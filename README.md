# Tarragon Health

Nigeria's digital-first chronic disease, preventive health, and family care
coordination OS. See `CLAUDE.md` for the operating contract,
`docs/ARCHITECTURE.md` for the system design, and `docs/FEATURE_SPEC.md` for the
full business/feature spec.

## Monorepo layout

```
apps/
  web/          Next.js 16 web app (patient/clinician/doctor/admin/HMO/corporate)
  mobile/       React Native Expo app (planned)
services/
  ml/           Python FastAPI ML microservice (stateless; scaffold pending)
packages/
  shared/       Shared TS constants, enums, helpers, ML client
supabase/        Migrations, Edge Functions, seed (planned)
docs/            ARCHITECTURE.md, FEATURE_SPEC.md, BRAND_GUIDE.md
brand/           Logo assets
```

## Toolchain

- **Node** ≥ 20.9, **pnpm** (via corepack), **Turborepo**
- TypeScript strict everywhere; the Python ML service uses **uv** and is standalone

## Getting started

```bash
corepack enable pnpm   # first time only
pnpm install
pnpm dev               # runs all app dev servers via turbo
pnpm build             # build all workspaces
pnpm lint              # lint all workspaces
pnpm typecheck         # type-check all workspaces
```

To work on a single app:

```bash
pnpm --filter @tarragon/web dev
```
