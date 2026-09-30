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

## S01c: Remove WhatsApp (2026-09-30)

- **Built**: migration `20260930094618_remove_whatsapp.sql` (generated from live function definitions, reviewed line by line); WhatsApp removed from the edge functions, `apps/web`, `apps/mobile` and shared packages; `packages/db/tests/remove_whatsapp.sql` (registered in `ci.manifest`); 12 existing proofs re-expressed on the new mechanism; `database.types.ts` (both copies) spliced by hand; `CLAUDE.md` no longer describes WhatsApp as a live channel.
- **Counted first (live)**: 77 WhatsApp notifications ever, 0 sent (68 failed, 9 suppressed); no profile prefers it; 0 templates; 0 rows in every WhatsApp-only table (support_messages, preferences, outreach, tickets). SMS shows the same pattern (71 failed, 0 sent). Nobody loses a channel they were receiving.
- **Safety mapping, the main risk**: the CMO-signed `escalation_slas` v8 names whatsapp in every urgent and emergency ladder, and `alert_rules.config` names it in the critical-alert fan-out. Removing the label naively would have (a) shortened every urgent ladder to one push hop and (b) made `private.notify_clinician_alert` throw `invalid input value for enum notification_channel: "whatsapp"` inside critical alert creation (reproduced by sabotage). Fixed without editing signed config: `normalize_escalation_channels` reads the retired token as email (D-12), and `notify_clinician_alert` reads its channel list through that normaliser. Proven end to end on live data: push to email after a failed hop, exhausted ladders record a failure and alarm admins, emergencies keep push, email, sms, critical alerts still fan out.
- **What patients get instead**: reminders pick their channel with `private.patient_reminder_channel()` (email if preferred, else push if subscribed, else the in-app inbox), replacing a WhatsApp placeholder plus a remap trigger. Expect more items in the in-app inbox for patients without push.
- **History kept**: 77 notification rows and 6 alert deliveries relabelled in_app with `legacy_channel` recorded; 51 exhausted-ladder rows relabelled email (ladder length preserved). All critical rows already had a next hop, so the escalation cron cannot re-page from them.
- **Tests**: migration dry-run against live in an always-rolled-back transaction (live confirmed unchanged: label, trigger and table still present); 11 DB proofs pass on the migrated schema; `pnpm lint` and `typecheck` 10/10; web 2,795, mobile 254, shared 94, lifestyle-engine 48, Deno webhook 38. `/code-review high` run (see PR).
- **Open questions**: OQ-29 to OQ-32 raised and answered the same day (ladder v9 sign-off by the CMO, emergency-contact SMS exception, consent text, patient SMS removal).
- **Follow-ups**: (1) CMO to publish escalation_slas v9 (OQ-29). (2) New consent and terms versions (OQ-31, counsel). (3) Patient SMS removal session (OQ-32). (4) Production apply: in a quiet window (the enum rebuild locks `notifications` and `profiles`; a 10 second lock_timeout makes it fail cleanly), then redeploy `send-pending-notifications` and `abnormal-result-handler` from source and verify the deployed version matches, and DELETE the deployed `whatsapp-webhook` and `send-support-reply` functions. The edge-drift job will flag them until that is done. (5) `notification_delivery_fallback.sql` now passes on the migrated schema and could be moved from `ci.excluded` to `ci.manifest` after a CI replay. (6) The admin ops console no longer has a support-inbox counter.
