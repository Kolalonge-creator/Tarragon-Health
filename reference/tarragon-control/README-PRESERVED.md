# tarragon-control — preserved copy (2026-07-29)

`~/Documents/tarragon-control` was a **separate local repo with no git remote**: its four commits
(M1–M4 of `docs/tarragon-build-spec-v3.md`) existed only on local disk and were one disk failure
from gone. Everything in it is preserved here before any deletion happens.

## What is preserved

- **`tarragon-control.bundle`** — the complete git repository including all four commits and their
  history. This is the authoritative copy. Restore it with:
  ```
  git clone reference/tarragon-control/tarragon-control.bundle tarragon-control-restored
  ```
- **Every tracked file** from `HEAD`, at its original path (48 files), so the content is readable
  and greppable without unbundling.

## What was in it that this repo did not already have

The migration SQL was largely absorbed into `supabase/migrations_v3_spec_build/` (several of those
files say so in their own comments). These did **not** exist anywhere else:

| File | Why it matters |
|---|---|
| `supabase/tests/invariants_test.sql` | The I1–I10 failing-first invariant suite. The single highest-value artifact for porting v3's discipline into the platform. |
| `supabase/tests/m1_fixture.sql` | Seeds the synthetic fixtures. The ~678 rows in the paused `tarragon-control-staging` database are reproducible from this file, so that data is not lost when the project is deleted. |
| `supabase/tests/m1–m4_exit_test.sql` | Per-milestone exit tests required by spec §20. Written independently of this repo's `packages/db/tests/*`. |
| `packages/protocol/src/devices.ts` + test | Validated-device logic. |
| `packages/shared/src/bmi.ts` + test | BMI computation. |
| `packages/shared/src/signature-block.ts` + test | Overlaps this repo's `packages/protocol/src/accountability.ts` but is a different implementation. |

## Its database

`tarragon-control-staging` (`jpdwbnvrgvpntcmfefeu`) was **paused**, not deleted, on 2026-07-29.
Its schema is fully reproducible from the 19 migration files preserved here, and its test data
from `m1_fixture.sql`. Restore the project with `restore_project` if you ever want it back live.

## Safe to delete the original folder?

Yes — **once this directory is committed**. The bundle carries the full history and every tracked
file is copied. The only thing not preserved is `node_modules` (~80 MB of the folder's 82 MB),
which is regenerable with `pnpm install`.
