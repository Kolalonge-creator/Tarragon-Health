"""Liveness endpoint (Sprint 1).

Unauthenticated by design: this is what Railway/Render and load balancers hit
to decide whether the process is up. It reports no patient data and touches no
external system, so it stays fast and dependency-free.
"""

from fastapi import APIRouter
from pydantic import BaseModel

from .. import __version__
from ..config import Settings, get_settings

router = APIRouter(tags=["health"])


class HealthResponse(BaseModel):
    status: str
    service: str
    version: str
    environment: str


@router.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    settings: Settings = get_settings()
    return HealthResponse(
        status="ok",
        service="tarragon-ml",
        version=__version__,
        environment=settings.environment,
    )
