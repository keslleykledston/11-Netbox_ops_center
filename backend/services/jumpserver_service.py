import httpx
import logging
from backend.core.config import settings
from typing import List, Dict, Any, Optional

logger = logging.getLogger(__name__)

class JumpServerService:
    def __init__(self):
        self.base_url = (settings.JUMPSERVER_URL or "").rstrip("/")
        self._cached_token: Optional[str] = settings.JUMPSERVER_TOKEN
        self._token_type = "Bearer" # N8N flow uses Bearer for JWT

    async def login(self) -> Optional[str]:
        """Perform login to get a fresh JWT token."""
        if not self.base_url or not settings.JUMPSERVER_USERNAME or not settings.JUMPSERVER_PASSWORD:
            logger.warning("JumpServer base_url or credentials not configured")
            return None
            
        async with httpx.AsyncClient() as client:
            endpoint = f"{self.base_url}/api/v1/authentication/auth/"
            payload = {
                "username": settings.JUMPSERVER_USERNAME,
                "password": settings.JUMPSERVER_PASSWORD
            }
            try:
                response = await client.post(endpoint, json=payload, timeout=10.0)
                response.raise_for_status()
                data = response.json()
                self._cached_token = data.get("token")
                return self._cached_token
            except Exception as e:
                logger.error(f"Failed to login to JumpServer: {e}")
                return None

    async def get_headers(self) -> Dict[str, str]:
        # If we have a static token, use it. Otherwise, use cached or login.
        token = settings.JUMPSERVER_TOKEN or self._cached_token
        
        if not token and settings.JUMPSERVER_USERNAME and settings.JUMPSERVER_PASSWORD:
            token = await self.login()
            
        prefix = "Bearer" if settings.JUMPSERVER_USERNAME else "Token"
        
        return {
            "Authorization": f"{prefix} {token or ''}",
            "Content-Type": "application/json",
            "Accept": "application/json"
        }

    async def get_assets(self) -> List[Dict[str, Any]]:
        if not self.base_url:
            return []
        
        headers = await self.get_headers()
        async with httpx.AsyncClient() as client:
            endpoint = f"{self.base_url}/api/v1/assets/assets/"
            try:
                response = await client.get(endpoint, headers=headers, timeout=10.0)
                if response.status_code == 401:
                    # Token might be expired, try login once
                    await self.login()
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
        async with httpx.AsyncClient() as client:
            endpoint = f"{self.base_url}/api/v1/assets/nodes/"
            try:
                response = await client.get(endpoint, headers=headers, timeout=10.0)
                response.raise_for_status()
                return response.json()
            except Exception as e:
                logger.error(f"Failed to fetch nodes: {e}")
                return []

    async def create_node(self, name: str, parent_id: str) -> Dict[str, Any]:
        if not self.base_url:
            return None
        headers = await self.get_headers()
        async with httpx.AsyncClient() as client:
            endpoint = f"{self.base_url}/api/v1/assets/nodes/"
            payload = {"value": name, "parent": parent_id}
            try:
                response = await client.post(endpoint, headers=headers, json=payload, timeout=10.0)
                response.raise_for_status()
                return response.json()
            except Exception as e:
                logger.error(f"Failed to create node {name}: {e}")
                return None

    async def ensure_node_path(self, path: str) -> Optional[str]:
        """
        Idempotently ensure a node path exists. Returns the ID of the leaf node.
        Example path: /DEFAULT/PRODUCAO/TenantName
        """
        if not self.base_url:
            return None
        
        nodes = await self.get_nodes()
        parts = [p for p in path.split("/") if p]
        
        current_parent_id = "" # Root
        
        for part in parts:
            # Find if part exists under current_parent_id
            found = next((n for n in nodes if n["value"] == part and (n.get("parent") or "") == current_parent_id), None)
            
            if found:
                current_parent_id = found["id"]
            else:
                # Create it
                new_node = await self.create_node(part, current_parent_id or None)
                if not new_node:
                    return None
                current_parent_id = new_node["id"]
                # Refresh nodes for next part
                nodes = await self.get_nodes()
                
        return current_parent_id


jumpserver_svc = JumpServerService()
