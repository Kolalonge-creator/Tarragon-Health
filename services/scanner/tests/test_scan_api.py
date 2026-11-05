import hashlib

import pytest
from httpx import AsyncClient

from app.config import get_settings

from .conftest import EICAR, TEST_SERVICE_KEY, FakeClamd

AUTH = {"X-Service-Key": TEST_SERVICE_KEY, "Content-Type": "application/octet-stream"}
PDF = b"%PDF-1.7\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n"


async def test_clean_file(client: AsyncClient) -> None:
    r = await client.post("/scan", content=PDF, headers=AUTH)
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "clean"
    assert body["signature"] is None
    assert body["engine_version"] == "ClamAV 1.4.1"
    assert body["db_version"] == "27450"
    assert body["size_bytes"] == len(PDF)
    assert body["sha256"] == hashlib.sha256(PDF).hexdigest()


async def test_eicar_is_infected(client: AsyncClient) -> None:
    r = await client.post("/scan", content=b"%PDF-1.4\n" + EICAR, headers=AUTH)
    assert r.status_code == 200
    assert r.json()["status"] == "infected"
    assert r.json()["signature"] == "Eicar-Test-Signature"


async def test_missing_key_is_401(client: AsyncClient) -> None:
    r = await client.post("/scan", content=PDF, headers={"Content-Type": "application/octet-stream"})
    assert r.status_code == 401


async def test_wrong_key_is_401(client: AsyncClient) -> None:
    r = await client.post("/scan", content=PDF, headers={**AUTH, "X-Service-Key": "nope"})
    assert r.status_code == 401


async def test_unconfigured_key_refuses_rather_than_accepts(client: AsyncClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SCANNER_SERVICE_KEY", "")
    get_settings.cache_clear()
    r = await client.post("/scan", content=PDF, headers=AUTH)
    assert r.status_code == 503


async def test_empty_body_is_400(client: AsyncClient) -> None:
    r = await client.post("/scan", content=b"", headers=AUTH)
    assert r.status_code == 400


async def test_over_cap_is_413_and_never_reaches_clamd(
    client: AsyncClient, fake_clamd: FakeClamd, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("SCANNER_MAX_BYTES", "1024")
    get_settings.cache_clear()
    r = await client.post("/scan", content=b"x" * 1025, headers=AUTH)
    assert r.status_code == 413
    assert fake_clamd.scanned == []


async def test_default_cap_is_ten_megabytes(client: AsyncClient, fake_clamd: FakeClamd) -> None:
    r = await client.post("/scan", content=b"a" * (10 * 1024 * 1024), headers=AUTH)
    assert r.status_code == 200
    r = await client.post("/scan", content=b"a" * (10 * 1024 * 1024 + 1), headers=AUTH)
    assert r.status_code == 413


async def test_clamd_down_is_503_error_never_clean(client: AsyncClient, fake_clamd: FakeClamd) -> None:
    fake_clamd.up = False
    r = await client.post("/scan", content=PDF, headers=AUTH)
    assert r.status_code == 503
    assert r.json()["status"] == "error"


async def test_clamd_error_reply_is_error(client: AsyncClient, fake_clamd: FakeClamd) -> None:
    fake_clamd.reply_error = True
    r = await client.post("/scan", content=PDF, headers=AUTH)
    assert r.status_code == 200
    assert r.json()["status"] == "error"


async def test_health_is_open_and_reports_clamd(client: AsyncClient, fake_clamd: FakeClamd) -> None:
    r = await client.get("/health")
    assert r.status_code == 200
    assert r.json()["clamd"] == "up"
    fake_clamd.up = False
    r = await client.get("/health")
    assert r.status_code == 200
    assert r.json()["clamd"] == "down"


async def test_ready_tracks_clamd(client: AsyncClient, fake_clamd: FakeClamd) -> None:
    assert (await client.get("/ready")).status_code == 200
    fake_clamd.up = False
    assert (await client.get("/ready")).status_code == 503
