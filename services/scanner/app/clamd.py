"""A minimal async client for clamd's TCP protocol (PING, VERSION, INSTREAM).

Written here rather than taken from a PyPI package: the protocol is three commands, the common Python wrappers are unmaintained
and synchronous, and this keeps the scan entirely in memory. INSTREAM sends the bytes as length-prefixed chunks over the socket;
clamd never sees a file path and this service never writes a temporary file.

Protocol reference: clamd(8), "z" prefix = NUL-terminated command and reply.
"""

import asyncio
import re
import struct
from dataclasses import dataclass
from typing import Literal, Protocol

CHUNK_BYTES = 64 * 1024

Verdict = Literal["clean", "infected", "error"]


class ClamdUnavailableError(Exception):
    """clamd could not be reached, or did not answer in time. The caller reports `error`, never `clean`."""


@dataclass(frozen=True)
class ClamdVersion:
    engine_version: str
    db_version: str | None
    db_date: str | None


@dataclass(frozen=True)
class ClamdScanResult:
    verdict: Verdict
    signature: str | None
    raw: str


_VERSION_RE = re.compile(r"^(?P<engine>ClamAV [^/]+)(?:/(?P<db>\d+)(?:/(?P<date>.+))?)?$")


def parse_version(reply: str) -> ClamdVersion:
    """Parse `ClamAV 1.4.1/27450/Tue Nov  4 08:20:18 2026` into its three parts."""
    m = _VERSION_RE.match(reply.strip())
    if not m:
        return ClamdVersion(engine_version=reply.strip()[:120], db_version=None, db_date=None)
    return ClamdVersion(engine_version=m["engine"], db_version=m["db"], db_date=m["date"])


def parse_scan_reply(reply: str) -> ClamdScanResult:
    """Map an INSTREAM reply to a verdict. Anything that is not exactly `OK` or `<sig> FOUND` is an error, never clean."""
    text = reply.strip()
    body = text.split(":", 1)[1].strip() if text.startswith("stream:") else text
    if body == "OK":
        return ClamdScanResult(verdict="clean", signature=None, raw=text)
    if body.endswith(" FOUND"):
        signature = body[: -len(" FOUND")].strip() or "unknown"
        return ClamdScanResult(verdict="infected", signature=signature[:200], raw=text)
    return ClamdScanResult(verdict="error", signature=None, raw=text[:200])


class ClamdLike(Protocol):
    async def ping(self) -> bool: ...

    async def version(self) -> ClamdVersion: ...

    async def instream(self, data: bytes) -> ClamdScanResult: ...


class ClamdClient:
    def __init__(self, host: str, port: int, timeout_seconds: float) -> None:
        self._host = host
        self._port = port
        self._timeout = timeout_seconds

    async def _command(self, command: bytes, payload: bytes | None = None) -> str:
        try:
            return await asyncio.wait_for(self._exchange(command, payload), timeout=self._timeout)
        except (OSError, TimeoutError, asyncio.IncompleteReadError) as exc:
            raise ClamdUnavailableError(str(exc) or type(exc).__name__) from exc

    async def _exchange(self, command: bytes, payload: bytes | None) -> str:
        reader, writer = await asyncio.open_connection(self._host, self._port)
        try:
            writer.write(b"z" + command + b"\0")
            if payload is not None:
                view = memoryview(payload)
                for start in range(0, len(view), CHUNK_BYTES):
                    chunk = view[start : start + CHUNK_BYTES]
                    writer.write(struct.pack("!L", len(chunk)))
                    writer.write(chunk)
                    await writer.drain()
                writer.write(struct.pack("!L", 0))
            await writer.drain()
            reply = await reader.readuntil(b"\0")
            return reply.rstrip(b"\0").decode("utf-8", errors="replace")
        finally:
            writer.close()
            try:
                await writer.wait_closed()
            except OSError:
                pass

    async def ping(self) -> bool:
        try:
            return (await self._command(b"PING")).strip() == "PONG"
        except ClamdUnavailableError:
            return False

    async def version(self) -> ClamdVersion:
        return parse_version(await self._command(b"VERSION"))

    async def instream(self, data: bytes) -> ClamdScanResult:
        return parse_scan_reply(await self._command(b"INSTREAM", data))
