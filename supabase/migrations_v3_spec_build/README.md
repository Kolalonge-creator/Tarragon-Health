# v3 spec build — reference only, NOT this repo's active migrations

These 44 migrations implement `docs/tarragon-build-spec-v3.md` (M1–M4 + Phase 2 guard L3).
They are **not** applied by `supabase db push` from this repo, and they are not part of the
platform schema. They live here so the work is preserved and readable, not so it runs.

## Why they are not in `supabase/migrations/`

As of 2026-07-29 the founder decided to bring v3's *rules* into the platform rather than
replace the platform with v3 (see the CLAUDE.md banner). `supabase/migrations/` therefore
means one thing only: the Tarragon Platform schema. The Supabase CLI assumes one repo maps
to one project, and having two migration sets in the default path made `db push` ambiguous
and dangerous.

## Where each database lives

| Supabase project | Ref | Holds | Status |
|---|---|---|---|
| **Tarragon Platform** | `rjsxbhgqdudowlvarmzq` | The platform — `supabase/migrations/` (277 files) | active, go-forward |
| **Tarragon Health** | `koiplnmbgnqnbywhpjlf` | This v3 spec build — the 44 files here | active |
| **tarragon-control-staging** | `jpdwbnvrgvpntcmfefeu` | A duplicate v3 build from `~/Documents/tarragon-control` | **paused** 2026-07-29 |

The paused project is restorable at any time (`restore_project`). It was paused, not deleted,
to free a slot under the free plan's two-active-project cap.

⚠️ `~/Documents/tarragon-control` has **no git remote** — its four commits (M1–M4) exist only
on local disk. Push it somewhere before relying on it.

## History note

On 2026-07-29 the `Tarragon Health` project's schema was dropped in error while a concurrent
session was building M3/M4 in it, then fully restored by replaying every file in this
directory in filename order. `supabase_migrations.schema_migrations` on that project records
these 44 filenames exactly. Nothing was lost — `auth.users` was never touched — but before any
destructive database operation, check `list_sessions` for a running session in the same
working directory first.
