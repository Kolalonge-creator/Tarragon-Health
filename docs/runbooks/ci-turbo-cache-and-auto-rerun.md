# CI: turbo cache and auto-rerun of lost runners

## Turbo cache (`.github/workflows/ci.yml`)
`typescript-core` and `web-tests` restore and save `.turbo/cache` with `actions/cache@v4`
(no Vercel remote-cache token, no secrets). Key: OS, job kind, `pnpm-lock.yaml` hash, commit sha;
`restore-keys` fall back to the newest entry for the same lockfile, then the same job. Turbo still
hashes every task's inputs, so a cache hit only happens when the package's files, dependencies and
upstream outputs are unchanged. A changed package always re-runs. `turbo.json` needed no change:
`build` already declares outputs; `lint`/`typecheck`/`test` have none, so a hit replays logs and
(correctly) restores nothing.

Expected effect (not measured yet): a PR touching one package re-uses cached typecheck/lint/test/build for
untouched packages, and the 3 web shards skip rebuilding workspace packages. The web Jest run itself
is invoked directly (not through turbo) and is not cached. Check the first two runs of the PR: run 1
populates, run 2 should show `FULL TURBO` / `cache hit` lines. Job names are unchanged, so branch
protection (`TypeScript (web + shared)`, `Supabase migration replay`, `Python ML service`) is untouched.
Caveats: a cache entry is per-branch scoped by GitHub (PR branches read `main-dev` entries, not each
other's); entries are evicted after 7 days idle or beyond the repo's 10 GB cache budget.

## Auto-rerun (`.github/workflows/auto-rerun-lost-runner.yml`)
After CI completes with `failure`, and only for `run_attempt == 1`, it inspects each failed or cancelled
job (annotations first, then the last 400 log lines). It re-runs failed jobs once, only if every failed
job shows an infrastructure signature: `received a shutdown signal`, `lost communication with the server`,
`toomanyrequests`, or `rate limit exceeded` next to docker/registry/supabase/setup-cli. Any other
failure means no re-run. Loop guard: the re-run is attempt 2, which the workflow ignores.
Permissions: `actions: write`, `contents: read`, `checks: read`; plain `gh` CLI, no checkout, no
third-party actions.

Not provable before merge: `workflow_run` workflows only run from the default branch, so this one cannot
be exercised until merged. To verify afterwards, look for the "Re-run once on infrastructure failure"
job in Actions after the next lost-runner failure.
