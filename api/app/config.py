"""Settings from environment variables (see api/.env.example)."""

from __future__ import annotations

from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    database_url: str = "postgresql+psycopg://postgres@localhost:5432/ams"
    redis_url: str = "redis://localhost:6379/0"
    ams_secret_key: str = Field("", description="HS256 signing key for access tokens; at least 32 characters")
    cors_origins: str = "http://localhost:3001,http://localhost:5173"
    web_base_url: str = "http://localhost:3001"

    access_token_minutes: int = 30
    refresh_token_days: int = 30
    invitation_days: int = 7

    ow_base_url: str | None = None
    ow_public_base_url: str | None = None  # what mobile clients use to reach OW; defaults to ow_base_url
    ow_api_key: str | None = None
    ow_app_id: str | None = None
    ow_app_secret: str | None = None
    ow_webhook_secret: str | None = None
    ow_timeout_seconds: float = 10.0

    ams_upload_dir: str = "./uploads"
    upload_ttl_hours: int = 24

    expo_push_enabled: bool = False
    expo_push_url: str = "https://exp.host/--/api/v2/push/send"
    reminder_lead_minutes: int = 60

    celery_task_always_eager: bool = False
    log_level: str = "INFO"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def ow_configured(self) -> bool:
        return bool(self.ow_base_url and self.ow_api_key)

    @property
    def ow_sdk_configured(self) -> bool:
        return bool(self.ow_base_url and self.ow_app_id and self.ow_app_secret)

    @property
    def ow_public_url(self) -> str | None:
        return (self.ow_public_base_url or self.ow_base_url or "").rstrip("/") or None


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
