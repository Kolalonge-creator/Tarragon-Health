"""End-to-end against a real clamd. Runs only when CLAMD_INTEGRATION=1 and a clamd answers at CLAMD_HOST:CLAMD_PORT.

Locally, see README.md ("Integration test"): build the image, run it with clamd published on 3310, then
`CLAMD_INTEGRATION=1 uv run pytest -m integration`.
"""

import os

import pytest

from app.clamd import ClamdClient

from .conftest import EICAR

pytestmark = pytest.mark.integration

HOST = os.environ.get("CLAMD_HOST", "127.0.0.1")
PORT = int(os.environ.get("CLAMD_PORT", "3310"))


@pytest.fixture
async def real_clamd() -> ClamdClient:
    if os.environ.get("CLAMD_INTEGRATION") != "1":
        pytest.skip("set CLAMD_INTEGRATION=1 with a running clamd to run")
    c = ClamdClient(HOST, PORT, 60)
    if not await c.ping():
        pytest.skip(f"no clamd answering at {HOST}:{PORT}")
    return c


async def test_real_clamd_flags_eicar(real_clamd: ClamdClient) -> None:
    r = await real_clamd.instream(EICAR)
    assert r.verdict == "infected"
    assert r.signature is not None and "eicar" in r.signature.lower()


async def test_real_clamd_passes_plain_pdf(real_clamd: ClamdClient) -> None:
    r = await real_clamd.instream(b"%PDF-1.7\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n")
    assert r.verdict == "clean"


async def test_real_clamd_reports_versions(real_clamd: ClamdClient) -> None:
    v = await real_clamd.version()
    assert v.engine_version.startswith("ClamAV")
    assert v.db_version is not None
