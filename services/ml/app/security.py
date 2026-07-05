"""Service-to-service authentication via the `X-Service-Key` header.

Every clinical/ML endpoint depends on `require_service_key`. Health/liveness
is intentionally left unauthenticated so orchestrators can probe it. The
comparison is constant-time to avoid leaking the key through timing.
"""

import secrets

from fastapi import Depends, Header, HTTPException, status

from .config import Settings, get_settings


async def require_service_key(
    x_service_key: str | None = Header(default=None, alias="X-Service-Key"),
    settings: Settings = Depends(get_settings),
) -> None:
    """Reject any caller that does not present the shared service key."""
    if not settings.ml_service_key:
        # Misconfiguration: refuse rather than accept every caller.
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Service key not configured",
        )
    if x_service_key is None or not secrets.compare_digest(
        x_service_key, settings.ml_service_key
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing X-Service-Key",
        )
