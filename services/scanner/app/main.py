"""FastAPI entrypoint for the upload scanner.

POST /scan takes the raw file bytes as the request body (application/octet-stream), streams them to clamd from memory and
returns a verdict. Stateless: no database, no storage credentials, no file written anywhere. GET /health is liveness (always
200, says whether clamd answers); GET /ready is 503 until clamd answers, so Railway only routes traffic once the signature
database has loaded.
"""

import hashlib
import secrets
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Header, HTTPException, Request, status
from fastapi.responses import JSONResponse

from . import __version__
from .clamd import ClamdClient, ClamdLike, ClamdUnavailableError, ClamdVersion
from .config import Settings, get_settings
from .schemas import HealthResponse, ScanResponse


async def require_service_key(
    x_service_key: str | None = Header(default=None, alias="X-Service-Key"),
    settings: Settings = Depends(get_settings),
) -> None:
    if not settings.scanner_service_key:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Service key not configured")
    if x_service_key is None or not secrets.compare_digest(x_service_key, settings.scanner_service_key):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or missing X-Service-Key")


def get_clamd(request: Request) -> ClamdLike:
    clamd: ClamdLike = request.app.state.clamd
    return clamd


async def _read_capped(request: Request, max_bytes: int) -> bytes:
    declared = request.headers.get("content-length")
    if declared is not None and declared.isdigit() and int(declared) > max_bytes:
        raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, f"File is larger than {max_bytes} bytes")
    buf = bytearray()
    async for chunk in request.stream():
        buf.extend(chunk)
        if len(buf) > max_bytes:
            raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, f"File is larger than {max_bytes} bytes")
    return bytes(buf)


async def _safe_version(clamd: ClamdLike) -> ClamdVersion | None:
    try:
        return await clamd.version()
    except ClamdUnavailableError:
        return None


def create_app(clamd: ClamdLike | None = None) -> FastAPI:
    settings = get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        app.state.clamd = clamd or ClamdClient(settings.clamd_host, settings.clamd_port, settings.clamd_timeout_seconds)
        yield

    app = FastAPI(
        title="Tarragon Health upload scanner",
        description="Stateless ClamAV scan of uploaded documents (T2-08).",
        version=__version__,
        lifespan=lifespan,
    )
    if clamd is not None:
        # Tests build the app without running the lifespan; set it eagerly too.
        app.state.clamd = clamd

    @app.get("/health", response_model=HealthResponse)
    async def health(c: ClamdLike = Depends(get_clamd)) -> HealthResponse:
        up = await c.ping()
        v = await _safe_version(c) if up else None
        return HealthResponse(
            status="ok",
            service="scanner",
            version=__version__,
            environment=get_settings().environment,
            clamd="up" if up else "down",
            engine_version=v.engine_version if v else None,
            db_version=v.db_version if v else None,
            db_date=v.db_date if v else None,
        )

    @app.get("/ready")
    async def ready(c: ClamdLike = Depends(get_clamd)) -> JSONResponse:
        up = await c.ping()
        return JSONResponse(
            {"ready": up},
            status_code=status.HTTP_200_OK if up else status.HTTP_503_SERVICE_UNAVAILABLE,
        )

    @app.post(
        "/scan",
        response_model=ScanResponse,
        dependencies=[Depends(require_service_key)],
        responses={503: {"model": ScanResponse}, 413: {}, 400: {}},
    )
    async def scan(request: Request, c: ClamdLike = Depends(get_clamd)) -> JSONResponse:
        data = await _read_capped(request, get_settings().max_bytes)
        if not data:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Empty body")
        size = len(data)
        digest = hashlib.sha256(data).hexdigest()
        try:
            result = await c.instream(data)
        except ClamdUnavailableError:
            body = ScanResponse(status="error", size_bytes=size, sha256=digest, detail="clamd unavailable")
            return JSONResponse(body.model_dump(), status_code=status.HTTP_503_SERVICE_UNAVAILABLE)
        v = await _safe_version(c)
        body = ScanResponse(
            status=result.verdict,
            signature=result.signature,
            engine_version=v.engine_version if v else None,
            db_version=v.db_version if v else None,
            db_date=v.db_date if v else None,
            size_bytes=size,
            sha256=digest,
            detail=result.raw if result.verdict == "error" else None,
        )
        return JSONResponse(body.model_dump())

    return app


app = create_app()
