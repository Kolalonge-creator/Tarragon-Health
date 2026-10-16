# AVS design: after-visit summary with a "what happens next" checklist

Branch `feat/after-visit-summary`. Invariants in play: INV-01 (no model in any safety path), INV-02 (signature stamped by the acting clinician), INV-07 (events and notifications carry ids only), INV-10 (staff reads audited), INV-11 (drafts never reach the patient), INV-13 (`is_test`), INV-14 (no new go-live guard needed, see 7). No AI call site is added; AI-017 (scribe) stays off and is not touched.

## 1. What is reused, what is new

Reused as is
- `clinical_encounter_notes` (S22): the signed note is the source of truth. Its `status = finalized`, `note_error_flags` (withdrawn), `amends_note_id` (amendments), `is_protected` and `note_releases` (the protected-release rule) decide whether a summary may be seen. `private.note_patient_visible` is reused for protected notes.
- Signed `prescriptions` (`encounter_note_id` is the explicit link), `lab_orders.ordered_by`, `specialist_referrals.referred_by`, signed `care_plan_changes` (all four carry a clinician attribution).
- `care_tasks` (patient owner role, `complete_care_task` lifecycle) for the checklist-to-task step. No second task system. S16 `clinical_tasks` are for clinicians and are not used.
- S10 event bus (`private.emit_domain_event`, `event_types`), notification registry (`notification_templates`, in-app only), `private.audit_chart_read` (INV-10), `private.may_work_on_note`, `private.is_clinical_tier`, `private.can_read_clinical(uuid, caregiver_permission)` with an explicit cast.
- Emergency wording: the existing signed key `history.unwell` ("If you feel unwell now, do not wait for a review. Open Emergency in the menu, or go to the nearest hospital.") and the EMG-001 config in `packages/i18n/src/clinical-wording.json`. The urgent-care block is a lookup of that key, never text stored per summary and never invented here.
- The older `consultation_patient_summaries` (publish-once, no draft, no checklist, no signature check, staff read by policy) is left in place and untouched. The new Care tab card prefers an approved visit summary. See OQ-AVS-1.

New
- `visit_summaries` (one per note), `visit_summary_items` (the checklist; frozen once approved), `visit_summary_item_progress` (the patient's tick-off, the only thing a patient writes).
- Functions: `assemble_visit_summary`, `update_visit_summary_draft`, `approve_visit_summary`, `withdraw_visit_summary`, `read_visit_summary_for_review` (audited), `my_visit_summaries`, `set_visit_summary_item_done`, `add_visit_summary_item_to_tasks`.
- Events `visit_summary.approved`, `visit_summary.withdrawn`, `visit_summary.viewed`; template `visit_summary_ready` (in-app and push, no content).
- Screens: clinician panel on the note page; patient card on the Care tab (web) and in the Notes section (mobile).

## 2. Assembly is deterministic

`assemble_visit_summary(note)` (clinician who may work on the note, note already signed) builds a DRAFT with no model:
- `summary_text` starts as the note's own assessment, plan and follow-up text, copied in with a "rewrite in plain words" prompt shown in the panel. The clinician owns the wording; nothing is auto-published.
- Checklist items come from structured rows of the same encounter: signed prescriptions linked by `encounter_note_id` (one "take as prescribed" item per drug item); lab orders ordered by the note's author for that patient, created in the window `encounter_date - 2h .. finalized_at + 2h`; specialist referrals referred by the author in the same window; signed `care_plan_changes` signed by the author in the same window; a follow-up item when the note has follow-up instructions. The window rule is the only fuzzy link (lab orders and referrals have no `encounter_note_id`), recorded in OQ-AVS-2. The clinician can delete or add items before approval.
- Item labels are not stored as prose: an item stores `kind` plus `params` (drug name, dose, date) and the apps render the label from `packages/i18n` (`avs.item.<kind>`). A clinician may override one item with `custom_text`.
- `draft_source` holds ids only (what was read), so a reviewer can see what the draft was built from.

## 3. States and the signature

`draft -> approved -> withdrawn`. Approval is a signature stamped by a trigger from `auth.uid()` and the clinical-staff row (`approved_by`, `approved_by_staff`, `approved_at`; the client can pass neither). CHECKs: an `approved` or `withdrawn` row has `approved_by` and `approved_at`; a `draft` row has neither (INV-02 style). Only a clinical-tier doctor (not a care coordinator) who may work on the note can approve. Approval also refuses text that fails the copy lint (em dash, en dash, WARNING, "your doctor", cure, "instant doctor", "free healthcare") and an empty summary. An approved summary is frozen: text and items cannot change; a correction is a new revision (see 4), never an edit.

## 4. Visibility (INV-11), one function used by RLS and by the RPC

`private.visit_summary_state_ok(id)` is true only when ALL of: summary `state = approved`; the note is `finalized`; the note has no `note_error_flags` row (withdrawn); the note has no amendment still in draft AND the count of signed amendments equals `amendment_count_at_approval` (an amendment hides the summary while it is a draft, and after it is signed until the clinician re-assembles and re-approves the summary); and, when the note `is_protected`, `private.note_patient_visible` says the CMO has released it. Draft and withdrawn rows are never visible. Caregivers see a summary only through `private.can_read_clinical(patient, 'view_care_plan'::public.caregiver_permission)` and never when the note is protected (the reproductive-health rule: no summary of a protected note reaches a proxy). RLS: patient policy and caregiver policy both call the state function; there is NO staff policy, staff read only through the audited function.

Re-approving after an amendment: `assemble_visit_summary` on a note whose summary is approved but stale (amendment count moved) opens a new draft revision by resetting the same row to `draft` (clearing the signature, bumping `revision`); the previous approval is kept in `visit_summary_revisions` (id, summary, revision, approved_by, approved_at, text hash). Reset is the one allowed transition out of `approved`, performed only by the function.

## 5. The checklist and tasks

Patient ticks an item through `set_visit_summary_item_done(item, done)` (writes `visit_summary_item_progress`, own summary only, visible summary only). "Add to my tasks" (`add_visit_summary_item_to_tasks`) creates one `care_tasks` row (`owner_role patient`, `source 'visit_summary'`, due from the item) and links it; ticking an item completes its task and completing the task in the Care tab is mirrored on next read. Nothing here sends a notification; the checklist works with push and email off (CLAUDE.md rule).

## 6. Safety rules

1. No language model anywhere in assembly, review or display.
2. Draft text and draft items are never readable by a patient or caregiver (no policy, function filters).
3. Urgent-care block: resolved at render time from the existing wording key, always shown on every summary. Not stored.
4. Copy: "your care team", no fear language, no em dashes, English only.
5. Events and notifications carry ids only (`summary_id`, `note_id`); the template text names no condition, reading or medicine (INV-07).
6. Every new function: `revoke ... from public` and a `has_function_privilege('anon', ..., 'EXECUTE') = false` assertion; every new table: RLS on, explicit `grant select ... to authenticated`, no write grant.
7. Staff reads: `read_visit_summary_for_review` calls `private.audit_chart_read` (INV-10); the table has no staff select policy.

## 7. Not done on purpose
No new go-live guard: the card appears only when a clinician has approved one, which needs the existing signed-note path. No PDF export, no push of the full text, no translation, no per-item reminders, no AI wording help. A fuller list is in OQ-AVS-3.

## 8. Proof
`packages/db/tests/avs_visit_summaries.sql` (registered in `ci.manifest`, BEGIN/ROLLBACK, raises on failure): signature CHECKs; coordinator cannot approve; patient sees approved only (draft, withdrawn, unsigned-note, amended-pending, entered-in-error, protected-unreleased all hidden); caregiver with and without the permission; stranger sees nothing; approved is frozen; checklist and tasks; events ids only; anon has no execute. Sabotage steps remove the amendment-count guard and the protected guard and require the check to flip. Jest: shared lint and parsers (web and mobile), i18n catalogue rules, urgent key equals the signed wording.
