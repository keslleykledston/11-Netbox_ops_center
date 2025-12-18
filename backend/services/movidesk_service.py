import httpx
import logging
from backend.core.config import settings

logger = logging.getLogger(__name__)

from typing import Dict, Any

class MovideskService:
    def __init__(self):
        self.api_url = settings.MOVIDESK_API_URL
        self.token = settings.MOVIDESK_TOKEN

    async def get_active_companies(self) -> list[Dict[str, Any]]:
        """Fetch active companies (personType 2) from Movidesk."""
        if not self.token:
            logger.warning("Movidesk token not found. Skipping company fetch.")
            return []
        async with httpx.AsyncClient() as client:
            # Filter for personType 2 (Company) and isActive true
            filter_query = "personType eq 2 and isActive eq true"
            endpoint = f"{self.api_url}/persons?token={self.token}&$filter={filter_query}"
            try:
                logger.info(f"Fetching companies from Movidesk: {self.api_url}/persons (filter applied)")
                response = await client.get(endpoint, timeout=15.0)
                logger.debug(f"Movidesk response status: {response.status_code}")
                response.raise_for_status()
                data = response.json()
                logger.info(f"Found {len(data)} active companies in Movidesk.")
                return data
            except Exception as e:
                logger.error(f"Error fetching Movidesk companies: {e}")
                return []

    def parse_webhook_payload(self, payload: Dict[str, Any]):
        # Example Movidesk webhook parsing
        # Extracts tenant info from payload
        return {
            "name": payload.get("businessName") or payload.get("userName"),
            "slug": (payload.get("businessName") or payload.get("userName") or "").lower().replace(" ", "-"),
            "description": f"Imported from Movidesk ID: {payload.get('id')}",
            "movidesk_id": str(payload.get("id")),
            "cnpj": payload.get("cpfCnpj")
        }


movidesk_svc = MovideskService()
