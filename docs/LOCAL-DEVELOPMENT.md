# Local development with Docker

Docker Desktop (installed 2026-10-06) runs a full copy of the database on your Mac, the same stack CI uses. Use it for any migration or database proof instead of running a rolled-back transaction against production.

## One-off setup
```bash
brew install --cask docker-desktop   # asks for your Mac password; then open Docker once and accept its prompts
```
Wait until Docker reports it is running. If image pulls are rate limited, sign in to a free Docker account from the app.

## Everyday commands (run from the repo root or any worktree)
```bash
npx supabase start          # first run pulls several GB; later runs take seconds
npx supabase db reset       # replays every migration and the seed: exactly what the CI "Supabase migration replay" job does
./scripts/run-db-proofs.sh  # runs every proof in packages/db/tests/ci.manifest, including the 50-session race script
npx supabase stop           # frees the memory (about 2 to 4 GB while running)
```
Local database: `postgresql://postgres:postgres@127.0.0.1:54322/postgres`. Never point `DATABASE_URL` at production for the `.sh` proofs; they refuse unless the URL looks local.

## Rules of thumb
- Write the migration, run `db reset`, then the proofs. Apply to production only after both pass, and pin the version to the filename (CI does not push migrations).
- A proof that commits data (the `.sh` ones) can only be run here or in CI, never against production.
- The scripts must work on macOS bash 3.2: no `mapfile`, no associative arrays.
- Stop the stack when you are not working on database changes. One stack serves every worktree on the machine, so do not stop it under another session.
