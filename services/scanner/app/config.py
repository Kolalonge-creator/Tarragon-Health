"""Runtime configuration, read once from the environment.

The scanner holds no database credentials and no storage credentials: the platform sends the file bytes in the request body,
the scanner streams them to the local clamd and returns a verdict. Nothing is written to disk by this service.
"""

from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

# The lab-result buckets cap a file at 10 MB (lab_result_files.file_size_bytes check and the bucket file_size_limit).
DEFAULT_MAX_BYTES = 10 * 1024 * 1024


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    environment: str = Field(default="development", alias="ENVIRONMENT")

    # Shared secret the platform sends as `X-Service-Key`. Empty means every /scan call is refused (503), never accepted.
    scanner_service_key: str = Field(default="", alias="SCANNER_SERVICE_KEY")

    # clamd runs in the same container and listens on loopback only (docker/clamd.conf).
    clamd_host: str = Field(default="127.0.0.1", alias="CLAMD_HOST")
    clamd_port: int = Field(default=3310, alias="CLAMD_PORT")
    # A 10 MB PDF scans in a few seconds; the platform's own timeout is shorter than this, so this only bounds a hung clamd.
    clamd_timeout_seconds: float = Field(default=60.0, alias="CLAMD_TIMEOUT_SECONDS")

    max_bytes: int = Field(default=DEFAULT_MAX_BYTES, alias="SCANNER_MAX_BYTES")


@lru_cache
def get_settings() -> Settings:
    return Settings()
