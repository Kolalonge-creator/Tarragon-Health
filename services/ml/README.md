# services/ml — Python ML Microservice

Stateless FastAPI microservice. **No database access. No file writes.** All
patient data arrives in the request body; results are returned as JSON. See
`docs/ARCHITECTURE.md` §4 and §9 for the service contract and endpoint catalogue.

- Python 3.12, package manager **uv only** (never bare pip)
- FastAPI 0.115+, Pydantic v2, scikit-learn / pandas / numpy / scipy (added per model)
- Auth header `X-Service-Key` (`ML_SERVICE_KEY`); called only by the TypeScript
  platform over HTTP with a 5s timeout and graceful fallback
- Not part of the pnpm workspace — it is a standalone Python project
- Never imports from `apps/` or `packages/`

## Layout

```
services/ml/
├─ app/
│  ├─ main.py            # FastAPI app + lifespan (models load once at startup)
│  ├─ config.py          # pydantic-settings, reads ML_SERVICE_KEY / ENVIRONMENT
│  ├─ security.py        # require_service_key — X-Service-Key dependency
│  └─ routers/health.py  # GET /health (unauthenticated liveness)
├─ tests/                # pytest + httpx (ASGI transport, no real port)
├─ Dockerfile           # uv multi-stage, non-root, HEALTHCHECK
└─ pyproject.toml       # uv project + ruff/mypy/pytest config
```

## Endpoints

| Endpoint | Auth | Purpose | Sprint |
|---|---|---|---|
| `GET /health` | none | Liveness (status/version/environment) | 1 |
| `POST /risk/cvd` | `X-Service-Key` | SCORE2 CVD 10-yr risk | 4 |
| `POST /trajectory/hba1c` | `X-Service-Key` | HbA1c trend | 4 |
| `POST /assess/bp-control` | `X-Service-Key` | 30-day BP control | 4 |

## Local development

Prerequisite: [uv](https://docs.astral.sh/uv/) (`curl -LsSf https://astral.sh/uv/install.sh | sh`).
uv provisions Python 3.12 itself from `.python-version`.

```bash
cd services/ml
cp .env.example .env          # set ML_SERVICE_KEY for local runs
uv sync                       # create .venv + install deps (incl. dev group)

uv run uvicorn app.main:app --reload   # http://127.0.0.1:8000/health
uv run ruff check .
uv run mypy app
uv run pytest
```

## Docker

```bash
docker build -t tarragon-ml services/ml
docker run --rm -p 8000:8000 -e ML_SERVICE_KEY=dev tarragon-ml
```

## Contract rules (do not violate)

- Stateless. Never read the database, never write files, never pull patient data.
- `X-Service-Key` is a shared secret — never commit a real value; keep `.env.example`
  in sync with any new variable.
- Health/liveness stays unauthenticated so orchestrators can probe it.
