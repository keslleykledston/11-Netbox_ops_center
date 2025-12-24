import asyncio
import base64
import httpx
import json
import logging
import random
import time
from backend.core.config import settings
from typing import List, Dict, Any, Optional

logger = logging.getLogger(__name__)

class JumpServerService:
    def __init__(self):
        self.base_url = (settings.JUMPSERVER_URL or "").rstrip("/")
        self._cached_token: Optional[str] = settings.JUMPSERVER_TOKEN
        self._token_type = "Bearer" # N8N flow uses Bearer for JWT
        self._token_expires_at: Optional[float] = None
        self._login_lock = asyncio.Lock()

    def _normalize_path(self, path: str) -> str:
        """Normalize JumpServer paths to avoid false negatives (extra slashes/spaces)."""
        clean_parts = [p.strip() for p in path.split("/") if p and p.strip()]
        return "/" + "/".join(clean_parts)

    def _decode_jwt_exp(self, token: str) -> Optional[float]:
        try:
            parts = token.split(".")
            if len(parts) < 2:
                return None
            payload = parts[1]
            padding = "=" * (-len(payload) % 4)
            decoded = base64.urlsafe_b64decode(f"{payload}{padding}".encode("utf-8"))
            data = json.loads(decoded.decode("utf-8"))
            exp = data.get("exp")
            if isinstance(exp, (int, float)):
                return float(exp)
        except Exception:
            return None
        return None

    def _resolve_token_expiry(self, data: Dict[str, Any], token: str) -> Optional[float]:
        exp = self._decode_jwt_exp(token)
        if exp:
            return exp
        if isinstance(data.get("expires_in"), (int, float)):
            return time.time() + float(data["expires_in"])
        if isinstance(data.get("expire_in"), (int, float)):
            return time.time() + float(data["expire_in"])
        if isinstance(data.get("expired_at"), (int, float)):
            return float(data["expired_at"])
        if isinstance(data.get("expire_at"), (int, float)):
            return float(data["expire_at"])
        return None

    def _token_is_valid(self) -> bool:
        if not self._cached_token:
            return False
        if not self._token_expires_at:
            return True
        return time.time() < (self._token_expires_at - 30)

    async def _wait_for_token_ready(self) -> None:
        await asyncio.sleep(random.uniform(3.0, 5.0))

    async def login(self, force: bool = False) -> Optional[str]:
        """Perform login to get a fresh JWT token."""
        if not self.base_url or not settings.JUMPSERVER_USERNAME or not settings.JUMPSERVER_PASSWORD:
            logger.warning("JumpServer base_url or credentials not configured")
            return None

        if not force and self._token_is_valid():
            return self._cached_token

        async with self._login_lock:
            if not force and self._token_is_valid():
                return self._cached_token

            async with httpx.AsyncClient(follow_redirects=True) as client:
                endpoint = f"{self.base_url}/api/v1/authentication/auth/"
                payload = {
                    "username": settings.JUMPSERVER_USERNAME,
                    "password": settings.JUMPSERVER_PASSWORD
                }
                try:
                    logger.info(f"Attempting login to JumpServer as {settings.JUMPSERVER_USERNAME}")
                    response = await client.post(endpoint, json=payload, timeout=10.0)
                    response.raise_for_status()
                    data = response.json()
                    token = data.get("token")
                    if token:
                        self._cached_token = token
                        self._token_expires_at = self._resolve_token_expiry(data, token)
                        await self._wait_for_token_ready()
                        logger.info("Successfully authenticated to JumpServer")
                        return token
                    logger.error("JumpServer login response did not include a token")
                    self._cached_token = None
                    self._token_expires_at = None
                    return None
                except httpx.HTTPStatusError as e:
                    logger.error(f"Failed to login to JumpServer: {e}")
                    logger.error(f"Response status: {e.response.status_code}")
                    logger.error(f"Response body: {e.response.text}")
                    return None
                except Exception as e:
                    logger.error(f"Failed to login to JumpServer: {e}")
                    return None

    async def get_headers(self) -> Dict[str, str]:
        # If we have a static token, use it. Otherwise, use cached or login.
        token = settings.JUMPSERVER_TOKEN or None

        if not token:
            if not self._token_is_valid() and settings.JUMPSERVER_USERNAME and settings.JUMPSERVER_PASSWORD:
                token = await self.login()
            else:
                token = self._cached_token
        
        # Base headers
        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json"
        }
        
        # Only add Authorization header if we have a valid token
        if token:
            prefix = "Bearer" if settings.JUMPSERVER_USERNAME else "Token"
            headers["Authorization"] = f"{prefix} {token}"
        else:
            logger.warning("No Jumpserver token available. API calls may fail.")
            
        return headers

    async def get_assets(self) -> List[Dict[str, Any]]:
        if not self.base_url:
            return []
        
        headers = await self.get_headers()
        async with httpx.AsyncClient(follow_redirects=True) as client:
            endpoint = f"{self.base_url}/api/v1/assets/assets/"
            try:
                response = await client.get(endpoint, headers=headers, timeout=10.0)
                if response.status_code == 401:
                    # Token might be expired, try login once
                    await self.login(force=True)
                    headers = await self.get_headers()
                    response = await client.get(endpoint, headers=headers, timeout=10.0)
                
                response.raise_for_status()
                data = response.json()
                if isinstance(data, list):
                    return data
                return data.get("results", [])
            except Exception as e:
                logger.error(f"Failed to fetch assets from JumpServer: {e}")
                return []

    async def get_nodes(self) -> List[Dict[str, Any]]:
        if not self.base_url:
            return []
        headers = await self.get_headers()
        async with httpx.AsyncClient(follow_redirects=True) as client:
            endpoint = f"{self.base_url}/api/v1/assets/nodes/"
            url = endpoint
            params = {"limit": 100, "offset": 0}
            nodes: List[Dict[str, Any]] = []
            base_scheme = "https" if self.base_url.startswith("https://") else "http"

            def normalize_next(next_url: Optional[str]) -> Optional[str]:
                if not next_url:
                    return None
                if next_url.startswith("/"):
                    return f"{self.base_url}{next_url}"
                if next_url.startswith("http://") and base_scheme == "https":
                    return next_url.replace("http://", "https://", 1)
                return next_url

            try:
                while url:
                    response = await client.get(url, headers=headers, params=params, timeout=10.0)
                    if response.status_code == 401:
                        await self.login(force=True)
                        headers = await self.get_headers()
                        response = await client.get(url, headers=headers, params=params, timeout=10.0)

                    response.raise_for_status()
                    data = response.json()

                    # JumpServer may return a paginated dict or a flat list
                    if isinstance(data, list):
                        nodes.extend(data)
                        break

                    page_results = data.get("results") or data.get("data") or []
                    nodes.extend(page_results)

                    next_url = normalize_next(data.get("next"))
                    if not next_url:
                        break

                    url = next_url
                    logger.debug(f"Following pagination to: {url}")
                    params = None  # the 'next' URL already contains paging info

                logger.info(f"Loaded {len(nodes)} nodes from JumpServer")
                return nodes
            except Exception as e:
                logger.error(f"Failed to fetch nodes: {e}")
                if hasattr(e, 'response'):
                    logger.error(f"Response body: {e.response.text if hasattr(e.response, 'text') else 'N/A'}")
                return []

    async def update_node(
        self,
        node_id: str,
        parent_id: str,
        parent_key: Optional[str] = None,
        parent_org: Optional[str] = None,
        key_override: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Move a node to a different parent."""
        if not self.base_url:
            return None
        headers = await self.get_headers()
        # Use org header when provided to avoid defaulting to root org
        if parent_org:
            headers = {**headers, "X-JMS-ORG": parent_org}
        async with httpx.AsyncClient(follow_redirects=True) as client:
            endpoint = f"{self.base_url}/api/v1/assets/nodes/{node_id}/"
            payload: Dict[str, Any] = {}
            if parent_id:
                payload["parent"] = parent_id  # Use ID for parent
                payload["parent_id"] = parent_id
            if parent_org:
                payload["org_id"] = parent_org
            if key_override:
                payload["key"] = key_override
            # Include parent_key if needed, but 'parent' as ID is safer usually
            if parent_key:
                payload["parent_key"] = parent_key

            logger.info(f"Moving node {node_id} to parent_id={parent_id} parent_key={parent_key} org={parent_org} payload={payload}")
            try:
                response = await client.patch(endpoint, headers=headers, json=payload, timeout=10.0)
                if response.status_code == 401:
                    # Token expired, refresh and retry
                    logger.warning("Token expired, refreshing...")
                    await self.login(force=True)
                    headers = await self.get_headers()
                    if parent_org:
                        headers = {**headers, "X-JMS-ORG": parent_org}
                    response = await client.patch(endpoint, headers=headers, json=payload, timeout=10.0)
                
                response.raise_for_status()
                logger.info(f"[JS MOVE] status={response.status_code} parent={parent_id} body={response.text}")
                result = response.json()
                logger.info(f"Node moved successfully to: {result.get('full_value', 'N/A')}")
                return result
            except Exception as e:
                logger.error(f"Failed to move node {node_id}: {e}")
                if hasattr(e, 'response'):
                    logger.error(f"[JS MOVE ERROR] status={e.response.status_code} body={e.response.text if hasattr(e.response, 'text') else 'N/A'}")
                return None

    async def delete_node(self, node_id: str) -> bool:
        """Delete a node by ID. Best-effort, used to clean wrong placements."""
        if not self.base_url:
            return False
        headers = await self.get_headers()
        async with httpx.AsyncClient(follow_redirects=True) as client:
            endpoint = f"{self.base_url}/api/v1/assets/nodes/{node_id}/"
            try:
                response = await client.delete(endpoint, headers=headers, timeout=10.0)
                if response.status_code == 401:
                    # Token expired, refresh and retry
                    logger.warning("Token expired, refreshing...")
                    await self.login(force=True)
                    headers = await self.get_headers()
                    response = await client.delete(endpoint, headers=headers, timeout=10.0)
                
                if response.status_code in (200, 204, 404):
                    logger.info(f"Deleted node {node_id} (status={response.status_code})")
                    return True
                logger.error(f"Failed to delete node {node_id}, status={response.status_code}, body={response.text}")
                return False
            except Exception as e:
                logger.error(f"Error deleting node {node_id}: {e}")
                return False

    async def create_node(
        self,
        name: str,
        parent_id: str,
        parent_key: Optional[str] = None,
        parent_org: Optional[str] = None,
        key_override: Optional[str] = None,
        expected_path: Optional[str] = None,
    ) -> Dict[str, Any]:
        if not self.base_url:
            return None
        if not parent_id:
            logger.error("Cannot create child node without parent_id.")
            return None
        headers = await self.get_headers()
        if parent_org:
            headers = {**headers, "X-JMS-ORG": parent_org}

        async with httpx.AsyncClient(follow_redirects=True) as client:
            # Correct UI flow: create child under parent, then rename with PATCH
            create_endpoint = f"{self.base_url}/api/v1/assets/nodes/{parent_id}/children/"
            try:
                logger.info(f"Creating child node under parent_id={parent_id} via {create_endpoint}")
                resp = await client.post(create_endpoint, headers=headers, json={}, timeout=10.0)
                if resp.status_code == 401:
                    # Token expired, refresh and retry
                    logger.warning("Token expired, refreshing...")
                    await self.login(force=True)
                    headers = await self.get_headers()
                    if parent_org:
                        headers = {**headers, "X-JMS-ORG": parent_org}
                    resp = await client.post(create_endpoint, headers=headers, json={}, timeout=10.0)
                
                logger.info(f"[JS CREATE CHILD] status={resp.status_code} body={resp.text}")
                resp.raise_for_status()
                created = resp.json()
                child_id = created.get("id")
                if not child_id:
                    logger.error("Create child response missing id.")
                    return None

                # Rename to requested value
                rename_endpoint = f"{self.base_url}/api/v1/assets/nodes/{child_id}/"
                rename_payload = {"value": name}
                logger.info(f"Renaming child node {child_id} to '{name}'")
                rename_resp = await client.patch(rename_endpoint, headers=headers, json=rename_payload, timeout=10.0)
                if rename_resp.status_code == 401:
                    # Token expired, refresh and retry
                    logger.warning("Token expired during rename, refreshing...")
                    await self.login(force=True)
                    headers = await self.get_headers()
                    if parent_org:
                        headers = {**headers, "X-JMS-ORG": parent_org}
                    rename_resp = await client.patch(rename_endpoint, headers=headers, json=rename_payload, timeout=10.0)
                
                logger.info(f"[JS RENAME] status={rename_resp.status_code} body={rename_resp.text}")
                rename_resp.raise_for_status()
                renamed = rename_resp.json()

                if expected_path and renamed.get("full_value") != expected_path:
                    logger.warning(f"Rename placed node at '{renamed.get('full_value')}', expected '{expected_path}'.")
                return renamed
            except Exception as e:
                logger.error(f"Failed to create child node '{name}' under parent {parent_id}: {e}")
                if hasattr(e, 'response'):
                    logger.error(f"[JS CREATE CHILD ERROR] status={e.response.status_code} body={e.response.text if hasattr(e.response, 'text') else 'N/A'}")
                return None

    async def ensure_node_path(self, path: str) -> Optional[str]:
        """
        Ensure a node path exists using the UI-correct children endpoint.
        Returns the ID of the leaf node if it exists or is created.
        """
        if not self.base_url:
            return None

        def build_maps(node_list: List[Dict[str, Any]]):
            by_full_lower = {}
            by_id_local = {}
            for node in node_list:
                full_val = node.get("full_value") or ""
                norm_lower = self._normalize_path(full_val).lower()
                if norm_lower not in by_full_lower:
                    by_full_lower[norm_lower] = node
                node_id = node.get("id")
                if node_id:
                    by_id_local[node_id] = node
            return by_full_lower, by_id_local

        normalized_requested_path = self._normalize_path(path)
        parts = [p for p in normalized_requested_path.split("/") if p]

        logger.info(f"Ensuring node path (case-insensitive): {normalized_requested_path}")

        nodes = await self.get_nodes()
        if not nodes:
            logger.error("JumpServer returned no nodes; aborting.")
            return None

        by_full_lower, by_id = build_maps(nodes)
        current_parent_id: Optional[str] = None
        current_actual_path = ""

        for part in parts:
            expected_path = self._normalize_path(f"{current_actual_path}/{part}")
            node = by_full_lower.get(expected_path.lower())
            if node:
                current_parent_id = node.get("id")
                current_actual_path = self._normalize_path(node.get("full_value") or expected_path)
                logger.debug(f"✓ Found existing node '{current_actual_path}'")
                continue

            parent_node = by_id.get(current_parent_id) if current_parent_id else None
            parent_org = parent_node.get("org_id") if parent_node else None
            if not current_parent_id:
                logger.error(f"Cannot create '{part}' without parent_id (path='{expected_path}').")
                return None

            new_node = await self.create_node(
                part,
                current_parent_id,
                parent_org=parent_org,
                expected_path=expected_path,
            )
            if not new_node:
                logger.error(f"Failed to create node segment '{part}'. Aborting path ensure.")
                return None

            current_parent_id = new_node.get("id")
            current_actual_path = self._normalize_path(new_node.get("full_value") or expected_path)
            logger.info(f"✓ Created node '{current_actual_path}' (ID: {current_parent_id})")

            nodes = await self.get_nodes()
            by_full_lower, by_id = build_maps(nodes)

        logger.info(f"=== Path ensure complete. Leaf ID: {current_parent_id} ===")
        return current_parent_id

    async def check_node_exists(self, path: str) -> bool:
        """Checks if a full node path exists without creating it."""
        if not self.base_url:
            return False

        normalized_path = self._normalize_path(path)
        nodes = await self.get_nodes()

        if not isinstance(nodes, list) or not nodes:
            logger.error(f"JumpServer node list unavailable; cannot verify '{normalized_path}'.")
            return False

        matches_exact = [n for n in nodes if self._normalize_path(n.get("full_value") or "") == normalized_path]
        if matches_exact:
            return True

        # Fallback: case-insensitive comparison to avoid false negatives on casing
        normalized_lower = normalized_path.lower()
        for n in nodes:
            full_val = n.get("full_value") or ""
            if self._normalize_path(full_val).lower() == normalized_lower:
                logger.warning(f"Node exists with different casing: stored '{full_val}', requested '{normalized_path}'")
                return True

        logger.warning(f"Node '{normalized_path}' not found among {len(nodes)} nodes.")
        return False


jumpserver_svc = JumpServerService()
