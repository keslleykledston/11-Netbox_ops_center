import httpx
import logging
from backend.core.config import settings

logger = logging.getLogger(__name__)

from typing import List, Dict, Any

class OxidizedService:
    def __init__(self):
        self.base_url = settings.OXIDIZED_API_URL.rstrip("/")

    async def get_nodes(self) -> List[Dict[str, Any]]:
        async with httpx.AsyncClient() as client:
            endpoint = f"{self.base_url}/nodes.json"
            response = await client.get(endpoint, timeout=10.0)
            response.raise_for_status()
            return response.json()

    async def get_node_status(self, node_name: str) -> Dict[str, Any]:
        nodes = await self.get_nodes()
        for node in nodes:
            if node.get("name") == node_name:
                return node
        return {}

    async def get_node_version(self, node_name: str) -> List[Dict[str, Any]]:
        async with httpx.AsyncClient() as client:
            endpoint = f"{self.base_url}/node/version.json?node_full={node_name}"
            response = await client.get(endpoint, timeout=10.0)
            response.raise_for_status()
            return response.json()

oxidized_svc = OxidizedService()
