# Tarragon Health

Nigeria's digital-first chronic disease, preventive health, and family care
coordination OS. See `CLAUDE.md` for the operating contract (kept short on
purpose — the full dated build history lives in
`docs/CLAUDE_SPRINT_HISTORY_ARCHIVE.md`), `docs/ARCHITECTURE.md` for the
system design, and `docs/FEATURE_SPEC.md` for the full business/feature spec.

## Monorepo layout

```
apps/
  web/          Next.js 16 web app — patient/clinician/admin/HMO/corporate/pharmacist/
                analyst/finance dashboards, the public marketing site, ~100+ shipped
                features (chronic-disease pathways, prevention/screening, finance
                tooling, wallet/vouchers, AI case briefs, and much more — see the
                sprint history archive for the full build record)
  mobile/       React Native Expo app — installable PWA + Expo Home-tab WebView
                shell + native Bluetooth clinical-device pairing (built, not just
                planned)
services/
  ml/           Python FastAPI ML microservice — stateless, deployed (Railway), used
                for BP-control/HbA1c/cohort risk scoring; its own further build-out
                (Sprint 4) is paused, not the service itself
packages/
  shared/       Shared TS constants, enums, helpers, ML client
  lifestyle-engine/, protocol/, db/  Condition-agnostic engines + DB test suites
supabase/        ~380+ migrations, 7+ Edge Functions, cron jobs, seed data — this is
                the platform's real backbone, not a scaffold
docs/            ARCHITECTURE.md, FEATURE_SPEC.md, BRAND_GUIDE.md, CLINICAL_TRUST_MODEL_SPEC.md,
                MARKETING_SITE_SPEC.md, Tarragon_Health_Master_Operating_Plan_v4.md,
                CLAUDE_SPRINT_HISTORY_ARCHIVE.md (full dated build history), legal/,
                archive/ (superseded build-plan docs, kept for historical rationale)
guideline/       Clinical pathway source documents (signed .docx) + outstanding-gap
                tracking for Diabetes/Hypertension
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
