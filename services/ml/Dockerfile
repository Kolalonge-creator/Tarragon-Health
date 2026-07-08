# Tarragon Health ML service — Python 3.12, uv-managed.
# Multi-stage: build a locked venv, then copy into a slim runtime image.
FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim AS builder

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=0

WORKDIR /app

# Install dependencies first (cached unless the lock/manifest changes).
# No --mount=type=cache: some builders (e.g. Railway's) enforce
# builder-specific requirements on cache mount ids beyond the Dockerfile
# spec proper, so plain (uncached) installs are the portable choice here.
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-install-project --no-dev

# Then the application itself.
COPY app ./app
RUN uv sync --frozen --no-dev


FROM python:3.12-slim-bookworm AS runtime

# Run as a non-root user.
RUN useradd --create-home --uid 1000 appuser
WORKDIR /app

COPY --from=builder --chown=appuser:appuser /app /app
ENV PATH="/app/.venv/bin:$PATH" \
    ENVIRONMENT=production
USER appuser

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD ["python", "-c", "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health').status==200 else 1)"]

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
