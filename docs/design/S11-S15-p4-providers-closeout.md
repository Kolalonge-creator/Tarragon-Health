# S11-S15 P4 (provider layer) closeout

Branch `s11-s15/p4-provider-layer`. Nothing was applied, deployed, merged or switched on. Four feature flags exist and are OFF: `provider_inbox_paystack`, `provider_circuit_breaker`, `payout_batch_maker_checker`, `payout_gl_posting`. `payouts_enabled` was not touched.

## Built
- Provider event inbox (`provider_events`, claim/complete/fail/replay/purge, admin list, audited raw read), adopted by `resend-webhook` and `zoom-webhook` (direct fallback if the inbox is unreachable) and by `paystack-webhook` behind the flag. New `provider-event-drain`.
- Settlement reconciliation: adapter `listSettlements` / `listSettlementTransactions` (interface, mock, Paystack, contract tests), `settlement-reconcile` function, report/line/break tables, break queue with ageing, audited close. Never posts.
- Payouts: GL posting on success and exact-opposite reversal (flag), failed/skipped posting queue and retry, clinician statement "paid then returned", batch maker-checker with limits (flag), send-time re-check of all limits.
- Circuit breaker: `provider_health`, `provider_health_v`, wrappers, wired into `order-checkout` (flag).
- `/admin/ops/providers` page (health, breaks, GL attention, inbox), nav and admin-search entries.
- R7: audio-fallback table tool, ASR gold-set harness, Q19 drug/number highlight on the scribe draft, Q18 database triggers (S23x).
- PROPOSED config `payouts.controls` and `providers.layer` with migration seeds and drift tests.

## Reused
S14 adapters and mocks, S10 bus pattern, S31 state machine and approvers, finance `finance_post_journal`, `audit_log`, `feature_flags`, S21 ladder (`stepLadder`), S35 scribe review panel and WER normaliser idea.

## Tests (all run)
- SQL proofs against the live project inside rolled-back transactions, nothing left behind: S14x 77 checks, S31x 59, S23x 20, all PASS, each with two sabotage steps that flip. Existing `scribe_consent_and_transcript_rls`, `s21g_*`, `s23c_*`, `s35c_*` proofs re-run with the S23x migration: no failure. Registered in `ci.manifest`. Not run: a fresh local `db reset` replay (no Docker here).
- Jest `@tarragon/integrations` 341 (new files 100% lines, global branches 98%); `apps/web` touched suites 161; `packages/shared` proposed-config 133; `packages/i18n` 81.
- Deno: resend 7, zoom 10, settlement-reconcile 3, drain 2, paystack 62 (51 existing + 11), order functions unchanged and green; lint clean. node:test ASR harness 15. tsc and eslint clean for integrations, shared, i18n and apps/web.
- Not proven (no deploy, no sandbox): any real Paystack, Zoom or Resend call; the Paystack settlement endpoint paths and field names (read from third-party pages [NV]); the cron/vault wiring; a real handset.

## Review (adversarial, run on this diff)
Fixed: bank return after a failed success posting (skipped, never retried into the books); failed postings now visible to finance; scribe triggers now demand an encounter-bound consent and check the patient; raw inbox no longer readable by any client role; rejected rows purgeable; dead Paystack events answer 500; clinician limit also checked at send and under a per-clinician lock. Accepted and documented: (a) with the Paystack flag on, the old path swallows some failures and answers 200, so the inbox shows `processed` for them and a replay no-ops on the old `payment_transactions` row: do not treat inbox status as a success signal until that dedupe moves into the inbox (soak item); (b) the maker-checker flag can be flipped by an admin, so it is a configuration control, not a guard (consider a go-live guard before switching `payouts_enabled`); (c) no UI yet to propose or release batches (RPCs only); (d) Zoom `meeting.ended` before `zoom_meeting_id` is stored is recorded and lost as before; (e) rejected rows are unauthenticated input: purge is not scheduled.

## Proposed OQ text
- OQ-P4-1: Who is the second payout approver when the founder is the only admin? Today the CMO. If neither is available nothing can be released (deliberate).
- OQ-P4-2: Set the real `payouts.controls` numbers (per payout, per clinician per 7 days, per batch). Starting values are sized for a small pilot.
- OQ-P4-3: Finance: account 5200 "Clinician fees" and the expense/cash treatment of payouts (and withholding tax, D-09) need sign-off before `payout_gl_posting` is switched on.
- OQ-P4-4: Pick the retention for rejected webhook rows (default 30 days) and for verified raw bodies (customer emails): counsel/DPO.
- OQ-P4-5: Real handset readings (3G, throttled, power-saving) for the audio-fallback table; CMO/founder choose the final `video.audio_fallback` values from it.
- OQ-P4-6: The CMO corrects `drug-names.json` (the list drives both the scribe highlight and the ASR scoring) and sets any pass mark for a speech vendor (Q19).

## Follow-ups
Schedule `provider-event-drain` and `settlement-reconcile` (vault secrets `provider_drain_secret`, `settlement_reconcile_secret`, a staggered cron; the connection budget is tight); batch propose/release UI; payout reconciliation against `GET /transfer`; move Paystack dedupe into the inbox; email breaker needs `send-pending-notifications` to use the adapter; splice generated types for the new tables/functions into `database.types.ts` (the new web loaders use one narrow untyped client until then); PHI note: the inbox raw body can hold a customer email, admin read is audited.

## Apply and deploy order (lead)
1. Migrations in file order: `20261013223052_s14x_...`, `20261013223547_s31x_...`, `20261013225511_s23x_...`. They were stamped from the local clock on 2026-10-13; if the apply-order check refuses because the live head moved past them, rename to later real timestamps. `finance_journal_entries_source_check` is widened (adds `payout`, `payout_reversal`): another branch that also widens it must carry both values.
2. Then deploy functions: `resend-webhook`, `zoom-webhook`, `paystack-webhook` (flag off, behaviour unchanged), `order-checkout` (flag off), new `settlement-reconcile`, `provider-event-drain`. Deploy functions only AFTER the migrations (Resend/Zoom fall back safely if not, Paystack with the flag off never touches the inbox).
3. Web deploy (admin page, statement note, scribe highlight).
4. Nothing to switch on. To soak the Paystack inbox later: flip `provider_inbox_paystack` in the sandbox first and watch `/admin/ops/providers`.
