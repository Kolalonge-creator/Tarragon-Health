"""Runtime configuration, loaded once from the environment.

The service is stateless: the only settings it needs are its own identity,
the shared-secret it authenticates callers with, and CORS/host wiring. It
never holds database credentials — patient data arrives in request bodies.
"""

from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    environment: str = Field(default="development", alias="ENVIRONMENT")

    # Shared secret the TypeScript platform sends as the `X-Service-Key`
    # header. Empty in local dev unless set; required in production.
    ml_service_key: str = Field(default="", alias="ML_SERVICE_KEY")


@lru_cache
def get_settings() -> Settings:
    """Return the process-wide settings singleton."""
    return Settings()
