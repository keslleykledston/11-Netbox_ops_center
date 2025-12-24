import os
from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import Optional

class Settings(BaseSettings):
    # App Settings
    APP_NAME: str = "Netbox Ops Center HUB"
    DEBUG: bool = os.getenv("DEBUG", "false").lower() == "true"

    # Banco de dados local (Postgres)
    DATABASE_URL: Optional[str] = None
    
    # NetBox
    NETBOX_URL: str = ""
    NETBOX_TOKEN: str = ""
    NETBOX_TENANT_GROUP_FILTER: str = "K3G Solutions"
    
    # Jumpserver
    JUMPSERVER_URL: Optional[str] = None
    JUMPSERVER_TOKEN: Optional[str] = None
    JUMPSERVER_USERNAME: Optional[str] = None
    JUMPSERVER_PASSWORD: Optional[str] = None


    
    # Oxidized
    OXIDIZED_API_URL: str = "http://localhost:8888"
    
    # Movidesk
    MOVIDESK_API_URL: str = "https://api.movidesk.com/public/v1"
    MOVIDESK_TOKEN: Optional[str] = None
    MOVIDESK_SYNC_INTERVAL: int = 600  # 10 minutes
    MOVIDESK_SYNC_ENABLED: bool = True
    MOVIDESK_WEBHOOK_AUTO_CREATE: bool = os.getenv("MOVIDESK_WEBHOOK_AUTO_CREATE", "false").lower() == "true"
    
    # Cache settings
    CACHE_TTL: int = 300  # 5 minutes
    HUB_SNAPSHOT_TTL: int = 600  # 10 minutes
    HUB_SNAPSHOT_ALLOW_STALE: bool = os.getenv("HUB_SNAPSHOT_ALLOW_STALE", "true").lower() == "true"
    
    model_config = SettingsConfigDict(
        env_file=(".env", ".env.local"),
        extra="ignore"
    )


settings = Settings()
