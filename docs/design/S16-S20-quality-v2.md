# S16 to S20 Stage 4: quality and safety v2

Plan: `docs/plans/S16-S20-review-and-build-plan.md` (defects Q1 to Q7, CMO decisions 5 to 8, recorded 2026-10-07). Migrations: `*_s20v2_audit_review_sampling_and_config_guard.sql`, `*_s20v2_speak_up_independent_reader_anonymous_checkins.sql`, `*_s20v2_licence_notices_rota_exclusion_and_evidence.sql`. Proof: `packages/db/tests/s20_quality_v2.sql` (262 checks, six sabotages). Nothing here signs or activates a configuration: `quality_config` v2 and `credentialing_config` v3 are inserted inactive.

## 1. What changed, by defect
- **Q1 / decision 5 (audit reads the case).** `audit_case_file` now returns the outcome note, the triage trigger and reading, the care messages in the work window and a matched scribe note, through an audited read (`audit_log` with `subject_patient_id`, plus `clinical_audit_case_opens`). The patient is a reference (`P-XXXXXX`) and an age; no id, name or phone. `submit_clinical_audit` refuses until the same reviewer opened the case. A critical miss (any failed safety item, including invented scribe content) needs a second reviewer who is not the first and not the clinician; the second reads the case without the first reading and the more severe outcome stands. The reliability event and the first-20 count wait for the final outcome. The audited clinician sees an audit only once it is final and can reply (append-only, lead sees it). Follow-up is append-only history; `close_audit_followup` can close once and never overwrites. Form v2 adds phase comments and an avoidability rating (config).
- **Q3 / decision 6 (sampling).** The draw is SHA-256 over a secret per-month seed in `quality_sampling_seeds` (no policy, no grant). The floor uses the same seed, with a catch-up later in the month and a current-month top-up (both config). Scribe-assisted notes are sampled at the configured rate (20 in v2) and scored on their own for omission and invented content.
- **Q4.** `quality_config` has a guard (a version used by an audit or signed cannot be edited or deleted), approval columns, the superseded-activation guard, and `sign_quality_config(version)` (CMO only, not called by anything here).
- **Q7.** UI for request, reassign, follow-up note/close, tier-1 progress and extend on `/clinician/quality`; second review on the audit page; `/clinician/my-quality` for the clinician. The hand-back review check is one function the trigger and the daily sweep both call; `queue.claims` exempt reasons are not counted.
- **Q2 / decision 7 (speak-up).** No admin readers (RPC, trigger, role-change trigger, reader checks). External independent reader (`kind = 'independent'`). Concerns by or about the lead (`routing = 'independent_only'`) are readable only by independent readers. Anonymous intake (no raiser id; code hash only). Check-ins at 30 and 90 days (config, inert until signed). Aggregate-only board report. Reader screen `/reader/concerns`.
- **Q6 / decision 8 (licences).** Notices 90/30/7/0 and the 15 December proof deadline (config v3), availability refused after expiry, nightly trim of future shifts after expiry, rota-only clinicians and lead holders inside the nightly net, missing licence date ineligible (config v3), grace CMO only and capped by a trigger, evidence rows for every verification.

## 2. Limits that matter
- The scribe link is a time-window match (same author, same patient, scribe-consented note created from one hour before the claim to a day after completion), not a foreign key. A foreign key would need S23 to store the task.
- Anonymity is anonymity from readers and from the database rows. The request still passes the platform's infrastructure logs and the notices go out at the moment of raising, so a determined insider with log access could correlate by time. The 24-hour per-organisation cap exists to stop flooding, not to hide.
- A second reviewer must be a different active chief medical officer. With one CMO a critical miss waits unassigned, the lead is told, and the sweep assigns one as soon as a second exists (OQ-138 stands).
- An independent reader is named by the lead (there is no superadmin role). The lead cannot remove the last independent reader while an independent-only concern is open, but the lead still chooses who that reader is. See open question 2.
- The CMO signing hub has no line for `quality_config` or `credentialing_config` yet. `sign_quality_config` exists; the hub line and panel are a follow-up (CLAUDE.md: anything the CMO signs belongs on the hub). Activating `credentialing_config` v3 is refused while any active clinician has no licence date.
- Not run: the full `run-db-proofs.sh` (about 300 scripts, hours) was started and stopped; the 24 scripts that touch these tables (s15 to s20, s19b, s20 v2, s21*, s22*, s30, s36e, s36i, s37, two_tier*) were run and pass. Real devices, email delivery and the edge function catalogue were not exercised (keys added to both catalogues).

## 3. Registry
`quality.audit` v2 and `credentialing.rules` v3 added (status proposed, owner CMO and Founder and counsel). Mirror tests compare each with its migration seed.

## 4. Open questions (not written to OPEN-QUESTIONS.md; another stream owns that file)
1. Second review outcome: the more severe reading stands when the two differ. Should the second reviewer's reading replace the first instead?
2. Who appoints the independent reader, given the lead names them? Options: the founder profile added through SQL once, or a CMO-plus-founder confirmation.
3. Scribe invented content as a critical miss: confirm, or score it as a quality deduction only.
4. Is a time-window scribe match acceptable, or should S23 store the task id on the note?
5. Check-ins: sent 30 and 90 days after raising, whether or not the concern is closed. Confirm that they continue after closure.
6. Missing licence date: v3 turns it on for everyone. The two legacy rows need dates first (the switch is refused until then).
7. Proof deadline: the 15 December notice is sent once per clinician per cycle to the clinician and reviewers; should it also suspend at 31 December without grace (it already does through the expiry sweep)?
8. Independent reader login: an outside person needs an account (role `patient` works, no clinician record). Confirm the invitation route.
