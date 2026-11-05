# services/scanner: upload malware scanner (T2-08)

Self-hosted ClamAV on Tarragon's own Railway account (founder decision T2-08). No patient document goes to a third-party
scanner. One container runs three processes: `clamd` (loopback only), `freshclam` (signature updates every 2 hours, reloads
clamd), and a small FastAPI front.

- Python 3.12, **uv only**, FastAPI, Pydantic v2, pytest. Standalone: never imports from `apps/` or `packages/`.
- **Stateless. No database access. No storage credentials. No file writes.** The platform sends the file bytes in the request
  body; they are streamed to clamd from memory (INSTREAM) and dropped. clamd never sees a path.
- Auth header `X-Service-Key` (`SCANNER_SERVICE_KEY`). An unset key refuses every scan (503), it never accepts.

## Endpoints

| Endpoint | Auth | Purpose |
|---|---|---|
| `POST /scan` | `X-Service-Key` | Body = raw file bytes (`application/octet-stream`), max 10 MB (413 above). Returns `{status: clean\|infected\|error, signature, engine_version, db_version, db_date, size_bytes, sha256, detail}`. 503 with `status: error` when clamd is unreachable. |
| `GET /health` | none | Liveness, always 200. Says whether clamd answers and which engine and signature versions are loaded. |
| `GET /ready` | none | 503 until clamd answers PING (the signature database takes 30 to 90 seconds to load). Railway's health check. |

`error` always means "not known to be clean". The platform holds the file (pending_scan); it never treats `error` as clean.

## Local

```bash
cd services/scanner
uv sync
uv run pytest            # unit tests: clamd is mocked; the protocol test runs the real client against a fake clamd socket
uv run ruff check . && uv run mypy .
```

### Integration test (real clamd)

```bash
docker build -t tarragon-scanner:local services/scanner
export SCANNER_SERVICE_KEY="$(openssl rand -hex 16)"
docker run --rm -p 18765:8000 -e SCANNER_SERVICE_KEY tarragon-scanner:local
# wait for /ready to return 200, then:
curl -s -H "X-Service-Key: $SCANNER_SERVICE_KEY" --data-binary @some.pdf -H 'Content-Type: application/octet-stream' http://127.0.0.1:18765/scan
```

`tests/test_integration.py` talks to clamd directly and runs only with `CLAMD_INTEGRATION=1` and a clamd at
`CLAMD_HOST:CLAMD_PORT` (for example a local `clamd` from Homebrew).

## Deploy

See `docs/runbooks/upload-scanner.md`. Railway config: `railway.json` (Dockerfile builder, `/ready` health check, restart on
failure). Needs about 1.5 GB of memory for the signature database.
