import asyncio
import logging
import os
import json
from datetime import datetime, timedelta, timezone
from typing import List, Dict, Any, Optional
from fastapi import FastAPI, HTTPException, Request, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from cachetools import TTLCache
from pydantic import BaseModel

from backend.core.config import settings
from backend.core.db import init_db, close_db, get_pool
from backend.services.netbox_service import netbox_svc
from backend.services.jumpserver_service import jumpserver_svc
from backend.services.movidesk_service import movidesk_svc
from backend.services.oxidized_service import oxidized_svc
from backend.services.sync_service import sync_svc
from backend.services.snapshot_store import upsert_movidesk_companies, upsert_jumpserver_assets


logger = logging.getLogger(__name__)
sync_task: Optional[asyncio.Task] = None


async def movidesk_sync_loop():
    interval = settings.MOVIDESK_SYNC_INTERVAL or 600
    while True:
        try:
            if settings.MOVIDESK_SYNC_ENABLED:
                await sync_svc.generate_sync_report(store_pending=False)
        except asyncio.CancelledError:
            break
        except Exception:
            logger.exception("Falha ao executar varredura Movidesk periodica.")
        await asyncio.sleep(interval)
logging.basicConfig(
    level=logging.DEBUG,
    format='%(levelname)s:%(name)s:%(message)s'
)

# Cache initialization
cache = TTLCache(maxsize=1000, ttl=settings.CACHE_TTL)

app = FastAPI(title=settings.APP_NAME)

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def _is_snapshot_fresh(last_seen, ttl_seconds: int) -> bool:
    if not last_seen:
        return False
    if isinstance(last_seen, str):
        try:
            last_seen = datetime.fromisoformat(last_seen)
        except ValueError:
            return False
    if not isinstance(last_seen, datetime):
        return False
    if last_seen.tzinfo is None:
        last_seen = last_seen.replace(tzinfo=timezone.utc)
    now = datetime.now(timezone.utc)
    return now - last_seen <= timedelta(seconds=ttl_seconds)


async def load_jumpserver_snapshot_assets(ttl_seconds: int) -> Optional[List[Dict[str, Any]]]:
    pool = await get_pool()
    if not pool:
        return None
    async with pool.acquire() as conn:
        last_seen = await conn.fetchval('SELECT MAX("lastSeenAt") FROM "JumpserverAssetSnapshot"')
        if not _is_snapshot_fresh(last_seen, ttl_seconds) and not settings.HUB_SNAPSHOT_ALLOW_STALE:
            return None
        rows = await conn.fetch(
            'SELECT "jumpserverId", "name", "hostname", "ipAddress", "nodePath" FROM "JumpserverAssetSnapshot"'
        )
    assets = []
    for row in rows:
        node_path = row.get("nodePath") if isinstance(row, dict) else row["nodePath"]
        nodes_display = []
        if node_path:
            if isinstance(node_path, str) and "," in node_path:
                nodes_display = [n.strip() for n in node_path.split(",") if n.strip()]
            else:
                nodes_display = [str(node_path)]
        assets.append({
            "id": str(row["jumpserverId"]),
            "name": row["name"],
            "hostname": row["hostname"],
            "ip": row["ipAddress"],
            "nodes_display": nodes_display,
        })
    return assets


async def load_netbox_snapshot_devices(limit: int, group_filter: str, ttl_seconds: int) -> Optional[List[Dict[str, Any]]]:
    pool = await get_pool()
    if not pool:
        return None
    async with pool.acquire() as conn:
        state = await conn.fetchrow(
            'SELECT "metadata", "lastSuccessAt" FROM "NetboxSyncState" WHERE "key" = $1 AND "tenantId" IS NULL',
            "devices",
        )
        if not state:
            return None
        try:
            metadata = json.loads(state["metadata"]) if state["metadata"] else {}
        except Exception:
            metadata = {}
        full_sync_completed = bool(metadata.get("fullSyncCompleted") or metadata.get("fullSync"))
        if not full_sync_completed and not settings.HUB_SNAPSHOT_ALLOW_STALE:
            return None
        if not _is_snapshot_fresh(state["lastSuccessAt"], ttl_seconds) and not settings.HUB_SNAPSHOT_ALLOW_STALE:
            return None

        last_seen = await conn.fetchval('SELECT MAX("lastSeenAt") FROM "NetboxDeviceSnapshot"')
        if not _is_snapshot_fresh(last_seen, ttl_seconds) and not settings.HUB_SNAPSHOT_ALLOW_STALE:
            return None

        query = """
            SELECT d."netboxId",
                   d."name",
                   d."ipAddress",
                   d."tenantNetboxId",
                   t."name" AS tenant_name,
                   t."groupName" AS tenant_group,
                   s."name" AS site_name
            FROM "NetboxDeviceSnapshot" d
            LEFT JOIN "NetboxTenantSnapshot" t ON d."tenantNetboxId" = t."netboxId"
            LEFT JOIN "NetboxSiteSnapshot" s ON d."siteNetboxId" = s."netboxId"
        """
        params: List[Any] = []
        if group_filter:
            query += ' WHERE LOWER(t."groupName") = LOWER($1)'
            params.append(group_filter)
        query += ' ORDER BY d."name" ASC'
        if limit > 0:
            query += f' LIMIT {int(limit)}'
        rows = await conn.fetch(query, *params)

    devices = []
    for row in rows:
        devices.append({
            "netboxId": row["netboxId"],
            "name": row["name"],
            "ipAddress": row["ipAddress"],
            "tenantName": row["tenant_name"],
            "tenantGroup": row["tenant_group"],
            "siteName": row["site_name"],
        })
    return devices

@app.on_event("startup")
async def startup_event():
    logger.info("Starting Netbox Ops Center HUB...")
    try:
        await netbox_svc.ensure_custom_fields()
    except Exception:
        logger.exception("Falha ao inicializar integração com NetBox. HUB continuará carregando.")
    try:
        await init_db()
    except Exception:
        logger.exception("Falha ao inicializar banco local. Persistencia ficara desabilitada.")
    global sync_task
    if sync_task is None:
        sync_task = asyncio.create_task(movidesk_sync_loop())

@app.on_event("shutdown")
async def shutdown_event():
    try:
        await close_db()
    except Exception:
        logger.exception("Falha ao encerrar banco local.")
    global sync_task
    if sync_task:
        sync_task.cancel()
        try:
            await sync_task
        except asyncio.CancelledError:
            pass
        sync_task = None


# Models
class MovideskWebhook(BaseModel):
    id: str
    businessName: Optional[str] = None
    userName: Optional[str] = None
    email: Optional[str] = None
    # Add other fields as per Movidesk documentation

class DeviceRegistration(BaseModel):
    name: str
    ip: str
    tenant_name: str
    platform: str
    site: str
    manufacturer: str
    ssh_port: int = 22
    username: Optional[str] = None
    password: Optional[str] = None

@app.get("/")
async def root():
    return {"status": "online", "app": settings.APP_NAME}

# Sincronia Comercial: Webhook Movidesk
@app.post("/webhooks/movidesk")
async def movidesk_webhook(payload: MovideskWebhook, background_tasks: BackgroundTasks):
    tenant_data = movidesk_svc.parse_webhook_payload(payload.dict())
    
    if not settings.MOVIDESK_WEBHOOK_AUTO_CREATE:
        await upsert_movidesk_companies([{
            "id": tenant_data.get("movidesk_id"),
            "businessName": tenant_data.get("name"),
            "cpfCnpj": tenant_data.get("cnpj"),
            "isActive": True,
            "source": "webhook",
        }])
        return {
            "status": "pending",
            "message": "Alteracoes externas desativadas. Aguardando aprovacao manual.",
        }

    # Process netbox tenant creation (explicitly enabled)
    try:
        tenant = await netbox_svc.create_tenant(
            name=tenant_data["name"],
            slug=tenant_data["slug"],
            description=tenant_data["description"]
        )
        return {"status": "success", "tenant_id": tenant.id if tenant else None}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# Módulo de Auditoria: Netbox vs JumpServer
@app.get("/audit/jumpserver-missing")
async def audit_jumpserver(limit: int = 0):
    snapshot_ttl = settings.HUB_SNAPSHOT_TTL or settings.CACHE_TTL
    group_filter = (settings.NETBOX_TENANT_GROUP_FILTER or "").strip()
    nb_devices = await load_netbox_snapshot_devices(limit, group_filter, snapshot_ttl)
    using_nb_snapshot = nb_devices is not None
    if not using_nb_snapshot:
        nb_devices = await netbox_svc.get_devices()

    js_assets = await load_jumpserver_snapshot_assets(snapshot_ttl)
    if js_assets is None:
        js_assets = await jumpserver_svc.get_assets()
        try:
            await upsert_jumpserver_assets(js_assets)
        except Exception as e:
            logger.warning(f"Falha ao persistir JumpServer localmente: {e}")

    group_filter_norm = group_filter.lower()
    tenant_group_cache: Dict[int, Optional[str]] = {}

    def extract_name(value):
        if not value:
            return None
        if isinstance(value, dict):
            return value.get("name") or value.get("display")
        return getattr(value, "name", None) or getattr(value, "display", None)

    def extract_device_id(device):
        if isinstance(device, dict):
            return device.get("netboxId") or device.get("id")
        return getattr(device, "id", None)

    def extract_device_name(device):
        if isinstance(device, dict):
            return device.get("name") or device.get("deviceName")
        return getattr(device, "name", None)

    def extract_device_tenant(device):
        if isinstance(device, dict):
            return device.get("tenantName") or device.get("tenant") or "N/A"
        tenant_obj = getattr(device, "tenant", None)
        return tenant_obj.name if tenant_obj else "N/A"

    def extract_device_site(device):
        if isinstance(device, dict):
            return device.get("siteName") or "N/A"
        site_obj = getattr(device, "site", None)
        return site_obj.name if site_obj else "N/A"

    def extract_device_ip(device):
        if isinstance(device, dict):
            ip_val = device.get("ipAddress") or device.get("ip")
            if isinstance(ip_val, str):
                return ip_val.split("/")[0]
            return None
        primary_ip = getattr(device, "primary_ip", None)
        if primary_ip and getattr(primary_ip, "address", None):
            return str(primary_ip.address).split("/")[0]
        return None

    async def resolve_tenant_group_name(tenant) -> Optional[str]:
        if not tenant:
            return None
        tenant_id = getattr(tenant, "id", None) or (tenant.get("id") if isinstance(tenant, dict) else None)
        if tenant_id and tenant_id in tenant_group_cache:
            return tenant_group_cache[tenant_id]
        group_obj = getattr(tenant, "group", None) or getattr(tenant, "tenant_group", None)
        group_name = extract_name(group_obj)
        if not group_name and tenant_id:
            try:
                tenant_full = await netbox_svc.get_tenant_by_id(tenant_id)
                group_obj = getattr(tenant_full, "group", None) or getattr(tenant_full, "tenant_group", None)
                group_name = extract_name(group_obj)
            except Exception:
                group_name = None
        if tenant_id:
            tenant_group_cache[tenant_id] = group_name
        return group_name

    # Optional limit for testing
    nb_devices = list(nb_devices)
    
    # Filter out CAIXA-PRETA variations
    nb_devices = [d for d in nb_devices if "CAIXA-PRETA" not in (extract_device_name(d) or "").upper()]
    
    if group_filter and not using_nb_snapshot:
        filtered_devices = []
        for device in nb_devices:
            tenant = getattr(device, "tenant", None)
            group_name = await resolve_tenant_group_name(tenant)
            if group_name and group_name.lower() == group_filter_norm:
                filtered_devices.append(device)
        nb_devices = filtered_devices

    if limit > 0:
        nb_devices = nb_devices[:limit]

    
    # Map JumpServer assets by IP for quick lookup
    # and also store their nodes for tenant validation
    js_map = {}
    for asset in js_assets:
        ip = asset.get("ip")
        if ip:
            js_map[ip] = {
                "id": asset.get("id"),
                "name": asset.get("name"),
                "nodes": asset.get("nodes_display", []) # N8N workflow suggests nodes_display
            }
    
    missing = []
    for device in nb_devices:
        ip_str = extract_device_ip(device)
        tenant_name = extract_device_tenant(device)
        device_name = extract_device_name(device) or "N/A"
        device_id = extract_device_id(device)
        site_name = extract_device_site(device)

        if ip_str:
            asset_info = js_map.get(ip_str)

            error_reason = None
            if not asset_info:
                error_reason = "IP not found in JumpServer"
            else:
                # Optional strict node validation (default: ignore node mismatches).
                strict_nodes = (os.getenv("SANITY_CHECK_STRICT_NODES", "false").lower() == "true")
                if strict_nodes:
                    expected_suffixes = []
                    if tenant_name and tenant_name != "N/A":
                        expected_suffixes.append(f"/{tenant_name}".lower())
                        expected_suffixes.append(f"/default/servidores/{tenant_name}/host".lower())
                    if tenant_name and tenant_name != "N/A":
                        expected_suffixes.append(f"/default/produção/{tenant_name}".lower())
                        expected_suffixes.append(f"/default/producao/{tenant_name}".lower())
                    node_list = asset_info.get("nodes") or []
                    if isinstance(node_list, str):
                        node_list = [node_list]
                    normalized_nodes = [str(n).strip().lower() for n in node_list]
                    matches_node = any(
                        any(n.endswith(suffix) for suffix in expected_suffixes)
                        for n in normalized_nodes
                    )
                    if expected_suffixes and not matches_node:
                        error_reason = f"Node mismatch. Expected suffixes: {', '.join(expected_suffixes)}"

            if error_reason:
                missing.append({
                    "id": device_id,
                    "name": device_name,
                    "ip": ip_str,
                    "tenant": tenant_name,
                    "site": site_name,
                    "error": error_reason,
                    "js_asset_name": asset_info["name"] if asset_info else None
                })
    
    return {
        "summary": {
            "netbox_devices_analyzed": len(nb_devices),
            "jumpserver_assets_total": len(js_assets),
            "missing_count": len(missing),
            "limit_applied": limit
        },
        "missing_devices": missing
    }


@app.get("/debug/config")
async def debug_config():
    """Endpoint para depurar o carregamento de configurações e estado do NetBox."""
    def mask(val):
        if not val: return "NOT_SET"
        if len(val) < 6: return "***"
        return f"{val[:3]}...{val[-3:]}"
    
    nb_status = "error"
    custom_fields = []
    try:
        cf_list = await netbox_svc._run_async(netbox_svc.nb.extras.custom_fields.all)
        custom_fields = [f.name for f in cf_list]
        nb_status = "connected"
    except Exception as e:
        nb_status = f"error: {str(e)}"

    return {
        "status": "online",
        "netbox": {
            "url": settings.NETBOX_URL,
            "token": mask(settings.NETBOX_TOKEN),
            "status": nb_status,
            "custom_fields_detected": custom_fields
        },
        "movidesk": {
            "token": mask(settings.MOVIDESK_TOKEN),
            "enabled": settings.MOVIDESK_SYNC_ENABLED
        }
    }

@app.get("/sync/movidesk/report")
async def get_movidesk_sync_report():
    """Gera relatório de pendências entre Movidesk e Sistemas Internos."""
    report = await sync_svc.generate_sync_report()
    return {
        "count": len(report),
        "actions": report
    }

@app.get("/sync/movidesk/status")
async def get_movidesk_sync_status():
    """Resumo do ultimo scan Movidesk/NetBox/JumpServer."""
    summary = sync_svc.get_last_report_summary()
    if not summary.get("last_run"):
        await sync_svc.generate_sync_report(store_pending=False)
        summary = sync_svc.get_last_report_summary()
    return summary

@app.post("/sync/movidesk/approve")
async def approve_movidesk_sync(action_ids: List[str]):
    """Executa as ações aprovadas pelo usuário."""
    results = await sync_svc.execute_actions(action_ids)
    return {
        "results": results
    }

@app.get("/debug/jumpserver/nodes")
async def debug_jumpserver_nodes():
    """Lista todos os nodes do JumpServer para debug."""
    try:
        nodes = await jumpserver_svc.get_nodes()
        return {
            "total": len(nodes),
            "nodes": [
                {
                    "id": n.get("id"),
                    "value": n.get("value"),
                    "full_value": n.get("full_value"),
                    "key": n.get("key")
                }
                for n in nodes
            ]
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/debug/jumpserver/test-path")
async def debug_test_node_path(path: str):
    """Testa a criação de um path específico no JumpServer."""
    try:
        logger.info(f"Testing node path creation: {path}")
        result_id = await jumpserver_svc.ensure_node_path(path)

        # Verify it was created
        nodes = await jumpserver_svc.get_nodes()
        created_node = None
        for n in nodes:
            if n.get("id") == result_id:
                created_node = n
                break

        return {
            "requested_path": path,
            "result_id": result_id,
            "created_node": created_node,
            "success": result_id is not None
        }
    except Exception as e:
        logger.exception(f"Error testing path: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# Status de Backup: Agregador Oxidized
@app.get("/backup/status/{device_name}")
async def get_backup_status(device_name: str):
    # Check cache first
    cache_key = f"backup_status_{device_name}"
    if cache_key in cache:
        return cache[cache_key]
    
    # Fetch from Oxidized
    try:
        status = await oxidized_svc.get_node_status(device_name)
        if not status:
            return {"status": "not_found", "device": device_name}
        
        result = {
            "device": device_name,
            "last_status": status.get("last", {}).get("status", "unknown"),
            "last_end": status.get("last", {}).get("end"),
            "time": status.get("time"),
            "group": status.get("group")
        }
        
        cache[cache_key] = result
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# Cadastro de Equipamento (One-click multi-system)
@app.post("/operations/register-device")
async def register_device(data: DeviceRegistration):
    # This logic would normally involve:
    # 1. Netbox creation (Device, IP, Interface)
    # 2. JumpServer asset creation via API
    # 3. Oxidized node addition (triggering sync)
    
    # For now, let's implement the NetBox part as a demo or base
    try:
        # Placeholder for complex multi-system logic
        return {
            "status": "received",
            "message": "Registration logic for multi-system is being initialized",
            "data": data.name
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
