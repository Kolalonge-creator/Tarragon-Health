"""Shared fixtures. clamd is replaced by an in-process fake for unit tests; tests/test_integration.py uses a real one."""

from collections.abc import AsyncIterator, Iterator

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from app.clamd import ClamdScanResult, ClamdUnavailableError, ClamdVersion
from app.config import get_settings
from app.main import create_app

TEST_SERVICE_KEY = "test-scanner-key"

# The EICAR anti-malware test file, assembled at runtime so this source file is not itself flagged by a desktop scanner.
EICAR = b"X5O!P%@AP[4\\PZX54(P^)7CC)7}$" + b"EICAR-STANDARD-ANTIVIRUS-TEST-FILE!" + b"$H+H*"


class FakeClamd:
    def __init__(self, *, up: bool = True, reply_error: bool = False) -> None:
        self.up = up
        self.reply_error = reply_error
        self.scanned: list[int] = []

    async def ping(self) -> bool:
        return self.up

    async def version(self) -> ClamdVersion:
        if not self.up:
            raise ClamdUnavailableError("down")
        return ClamdVersion(engine_version="ClamAV 1.4.1", db_version="27450", db_date="Tue Nov  4 08:20:18 2026")

    async def instream(self, data: bytes) -> ClamdScanResult:
        if not self.up:
            raise ClamdUnavailableError("connection refused")
        self.scanned.append(len(data))
        if self.reply_error:
            return ClamdScanResult(verdict="error", signature=None, raw="INSTREAM size limit exceeded. ERROR")
        if EICAR in data:
            return ClamdScanResult(
                verdict="infected",
                signature="Eicar-Test-Signature",
                raw="stream: Eicar-Test-Signature FOUND",
            )
        return ClamdScanResult(verdict="clean", signature=None, raw="stream: OK")


@pytest.fixture(autouse=True)
def _settings(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    monkeypatch.setenv("SCANNER_SERVICE_KEY", TEST_SERVICE_KEY)
    monkeypatch.setenv("ENVIRONMENT", "test")
    monkeypatch.delenv("SCANNER_MAX_BYTES", raising=False)
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


@pytest.fixture
def fake_clamd() -> FakeClamd:
    return FakeClamd()


@pytest_asyncio.fixture
async def client(fake_clamd: FakeClamd) -> AsyncIterator[AsyncClient]:
    app = create_app(clamd=fake_clamd)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://scanner.test") as ac:
        yield ac
