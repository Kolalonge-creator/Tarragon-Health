"""Tests for the `X-Service-Key` dependency via a throwaway protected route."""

from collections.abc import AsyncIterator

import pytest
import pytest_asyncio
from fastapi import Depends, FastAPI
from httpx import ASGITransport, AsyncClient

from app.security import require_service_key
from tests.conftest import TEST_SERVICE_KEY


def _protected_app() -> FastAPI:
    app = FastAPI()

    @app.get("/protected", dependencies=[Depends(require_service_key)])
    async def protected() -> dict[str, bool]:
        return {"ok": True}

    return app


@pytest_asyncio.fixture
async def protected_client() -> AsyncIterator[AsyncClient]:
    transport = ASGITransport(app=_protected_app())
    async with AsyncClient(transport=transport, base_url="http://ml.test") as ac:
        yield ac


async def test_rejects_missing_key(protected_client: AsyncClient) -> None:
    resp = await protected_client.get("/protected")
    assert resp.status_code == 401


async def test_rejects_wrong_key(protected_client: AsyncClient) -> None:
    resp = await protected_client.get("/protected", headers={"X-Service-Key": "nope"})
    assert resp.status_code == 401


async def test_accepts_correct_key(protected_client: AsyncClient) -> None:
    resp = await protected_client.get(
        "/protected", headers={"X-Service-Key": TEST_SERVICE_KEY}
    )
    assert resp.status_code == 200
    assert resp.json() == {"ok": True}


async def test_503_when_key_unconfigured(
    protected_client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.config import get_settings

    monkeypatch.setenv("ML_SERVICE_KEY", "")
    get_settings.cache_clear()
    resp = await protected_client.get(
        "/protected", headers={"X-Service-Key": TEST_SERVICE_KEY}
    )
    assert resp.status_code == 503
