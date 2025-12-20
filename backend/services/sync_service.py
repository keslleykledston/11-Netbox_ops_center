import uuid
import logging
import re
from datetime import datetime, timezone
from typing import List, Dict, Any
from backend.services.movidesk_service import movidesk_svc
from backend.services.netbox_service import netbox_svc
from backend.services.jumpserver_service import jumpserver_svc
from backend.services.snapshot_store import (
    upsert_movidesk_companies,
    upsert_jumpserver_assets,
    upsert_sync_actions,
    update_sync_action_status,
)

logger = logging.getLogger(__name__)

class SyncService:
    def __init__(self):
        self._pending_actions: Dict[str, Dict[str, Any]] = {}
        self._last_report: List[Dict[str, Any]] = []
        self._last_report_at = None

    def get_last_report_summary(self) -> Dict[str, Any]:
        if not self._last_report_at:
            return {
                "has_discrepancies": False,
                "pending_count": 0,
                "total": 0,
                "last_run": None,
            }
        pending = [a for a in self._last_report if a.get("status") != "synced"]
        return {
            "has_discrepancies": len(pending) > 0,
            "pending_count": len(pending),
            "total": len(self._last_report),
            "last_run": self._last_report_at.isoformat(),
        }

    def _company_name_candidates(self, company: Dict[str, Any]) -> List[str]:
        keys = ("businessName", "companyName", "tradeName", "fantasyName", "name", "userName")
        candidates: List[str] = []
        for key in keys:
            value = company.get(key)
            if isinstance(value, str):
                cleaned = value.strip()
                if cleaned and cleaned not in candidates:
                    candidates.append(cleaned)
        return candidates

    def _normalize_name_tokens(self, name: str) -> List[str]:
        if not name:
            return []
        cleaned = name.upper().strip()
        cleaned = cleaned.replace("S/A", "SA").replace("S.A.", "SA").replace("S.A", "SA")
        cleaned = re.sub(r"[^A-Z0-9\\s]", " ", cleaned)
        cleaned = re.sub(r"\\s+", " ", cleaned).strip()
        tokens = cleaned.split()
        suffixes = {"LTDA", "ME", "EPP", "EIRELI", "SA", "TELECOM", "TELECOMUNICACAO", "TELECOMUNICACOES"}
        while tokens and tokens[-1] in suffixes:
            tokens.pop()
        return tokens

    def _names_equivalent(self, name_a: str, name_b: str) -> bool:
        if not name_a or not name_b:
            return False
        return self._normalize_name_tokens(name_a) == self._normalize_name_tokens(name_b)

    def _name_in_candidates(self, target: str, candidates: List[str]) -> bool:
        for cand in candidates:
            if self._names_equivalent(target, cand):
                return True
        return False

    async def generate_sync_report(self, store_pending: bool = True) -> List[Dict[str, Any]]:
        """
        Compare systems and generate a report of pending actions.
        """
        try:
            movidesk_companies = await movidesk_svc.get_active_companies()
            try:
                await upsert_movidesk_companies(movidesk_companies)
            except Exception as e:
                logger.warning(f"Falha ao persistir Movidesk localmente: {e}")

            js_assets = await jumpserver_svc.get_assets()
            try:
                await upsert_jumpserver_assets(js_assets)
            except Exception as e:
                logger.warning(f"Falha ao persistir JumpServer localmente: {e}")
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
            if store_pending:
                self._pending_actions.clear()
            
            report = []
            for company in movidesk_companies:
                m_id = str(company.get("id"))
                cnpj = company.get("cpfCnpj")
                name_candidates = self._company_name_candidates(company)
                if not name_candidates:
                    continue

                name = name_candidates[0]
                name_norm = name.upper().strip()

                # 1. Try match by Movidesk ID or CNPJ
                matching_tenant = nb_by_movidesk_id.get(m_id) or nb_by_cnpj.get(cnpj)
                
                # 2. Try match by Name (Case-Insensitive) as Fallback
                fallback_match = None
                if not matching_tenant:
                    for cand in name_candidates:
                        cand_norm = cand.upper().strip()
                        fallback_match = nb_by_name.get(cand_norm)
                        if fallback_match:
                            break

                if not matching_tenant and not fallback_match:
                    # CASE 1: TRUE NEW CLIENT
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
                    if store_pending:
                        if store_pending:
                            self._pending_actions[action_id] = action
                    report.append(action)
                
                elif fallback_match and not matching_tenant:
                    # CASE 2: NAME MATCHES BUT NO ID LINKED
                    preferred_name = fallback_match.name
                    node_paths = [f"/DEFAULT/PRODUÇÃO/{preferred_name}"]
                    if preferred_name != name:
                        node_paths.append(f"/DEFAULT/PRODUÇÃO/{name}")
                    js_exists = False
                    for node_path in node_paths:
                        if await jumpserver_svc.check_node_exists(node_path):
                            js_exists = True
                            break
                    
                    action_id = str(uuid.uuid4())
                    obs_list = [f"Aviso: Encontrado '{fallback_match.name}' no NetBox via nome."]
                    
                    if fallback_match.name != name and self._names_equivalent(fallback_match.name, name):
                        obs_list.append(f"Nome alternativo no Movidesk: '{name}'.")
                    elif fallback_match.name != name:
                        obs_list.append(f"Divergência de nome: '{fallback_match.name}' vs '{name}'.")
                    
                    obs_list.append("Sem vínculo com Movidesk ID.")
                    
                    if not js_exists:
                        obs_list.append(f"Node JumpServer ausente em '{node_paths[0]}'.")

                    action = {
                        "id": action_id,
                        "status": "pending_update",
                        "type": "update_client",
                        "netbox_id": fallback_match.id,
                        "client_name": preferred_name,
                        "old_name": fallback_match.name,
                        "cnpj": cnpj or "N/A",
                        "movidesk_id": m_id,
                        "systems": ["NetBox"],
                        "details": " | ".join(obs_list) + ". Recomenda-se atualizar."
                    }
                    if not js_exists:
                        action["systems"].append("JumpServer")
                        
                    if store_pending:
                        self._pending_actions[action_id] = action
                    report.append(action)

                else:
                    # CASE 3: MATCHED BY ID/CNPJ (FULLY IDENTIFIED)
                    equivalent_name = self._name_in_candidates(matching_tenant.name, name_candidates)
                    preferred_name = matching_tenant.name if equivalent_name else name
                    node_paths = [f"/DEFAULT/PRODUÇÃO/{preferred_name}"]
                    if preferred_name != name:
                        node_paths.append(f"/DEFAULT/PRODUÇÃO/{name}")
                    js_exists = False
                    for node_path in node_paths:
                        if await jumpserver_svc.check_node_exists(node_path):
                            js_exists = True
                            break
                    
                    name_mismatch = (not equivalent_name) and matching_tenant.name != name
                    case_only_mismatch = (not equivalent_name) and (matching_tenant.name.upper() == name.upper()) and name_mismatch

                    if name_mismatch or not js_exists:
                        action_id = str(uuid.uuid4())
                        obs_list = []
                        
                        if name_mismatch:
                            if case_only_mismatch:
                                obs_list.append(f"Variação de caixa: '{matching_tenant.name}' vs '{name}'.")
                            else:
                                obs_list.append(f"Divergência de nome: '{matching_tenant.name}' vs '{name}'.")
                        
                        if not js_exists:
                            obs_list.append(f"Node JumpServer ausente em '{node_paths[0]}'.")

                        action = {
                            "id": action_id,
                            "status": "pending_update",
                            "type": "update_client",
                            "netbox_id": matching_tenant.id,
                            "client_name": preferred_name,
                            "old_name": matching_tenant.name,
                            "cnpj": cnpj or "N/A",
                            "movidesk_id": m_id,
                            "systems": ["NetBox"] if name_mismatch else [],
                            "details": " | ".join(obs_list) + ". Sugerido sincronizar."
                        }
                        if not js_exists:
                            action["systems"].append("JumpServer")
                            
                        self._pending_actions[action_id] = action
                        report.append(action)
                    else:
                        # Already synced (Exactly identical name and JS node exists)
                        report.append({
                            "id": f"synced-{m_id}",
                            "status": "synced",
                            "client_name": name,
                            "cnpj": cnpj or "N/A",
                            "movidesk_id": m_id,
                            "systems": ["NetBox", "JumpServer", "Oxidized"],
                            "details": "Sincronizado e validado (Nome idêntico e Node OK)."
                        })

            try:
                await upsert_sync_actions(report)
            except Exception as e:
                logger.warning(f"Falha ao persistir relatorio de sync: {e}")
            self._last_report = report
            self._last_report_at = datetime.now(timezone.utc)
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
                    node_path = f"/DEFAULT/PRODUÇÃO/{action['client_name']}"
                    await jumpserver_svc.ensure_node_path(node_path)
                    
                    # 3. Oxidized (Logic to create group if possible)
                    # For now we assume the group is ready or assigned in metadata.
                    
                    results.append({"id": aid, "status": "success", "client": action["client_name"]})
                    try:
                        await update_sync_action_status(aid, "success")
                    except Exception as e:
                        logger.warning(f"Falha ao atualizar sync action {aid}: {e}")
                    del self._pending_actions[aid]

                elif action["type"] == "update_client":
                    # Update or Create Netbox Tenant
                    nb_id = action.get("netbox_id")
                    tenant = None

                    # Try multiple strategies to find existing tenant
                    if nb_id:
                        tenant = await netbox_svc.get_tenant_by_id(nb_id)

                    if not tenant:
                        # Fallback 1: Search by ERP_ID
                        tenant = await netbox_svc.get_tenant_by_custom_field("ERP_ID", action["movidesk_id"]) or \
                                 await netbox_svc.get_tenant_by_custom_field("erp_id", action["movidesk_id"]) or \
                                 await netbox_svc.get_tenant_by_custom_field("movidesk_id", action["movidesk_id"])

                    if not tenant:
                        # Fallback 2: Search by name in the same group
                        tenants = await netbox_svc.get_tenants(**{"group-name": "K3G Solutions"})
                        for t in tenants:
                            if t.name == action["client_name"]:
                                tenant = t
                                logger.warning(f"Tenant '{action['client_name']}' found by name match (not by ERP_ID)")
                                break

                    # If tenant doesn't exist in Netbox, create it
                    if not tenant:
                        logger.info(f"Tenant '{action['client_name']}' não encontrado no Netbox. Criando novo tenant.")

                        # Get or use group
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

                        # Create JumpServer node
                        node_path = f"/DEFAULT/PRODUÇÃO/{action['client_name']}"
                        await jumpserver_svc.ensure_node_path(node_path)

                        results.append({"id": aid, "status": "success", "client": action["client_name"], "message": "Tenant criado no Netbox e node criado no Jumpserver"})
                        try:
                            await update_sync_action_status(aid, "success", "Tenant criado no Netbox e node criado no Jumpserver")
                        except Exception as e:
                            logger.warning(f"Falha ao atualizar sync action {aid}: {e}")
                        del self._pending_actions[aid]
                        continue
                    else:
                        # Use found tenant's ID
                        nb_id = tenant.id
                        logger.info(f"Tenant '{action['client_name']}' encontrado no Netbox (ID: {nb_id}). Atualizando...")

                    # Tenant exists, update it
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

                    # Ensure JumpServer node exists
                    node_path = f"/DEFAULT/PRODUÇÃO/{action['client_name']}"
                    await jumpserver_svc.ensure_node_path(node_path)

                    if conflicts:
                        results.append({
                            "id": aid,
                            "status": "warning",
                            "message": f"Sincronizado parcial. Conflito em: {', '.join(conflicts)}",
                            "client": action["client_name"]
                        })
                        try:
                            await update_sync_action_status(aid, "warning", f"Sincronizado parcial. Conflito em: {', '.join(conflicts)}")
                        except Exception as e:
                            logger.warning(f"Falha ao atualizar sync action {aid}: {e}")
                    else:
                        results.append({"id": aid, "status": "success", "client": action["client_name"]})
                        try:
                            await update_sync_action_status(aid, "success")
                        except Exception as e:
                            logger.warning(f"Falha ao atualizar sync action {aid}: {e}")

                    del self._pending_actions[aid]

            except Exception as e:
                logger.error(f"Error executing action {aid}: {e}")
                results.append({"id": aid, "status": "error", "message": str(e)})
                try:
                    await update_sync_action_status(aid, "error", str(e))
                except Exception as err:
                    logger.warning(f"Falha ao atualizar sync action {aid}: {err}")
        
        return results

sync_svc = SyncService()
