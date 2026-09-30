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

## S01b: Remove Platform Credit (2026-09-30)

- **Built**: migration `20260930093012_remove_platform_credit.sql`; Platform Credit removed from `apps/web`, `apps/mobile` and the Paystack webhook; `packages/db/tests/remove_platform_credit.sql` (registered in `ci.manifest`); `packages/shared/src/database.types.ts` spliced by hand.
- **Counted first (live)**: 0 balances, 0 ledger entries, 0 top-ups, 0 rows using the `platform_credit` payment provider, 1 config row. No money moved, no refund step.
- **What the migration does**: rewrites every surviving function that touched credit (video-visit accept and alternate slot, both guarantee-refund RPCs, receipts, unified ledger, payer and service-label helpers); drops 4 tables, 14 functions, 3 enum types, the trigger and the `platform_credit_topups` module flag; rebuilds `payment_provider` without the label; ends in an assertion block. Sets a 10 second `lock_timeout` because the enum rebuild locks the payment tables.
- **Kept on purpose (read-only history)**: 7 E2E-test GL journal entries with `source = 'platform_credit'` (posted entries are append-only) and account 2600. Care Vouchers and service-purchase credits ("Ask a doctor credit") are a different feature and untouched.
- **Reused**: the repo's feature-removal pattern; `private.finance_create_recognition_schedule` to rebuild cash-funded fixtures in three DB proofs.
- **Tests**: migration dry-run against live inside a rolled-back transaction (live confirmed unchanged afterwards); remove_platform_credit, first_purchase_guarantee_refund, finance_revenue_by_funding_source, both voucher redemption proofs and the recognition-schedule proof all pass on the migrated schema; Deno webhook tests 38 pass and `deno lint --no-config` clean; `pnpm lint`, `typecheck`, `test` green (web 2,793, mobile 251, shared 94). `/code-review high`: 8 findings, 6 fixed, 2 skipped (retained history hidden from profile-scoped ledger; dead `stripe`/`wallet` enum labels).
- **The control check caught a real bug**: the first version of the rewritten `finance_unified_ledger` mixed numeric into a bigint column and would only have failed at runtime. Fixed before review.
- **Not applied to production yet**. CI does not push migrations, and this one drops RPCs the deployed app still calls, so apply it together with the merge (see follow-ups). The migration-replay CI job has not run on this branch: no Docker was available locally.
- **Open questions**: 1 new (OQ-28, leftover 250,000 kobo test balance on GL account 2100).
- **Follow-ups**: apply the migration in a quiet window (pinned to its file version, in one transaction with the schema_migrations row) and deploy the web app and `paystack-webhook` function immediately after; mobile ships via OTA (JS-only). Older installed mobile builds still call the deleted `/api/mobile/platform-credit/*` routes and will show an error on those screens until updated. Free (zero price) products on mobile now go through the browser like every other purchase.
