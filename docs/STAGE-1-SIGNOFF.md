# Stage 1 sign-off (S40 gate run, 2026-10-28)

**Verdict: Stage 1 is NOT complete. "Stage 1 complete" is not written in `docs/BUILD-PROGRESS.md`.**

This replaces the 2026-10-07 draft. Every Stage 1 pull request is now merged, so the draft's "not all of Stage 1 is on main-dev" blocker is gone. This run executed the test matrix on a Mac with Docker and an iOS simulator against `origin/main-dev` at `43c9fec5c`, plus the fixes listed in section 5. Nothing below is a pass unless a command ran and passed; the rows that did not run say so and say why.

The gate does not pass today for these reasons, none of which is a failing automated test:

1. The mobile half of safety case 1 was proved on the iOS simulator only in part (guidance with no network: yes; the reading reaching the server after the network returns: not verified), and no flow was run on a real phone.
2. Five-plus hardware and money rows cannot be run on a simulator (section 7).
3. Safety case 7 has three different numbers (5, 6, 7 days). See section 6.
4. The S85 journeys J1, J2 and J4 finish with no failures but are INCOMPLETE: their pending steps are human decisions or later-stage features.
5. About 593 entries in `docs/OPEN-QUESTIONS.md` still read "Decision: open" (a text match, not a verified status).

## 1. What was run

| Level | Command | Result |
|---|---|---|
| Migration replay | `supabase db reset` on a fresh local stack | Pass. Every migration and the seed applied, twice (before and after the new migration). |
| Database proofs | `scripts/run-db-proofs.sh` (race proofs included) | **Pass: 486 of 486** on a fresh replay, and **487 of 487** on a second fresh replay after the first push migration and proof were added, and **488 of 488** on a third fresh replay after the sign-out and takeover migration and proof (final state of this branch). The six "FAIL" strings in the first log are deliberate sabotage rows inside the S39 proofs, which the runner accepts. These proofs assume a fresh database like CI's: a run on a database that the E2E suite had already used (with `S85_FIXTURE_APPROVE_RULESET=1`) failed about 50 scripts on leftover state, so always reset first. |
| Typecheck | `pnpm typecheck` | Pass. |
| Unit, all packages except web | `pnpm test:ci` | Pass. shared 1,864, mobile 3,238, notifications 737, medicines 509, symptom-triage 282, queue 220, integrations 449 (1 skipped), clinical 1,434, others green. |
| Unit, web | `jest` in `apps/web` | Pass: 1,054 suites, 9,037 tests. |
| Unit, mobile after this run's fixes | `pnpm test` in `apps/mobile` | Pass: 264 suites, 3,255 tests. Typecheck clean, lint 0 errors. |
| Coverage target | `packages/clinical`, `packages/queue` | 100 percent statements, branches, functions and lines, enforced by `coverageThreshold`. |
| Python ML service | `ruff`, `mypy`, `pytest` | Pass (`ruff` clean, `mypy` 46 source files clean, `pytest` 126 tests all passed). |
| Web browser E2E | Playwright, production build, fresh database | Pass: 27 passed, 0 failed, 12 skipped. The skips are unbuilt journey stubs and the Paystack hosted-checkout step (needs a served `order-checkout` function and the checkout guard, both off locally). |
| Console browser E2E | Playwright (apps/console) | Pass: 10 passed. This includes the authenticated sign-in specs that had never run. |
| Mobile end to end | Maestro on iPhone 17 Pro, Release build | `signed-out-sign-in-screen`: pass. `login-to-overview`: pass (after fixing the flow, section 5). The other eight flows are Android-only (`appId com.tarragonhealth.app`) or device-lab and were not run: no Android emulator is installed. |
| Performance | iOS simulator, Release build | Reported, not gated (OQ-227 has no pass or fail targets). Installed bundle 130.8 MB (13.5 MB of it JavaScript; this is an unthinned simulator build, not an App Store download). Cold start to the first API call about 1 second (5 runs, 0.9 to 1.3 s). Not measured on a real or low-end phone. |
| Paystack test mode | Test secret key, Paystack API | Pass for the integration: a test transaction was initialised (domain `test`) and verified; it stayed "abandoned" because no payment was made. The webhook-to-entitlement path was not run live (Paystack cannot reach this machine); safety case 24 is proved by the database proofs. |

Test patients created on the local stack for the mobile runs were `is_test` rows in a throwaway database that is reset after each run.

## 2. Journeys (S85)

All three run end to end and report **INCOMPLETE** with no failed steps.

| Journey | Passed | Failed | Pending | Skipped |
|---|---|---|---|---|
| J1 a new user's first month | 6 | 0 | 9 | 1 |
| J2 a red reading at night | 14 | 0 | 4 | 0 |
| J4 institution | 8 | 0 | 3 | 1 |

The pending steps are the human or later-stage items the journeys already name: the CMO signing the WHO CVD instrument, screening rules, `bp_care_triage` and the silence sweep; the founder's go-live of the membership catalogue and decisions on what "goal" and "consistency" mean; S64 follow-up booking after a red reading; S79 institution console; and OQ-549 (an untied clinician still reads `menstrual_cycles`, a known gap). A journey is not counted as passing while any step is pending.

## 3. The 25 clinical safety cases

"Proof" is the script or test that exercised the case in this run.

| # | Case | Proof | Result |
|---|---|---|---|
| 1 | 185/125 with severe headache, no network: guidance within the ceiling, page when online, server red | `SC-01` (jest, pass). On device: with the API gateway stopped, 190/120 plus a severe headache showed "This may be a medical emergency / Go to the nearest hospital now" within the 3 second ceiling, twice (screenshot in `docs/stage-1-evidence/`). Server red: a direct API post of 190/120 raised one `emergency_events` row. **Not verified:** the app's own queued offline reading reaching the server after the network returned (see section 5, item 5). | Partial |
| 2 | 205/100 no symptoms: red | `SC-02` | Pass |
| 3 | 182/112 repeat prompt, 181/111 amber task due in 4 h | `SC-03a` to `SC-03h` | Pass |
| 4 | 85/60 with fainting: red low-pressure path | `SC-04` | Pass |
| 5 | 300/40 rejected with TRI-006 | `SC-05` | Pass |
| 6 | Seven readings average target plus 25: amber, 24 h | `SC-06` | Pass |
| 7 | Care-pack patient silent N days: one silence task | `SC-07` passes against the fixture (6 days) | **Pass against the fixture only; the number is unresolved, section 6** |
| 8 | Unacknowledged red page: backup at 5 min, lead and ops at 10 min | `s19_red_event_paging.sql`, `s19_page_ack_sweep_race.sh` | Pass |
| 9 | Red event outside rota: level 2 at once | `s19_red_event_paging.sql`, `s19b_on_call_readiness.sql` | Pass |
| 10 | Titration cannot change medications until signed | `s24_prescriptions_and_care_plan_changes.sql` | Pass |
| 11 | Raised creatinine held, not visible before release | `s27_lab_results_release.sql` | Pass |
| 12 | Positive HBsAg: disclosure required, no audio, no AI, task created | `s27_lab_results_release.sql` | Pass |
| 13 | All-normal result auto-released with RES-001 | `s27_lab_results_release.sql` | Pass |
| 14 | Scribe consent declined: scribe cannot start | `scribe_consent_and_transcript_rls.sql`, `s21g_scribe_consent_and_chart_access.sql` | Pass |
| 15 | AI draft never visible before signing | `s23c_attach_scribe_draft_to_note.sql` | Pass |
| 16 | Expired licence: removed overnight, lead patients reassigned | `s15_clinician_credentialing.sql`, `s20_quality_and_safety.sql` | Pass |
| 17 | Conflicted clinician never gets that patient's tasks | `s17_queue_next.sql` | Pass |
| 18 | Two clinicians never get the same task | `s17_queue_concurrent_claim.sh` (two real concurrent connections) | Pass |
| 19 | Abandoned task returns after timeout, reliability updated | `s17_queue_next.sql`, `s20_quality_and_safety.sql` | Pass |
| 20 | Amber notification text has no condition or reading | `s13_notifications_framework.sql`, the INV-07 lint | Pass |
| 21 | Supporter without `weekly_bp_trend` cannot see readings via any API | `s29_care_circle.sql` | Pass |
| 22 | Test accounts absent from metrics and payouts | `s38_independent_review.sql` | Pass |
| 23 | Proxy sees nothing until the parent confirms | `s04_proxy_setup.sql` | Pass |
| 24 | Replayed payment webhook creates one entitlement | `s25_catalogue_orders_payments.sql`, `s26_entitlements_lifecycle_and_refunds.sql` | Pass |
| 25 | Care pack does not auto-renew, reminder 7 days before | `s26_entitlements_lifecycle_and_refunds.sql` | Pass |

Cases 2 to 25 pass on the automated proofs. The CMO's review of the safety-case fixture file (`packages/clinical/fixtures/safety-cases.json`, 54 cases) is still not recorded anywhere.

## 4. Milestones M0 to M10

| Milestone | Status |
|---|---|
| M0 Foundations | CI green; no staging deployment of either app (OQ-36). **Not met.** |
| M1 Identity and consent | Proofs pass. Met on automated evidence. |
| M2 Records and offline | Proofs pass; offline guidance proved on a simulator; sync half and performance on a device not verified. **Not met.** |
| M3 Triage and events | Safety cases 1 to 7 and 20: see section 3. Case 1 partial, case 7 number unresolved. **Not met.** |
| M4 Clinician network | Cases 8, 9, 16 to 19 pass including the concurrency proofs. Met on automated evidence. |
| M5 Consultations and scribe | Cases 10, 14, 15 pass. End-to-end consultation (Zoom SDK) not run on a device. **Not met.** |
| M6 Payments | Cases 24, 25 pass; Paystack test-mode init and verify pass. A hosted-checkout payment and live webhook were not run. **Not met.** |
| M7 Partners | Cases 11 to 13 pass. The S28 pharmacy partner (#990) was merged then reverted (#1001); confirm its current state. **Not met until that is confirmed.** |
| M8 Care Circle | Case 21 passes. Met on automated evidence. |
| M9 Earnings and payouts | Ledger and payout proofs pass. A real payout test with attestation (S31) was not run. **Not met.** |
| M10 Audio, content, polish | Case 22 passes. App size has no target (OQ-227); the understandability build was not run. **Not met.** |

## 5. Findings from this run and what was done

1. **Mobile push registration was broken since 2026-08-09 (fixed here, not yet applied to the live database).** The Expo app registers a push token with an upsert on `expo_push_token`. The unique index on that column was partial (`WHERE expo_push_token IS NOT NULL`), which Postgres cannot use as an arbiter, so every registration failed with `42P10` (HTTP 400). The app treats registration as best effort and swallowed the error. The live project holds 0 `ios` or `android` rows (2 `web`). Fix: `20261028192001_push_subscriptions_expo_token_unique_non_partial.sql` replaces the index with a plain unique index (NULLs stay distinct, so web rows are unaffected); proof `push_subscriptions_expo_token_upsert.sql` includes a sabotage step. **The code review of this fix found a second problem it would switch on:** nothing disabled a token on sign-out, and a second account's upsert onto the same phone's token was refused by the owner-only update policy (and swallowed), so a signed-out account kept receiving pushes and the next account got none. Follow-up fix `20261028211451_native_push_token_register_and_unregister.sql`: `register_native_push_token` moves the row to whoever is signed in (the token belongs to the phone), `unregister_native_push_token` lets the leaving account switch its own row off, and both are closed to `anon`. The app registers through the RPC and every deliberate sign-out goes through `signOutOfThisPhone()` (unregister first, bounded to 2.5 s so it never blocks sign-out). Proof `push_token_register_takeover.sql` runs as simulated signed-in sessions with a control and a sabotage step. Device check: sign-in registers the row, and signing out from Settings disables that account's row. **Neither migration has been applied to production; CI does not push migrations, so apply both (in order) before merging.**
2. **A signed-in patient was sent back through the splash on every token refresh (fixed).** `App.tsx` keyed the identity load and the patient background work on the Session object. supabase-js hands out a new object on every token refresh (hourly, and on any 401 retry in `lib/api.ts`), so each refresh reset identity, remounted the home shell and re-ran push and HealthKit registration. With a persistent 401 it became a loop of about 17 remounts a second on the simulator, which saturated the JS thread and ended in a Reanimated or SVG crash (SIGSEGV, `TarragonHealth-2026-10-28-195925.ips`). Fix: both effects are keyed on the user id, plus `keepSessionIfSame` (`apps/mobile/src/lib/auth/keep-session.ts`). Because identity is then read once per person, a quiet background re-read (`lib/identity-refresh.ts`) runs after `SIGNED_IN`, `USER_UPDATED` and `TOKEN_REFRESHED` (at most once a minute, no reset to the splash, a failed read keeps what is held), so a role or organisation changed on the server still reaches an open app. Regression tests: `keep-session.test.ts` and `app-session-keying.test.ts` (the second fails if the old keying returns; checked by sabotage). Verified on the device: with the 401 trigger still active, a launch now does about 1 refresh and about 67 requests in 20 seconds instead of hundreds per second.
3. **Maestro flows were stale against the current UI (fixed).** `login-to-overview.yaml` waited for "Email" instead of "Use email", tapped the "Sign in" heading instead of the button, and did not decline the iOS password prompt or the in-app biometric offer. Both iOS flows now start with `clearKeychain` (the session lives in the Keychain, which `clearState` does not touch). `login-to-overview` keeps its original assertion that the overview subtitle "Today at a glance..." is visible, so it proves the overview loaded and not only that the tab bar rendered; it passes on the device.
4. **The app's API base falls back to the production platform URL when `EXPO_PUBLIC_API_BASE_URL` is unset.** For a while this run's Release build sent a local test token to the production host and got 401s. No real data was involved. Local builds must set that variable.
5. **Not verified: the offline reading syncing after the network returns.** The guidance appears with the network cut, but the app's own saved reading was not seen on the server in any attempt: the numeric-keypad form entry under Maestro was unreliable (values landed in the wrong field, the keypad covered the Save button), and an online save from the app also did not appear. Whether that is a Maestro entry problem or an app defect is unknown. This needs a manual run on a device, or a reliable flow, before safety case 1 can be called passed.
6. The web E2E run on `next dev` produces a persistent 404 on some staff routes; the suite is meant to run on a production build (`E2E_PRODUCTION_BUILD=1`, as CI does), and it passes there.

## 6. PROPOSED values

The code registry (`packages/shared/src/proposed-config/registry.ts`) holds **293 keys, not the 55 the old draft counted**: 6 are confirmed and 287 were `proposed` before this run (187 CMO, 88 founder, 12 founder and counsel).

All 287 were walked in chat on 2026-10-28 in 72 batches; the owner confirmed every batch. The record is `docs/STAGE-1-PROPOSED-VALUES-LEDGER.md`. What that is and is not:

- It records the owner's chat decision. No registry entry was republished as a new `confirmed` version, and the governed configs signed through the sign-off hub are signed there.
- Long values were shortened in the pop-ups; the full text is in the registry.
- Several confirmed values are embedded drafts with `clinical_sign_off: null` (`symptom.checkback`, `symptom.describe_synonyms`, `symptom.result_explainer`, `symptom.safety_net`, `symptom.urgency_map`, `emergency.pack`, `immunisation.schedule`, `pathways.hypertension_step_table`) or placeholders pending counsel (`records_request.letter`, `records_request.response_days`). A chat confirmation does not replace those signatures.
- `privacy.transcript_retention` and `privacy.retention.retentionPeriodYears` are `null`: counsel has not set a retention period.
- CMO-owned rows were confirmed by the project owner; the CMO should countersign.
- **Case 7 and `triage.silence_rule_days` disagree three ways:** the spec table says 5, the safety-case fixture says 6, the latest registry value is 7. The owner ruled "6" when asked about case 7 and then confirmed the registry value 7 in the walkthrough. One number has to be chosen, then the fixture, the registry and the spec text aligned.

## 7. What a simulator and a Mac cannot run

1. Maestro on a real iPhone and on Android (eight flows are Android-only and no emulator is installed).
2. The offline-sync half of case 1 on a device (section 5, item 5).
3. Device measurements on a real or low-end phone: cold start, installed size from the store, memory, logging speed, 200 percent text, TalkBack and VoiceOver reading order.
4. HealthKit, Health Connect, Bluetooth devices and the Zoom Meeting SDK on real hardware.
5. A Paystack hosted-checkout payment with the live webhook, and the S31 real payout with attestation (needs real money and the guard on).
6. A staging deployment of both apps and the console DNS (OQ-36).
7. Whether the S28 pharmacy partner (#990, reverted by #1001) is back on main-dev.

## 8. What to do next

1. Apply `20261028192001_push_subscriptions_expo_token_unique_non_partial.sql` to production, then merge this branch.
2. Choose one number for case 7 and align the fixture, the registry and the spec.
3. Run safety case 1 end to end on a real phone and record the result in section 3.
4. Decide, item by item, the pending journey steps and the unsigned drafts listed in section 6.
5. Run the rows in section 7 that need hardware, money or a staging environment.
6. Only when every row in sections 3 and 4 is a pass and the section 6 items are signed does S40 write "Stage 1 complete".
