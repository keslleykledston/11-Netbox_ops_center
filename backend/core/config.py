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
    JUMPSERVER_URL: Optional[str] = "https://js.k3gsolutions.com.br"
    JUMPSERVER_TOKEN: Optional[str] = None
    JUMPSERVER_USERNAME: Optional[str] = "k3g_ia"
    JUMPSERVER_PASSWORD: Optional[str] = "8png1X^2DN5k"


    
    # Oxidized
    OXIDIZED_API_URL: str = "http://localhost:8888"
    
    # Movidesk
    MOVIDESK_API_URL: str = "https://api.movidesk.com/public/v1"
    MOVIDESK_TOKEN: Optional[str] = None
    MOVIDESK_SYNC_INTERVAL: int = 600  # 10 minutes
    MOVIDESK_SYNC_ENABLED: bool = True
    
    # Cache settings
    CACHE_TTL: int = 300  # 5 minutes
    
    model_config = SettingsConfigDict(
        env_file=(".env", "server/.env"), 
        extra="ignore"
    )


settings = Settings()
