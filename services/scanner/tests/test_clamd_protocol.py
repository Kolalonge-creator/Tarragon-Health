"""The real ClamdClient against a tiny in-process server that speaks clamd's INSTREAM protocol."""

import asyncio
import struct
from collections.abc import AsyncIterator

import pytest
import pytest_asyncio

from app.clamd import (
    CHUNK_BYTES,
    ClamdClient,
    ClamdUnavailableError,
    parse_scan_reply,
    parse_version,
)

from .conftest import EICAR


async def _handle(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
    command = (await reader.readuntil(b"\0")).rstrip(b"\0")
    if command == b"zPING":
        writer.write(b"PONG\0")
    elif command == b"zVERSION":
        writer.write(b"ClamAV 1.4.1/27450/Tue Nov  4 08:20:18 2026\0")
    elif command == b"zINSTREAM":
        data = bytearray()
        while True:
            (size,) = struct.unpack("!L", await reader.readexactly(4))
            if size == 0:
                break
            assert size <= CHUNK_BYTES
            data.extend(await reader.readexactly(size))
        writer.write(b"stream: Eicar-Test-Signature FOUND\0" if EICAR in data else b"stream: OK\0")
    else:
        writer.write(b"UNKNOWN COMMAND\0")
    await writer.drain()
    writer.close()


@pytest_asyncio.fixture
async def clamd_port() -> AsyncIterator[int]:
    server = await asyncio.start_server(_handle, "127.0.0.1", 0)
    port = server.sockets[0].getsockname()[1]
    async with server:
        yield port


async def test_instream_clean_and_infected_over_many_chunks(clamd_port: int) -> None:
    c = ClamdClient("127.0.0.1", clamd_port, 5)
    big = b"a" * (CHUNK_BYTES * 3 + 17)
    assert (await c.instream(big)).verdict == "clean"
    infected = await c.instream(big + EICAR)
    assert infected.verdict == "infected"
    assert infected.signature == "Eicar-Test-Signature"


async def test_ping_and_version(clamd_port: int) -> None:
    c = ClamdClient("127.0.0.1", clamd_port, 5)
    assert await c.ping() is True
    v = await c.version()
    assert v.engine_version == "ClamAV 1.4.1"
    assert v.db_version == "27450"


async def test_unreachable_clamd_raises_unavailable() -> None:
    # Port 1 on loopback is never a clamd.
    c = ClamdClient("127.0.0.1", 1, 1)
    assert await c.ping() is False
    with pytest.raises(ClamdUnavailableError):
        await c.instream(b"x")


@pytest.mark.parametrize(
    ("reply", "verdict", "signature"),
    [
        ("stream: OK", "clean", None),
        ("stream: Win.Test.EICAR_HDB-1 FOUND", "infected", "Win.Test.EICAR_HDB-1"),
        ("INSTREAM size limit exceeded. ERROR", "error", None),
        ("stream: Can't allocate memory ERROR", "error", None),
        ("", "error", None),
        ("stream: OKAY", "error", None),
    ],
)
def test_parse_scan_reply_never_defaults_to_clean(reply: str, verdict: str, signature: str | None) -> None:
    r = parse_scan_reply(reply)
    assert r.verdict == verdict
    assert r.signature == signature


def test_parse_version_tolerates_unknown_shape() -> None:
    assert parse_version("ClamAV 1.0.7").db_version is None
    assert parse_version("garbage").engine_version == "garbage"
