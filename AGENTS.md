<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Cursor Cloud specific instructions

Two independent toolchains: the pnpm/Turborepo TypeScript monorepo (`apps/*`, `packages/*`) and a standalone Python/`uv` FastAPI ML service in `services/ml` (deliberately outside the pnpm workspace). The startup update script already runs `pnpm install` and `uv sync` for `services/ml`; standard task commands live in `README.md`, root `package.json`, and `services/ml/README.md`.

### Running the services (dev mode)
- Web (Next.js 16, port 3000): `pnpm --filter @tarragon/web dev`. **This note is stale as of 2026-08-04 — it previously said this was "currently the default create-next-app scaffold; it renders without Supabase/env vars."** That has not been true for a long time: `apps/web` is a large, fully-built production platform (patient/clinician/admin/HMO/corporate dashboards, ~180+ Supabase tables, dozens of Edge Functions and cron jobs) and needs real Supabase env vars to run meaningfully — see `.env.example` and `CLAUDE.md`. If you're bootstrapping a brand-new sandbox with no env vars configured yet, the app will still build but most pages will error without a working Supabase connection.
- ML service (FastAPI, port 8000): from `services/ml`, `uv run uvicorn app.main:app --reload --port 8000`. `GET /health` is unauthenticated; Swagger UI at `/docs`. The ML service is optional at runtime — the TS platform calls it over HTTP with a 5s timeout and graceful fallback (`packages/shared/ml-client.ts` returns `null` on error), so the web app works even when ML is down. It is deployed and live (Railway), used for BP-control risk scoring, HbA1c trajectory, and cohort analytics — its own further build-out (Sprint 4) has been paused since 2026-07-09, but what's shipped is real and called from production.
- `uv` is installed under `~/.local/bin`; if `uv` is not found, prefix commands with `PATH="$HOME/.local/bin:$PATH"`.

### Non-obvious gotchas
- pnpm 11 removed `onlyBuiltDependencies`; approved native build scripts (`sharp`, `unrs-resolver`) now live in the `allowBuilds` map in `pnpm-workspace.yaml`. If a fresh `pnpm install` prints `ERR_PNPM_IGNORED_BUILDS` and then `pnpm <script>` fails its pre-run dependency check, it means `allowBuilds` is missing/wrong — pnpm will also auto-write an invalid `allowBuilds` placeholder that must be replaced with `true`/`false` (or reverted).
- **`apps/mobile` (React Native Expo) exists and is built** (installable PWA + Expo Home-tab WebView shell + native BLE device pairing) — the previous note here claiming it was "documented but not yet scaffolded" was wrong/stale; don't assume it's empty.
- Supabase local dev (`supabase start`) needs Docker + the Supabase CLI. Whether either is pre-installed in a given sandbox varies — check before assuming; regardless, most work against this project happens against the live remote Supabase project (`koiplnmbgnqnbywhpjlf`, see `CLAUDE.md`) via the Supabase MCP tools or `npx supabase db query --linked`, not a local stack.
- CI (`.github/workflows/ci.yml`) runs `pnpm typecheck && pnpm lint && pnpm test && pnpm build` (Node 22) and, for `services/ml`, `uv run ruff check . && uv run mypy . && uv run pytest`.
