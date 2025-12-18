import pynetbox
import asyncio
import logging
from concurrent.futures import ThreadPoolExecutor

logger = logging.getLogger(__name__)

from backend.core.config import settings

class NetBoxService:
    def __init__(self):
        self.nb = pynetbox.api(settings.NETBOX_URL, token=settings.NETBOX_TOKEN)
        self.executor = ThreadPoolExecutor(max_workers=10)

    async def _run_async(self, func, *args, **kwargs):
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(self.executor, lambda: func(*args, **kwargs))
    async def get_devices(self):
        return await self._run_async(self.nb.dcim.devices.all)

    async def get_device_by_name(self, name: str):
        return await self._run_async(self.nb.dcim.devices.get, name=name)

    async def get_tenant_by_id(self, tenant_id: int):
        return await self._run_async(self.nb.tenancy.tenants.get, tenant_id)


    async def get_tenants(self, **kwargs):
        if kwargs:
            return await self._run_async(self.nb.tenancy.tenants.filter, **kwargs)
        return await self._run_async(self.nb.tenancy.tenants.all)

    async def get_tenant_by_custom_field(self, field_name: str, value: str):
        if not value:
            return None
        # Try both variants (the one passed and common fallbacks)
        try:
            return await self._run_async(self.nb.tenancy.tenants.get, **{f"cf_{field_name}": value})
        except:
            return None

    async def get_tenant_group_by_name(self, name: str):
        return await self._run_async(self.nb.tenancy.tenant_groups.get, name=name)

    async def create_tenant(self, name: str, slug: str, description: str = "", custom_fields: dict = None, group_id: int = None):
        payload = {
            "name": name,
            "slug": slug,
            "description": description
        }
        if custom_fields:
            payload["custom_fields"] = custom_fields
        if group_id:
            payload["group"] = group_id
            
        return await self._run_async(self.nb.tenancy.tenants.create, payload)

    async def update_tenant(self, tenant_id: int, data: dict):
        tenant = await self._run_async(self.nb.tenancy.tenants.get, tenant_id)
        if tenant:
            tenant.update(data)
            return await self._run_async(tenant.save)
        return None

    async def ensure_custom_fields(self):
        """Ensure required custom fields exist for Tenants."""
        required = [
            {"name": "ERP_ID", "label": "ERP_ID", "type": "text"},
            {"name": "CNPJ", "label": "CNPJ", "type": "text"}
        ]
        
        try:
            # Try to get content type for tenancy.tenant
            # In some versions it might be in 'extras', in others 'core'
            content_type = None
            potential_paths = [
                (self.nb.extras.content_types, {"app_label": "tenancy", "model": "tenant"}),
                (self.nb.extras.content_types, {"app_label": "tenancy", "model": "Tenant"}),
                (self.nb.core.content_types, {"app_label": "tenancy", "model": "tenant"}),
            ]
            
            for api_path, params in potential_paths:
                try:
                    content_type = await self._run_async(api_path.get, **params)
                    if content_type:
                        logger.info(f"Found Content Type for Tenant using {params}")
                        break
                except Exception as e:
                    logger.debug(f"Failed to find content type with {params}: {e}")
            
            if not content_type:
                # Last resort: search all content types
                try:
                    all_cts = await self._run_async(self.nb.extras.content_types.all)
                    for ct in all_cts:
                        if ct.app_label == "tenancy" and ct.model.lower() == "tenant":
                            content_type = ct
                            logger.info(f"Found Content Type via search: {ct.app_label}.{ct.model}")
                            break
                except:
                    pass

            if not content_type:
                logger.warning("Could not find Content Type for Tenancy.Tenant. Custom fields might not be created.")
                return
            
            for field in required:
                try:
                    existing = await self._run_async(self.nb.extras.custom_fields.get, name=field["name"])
                    if not existing:
                        await self._run_async(self.nb.extras.custom_fields.create, {
                            "name": field["name"],
                            "label": field["label"],
                            "type": field["type"],
                            "content_types": [content_type.id]
                        })
                except Exception as e:
                    logger.warning(f"Failed to ensure custom field {field['name']}: {e}")
        except Exception as e:
            logger.debug(f"Generic failure in ensure_custom_fields: {e}")



netbox_svc = NetBoxService()

