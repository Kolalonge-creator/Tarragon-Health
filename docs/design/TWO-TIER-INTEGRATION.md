# Two-tier integration (branch `integration/two-tier`, 2026-10-12)

Status: for review. Nothing here is pushed, merged to `main-dev`, or applied to the live project `koiplnmbgnqnbywhpjlf`.

## 1. Branches merged (real merges, in this order, onto `origin/main-dev` 2f013845a)

| Order | Branch | Tip | Content |
|---|---|---|---|
| 1 | `two-tier/free-red-path` | 27d5abae0 | Free red events are guidance only (no page, task or alert); legacy screening bundles not sellable; amber, heart-failure and crisis follow-up on the same Free rule |
| 2 | `two-tier/pricing` | cc8caf1d1 | 120,000 individual price, 100,000 organisation price with overrides, only Free and Member, 14 day lapse grace, one Member function, add-ons retired |
| 3 | `two-tier/monthly-booking` | 405ab42ea | Doctor-offered follow-up slots, monthly entitlement, tiered call length, pre-call summary |
| 4 | `two-tier/testing-days` | 1a8b195d3 | Testing days, employer on-site visits, point-of-care results, annual screening tests required |
| 5 | `scale/sr1-sr3` | 883578ef0 | Observability, health snapshot, hot-path indexes, growth plan |
| 6 | `scale/sr4-sr7` | 46b201162 | Load-test harness, operations alert rules and wall, Stage A runbook, architecture note |

`fix/f05-replay-determinism` had no commits of its own; the fix it targeted is already on `main-dev` (#1057, 1fe12cdd7), so the F-05 migration replays with its file in place.

## 2. Changes made while integrating (beyond conflict resolution)

1. **Migration versions renumbered.** The branches' 17 migrations were stamped 20261012180704 to 20261012193928, which sort BEFORE two migrations already live (`20261012183252` SR2 purge, `20261012183729` OQ-276b). They were renumbered to 20261013003317 to 20261013010949 (same relative order, 137 s apart, not round numbers) so every one sorts after the live head. References in tests, mirrors, registry sources and docs were updated.
2. **SR2a dropped.** `sr2a_cron_history_cleanup` (job `cron-history-cleanup`, 7/30 days) duplicates the already-live SR2 purge (`purge-cron-history`, 7/30 days, #1055). Two purge jobs would double-run. The migration, its proof, the `db.cron_history_retention` config entry and its mirror test were removed.
3. **OQ numbering.** OQ-309 was used twice; the pricing one is now OQ-310 (and the BUILD-PROGRESS reference).
4. **Added proof** `packages/db/tests/two_tier_integration_feature_gate_union.sql` (registered in `ci.manifest`): the final `private.patient_has_feature_access` is the union of the Free red-event version and the add-on-retirement version. No extra composing migration was needed; the last-sorting definition (`...010949`) already carries both (fail-closed paging for the red feature, null patient pages, Member rule with grace for the doctor-time features, no recursion on `async_doctor_visit`).
5. **Proof fixes found by the full replay:** `s16_clinical_tasks.sql` counted task types excluding only one branch's addition (`membership_handoff` from pricing, `ecg_interpretation` from testing days; each branch fixed only its own); `testing_days_visits_poc.sql` fixtures did not set `organisation_id` on the profile the signup trigger had already created, so the employer-visit section ran in the default organisation (fixed with `organisation_id = excluded.organisation_id`); the entitlement FK indexes above.
6. Registry (`proposed-config/registry.ts`) and `database.types.ts` re-spliced; every added key from each branch kept. i18n, `ci.manifest` were union merges.

Member helper usage: monthly-booking and testing-days both call `private.patient_is_member` (defined by the pricing migration, which sorts first). A Member in the 14 day grace passes it; a lapsed patient and a Free patient are refused (proved for the helper). A Member in the grace can now book exactly one follow-up (month 13, migration `...012547`); decided 2026-10-12 (TT-8).

## 3. Final migration list, in apply order

All new, all after the live head `20261012183729`.

| Version | Name | Purpose |
|---|---|---|
| 20261013003317 | two_tier_membership_pricing | 120,000 price row (old row closed at apply), organisation price and overrides, organisation-paid seats (dormant module), lapse config, `patient_is_member` / `patient_is_member_at`, notification templates |
| 20261013003751 | two_tier_emergency_source_triage_red | Adds the enum value the Free red path needs (own transaction) |
| 20261013004008 | two_tier_free_red_event_path | `patient_may_page_doctor` gate, Free guidance, recheck and check-in, `free_red_events` |
| 20261013004225 | two_tier_legacy_screening_bundles_not_sellable | Legacy bundles off the shelf |
| 20261013004442 | sr2c_hot_table_indexes_and_policy_initplan | Hot-table indexes, RLS init-plan wrapping |
| 20261013004659 | testing_days_employer_visits_point_of_care | Testing days, employer visits, point-of-care results |
| 20261013004916 | sr2d_hot_path_indexes_and_overdue_sweep_sargable | More hot-path indexes, overdue sweep made index-friendly |
| 20261013005133 | membership_annual_screening_required | Annual screening tests required for Members |
| 20261013005350 | sr5_alert_rules_and_operations_wall | 14 operations alert rules, evaluator, wall |
| 20261013005607 | two_tier_followup_data_model_and_config | Monthly follow-up entitlements and config |
| 20261013005824 | two_tier_followup_entitlement_call_length_precall | Entitlement lifecycle, tiered call length, pre-call summary |
| 20261013010041 | two_tier_doctor_offered_followup_slots | Doctor offers several times, Member picks one |
| 20261013010258 | sr1_platform_health_snapshot | `platform_health_snapshot()` for `/api/health/deep` |
| 20261013010515 | two_tier_free_rule_amber_heart_failure_crisis | Free rule extended to amber, heart-failure weight gain, crisis follow-up |
| 20261013010732 | two_tier_only_free_and_member | Care packs, per-item doctor-time products, credits non-sellable (CHECK) |
| 20261013010949 | two_tier_retire_addons_and_member_gates | AI pass and monitoring retired; Member rule in feature gate; final `patient_has_feature_access` |
| 20261013011207 | two_tier_entitlement_fk_indexes | NEW (integration fix): partial indexes on `entitlements.seat_price_id` and `.invoice_id`; the pricing FKs had none and the SR2c proof refuses an uncovered FK on a hot table |
| 20261013012113 | two_tier_refund_window_and_immediate_end | NEW (review decision 1): `membership_policy_config` (refund 21 days, legacy no-end-date grant 365 days, renewal lookahead 30 days), `request_order_refund` refuses after the window, `decide_order_refund` ends Member access at once through `private.end_membership_now` |
| 20261013012331 | two_tier_one_member_rule_and_legacy_conversion | NEW (decision 2): legacy programme/plan holders converted to `legacy_conversion` Memberships (365 days from conversion when there is no end date), the `async_doctor_visit` clause removed from `patient_is_member(_at)`, only role `patient` can be a Member |
| 20261013012547 | two_tier_grace_followup_booking | NEW (decision 3): one grace follow-up (month 13) for a Member inside the 14 day grace; offers find the membership through the grace |
| 20261013012811 | two_tier_renewals_included_second_opinion_member_only | NEW (decision 4, revised 2026-10-13): the standalone renewal request is closed for a Member (renewals are decided at the monthly review); second opinion re-enabled at 500,000 kobo, Members only (RPC plus table trigger), one CHECK exemption; the anonymous price list hides it |
| 20261013013400 | two_tier_renewal_at_monthly_review | NEW (2026-10-13): `member_review_notes` and `add_review_note`; the pre-call summary lists medicines due for renewal and the Member's notes |
| 20261013013102 | two_tier_poc_ecg_path_and_free_red_record | NEW (findings 5 and 6): ECG file path validation (function and table CHECK); `record_free_red_event` opens the Free record explicitly when membership flipped |

## 4. Apply runbook

0. **PRE-APPLY RE-CHECK (mandatory, immediately before the first migration).** The migration stamps are hand-spaced future stamps, chosen to sort after the live head on 2026-10-12. Anything applied live since then can break that. Run `list_migrations` (or `select version from supabase_migrations.schema_migrations order by version`), save the versions to a file and run `node scripts/release-integrity/check-two-tier-apply-order.mjs --live <that file> --since 20261013000000`. It prints the migrations in apply order and exits 1 if any sorts before the newest live version. If it fails: re-stamp the failing migration and every one after it from the clock (one new 14-digit stamp each, in the same order, never a round number), update the references the checker and `rg <old stamp>` find, and re-run until it passes. Check again between migrations if the apply takes more than a few minutes. (`node --test scripts/release-integrity/check-two-tier-apply-order.test.mjs` proves the checker, including the failing case.)
1. **Code first.** Deploy the web app, console and mobile OTA from this branch once merged. Code written for the new schema must tolerate the old schema until step 3 (the Free-path and pricing screens read new tables; deploy them behind the dormant modules or immediately before step 3). The medicines screen calls `add_review_note` (created by `...013400`); against the old schema the note button shows the server's error. The public per-product guest checkout (`/checkout/*`) is deleted in this release.
2. **Edge functions.** Redeploy `send-pending-notifications` (new templates for membership lapse, follow-up offers, Free recheck and check-in) and the Sentry-instrumented functions (`abnormal-result-handler`, `integration-outbound-drain`, `paystack-webhook`, `process-events`, `queue-next`, `zoom-webhook`) with `supabase functions deploy <name>`. Do this BEFORE the migrations that add templates (the first, pricing). Check the deployed version against source afterwards (known drift). `deno check --no-config` passes for `templates.ts` and `index.ts`.
3. **Migrations, one at a time, in file order**, each applied as `execute_sql` inside a transaction with the `supabase_migrations.schema_migrations` row inserted at the version equal to the filename (never bare `apply_migration`, which stamps wall-clock time). Before each: `list_migrations` for anything new and unrecognised. Two migrations need a note: `...012331` converts the live legacy holders (1 plan-feature purchase live on 2026-10-12, no programme purchases) and prints its count; run it BEFORE the Free red-event path matters to those people (it sorts after it, so apply the whole chain in one sitting). Do not apply while Membership is unsellable without reading the warning in OQ-309: on the day the Free red-event path is applied every patient with no programme purchase becomes guidance-only.
4. **Post-apply checks:** `has_function_privilege('anon', <each new function>, 'EXECUTE')` false; `has_table_privilege('anon', <each new table>, 'SELECT')` false; `prices` shows one open 12,000,000 kobo membership row and the 10,000,000 row closed; `private.patient_may_page_doctor` false for a Free test patient, true for a Member; `select count(*) from patient_memberships where source = 'legacy_conversion'` equals the conversion count; `service_products` where `is_active` and code like `%credit` is exactly `second_opinion_credit` at 500000; `membership_policy_config` has one active row each for refund (21), legacy_conversion (365) and review (30); an anonymous call to `public_price_list()` never returns `second_opinion_credit`; `cron.job` shows the SR2 jobs and no `cron-history-cleanup`; `/api/health/deep` answers; `ops_alert_rules` has 14 rows; `get_advisors` security and performance; regenerate nothing wholesale (splice types only).
5. **Rollback:** every structural migration is additive except the retirements (`two_tier_only_free_and_member`, `retire_addons`, legacy bundles), which only flip `is_active` and add CHECKs: drop the CHECKs and set `is_active = true` to undo (rows are kept). Pricing: close the new price row and reopen the old one by inserting a new row (never edit). Free path: redefine `private.patient_may_page_doctor` to return true. Indexes: `drop index concurrently`. The review migrations carry their own ROLLBACK lines in their headers (restore the previous function bodies; `delete from patient_memberships where source = 'legacy_conversion'`; drop the ECG CHECK). New tables hold no production data at apply time (0 active memberships live).

## 5. Founder decisions and actions

- Verified Nigerian helpline numbers for the crisis and red screens (none exist in the repo; none invented).
- On-call contacts and the paging route (SR5/SR6), plus where alerts go on a phone.
- Thresholds: `ops.health_thresholds`, `ops.alert_rules`, `free_red_event.rules` (30 min recheck, 6 h check-in), `membership.lapse` grace and reminder days, organisation price band 50,000 to 200,000 naira. All PROPOSED.
- Service targets (`ops.service_targets`): CMO and founder to sign. Not marked confirmed.
- Device models for point-of-care testing days; venue approval for testing days and employer on-site visits; the standing order for point-of-care testing.
- CMO signing of lab panel v2 and the urinalysis and HbA1c limits used by point-of-care results.
- INV-05 wording (Free red events guidance-only): the CMO's signature is the only thing needed to go live (OQ-309, TT-12). Telling the DPO and a legal review of the consent wording are recommended and optional.
- Whether Membership is sellable before the Free path is applied (OQ-309 option c).
- Open items in OQ-310: seats not posted to the ledger, `price_per_member_minor` second price, no auto-renewal of an organisation seat.
- Hosting facts and the paid plan with point-in-time recovery (SR1 launch blocker), Sentry DSNs, Upstash.
- AI scribe evaluations (CMO runs; AI-017 stays off until then). No evaluation, approval or signature was seeded.
- Renewals (OQ-311, resolved 2026-10-13): confirm the 30 day lookahead for "due for renewal" in the pre-call summary (`membership.review`, PROPOSED). Legacy holders (OQ-312, resolved): 365 days when there is no end date (`membership.legacy_conversion`, PROPOSED), none live. The Membership terms text for the 21 day refund is being drafted on another branch (OQ-313); counsel review is recommended, optional.
- Note for the founder: renewals were effectively free for everyone before this change (the old check passed because `medication_refills` is in the free feature list); they are now a Membership benefit decided at the monthly review. The second opinion shows the 5,000 naira price in the Member app only; the marketing price content is deleted (TT-11) and a Jest test keeps it off.

## 6. Verification results (2026-10-12, review pass)

- Fresh `supabase db reset` replay of every migration (including the F-05 file and the five review migrations) and the seed: clean.
- `scripts/run-db-proofs.sh`: 196 of 196 manifest entries run (including the five shell race proofs). First run: 193 passed, 3 failed because their fixtures picked "any active product" and now met the Members-only second opinion; those three proofs now skip that product, and all three pass. New proof `two_tier_review_decisions.sql`: 51 checks plus 7 sabotage steps that each flip their check; ECG-path and Free-record proofs extended inside `testing_days_visits_poc.sql` and `two_tier_free_red_event_path.sql`.
- Race proofs alone, on a loaded shared machine (load average about 22 on 18 cores): s19 106 s, s18 54 s, s17 38 s, finance reversal 27 s, care voucher 6 s, all pass with their controls. The earlier stall coincided with the web Jest suite running at the same time on the same machine and with the harness not being given CPU while idle-waiting; the gate in `create_red_page` is exercised by the s19 fixtures (the patient is a Member) and adds no lock.
- `pnpm typecheck` 19 of 19. Jest: shared 221, i18n 81, notifications 430, clinical 350, console 44, mobile 1552, web 4510 tests, all passing. ESLint clean on changed web and package files (mobile: 0 errors). `deno check --no-config` passes for `send-pending-notifications/templates.ts` and `index.ts`; `deno lint` reports the same 18 findings as before the branch. `node --test scripts/release-integrity/check-two-tier-apply-order.test.mjs`: 4 of 4.

## 7. Decisions of 2026-10-13 (founder/CMO)

1. Renewals are decided at the monthly review (TT-9, OQ-311 resolved): standalone request closed for a Member, optional note, pre-call summary lists medicines due for renewal and the note. No frequency limit.
2. Legacy holders: every one becomes a real Member; no end date means 365 days from conversion (TT-7, OQ-312 resolved).
3. Marketing pricing: only Free and Membership; one price (read from config) and the refund rule are public; everything else deleted; Jest scan keeps it that way (TT-11).
4. OQ-309: only the CMO's signature is needed; DPO and legal are recommended, optional (TT-12). Nothing in this document is blocked on them.
5. `docs/legal` is not touched on this branch (another agent drafts the Membership terms).

## 8. What was and was not verified after the 2026-10-13 decisions

Verified: `pnpm typecheck` 19 of 19; Jest (shared 223, i18n 81, notifications 430, clinical 350, console 44, mobile 1552, web 4499 tests in 517 suites; the web count dropped by the deleted guest-checkout and structured-data price tests and rose by the new no-public-prices scan); the scan test `apps/web/src/lib/marketing/no-public-prices.test.ts`.

NOT verified: the edited and new SQL (`...012113`, `...012331`, `...012811`, `...013400`) and the updated proofs (`two_tier_review_decisions.sql`, `two_tier_monthly_followup_offers_and_call_length.sql`) have not been replayed or run, because the local Docker engine stopped answering (every call returned HTTP 500) during this pass and could not be restarted without disturbing other sessions' containers. The migrations were written against the function bodies read in the previous, fully verified pass (196 of 196 manifest entries, 5 race proofs). Before applying anything: run `supabase db reset` and `scripts/run-db-proofs.sh` on this branch and fix whatever the four migrations and two proofs turn up.
