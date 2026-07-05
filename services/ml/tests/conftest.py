"""Shared pytest fixtures.

`get_settings` is cached, so tests set env vars and clear the cache to force a
fresh read. An httpx client wired to the ASGI app avoids binding a real port.
"""

from collections.abc import AsyncIterator, Iterator

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from app.config import get_settings
from app.main import create_app

TEST_SERVICE_KEY = "test-service-key"


@pytest.fixture(autouse=True)
def _configured_service_key(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    monkeypatch.setenv("ML_SERVICE_KEY", TEST_SERVICE_KEY)
    monkeypatch.setenv("ENVIRONMENT", "test")
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


@pytest_asyncio.fixture
async def client() -> AsyncIterator[AsyncClient]:
    app = create_app()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://ml.test") as ac:
        yield ac
