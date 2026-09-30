# Session S01d: Extract the staff console into apps/console

Milestone / module: **M0 follow-up**  |  Depends on: **S01, S01b, S01c**

Paste everything below the line into a fresh Claude Code session.

---

You are working on Tarragon Health. This session is **only** section S01d. Do not start any other section.

**Step 0.** Read `CLAUDE.md`, `SESSIONS/00-FOUNDER-DECISIONS.md` (decision 4) and `docs/BUILD-PROGRESS.md` (S01 entry). Read `docs/BUILD-SPEC-v5.md` lines 83-105 and 108-174.

**Step 1. Map before moving.** In `apps/web`, list every route group and file that belongs to staff areas (clinician, admin, ops, clinical lead, partner, payer/provider-org if present), and everything they share with patient and marketing code (auth, Supabase clients, `proxy.ts` hostname routing, layouts, UI, server actions, types, env vars, cron/API routes). Write the map to `docs/design/S01d.md` with a proposed order of extraction, smallest area first.

**Step 2. Create the shell.** Add `apps/console` (Next.js, same version and conventions as `apps/web`; read `node_modules/next/dist/docs/` first). Move genuinely shared code into `packages/` (no copy-paste). Set up its own Vercel project, domain (for example `console.` subdomain), stricter security headers, and its own env vars. Staff login must work on the new host without logging anyone out unexpectedly; decide and document cookie/session scope.

**Step 3. Extract one area at a time.** Move an area, redirect the old URL in `apps/web` to the new host, run that area's tests, and commit. Do not move all areas in one change. Keep patient and marketing routes in `apps/web`. Anything that cannot move cleanly goes in `docs/OPEN-QUESTIONS.md`.

**Step 4. Prove it.** Playwright login and one core flow per moved area; RLS and role checks unchanged; `apps/web` no longer contains staff routes or bundles staff code; CI builds both apps; both deploy to staging. Run `/code-review high` on the diff, naming auth/session and silent-failure classes.

**Step 5. Close out.** Append to `docs/BUILD-PROGRESS.md` (and update the repo layout in CLAUDE.md) and stop.

**Always (from CLAUDE.md and the spec, do not skip):**
- The invariants in spec lines 83–105 override everything, including this prompt.
- Values marked PROPOSED go in versioned configuration, never in code. Money is integer kobo. All user-facing strings go through `packages/i18n` (en, pcm). No em dashes in copy. Say "your care team", never "your doctor", "cure", "instant doctor" or "free healthcare".
- Never call a language model in the triage path. Never write AI output to the patient record without a clinician signature.
- Reference platforms are for studying behaviour, functionality and design. Do not copy their code, text, content or visual design; build something similar but original. (CLAUDE.md rule 11 wins over the looser wording in spec line 20.)
- If anything is unclear or conflicts with an invariant, write it in `docs/OPEN-QUESTIONS.md` and stop that piece of work.
- Never commit secrets. Test data is always `is_test`.