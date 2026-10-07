# Stage 1 sign-off (DRAFT, gate NOT passed)

Written 2026-10-07 as S40 preparation. S40 says: run the whole matrix, record every acceptance test as pass or fail, list every unsigned PROPOSED value and open question, and only if all pass write "Stage 1 complete" at the top of `docs/BUILD-PROGRESS.md`. **That line has not been written and must not be, yet.** Nothing in this file is a test result unless it says so. "Not run" means exactly that: no Docker, Maestro, Playwright or device was available in this session, so the matrix was not executed. The CI results quoted below are what GitHub reported on the pull requests.

## 1. Why the gate cannot pass today

Stage 1 (S01 to S39) is not all on main-dev. As of this draft:

| Item | State | What blocks it |
|---|---|---|
| S28 pharmacy partner (PR 990) | open, conflicting, no CI run | Rebase onto main-dev, then CI. |
| S32b device audio layer (PR 980) | open, conflicting, CI green before conflict | Rebase. First caller of the S34 media policy. |
| EMG/TRI wording (PR 989) | draft, conflicting | Must not merge before the CMO signs the wording. |
| S33 BP course and breathing (PR 982) | open, CI green | None known; merge. |
| S34 low data, accessibility, size report (PR 994) | open, built 2026-10-07 | CI result pending. Supersedes docs-only PR 966 (close 966). |
| S35b scribe draft review (PR 967) | open | Retargeted to main-dev and main-dev merged in 2026-10-07 (English-only conflict resolved: Pidgin strings dropped, English kept). CI re-running. |
| S35c scribe safety (PR 975) | open, stacked on 967 | The `s23b` proof expected 7 required AI-017 eval cases and found 13: S35c deliberately adds a six-case facts-to-confirm suite, so the proof was stale. Updated to 13 on the branch. Still stacked on 967: merge 967 first, then merge main-dev into 975 (it conflicts on i18n, `consent-dialog.tsx`, the manifest and docs). |
| S36 console operations (PR 987) | merged 2026-10-06 | Done. |
| S37b guard safety cases (PR 971) | open | Panel test failure was a stale base. main-dev merged in 2026-10-07 (one docs conflict kept both entries); web suite 4,142 pass locally; CI re-running. |
| S38 outcome snapshots (PR 968) | open | Was red on the sign-off hub panel test (stale base). Fixed 2026-10-07 by merging main-dev; full web suite 4,149 pass locally; CI re-running. Also two open-question numbers renumbered (OQ-270, OQ-271) because S36g already used OQ-235 and OQ-236. |
| S38c to S38e monthly report, risk, sponsor report (PR 988) | draft, stacked on 968 | The check 1c proof failure (`s38_independent_review.sql`, expected `controlled/2`, got `controlled/1`) belonged to this PR, not 968, and is already fixed on its newest commit (migration replay green). Merges after 968. |
| S39 security hardening (PR 986) | open; retargeted to main-dev but still contains S38, so merge 968 first | Fixed 2026-10-07: S38 and main-dev merged in; gitleaks flagged `ACK_KEY = "breathing.safety_ack.v1"` from S33's breathing screen, an on-device storage key name and not a secret, so the exact string is allowlisted in `.gitleaks.toml`; the replay failure was a GitHub rate limit. CI re-running. |
| S21h Zoom host key (PR 973) | open, CI green | Merge. |

Also open, outside Stage 1 proper: PR 979 (competitor review, visit report, weekly summary). PR 994 carries its mobile low-data diff unchanged, so the two will not conflict.

### Recommended merge order
1. Close PR 966 (docs-only prep, content is inside 994).
2. Independent and green: 982 (S33), 973 (S21h).
3. Fixed and re-running CI, merge when green: 971 (S37b), then 968 (S38), then 986 (S39), then 988 (S38c to S38e).
4. 967, then merge main-dev into 975 and merge it. #982 (S33) now conflicts with main-dev and needs a rebase before it merges.
5. 980 (S32b) and 990 (S28): rebase, re-run CI, merge. 994 (S34) any time after CI is green. 979 whenever the founder wants it.
6. 989 (EMG/TRI wording): only after the CMO signs.
7. Then run section 3 below.

Each merge should wait for the three required checks (`Supabase migration replay`, `Python ML service`, `TypeScript (web + shared)`). Migrations in these PRs are applied to production before merge (CI does not push migrations); the S38, S39 and S28 migrations need the usual live check first. This draft did not merge anything.

### Update, later on 2026-10-07
- **Merged:** #971 (S37b), #968 (S38), #999 (S27g lab panel, units, NICE blood pressure; migration applied live and signed), #967 (S35b), #975 (S35c; its two migrations applied live first), #988 (S38c to S38f), #994 (S34), #980 (S32b), #973 (S21h), #989 and #990 (by another session; #990 was later reverted by #1001).
- **Open:** #1012 (S11c to S11h restored onto main-dev plus bp_care_triage v3; see below), #986 (S39: waiting on a decision about the secret scanner: history holds many storage-key and config-key names that the generic key rule flags, and loosening that rule is the founder's call), #982 (S33, re-merged with main-dev, CI running), #995 (this document).
- **Found while merging, fixed in #1012 and applied live (S11h):** the live `private.handle_symptom_red_flag` had lost the clinician paging loop and the paediatric red flags, because S11e and S11g were written from an older copy of the function. Restored from the 2026-09-05 body plus testicular pain, the S11e answers and the S11g emergency record; the old proof now passes on a database that has S11e and S11g.
- **Found:** the live triage rule set was rolled back on 2026-10-06 23:24 UTC (v1 approved over the approved v2). The deployed `process-events` still has the pre-S11c engine, so v3 must not be approved before that function is redeployed from the merged code.

## 2. The matrix (spec section 15)

| Level | Tooling | Status in this draft |
|---|---|---|
| Unit | Jest in this repo (spec says Vitest) | Last known: mobile 1,398 pass on the S34 branch; web and packages not re-run here. Coverage target: `packages/clinical` and `packages/queue` at 100 percent branch, not re-measured. |
| Database | SQL proofs in `packages/db/tests`, run by CI replay | Run by CI per PR; red on 968, 975 and 967 as listed above; not run locally (no Docker). |
| Integration | Local Supabase, webhooks, payouts, 50 parallel claims | Proof scripts exist (`s17_queue_concurrent_claim.sh`, `s18_lead_capacity_race.sh`, `s19_page_ack_sweep_race.sh`); not run here. |
| Mobile end to end | Maestro | **Cannot run here.** Needs a device or simulator and the flows in spec 15. |
| Console end to end | Playwright | **Cannot run here.** Needs a local Supabase. The 5 authenticated sign-in specs from S01d have never run. |
| Clinical safety cases | Fixture reviewed by the CMO | 54 fixture cases in `packages/clinical/fixtures/safety-cases.json` for the BP rules; covered by `safety-cases.test.ts`. CMO review of the fixture file: not recorded. |
| Performance | Device lab | **Not measured.** OQ-227: no pass or fail targets for size or start time; they are reported, not gated. |

## 3. The 25 clinical safety cases

Result column is blank on purpose until the matrix is run. "Proof" is where a test for it lives on main-dev; I located these by name and did not run them.

| # | Case | Milestone | Proof located | Result |
|---|---|---|---|---|
| 1 | 185/125 with severe headache offline: guidance within 1 s, page when online, server red | M3 | `SC-01` in safety-cases.json; on-device timing needs a device | not run |
| 2 | 205/100 no symptoms: red | M3 | `SC-02` | not run |
| 3 | 182/112 repeat prompt, 181/111 amber task due in 4 h | M3 | `SC-03a` to `SC-03h` | not run |
| 4 | 85/60 with fainting: red low-pressure path | M3 | `SC-04` | not run |
| 5 | 300/40 rejected with TRI-006 | M3 | `SC-05` | not run |
| 6 | Seven readings average target plus 25: amber, 24 h | M3 | `SC-06` | not run |
| 7 | Care-pack patient silent 5 days: one silence task | M3 | `SC-07` (note the fixture uses 6 days; `triage.silence_rule_days` is PROPOSED, see section 5) | not run |
| 8 | Unacknowledged red page: backup at 5 min, lead and ops at 10 min | M4 | `s19_red_event_paging.sql`, `s19_page_ack_sweep_race.sh` | not run |
| 9 | Red event outside rota: level 2 at once | M4 | `s19_red_event_paging.sql`, `s19b_on_call_readiness.sql` | not run |
| 10 | Titration cannot change medications until signed | M5 | `s24_prescriptions_and_care_plan_changes.sql`, `titration.test.ts` | not run |
| 11 | Raised creatinine held, not visible before release | M7 | `s27_lab_results_release.sql`, `lab-release.test.ts` | not run |
| 12 | Positive HBsAg: disclosure required, no audio, no AI, task created | M7 | `s27_lab_results_release.sql` | not run |
| 13 | All-normal result auto-released with RES-001 | M7 | `s27_lab_results_release.sql` | not run |
| 14 | Scribe consent declined: scribe cannot start | M5 | `scribe_consent_and_transcript_rls.sql`, `s21g_scribe_consent_and_chart_access.sql` | not run |
| 15 | AI draft never visible before signing | M5 | `s23c_attach_scribe_draft_to_note.sql` | not run |
| 16 | Expired licence: removed overnight, lead patients reassigned | M4 | `s15_clinician_credentialing.sql`, `s20_quality_and_safety.sql` | not run |
| 17 | Conflicted clinician never gets that patient's tasks | M4 | `s17_queue_next.sql` | not run |
| 18 | Two clinicians never get the same task | M4 | `s17_queue_concurrent_claim.sh` | not run |
| 19 | Abandoned task returns after timeout, reliability updated | M4 | `s17_queue_next.sql`, `s20_quality_and_safety.sql` | not run |
| 20 | Amber notification text has no condition or reading | M3 | `s13_notifications_framework.sql`, INV-07 lint test | not run |
| 21 | Supporter without `weekly_bp_trend` cannot see readings via any API | M8 | `s29_care_circle.sql` | not run |
| 22 | Test accounts absent from metrics and payouts | M10 | S38 proofs (PR 968, and `s38_independent_review.sql` in PR 988) | not run |
| 23 | Proxy sees nothing until the parent confirms | M1 | `s04_proxy_setup.sql` | not run |
| 24 | Replayed payment webhook creates one entitlement | M6 | `s25_catalogue_orders_payments.sql`, `s26_entitlements_lifecycle_and_refunds.sql` | not run |
| 25 | Care pack does not auto-renew, reminder 7 days before | M6 | `s26_entitlements_lifecycle_and_refunds.sql` | not run |

Mismatch to resolve with the CMO before sign-off: case 7 says 5 days, the fixture and the PROPOSED value use 6.

## 4. Milestones M0 to M10 (spec section 16)

| Milestone | Acceptance | Status |
|---|---|---|
| M0 Foundations | CI green; empty apps deploy to staging | CI exists. No staging deployment of either app (OQ-36). Not met. |
| M1 Identity and consent | Onboarding and proxy tests; RLS tests | Proofs on main-dev. Not run here. |
| M2 Records and offline | Offline logging and sync; performance targets | Proofs on main-dev. Performance not measured (OQ-227). |
| M3 Triage and events | Triage unit tests, safety cases 1 to 7 and 20 | Fixture and tests exist. Not run here. |
| M4 Clinician network | Cases 8, 9, 16 to 19; concurrency | Proofs on main-dev. Not run here. |
| M5 Consultations and scribe | Cases 10, 14, 15; end-to-end consult | Merged pieces; S35b and S35c open. Not met. |
| M6 Payments | Cases 24, 25; webhook fixtures | Merged. Not run here. Real Paystack test payment deferred (needs the founder's test key). |
| M7 Partners | Cases 11 to 13 | Lab side merged; S28 pharmacy open. Not met. |
| M8 Care Circle | Case 21 | Merged. Not run here. |
| M9 Earnings and payouts | Payout integration; ledger immutability | S30 merged; S31 deployed with the guard OFF. Real payout test and attest outstanding. |
| M10 Audio, content, polish | Case 22; understandability build; app size | S32b, S33, S34, S38, S39 open. Size has no target (OQ-227). Not met. |

## 5. Unsigned PROPOSED values

The code registry (`packages/shared/src/proposed-config/registry.ts`, latest version of each key) holds 55 keys: **53 are still `proposed` and 2 are `confirmed`.** Owners: CMO for the clinical rules, founder for operating values, "founder and counsel" for privacy and credentialing.

CMO (27): paging.escalation_minutes, triage.silence_rule_days, adherence.threshold, clinician.min_practice_years_after_house_job, clinician.training_test, clinician.tier1_audited_task_count, queue.handback_review_threshold, clinician.max_lead_patients, bp.home_protocol, bp.average_gate, bp.trend_display, bp.starting_suggestion_target, bp.symptom_checklist, medicines.dose_rules (v2), lab.release_policy, lab.panels, written_care.behaviour, care_change.behaviour, queue.rules, lead.rules, paging.rules, queue.claims, quality.audit, queue.task_types, triage.bp_rule_set, triage.wiring_rules, reliability.dashboard.
Founder (24): proxy.setup, commerce.care_pack_price_kobo, reminders.behaviour (v2), streaks.rules, events.bus_rules, earnings.rules, payouts.rules, notifications.rules (v2), video.audio_fallback (v2), consultations.policy, scribe.transcript_retention_days, scribe.claude_model, scribe.claude_max_tokens, scribe.prompt_cache_ttl_seconds, care_circle.rules (v3), entitlements.expiry_reminder_days, refunds.cooling_off_days, refunds.consultation_cancel_grace_hours, refunds.late_cancel_retention_kobo, audio.bundled_max_bytes, audio.mono_bitrate_kbps, audio.speech_chars_per_minute, audio.number_clip_seconds, directory.verification_cadence.
Founder and counsel (2): privacy.transcript_retention, credentialing.rules.

Two caveats. First, the registry status and the database sign-off are different things: the live governed configs (triage protocol, result release policy, risk questionnaire, triage rule set, escalation SLAs, alert rules and so on) are signed through the sign-off hub; some `bp.*` and `lab.*` values may already be signed there while the code registry still says `proposed`. The S37 sign-off screen is the place to reconcile the two before the gate is written. Second, still waiting on the CMO in the hub or in PRs: the EMG/TRI wording (PR 989) and AI-017 (blocked on two evaluation suites that have not run).

## 6. Open questions
`docs/OPEN-QUESTIONS.md` has 280 entries; about 43 still read "Decision: open". The count is a text match, not a verified status. Before the gate, the founder or CMO should read the ones that block Stage 1 (those that name S28, S31, S34, S36 to S39, OQ-36 staging, OQ-33 to OQ-37 console, OQ-28 test balance on GL account 2100) and decide or defer each in writing.

## 7. Checks only the founder's machine or a device can run
1. Maestro mobile flows: onboarding, set up for a parent, log BP green, amber and red offline, checkout, join a consultation, Care Circle.
2. Playwright console flows with a local Supabase: next task, hand-back, claim timeout, on-call acknowledge and escalation, scribe draft and sign, result review and release, credentialing, payout approval. Includes the 5 authenticated sign-in specs that have never run.
3. Device measurements: cold start, installed size, memory, logging speed, safety case 1 timing on device, 200 percent text, TalkBack and VoiceOver reading order.
4. Real money: a Paystack test payment (S25) and a real payout test with attestation (S31).
5. A staging deployment of both apps and the console DNS (OQ-36).
6. HealthKit, Health Connect, BLE devices and the Zoom Meeting SDK on real hardware (all unrun to date).

## 8. What to do next
Follow the merge order in section 1, re-run CI on each, then run section 7 on a machine with Docker and a phone. When every row in sections 3 and 4 is pass and every open question blocking Stage 1 is answered, S40 writes "Stage 1 complete" and the S41 onward sessions (including S46 to S50) can start.
