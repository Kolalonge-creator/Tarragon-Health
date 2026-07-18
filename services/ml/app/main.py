"""FastAPI application entrypoint.

Models are loaded once at startup via the lifespan handler (none yet in
Sprint 1) and never per-request. The app is stateless with respect to
patient data — nothing is persisted here.
"""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

import sentry_sdk
from fastapi import FastAPI

from . import __version__
from .config import get_settings
from .routers import analytics, batch, diabetes, health, hypertension, labs, risk


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    # SCORE2/HbA1c/BP-control are pure functions with no fitted artifacts to
    # load. Later models (population cohort analytics, batch prediction) that
    # do need warm state will populate this dict once, here, at startup.
    models: dict[str, Any] = {}
    app.state.models = models
    yield
    models.clear()


def create_app() -> FastAPI:
    settings = get_settings()
    if settings.sentry_dsn:
        sentry_sdk.init(dsn=settings.sentry_dsn, environment=settings.environment)

    app = FastAPI(
        title="Tarragon Health ML Service",
        description="Stateless ML microservice — SCORE2, HbA1c trajectory, BP control, lab "
        "interpretation, cohort analytics, batch prediction.",
        version=__version__,
        lifespan=lifespan,
    )
    app.include_router(health.router)
    app.include_router(risk.router)
    app.include_router(diabetes.router)
    app.include_router(hypertension.router)
    app.include_router(labs.router)
    app.include_router(analytics.router)
    app.include_router(batch.router)
    return app


app = create_app()
