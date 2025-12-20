import asyncio
import logging
from typing import List, Dict, Any, Optional
from fastapi import FastAPI, HTTPException, Request, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from cachetools import TTLCache
from pydantic import BaseModel

from backend.core.config import settings
from backend.core.db import init_db, close_db
from backend.services.netbox_service import netbox_svc
from backend.services.jumpserver_service import jumpserver_svc
from backend.services.movidesk_service import movidesk_svc
from backend.services.oxidized_service import oxidized_svc
from backend.services.sync_service import sync_svc


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
    
    # Process netbox tenant creation
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
    # Performance: Run queries simultaneously
    nb_devices_task = netbox_svc.get_devices()
    js_assets_task = jumpserver_svc.get_assets()
    
    nb_devices, js_assets = await asyncio.gather(nb_devices_task, js_assets_task)
    
    # Optional limit for testing
    nb_devices = list(nb_devices)
    
    # Filter out CAIXA-PRETA variations
    nb_devices = [d for d in nb_devices if "CAIXA-PRETA" not in (d.name or "").upper()]
    
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
        primary_ip = getattr(device, 'primary_ip', None)
        tenant_name = device.tenant.name if device.tenant else "N/A"
        
        if primary_ip:
            ip_str = str(primary_ip.address).split("/")[0]
            asset_info = js_map.get(ip_str)
            
            error_reason = None
            if not asset_info:
                error_reason = "IP not found in JumpServer"
            else:
                # Validate if asset is in the correct Tenant Node
                # Expected path: /DEFAULT/PRODUCAO/TenantName
                expected_node = f"/DEFAULT/PRODUCAO/{tenant_name}"
                if tenant_name != "N/A" and expected_node not in asset_info["nodes"]:
                    error_reason = f"Node mismatch. Expected: {expected_node}"
            
            if error_reason:
                missing.append({
                    "id": device.id,
                    "name": device.name,
                    "ip": ip_str,
                    "tenant": tenant_name,
                    "site": device.site.name if device.site else "N/A",
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
