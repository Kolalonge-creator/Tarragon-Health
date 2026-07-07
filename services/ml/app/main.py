"""FastAPI application entrypoint.

Models are loaded once at startup via the lifespan handler (none yet in
Sprint 1) and never per-request. The app is stateless with respect to
patient data — nothing is persisted here.
"""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI

from . import __version__
from .routers import diabetes, health, hypertension, risk


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
    app = FastAPI(
        title="Tarragon Health ML Service",
        description="Stateless ML microservice — SCORE2, HbA1c trajectory, BP control.",
        version=__version__,
        lifespan=lifespan,
    )
    app.include_router(health.router)
    app.include_router(risk.router)
    app.include_router(diabetes.router)
    app.include_router(hypertension.router)
    return app


app = create_app()
