# Build progress (v5 upgrade)

One entry per session, appended when the session closes. Newest last.

Entry format:

- **Section id**: session id and title (for example S01)
- **Built**: what was added
- **Reused**: what already existed and was kept
- **Tests**: what was run and the result
- **Open questions**: count, and ids in `docs/OPEN-QUESTIONS.md`
- **Follow-ups**: what the next session must know

---

## S01: Reconcile v5 with the live platform, docs scaffold, safe foundations (2026-09-30)

- **Built**: `docs/RECONCILIATION.md` (matches, differs, missing, invariant conflicts, role and table mapping, live-DB and migration-drift check, copy-lint baseline); `docs/OPEN-QUESTIONS.md` (26); `docs/DECISIONS.md`; this log; `docs/research/`, `docs/design/`; the v5 spec and session prompts under `docs/`; `@tarragon/i18n` (`en`, `pcm`, parity test); `@tarragon/ui` brand tokens with a `globals.css` drift test; versioned PROPOSED-config loader in `@tarragon/shared` with a hard-coded-literal repo scan; copy-lint with a baseline ratchet; a `lint` script for all 8 packages.
- **Reused**: existing CI (`turbo` typecheck, lint, test, build already covered every workspace except package lint); existing `ui-language.ts` Pidgin dictionary (left untouched); `globals.css` palette; `packages/*` jest/tsconfig conventions.
- **Tests**: `pnpm lint` and `pnpm typecheck` 10/10; `pnpm test` passing across web (2,793), mobile (285), shared, i18n, ui, triage and lifestyle engines. `pnpm install --frozen-lockfile` clean. No tables, RLS, app folders or clinical behaviour changed; migration-replay job unaffected (no SQL touched). `/code-review high` run: 8 findings, 7 fixed, 1 skipped (CLAUDE.md pointer section was explicitly requested).
- **Open questions**: 26 (OQ-01 to OQ-26). Decide first: OQ-01 (pull versus push queue), OQ-02/03 (clinician read scope and read logging, critical and live today), OQ-05/06 (SMS and notification content), OQ-09 (`is_test`).
- **Follow-ups**: Sentry for mobile and Edge Functions and CI secret scanning deferred (OQ-20). Run the real migration-drift script with a token (OQ-26). Recommended order: S01b (Platform Credit, 0 balance rows so a pure structural removal), then S01c (WhatsApp, also clears most of the SMS and INV-08 surface), then S01d (console split, largest and riskiest, do last once the first two shrink the code moving).
