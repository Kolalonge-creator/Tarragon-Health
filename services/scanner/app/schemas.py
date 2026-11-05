"""Response shapes. Mirrored field for field by packages/shared/src/scanner-client.ts."""

from typing import Literal

from pydantic import BaseModel, Field


class ScanResponse(BaseModel):
    # `error` means "not known to be clean": the platform must hold the file, never treat it as clean.
    status: Literal["clean", "infected", "error"]
    signature: str | None = Field(default=None, description="Signature name when infected, e.g. Eicar-Test-Signature")
    engine_version: str | None = None
    db_version: str | None = None
    db_date: str | None = None
    size_bytes: int
    sha256: str
    detail: str | None = Field(default=None, description="Short reason when status is error. Never file content.")


class HealthResponse(BaseModel):
    status: Literal["ok"]
    service: Literal["scanner"]
    version: str
    environment: str
    clamd: Literal["up", "down"]
    engine_version: str | None = None
    db_version: str | None = None
    db_date: str | None = None
