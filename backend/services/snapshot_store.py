import json
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, Iterable, List, Optional

from backend.core.db import get_pool


def _first_name(company: Dict[str, Any]) -> Optional[str]:
    for key in ("businessName", "companyName", "tradeName", "fantasyName", "name", "userName"):
        value = company.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def _is_snapshot_fresh(last_seen: Optional[Any], ttl_seconds: int) -> bool:
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


async def load_movidesk_snapshot_companies(ttl_seconds: int, allow_stale: bool = False) -> Optional[List[Dict[str, Any]]]:
    pool = await get_pool()
    if not pool:
        return None
    async with pool.acquire() as conn:
        last_seen = await conn.fetchval('SELECT MAX("lastSeenAt") FROM "MovideskCompany"')
        if not _is_snapshot_fresh(last_seen, ttl_seconds) and not allow_stale:
            return None
        rows = await conn.fetch(
            'SELECT "movideskId", "name", "businessName", "tradeName", "cnpj", "rawData" FROM "MovideskCompany" WHERE "isActive" = true'
        )
    companies: List[Dict[str, Any]] = []
    for row in rows:
        payload: Dict[str, Any] = {}
        raw = row.get("rawData") if isinstance(row, dict) else row["rawData"]
        if raw:
            try:
                payload = json.loads(raw)
            except Exception:
                payload = {}
        payload.update({
            "id": row.get("movideskId") if isinstance(row, dict) else row["movideskId"],
            "name": row.get("name") if isinstance(row, dict) else row["name"],
            "businessName": row.get("businessName") if isinstance(row, dict) else row["businessName"],
            "tradeName": row.get("tradeName") if isinstance(row, dict) else row["tradeName"],
            "cpfCnpj": row.get("cnpj") if isinstance(row, dict) else row["cnpj"],
        })
        companies.append(payload)
    return companies


async def load_jumpserver_snapshot_assets(ttl_seconds: int, allow_stale: bool = False) -> Optional[List[Dict[str, Any]]]:
    pool = await get_pool()
    if not pool:
        return None
    async with pool.acquire() as conn:
        last_seen = await conn.fetchval('SELECT MAX("lastSeenAt") FROM "JumpserverAssetSnapshot"')
        if not _is_snapshot_fresh(last_seen, ttl_seconds) and not allow_stale:
            return None
        rows = await conn.fetch(
            'SELECT "jumpserverId", "name", "hostname", "ipAddress", "nodePath", "platform", "rawData" FROM "JumpserverAssetSnapshot"'
        )
    assets: List[Dict[str, Any]] = []
    for row in rows:
        payload: Dict[str, Any] = {}
        raw = row.get("rawData") if isinstance(row, dict) else row["rawData"]
        if raw:
            try:
                payload = json.loads(raw)
            except Exception:
                payload = {}
        node_path = row.get("nodePath") if isinstance(row, dict) else row["nodePath"]
        nodes_display = []
        if node_path:
            if isinstance(node_path, str) and "," in node_path:
                nodes_display = [n.strip() for n in node_path.split(",") if n.strip()]
            else:
                nodes_display = [str(node_path)]
        payload.update({
            "id": row.get("jumpserverId") if isinstance(row, dict) else row["jumpserverId"],
            "name": row.get("name") if isinstance(row, dict) else row["name"],
            "hostname": row.get("hostname") if isinstance(row, dict) else row["hostname"],
            "ip": row.get("ipAddress") if isinstance(row, dict) else row["ipAddress"],
            "nodes_display": nodes_display,
            "platform": row.get("platform") if isinstance(row, dict) else row["platform"],
        })
        assets.append(payload)
    return assets


async def load_netbox_snapshot_tenants(group_filter: str, ttl_seconds: int, allow_stale: bool = False) -> Optional[List[Dict[str, Any]]]:
    pool = await get_pool()
    if not pool:
        return None
    async with pool.acquire() as conn:
        last_seen = await conn.fetchval('SELECT MAX("lastSeenAt") FROM "NetboxTenantSnapshot"')
        if not _is_snapshot_fresh(last_seen, ttl_seconds) and not allow_stale:
            return None
        query = 'SELECT "netboxId", "name", "groupName", "erpId", "cnpj", "rawData" FROM "NetboxTenantSnapshot"'
        params: List[Any] = []
        if group_filter:
            query += ' WHERE LOWER("groupName") = LOWER($1)'
            params.append(group_filter)
        rows = await conn.fetch(query, *params)
    tenants: List[Dict[str, Any]] = []
    for row in rows:
        payload: Dict[str, Any] = {}
        raw = row.get("rawData") if isinstance(row, dict) else row["rawData"]
        if raw:
            try:
                payload = json.loads(raw)
            except Exception:
                payload = {}
        custom_fields = payload.get("custom_fields") or {}
        if row.get("erpId") if isinstance(row, dict) else row["erpId"]:
            custom_fields.setdefault("ERP_ID", row.get("erpId") if isinstance(row, dict) else row["erpId"])
        if row.get("cnpj") if isinstance(row, dict) else row["cnpj"]:
            custom_fields.setdefault("CNPJ", row.get("cnpj") if isinstance(row, dict) else row["cnpj"])
        tenants.append({
            "id": row.get("netboxId") if isinstance(row, dict) else row["netboxId"],
            "name": row.get("name") if isinstance(row, dict) else row["name"],
            "custom_fields": custom_fields,
            "group": {"name": row.get("groupName") if isinstance(row, dict) else row["groupName"]} if (row.get("groupName") if isinstance(row, dict) else row["groupName"]) else None,
        })
    return tenants


async def upsert_movidesk_companies(companies: Iterable[Dict[str, Any]]) -> None:
    pool = await get_pool()
    if not pool:
        return

    rows = []
    for company in companies:
        movidesk_id = str(company.get("id"))
        name = _first_name(company)
        if not movidesk_id or not name:
            continue
        is_active = company.get("isActive")
        if is_active is None:
            is_active = True
        rows.append({
            "movideskId": movidesk_id,
            "name": name,
            "businessName": company.get("businessName"),
            "tradeName": company.get("tradeName") or company.get("fantasyName"),
            "cnpj": company.get("cpfCnpj"),
            "status": company.get("status"),
            "isActive": bool(is_active),
            "rawData": json.dumps(company, ensure_ascii=True),
        })

    if not rows:
        return

    query = """
        INSERT INTO "MovideskCompany" (
            "movideskId",
            "name",
            "businessName",
            "tradeName",
            "cnpj",
            "status",
            "isActive",
            "rawData",
            "lastSeenAt",
            "createdAt",
            "updatedAt"
        )
        VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8,
            CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )
        ON CONFLICT ("movideskId") DO UPDATE SET
            "name" = EXCLUDED."name",
            "businessName" = EXCLUDED."businessName",
            "tradeName" = EXCLUDED."tradeName",
            "cnpj" = EXCLUDED."cnpj",
            "status" = EXCLUDED."status",
            "isActive" = EXCLUDED."isActive",
            "rawData" = EXCLUDED."rawData",
            "lastSeenAt" = CURRENT_TIMESTAMP,
            "updatedAt" = CURRENT_TIMESTAMP
    """

    async with pool.acquire() as conn:
        for row in rows:
            await conn.execute(
                query,
                row["movideskId"],
                row["name"],
                row["businessName"],
                row["tradeName"],
                row["cnpj"],
                row["status"],
                row["isActive"],
                row["rawData"],
            )


async def upsert_jumpserver_assets(assets: Iterable[Dict[str, Any]]) -> None:
    pool = await get_pool()
    if not pool:
        return

    rows = []
    for asset in assets:
        jumpserver_id = asset.get("id")
        if not jumpserver_id:
            continue

        nodes_display = asset.get("nodes_display")
        node_path = None
        if isinstance(nodes_display, list) and nodes_display:
            node_path = nodes_display[0]
            if len(nodes_display) > 1:
                node_path = ", ".join(nodes_display)
        elif isinstance(nodes_display, str):
            node_path = nodes_display

        platform = asset.get("platform") or asset.get("platform_name")
        if isinstance(platform, dict):
            platform = platform.get("name") or platform.get("value") or platform.get("id")

        ip_address = asset.get("ip") or asset.get("address") or asset.get("host") or asset.get("ip_address")

        rows.append({
            "jumpserverId": str(jumpserver_id),
            "name": asset.get("name"),
            "hostname": asset.get("hostname"),
            "ipAddress": ip_address,
            "assetId": asset.get("asset_id") or asset.get("id"),
            "hostId": asset.get("host_id"),
            "nodePath": node_path,
            "platform": platform,
            "rawData": json.dumps(asset, ensure_ascii=True),
        })

    if not rows:
        return

    query = """
        INSERT INTO "JumpserverAssetSnapshot" (
            "jumpserverId",
            "name",
            "hostname",
            "ipAddress",
            "assetId",
            "hostId",
            "nodePath",
            "platform",
            "rawData",
            "lastSeenAt",
            "createdAt",
            "updatedAt"
        )
        VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9,
            CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )
        ON CONFLICT ("jumpserverId") DO UPDATE SET
            "name" = EXCLUDED."name",
            "hostname" = EXCLUDED."hostname",
            "ipAddress" = EXCLUDED."ipAddress",
            "assetId" = EXCLUDED."assetId",
            "hostId" = EXCLUDED."hostId",
            "nodePath" = EXCLUDED."nodePath",
            "platform" = EXCLUDED."platform",
            "rawData" = EXCLUDED."rawData",
            "lastSeenAt" = CURRENT_TIMESTAMP,
            "updatedAt" = CURRENT_TIMESTAMP
    """

    async with pool.acquire() as conn:
        for row in rows:
            await conn.execute(
                query,
                row["jumpserverId"],
                row["name"],
                row["hostname"],
                row["ipAddress"],
                row["assetId"],
                row["hostId"],
                row["nodePath"],
                row["platform"],
                row["rawData"],
            )


async def upsert_sync_actions(actions: Iterable[Dict[str, Any]]) -> None:
    pool = await get_pool()
    if not pool:
        return

    action_list: List[Dict[str, Any]] = []
    movidesk_ids: List[str] = []
    for action in actions:
        movidesk_id = action.get("movidesk_id")
        if movidesk_id:
            movidesk_ids.append(str(movidesk_id))
        action_list.append(action)

    company_map: Dict[str, int] = {}
    if movidesk_ids:
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                "SELECT id, \"movideskId\" FROM \"MovideskCompany\" WHERE \"movideskId\" = ANY($1)",
                movidesk_ids,
            )
            company_map = {str(row["movideskId"]): row["id"] for row in rows}

    query = """
        INSERT INTO "MovideskSyncAction" (
            "id",
            "movideskCompanyId",
            "movideskId",
            "netboxTenantId",
            "netboxTenantName",
            "jumpserverNodePath",
            "status",
            "type",
            "systems",
            "details",
            "payload",
            "createdAt",
            "updatedAt"
        )
        VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
            CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )
        ON CONFLICT ("id") DO UPDATE SET
            "movideskCompanyId" = EXCLUDED."movideskCompanyId",
            "movideskId" = EXCLUDED."movideskId",
            "netboxTenantId" = EXCLUDED."netboxTenantId",
            "netboxTenantName" = EXCLUDED."netboxTenantName",
            "jumpserverNodePath" = EXCLUDED."jumpserverNodePath",
            "status" = EXCLUDED."status",
            "type" = EXCLUDED."type",
            "systems" = EXCLUDED."systems",
            "details" = EXCLUDED."details",
            "payload" = EXCLUDED."payload",
            "updatedAt" = CURRENT_TIMESTAMP
    """

    async with pool.acquire() as conn:
        for action in action_list:
            movidesk_id = action.get("movidesk_id")
            movidesk_company_id = company_map.get(str(movidesk_id)) if movidesk_id else None
            systems = action.get("systems")
            action_type = action.get("type")
            if not action_type:
                action_type = "synced" if action.get("status") == "synced" else "unknown"
            await conn.execute(
                query,
                str(action.get("id")),
                movidesk_company_id,
                str(movidesk_id) if movidesk_id else None,
                action.get("netbox_id"),
                action.get("client_name"),
                action.get("jumpserver_node"),
                action.get("status"),
                action_type,
                json.dumps(systems, ensure_ascii=True) if systems is not None else None,
                action.get("details"),
                json.dumps(action, ensure_ascii=True),
            )


async def update_sync_action_status(action_id: str, status: str, message: Optional[str] = None) -> None:
    pool = await get_pool()
    if not pool:
        return

    query = """
        UPDATE "MovideskSyncAction"
        SET "status" = $2,
            "details" = COALESCE($3, "details"),
            "updatedAt" = CURRENT_TIMESTAMP
        WHERE "id" = $1
    """

    async with pool.acquire() as conn:
        await conn.execute(query, str(action_id), status, message)
