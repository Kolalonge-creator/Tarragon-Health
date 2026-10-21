# Design: clinician-signed personal threshold overrides (2026-10-16)

Research: `docs/research/build-threshold-overrides.md`. Builds on the triage engine (`supabase/functions/_shared/clinical`, mirrored by `packages/clinical`), the `triage.grade_observation` handler (S12), the S39b/S39g tied-staff rules, the sole-CMO style typed signing and the CMO sign-off hub.

## 1. What it is and the one rule
A doctor sets a personal threshold for one patient, signs it, and the engine uses it only inside hard safety clamps. It exists to cut alert load for patients whose usual readings sit outside the standard lines, and to make checks MORE sensitive where a patient is at special risk.

THE ONE RULE: an override never edits a signed rule set and never lowers a red. The signed rule set grades first. A separate pure layer (`threshold-override.ts`) then looks at the finished result and may change it in three bounded ways, otherwise it returns the result untouched.

| Move | Effect | Condition (all must hold) |
|---|---|---|
| RELAX | amber to green | winner is amber; EVERY matched non-green rule is BP-A2 (seven day average over target) or BP-A7 (low reading, no symptom) and each is cleared by the override's own setting; no symptom ticked; adult with a known age; not pregnant; not postpartum; override signed, in date, inside the clamps |
| TIGHTEN (amber) | green to amber | BP: a stricter personal target makes BP-A2 fire (same review task, same weekly dedupe key); glucose: reading between the default 3.9 and the personal treat-now line |
| TIGHTEN (red) | glucose amber or green to red | reading under the personal red low line (3.0 up to 3.5); uses GL-R1's own actions (emergency guidance and page on-call) |

Never: a red lowered; BP-A1 (urgent 180/110), BP-A3 (low with dizziness), BP-A4/A5 (adherence, silence), BP-P* (pregnancy, postpartum), BP-A6 (red-flag symptom), recheck or ask prompts, any glucose amber relaxed; a symptom relaxed; a corrupt or past expiry honoured; the phone changed (see 6).

## 2. Clamps (code and database, pinned equal by a Jest mirror test)
`OVERRIDE_LIMITS` in the engine and `private.threshold_override_limits()` in the migration:
- BP target systolic 100 to 160, diastolic 60 to 100, diastolic under systolic. Effective amber line is additionally capped at the urgent line: an average at or over urgent (180/110) is never relaxed whatever the target.
- BP low-reading line 80 to 90 (default 90). Relax only; it never touches BP-R3 (low with fainting, confusion or chest pain stays red).
- Glucose treat-now line 3.9 to 5.0 (default 3.9) and red line 3.0 to 3.5 (default 3.0): raise only.
Clamps are code, not configuration; widening them is a reviewed code change. Config holds only the period (`triage.threshold_override_policy`: maxDays 90, reviewDays 30, review task due 4320 minutes), PROPOSED, mirrored by a seed and a drift test.

## 3. Authority and signing
- Who: `private.has_prescribing_authority` (senior_medical_officer or chief_medical_officer, active, same organisation) AND `private.clinician_has_patient_access(patient)` (a TRUE care relationship: care team, open escalation or alert, live consultation, active task, post-consult window, assigned referral). A logged record opening (S39c) is deliberately NOT enough: a safety-affecting setting is not proposed and signed alone by a doctor who only opened the chart. Both inside `private.threshold_override_actor`. Ending an override is stop-only, so the active CMO may end any override without a tie (`threshold_override_overseer`); keeping one at the monthly review needs the tie. A coordinator-tier clinician, an untied senior doctor and the patient are refused (proof B1 to B3).
- Two steps: `propose_threshold_override` (draft, no effect, one draft per patient and domain) and `sign_threshold_override(id, 'SIGN')` (typed confirmation, same pattern as the sole-CMO exception). The agent never signs anything: no code path signs, and no migration inserts a signed row.
- Signing sets expiry (`valid_days` up to the policy maximum), the first review date (30 days or the expiry), the policy version, and supersedes any live override for the same patient and domain.
- Eligibility is checked at propose AND sign: age 18 or over with a date of birth, not pregnant, not within 42 days of a delivery. The engine checks again at grade time, because pregnancy can start later (the override then stops relaxing, never errors).
- The feature is dormant until the Chief Medical Officer signs the policy (`sign_threshold_override_policy`, typed SIGN). `withdraw_threshold_override_policy` switches every override off at once (the loader serves nothing while no policy is active). It is reversible: signing the withdrawn version again switches the feature back on, and the hub shows the line again while it is off.

## 4. Data model (migration `*_n_patient_threshold_overrides.sql`)
- `threshold_override_policies` (versioned, born unsigned and inactive).
- `patient_threshold_overrides`: params jsonb with a CHECK calling the clamp function; status draft, active, superseded, revoked, lapsed; proposed_by, signed_by, signed_at, expires_at, review_due_at, last_reviewed_at, policy_version, end fields, `is_test`. Unique partial indexes: one active and one draft per patient and domain.
- `patient_threshold_override_events` (append only history).
- `triage_override_applications` (append only, one row per triage event an override changed): override id, direction, parameters, default and final grade and rule id, shadow, `is_test`. CHECKs: a relaxed row is amber to green only; a tightened row strictly raises the grade. `triage_events` and the live `record_triage_result` / `record_glucose_triage_result` are NOT rewritten (append-only table, live safety path): provenance is a second idempotent write keyed by the triage event.
- Reads: tied staff (`staff_may_read`) only. The patient has NO direct read (the table holds numbers and the doctor's reason, INV-07); the patient's only view is `my_threshold_override_notice()`, a bare boolean. No direct writes (grants are SELECT only). Registered in `staff_read_scope` (tied) and `data_registry`.
- RPCs: propose, sign, revoke, review, `list_threshold_overrides_for_oversight` (CMO only, audited), `threshold_override_oversight_counts` (CMO, counts), `my_threshold_override_notice` (bare boolean), and two service-role functions for the handler. All new functions revoke from public; checked with `has_function_privilege`.

## 5. Flow in the engine path
`process-events` handler: grade with the signed rule set; `loadThresholdOverride` (service role RPC, status active, signed, `expires_at > now()`, policy active); `applyBpOverride` or `applyGlucoseOverride`; record the final result via the unchanged `record_*`; if an override changed the grade, `record_triage_override_application`. A failed override load is retried through the bus (two retries), because a lost override can be a silent downgrade (a personal red low line would be graded at the amber default); on the third attempt the signed default is recorded and a loud JSON error is logged. A database that does not have the functions yet (migration not applied) is "no override", quietly. The override layer itself runs inside a guard: a fault in it records the signed grade and logs, it never stops grading. The override lookup runs in parallel with the rule-set read, so it adds a database call but no wait. A failed provenance write throws, the event retries, and the grade write is idempotent. Residual: if the override expires between a first delivery's grade write and its retry, the stored grade has no provenance row (it is stored only if the stored grade equals the override's final grade, otherwise skipped without error). This window is the length of one retry and only at the instant of expiry.

## 6. Phone and parity
The phone keeps the signed default (it has no override feed), so offline guidance can only be as urgent as the server, never less. The server result decides tasks and pages. Phone and server parity fixtures are unchanged because `override` is absent unless the server applied one.

Shadow-parity impact (CMO Q1: legacy BP and glucose alerts keep running beside the triage engine until parity is shown):
- Reds never move down, so `live_only_urgent` (the dangerous divergence) cannot be created by an override.
- Relaxing moves amber to green only; the divergence reports count reds only, so BP and glucose `both_urgent` / `neither_urgent` counts are unaffected.
- A glucose red-line override turns an amber into a red between 3.0 and the personal line; the legacy glucose emergency tier starts under 3.0, so that row reads `shadow_only_urgent` BY DESIGN. To exclude overridden events from the evidence the CMO reads: `where not exists (select 1 from public.triage_override_applications a where a.triage_event_id = e.id)`. The divergence functions were not rewritten here (unreadable live at build time); the join is the documented way and `triage_override_applications` is read-only evidence.

## 7. Surfaces
- Doctor: a card on the patient chart (`ThresholdOverrideCard`, shown to prescribing-authority doctors) to propose, sign (tick, SIGN) and end, with the clamps printed on the form.
- CMO: `/clinician/threshold-overrides` (roster with who proposed and signed, expiry, review due, grades changed, keep or end with a note, withdraw the policy); a sign-off hub line plus inline panel for the policy; an attention line (not a signature) when reviews are overdue; nav and console search entries. A routine monthly review task (`threshold_override_review`, class 8, never pushed) is raised by a daily sweep at 06:12 UTC, which also lapses expired overrides.
- Patient: a bare note on the vitals page, "Your care team has set personal targets for you." No number, domain or reason. No notification is sent about an override at all (INV-07); if one is ever added it must use a neutral key.

## 8. Invariants
INV-01 no model call (pure code). INV-05 every red keeps guidance and page. INV-07 no reading or target in any patient text or in the provenance JSON. INV-12 reads and writes tied. English only, no em dashes. `is_test` on new tables. Africa/Lagos used for the postpartum window and review dates.

## 9. Not built, on purpose
Relaxing any glucose line; relaxing BP-A1, A3, A4, A5; a personal red line for blood pressure; patient-visible numbers; automatic threshold learning (INV-01, and it would be a model); a notification about a new override.
