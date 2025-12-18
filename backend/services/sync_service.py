import uuid
import logging
from typing import List, Dict, Any
from backend.services.movidesk_service import movidesk_svc
from backend.services.netbox_service import netbox_svc
from backend.services.jumpserver_service import jumpserver_svc

logger = logging.getLogger(__name__)

class SyncService:
    def __init__(self):
        self._pending_actions: Dict[str, Dict[str, Any]] = {}

    async def generate_sync_report(self) -> List[Dict[str, Any]]:
        """
        Compare systems and generate a report of pending actions.
        """
        try:
            movidesk_companies = await movidesk_svc.get_active_companies()
            # User requirement: Only tenants from 'K3G Solutions' group
            netbox_tenants = await netbox_svc.get_tenants(**{"group-name": "K3G Solutions"})
            
            # Mapping Netbox tenants
            nb_by_movidesk_id = {}
            nb_by_cnpj = {}
            nb_by_name = {} # Fallback: normalized name
            
            for t in netbox_tenants:
                cf = getattr(t, 'custom_fields', {}) or {}
                # Support both new 'ERP_ID' and old 'movidesk_id' during transition
                m_id = str(cf.get('ERP_ID') or cf.get('erp_id') or cf.get('movidesk_id') or "")
                cnpj = str(cf.get('CNPJ') or cf.get('cnpj') or "")
                
                if m_id: nb_by_movidesk_id[m_id] = t
                if cnpj: nb_by_cnpj[cnpj] = t
                
                # Store by name for fallback lookup (normalized)
                nb_by_name[t.name.upper().strip()] = t
 
            # Clear previous pending for fresh report
            self._pending_actions.clear()
            
            report = []
            for company in movidesk_companies:
                m_id = str(company.get("id"))
                cnpj = company.get("cpfCnpj")
                name = company.get("businessName") or company.get("userName")
                
                if not name:
                    continue
                
                name_norm = name.upper().strip()

                # 1. Try match by Movidesk ID or CNPJ
                matching_tenant = nb_by_movidesk_id.get(m_id) or nb_by_cnpj.get(cnpj)
                
                # 2. Try match by Name (Case-Insensitive) as Fallback
                fallback_match = None
                if not matching_tenant:
                    fallback_match = nb_by_name.get(name_norm)

                if not matching_tenant and not fallback_match:
                    # TRUE NEW CLIENT
                    action_id = str(uuid.uuid4())
                    action = {
                        "id": action_id,
                        "status": "pending_create",
                        "type": "sync_client",
                        "client_name": name,
                        "cnpj": cnpj or "N/A",
                        "movidesk_id": m_id,
                        "systems": ["NetBox", "JumpServer", "Oxidized"],
                        "details": f"Cliente não encontrado. Criar novo Tenant '{name}' e infra associada."
                    }
                    self._pending_actions[action_id] = action
                    report.append(action)
                
                elif fallback_match and not matching_tenant:
                    # NAME MATCHES BUT NO ID LINKED
                    action_id = str(uuid.uuid4())
                    
                    details = f"Aviso: Encontrado '{fallback_match.name}' no NetBox via nome. "
                    if fallback_match.name != name:
                        details += f"Diferença de caixa: '{fallback_match.name}' vs '{name}'. "
                    details += "O Tenant existe mas não está vinculado ao Movidesk ID. Recomenda-se ATUALIZAR para vincular."

                    action = {
                        "id": action_id,
                        "status": "pending_update",
                        "type": "update_client",
                        "netbox_id": fallback_match.id,
                        "client_name": name,
                        "old_name": fallback_match.name,
                        "cnpj": cnpj or "N/A",
                        "movidesk_id": m_id,
                        "systems": ["NetBox"],
                        "details": details
                    }
                    self._pending_actions[action_id] = action
                    report.append(action)

                else:
                    # MATCHED BY ID/CNPJ (FULLY IDENTIFIED)
                    name_mismatch = matching_tenant.name != name
                    case_only_mismatch = (matching_tenant.name.upper() == name.upper()) and name_mismatch

                    if name_mismatch:
                        action_id = str(uuid.uuid4())
                        
                        if case_only_mismatch:
                            obs = f"Variação de caixa encontrada: '{matching_tenant.name}' no NetBox vs '{name}' no Movidesk. Sugerido atualizar para padronizar."
                        else:
                            obs = f"Divergência de nome: Atualmente '{matching_tenant.name}' no NetBox. Movidesk informa '{name}'."

                        action = {
                            "id": action_id,
                            "status": "pending_update",
                            "type": "update_client",
                            "netbox_id": matching_tenant.id,
                            "client_name": name,
                            "old_name": matching_tenant.name,
                            "cnpj": cnpj or "N/A",
                            "movidesk_id": m_id,
                            "systems": ["NetBox", "JumpServer"],
                            "details": obs
                        }
                        self._pending_actions[action_id] = action
                        report.append(action)
                    else:
                        # Already synced (Exactly identical)
                        report.append({
                            "id": f"synced-{m_id}",
                            "status": "synced",
                            "client_name": name,
                            "cnpj": cnpj or "N/A",
                            "movidesk_id": m_id,
                            "systems": ["NetBox", "JumpServer", "Oxidized"],
                            "details": "Sincronizado e validado (Nome idêntico)."
                        })

            return report
        except Exception as e:
            logger.error(f"Error generating sync report: {e}")
            return []

    async def execute_actions(self, action_ids: List[str]) -> List[Dict[str, Any]]:
        results = []
        for aid in action_ids:
            action = self._pending_actions.get(aid)
            if not action:
                results.append({"id": aid, "status": "error", "message": "Ação expirou ou não existe."})
                continue
            
            try:
                if action["type"] == "sync_client":
                    # 1. NetBox - Ensure group exists or get ID
                    group = await netbox_svc.get_tenant_group_by_name("K3G Solutions")
                    group_id = group.id if group else None

                    # Convert Movidesk ID to int for NetBox compatibility
                    try:
                        m_id_val = int(action["movidesk_id"])
                    except:
                        m_id_val = action["movidesk_id"]

                    tenant = await netbox_svc.create_tenant(
                        name=action["client_name"],
                        slug=action["client_name"].lower().replace(" ", "-")[:50],
                        description=f"Sincronizado via Movidesk ID: {action['movidesk_id']}",
                        custom_fields={
                            "ERP_ID": m_id_val,
                            "CNPJ": action["cnpj"]
                        },
                        group_id=group_id
                    )
                    
                    # 2. JumpServer
                    node_path = f"/DEFAULT/PRODUCAO/{action['client_name']}"
                    await jumpserver_svc.ensure_node_path(node_path)
                    
                    # 3. Oxidized (Logic to create group if possible)
                    # For now we assume the group is ready or assigned in metadata.
                    
                    results.append({"id": aid, "status": "success", "client": action["client_name"]})
                    del self._pending_actions[aid]

                elif action["type"] == "update_client":
                    # Update Netbox
                    nb_id = action.get("netbox_id")
                    if not nb_id:
                        # Fallback to lookup by ERP_ID if somehow missing id
                        matching_tenant = await netbox_svc.get_tenant_by_custom_field("ERP_ID", action["movidesk_id"]) or \
                                         await netbox_svc.get_tenant_by_custom_field("erp_id", action["movidesk_id"]) or \
                                         await netbox_svc.get_tenant_by_custom_field("movidesk_id", action["movidesk_id"])
                        nb_id = matching_tenant.id if matching_tenant else None
                    
                    if nb_id:
                        tenant = await netbox_svc.get_tenant_by_id(nb_id)
                        if tenant:
                            cf = getattr(tenant, 'custom_fields', {}) or {}
                            conflicts = []
                            new_cf = {}

                            # Check ERP_ID
                            curr_erp = cf.get('ERP_ID') or cf.get('erp_id') or cf.get('movidesk_id')
                            try:
                                m_id_val = int(action["movidesk_id"])
                            except:
                                m_id_val = action["movidesk_id"]

                            if curr_erp and str(curr_erp) != str(m_id_val):
                                conflicts.append(f"ERP_ID ({curr_erp} vs {m_id_val})")
                            else:
                                new_cf["ERP_ID"] = m_id_val

                            # Check CNPJ
                            curr_cnpj = cf.get('CNPJ') or cf.get('cnpj')
                            if curr_cnpj and str(curr_cnpj) != str(action["cnpj"]):
                                conflicts.append(f"CNPJ ({curr_cnpj} vs {action['cnpj']})")
                            else:
                                new_cf["CNPJ"] = action["cnpj"]

                            update_payload = {"name": action["client_name"]}
                            if new_cf:
                                update_payload["custom_fields"] = new_cf
                            
                            await netbox_svc.update_tenant(nb_id, update_payload)
                            
                            if conflicts:
                                results.append({
                                    "id": aid, 
                                    "status": "warning", 
                                    "message": f"Sincronizado parcial. Conflito em: {', '.join(conflicts)}",
                                    "client": action["client_name"]
                                })
                                continue

                    # Update JumpServer
                    node_path = f"/DEFAULT/PRODUCAO/{action['client_name']}"
                    await jumpserver_svc.ensure_node_path(node_path)
                    
                    results.append({"id": aid, "status": "success", "client": action["client_name"]})
                    del self._pending_actions[aid]

            except Exception as e:
                logger.error(f"Error executing action {aid}: {e}")
                results.append({"id": aid, "status": "error", "message": str(e)})
        
        return results

sync_svc = SyncService()
