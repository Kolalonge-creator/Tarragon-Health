# Unified clinical document and diagnostic intelligence: architecture and plan

Date: 2026-11-04. Read against `origin/main-dev` at `502f9d99a` and the live project `koiplnmbgnqnbywhpjlf`.
Source: the founder's "Unified Clinical Document, Laboratory and Diagnostic Imaging Intelligence System" specification (pasted in chat, 2026-11-04), an extension of the Tarragon 2.0 brief (`docs/plans/tarragon-2-0-founder-brief-2026-11-04.md`) and its discovery report (`docs/plans/tarragon-2-0-discovery-2026-11-04.md`).

This document changes no code, data or configuration. It answers the specification's section 13 list (items 1 to 9). Open conflicts are in `docs/OPEN-QUESTIONS.md` under "Clinical document engine (OQ-CDE)".

## 1. The short answer

The platform already has most of the parts. It has them **six times over**, once per document kind, and none of them talk to each other:

| Pipeline | Upload table | Structured result | AI reader | Review screen |
|---|---|---|---|---|
| Lab report | `lab_result_documents` | `lab_report_extractions` → S27 `lab_results` / `lab_result_items` (since T2-07) | AI-005, live | `lab-report-extraction-panel.tsx` |
| 12-lead ECG | `ecg_report_documents` | `ecg_report_extractions` → `ecg_parameter_readings` | AI-006, live | `ecg-report-extraction-panel.tsx` |
| Imaging report | `imaging_report_documents` | `imaging_reports` (+ `imaging_incidental_findings`) | AI-016, registered, **off** | imaging orders section |
| Other documents (discharge summary, letters, prescriptions) | `patient_documents` | suggestions only | AI-018, registered, **off** | patient `documents` page |
| Vaccination card | (vaccination module) | `vaccination_records` | AI-012, live | vaccination screens |
| Second opinion | `second_opinion_documents` | none | none | second opinion flow |

Live facts that shape the plan (checked 2026-11-04):

- **Every one of these tables has 0 rows**, and so do `external_records` and S27 `lab_results`. Nothing a patient has uploaded can be lost or reshaped by unifying them.
- The **Laboratory Liaison role already exists** (`user_role` value `lab_liaison`, `private.is_lab_liaison()`, `/lab-liaison` dashboard, upload source value `lab_liaison` on lab and ECG documents). There are **0 liaison accounts** live.
- 1 active laboratory (`lab_providers.is_active`).

So the specification is not a new module. It is three things on top of what exists:

1. **One front door**: a single intake record per uploaded document, with one status list, one classification step, one job queue and one duplicate check, which then hands the document to the existing specialised pipeline.
2. **One record view**: a single list of every investigation for a patient, for the patient and for the doctor, built over the existing tables.
3. **The missing pieces**: automatic classification, liaison identity confirmation and lab assignment, manual multi-value entry, the pathology/cytology/cervical and mammography extraction schemas, and the rule list that says which reported narrative findings need prompt doctor review.

Nothing existing is dropped or rewritten. The specialised tables stay the system of record for their kind; the intake record points at them.

## 2. Architecture assessment: what to reuse

| Spec component | Exists? | Reuse | Gap |
|---|---|---|---|
| Private storage, owner folders, signed URLs, file-signature check | Yes, per pipeline (lab check added in #1681) | All of it | Apply the signature check to every bucket; one shared helper |
| Malware scan | Decided (T2-08, self-hosted ClamAV), not built | Plan it once for the shared intake | Railway service |
| Patient upload (PDF, photo, multi-page) | Lab, ECG, imaging, documents each have a form | Upload actions, HEIC conversion | One "Upload medical report" entry point; multi-page as one document |
| Auto classification | **No** | — | New governed AI system (assist only) plus a deterministic first pass on the filename and printed headings |
| Processing status | Partial (`ai_summary_status` on lab) | — | One status field on the intake record |
| Lab extraction, catalogue mapping, units, QC | Yes (AI-005, `qc.ts`, LOINC/UCUM, S27 classifier) | All of it | None for this spec |
| ECG extraction | Yes (AI-006) | All of it | Spec already matches (rate, rhythm, PR, QRS, QT/QTc, axis, interpretation as printed) |
| Imaging extraction | Built, off (AI-016, eval fixtures exist) | Turn on after its evaluation passes | Mammography fields (laterality, density, BI-RADS as printed), contrast, clinical indication |
| Pathology, cytology, cervical screening, HPV | **No** extraction | Screening results path for cervical/HPV once a doctor files them | New extraction schema; findings kept verbatim |
| Narrative reports (specialist, discharge, endoscopy) | AI-018 transcriber, off | Turn on, widen the type list | Structured summary fields |
| Clinical alert for abnormal results | Lab (S27, T2-04/T2-07), screening, imaging (`imaging_reports` trigger) | All of it | Narrative significant-finding rules (CMO list); ECG has no alert today |
| Doctor review, correction, supersede-not-edit, audit | Yes per pipeline | All of it | One queue across kinds |
| Liaison dashboard | Yes, lab uploads only | Page, worklist, `liaison_recent_uploads` | All kinds; identity step; lab assignment; manual entry |
| Liaison patient search | Loads up to 200 org patients client-side; RLS lets a liaison read every org patient's full `profiles` row (`profiles_select`) | — | **Replace with a narrow search function** (see §6.2); this is wider than the spec's "limited identifiers" |
| Longitudinal trends | Yes (`patient_biomarker_trend`, `biomarker_points`) | All of it | Prior-same-kind list for imaging/ECG/pathology |
| Unified timeline | `clinical_encounters` summary table (Phase 1 of the data-architecture build) | Feed it from the new record view | Document kinds not all wired in |
| DICOM / PACS | Columns only (`imaging_reports.dicom_study_instance_uid`, `pacs_url`) | Keep | Not built, by design (§9) |

## 3. Proposed unified document architecture

```
 patient app ─┐                                                 ┌─ lab_result_documents → AI-005 → S27 lab_results (classifier, alerts)
 liaison ─────┼─► clinical_documents ─► job: classify ─► router ┼─ ecg_report_documents → AI-006 → ecg readings
 clinician ───┤   (one row per upload,  (AI + rules,    (writes ├─ imaging_report_documents → AI-016 → imaging_reports (alerts)
 partner push ┘    status, hash,         confirm if     the     ├─ pathology/cervical (new schema) → doctor files → screening_results
 manual entry ───► S27 directly           unsure)       pipeline└─ patient_documents → AI-018 → narrative summary
                   (with clinical_documents row if a file is attached)            row)
                                         │
                         clinical_record_items (one read model) ─► My Health Records / Clinical Records and Investigations / timeline
```

### 3.1 New tables (all additive)

**`clinical_document_kinds`**: the taxonomy (spec §3.2), one row per node: `code`, `parent_code`, `label`, `pipeline` (one of `lab`, `ecg`, `imaging`, `mammography`, `pathology`, `cervical`, `narrative`), `access_category` (the existing `care_access_category`; cervical, obstetric and HPV nodes are `reproductive_health`), `is_active`, versioned with an audited change note. Admins add a subtype (for example "Ultrasound → Thyroid") from the admin console without a code change. A **new pipeline** still needs code, because each pipeline has its own extraction schema and safety rules; that is deliberate.

**`clinical_documents`**: the intake record, one per uploaded document (a multi-page report is one document with several files).

| Column group | Columns |
|---|---|
| Subject | `organisation_id`, `patient_id` |
| Files | `files jsonb` (bucket, path, mime, size, page order), `content_sha256` (per file and combined) |
| Provenance | `upload_channel` (`patient_app`, `lab_liaison`, `clinician`, `partner_integration`, `manual_entry`), `uploaded_by` (server-derived, `on delete restrict`), `source_facility_id` (`lab_providers` / `imaging_providers`, nullable) and `source_facility_name` (free text), `investigation_date`, `patient_note`, `admin_note` |
| Identity check | `identity_check jsonb` (matched on which identifiers, confirmed by, at); required when the uploader is not the patient |
| Classification | `kind_code` (null until known), `kind_source` (`uploader`, `ai`, `rules`, `confirmed`), `kind_confidence`, `classified_by_system` (AI system code + model + prompt version) |
| State | `status` (`uploaded`, `processing`, `processed`, `awaiting_verification`, `doctor_review_required`, `reviewed`, `processing_failed`, `needs_type_confirmation`, `duplicate_suspected`), `status_reason` |
| Routing | `routed_table`, `routed_id` (the specialised row it became) |
| Duplicate | `duplicate_of` (another `clinical_documents.id`) |

Status is the one the patient and staff see. The specialised tables keep their own review fields; a small trigger on each specialised table moves the intake status forward (for example, `reviewed_at` set → `reviewed`).

**`clinical_document_jobs`**: the asynchronous queue (spec §11): `document_id`, `step` (`scan`, `classify`, `extract`), `attempts`, `next_run_at`, `last_error`, `dead_lettered_at`. Driven by pg_cron plus an edge function or a Next route (Stack A; no Celery). Retries with back-off; after the last attempt the job is dead-lettered, the document goes to `processing_failed`, and a `clinician_review` alert plus an ops exception are raised. **A failed or uncertain job can only ever move a document toward a human, never toward "normal".** This is proved in the DB test suite with a sabotage step.

**`lab_liaison_assignments`**: liaison ↔ laboratory (and optionally branch), with `active_from`/`active_to`, created by an admin. Used to scope the "assigned laboratory relationships" view and the upload statistics, not to restrict which patient a liaison may upload for (a lab can send a result for any Tarragon patient).

### 3.2 What each specialised table gains

One nullable column, `clinical_document_id`, on `lab_result_documents`, `ecg_report_documents`, `imaging_report_documents`, `patient_documents` and the new pathology table. The existing upload actions keep working unchanged during the move; once the shared intake is live, the old per-kind forms call it instead.

### 3.3 The read model

**`clinical_record_items`**: a `security_invoker` view (per the standing rule that a view over RLS tables must be `security_invoker`) that unions every investigation the patient has, from: intake documents not yet routed, S27 lab results, legacy `lab_analyte_readings`, ECG readings, imaging reports, pathology/cervical records, screening results and narrative documents. Columns: name, category, kind, date performed, date uploaded, upload channel, source facility, processing status, review status, an "important finding" flag, and a link to the original. The patient view and the doctor view both read it, so they can never disagree about what exists. It also feeds `clinical_encounters` so the timeline gains documents.

### 3.4 Roles (spec §10)

No new account roles. The spec's list maps onto what exists, as CLAUDE.md requires ("never re-split the account role"):

| Spec role | Existing |
|---|---|
| Super Administrator | `admin` with superadmin |
| Clinical Administrator | `clinician` with `doctor_tier = 'chief_medical_officer'` |
| Doctor | `clinician` |
| Laboratory Liaison | `lab_liaison` (exists; excluded from `is_org_staff`, correctly) |
| Patient | `patient` |
| Employer Administrator | `corporate_admin` (aggregate only, I9) |
| Care Coordinator | `care_coordinator` |

## 4. Patient dashboard: My Health Records

One hub at `/patient/records`, replacing the current scattered entry points (`result-documents`, `documents`, `ecg-report-documents`, `imaging-report-documents`, `released-lab-results`, `results-trends-card`); the old paths redirect.

- A single **Upload medical report** button opens one flow: choose a type or "I'm not sure", add pages (camera, photo library, PDF; several pages), date if known, lab/hospital/centre (search the directory or type a name), optional note, submit.
- Sections: Laboratory results, Imaging, Heart tests, Cancer screening, Other reports, each grouped by date, with search across all of them.
- Each item shows the original, the values or findings read from it, and one honest status chip:
  - "We're reading this" (processing)
  - "Read by computer, not yet checked" (processed / awaiting verification)
  - "Waiting for a doctor" (doctor review required)
  - "Checked by Dr X on <date>" (reviewed; the shared null-gated `ReviewedByDoctor` component only)
  - "Follow-up needed" (when the doctor recorded one)
  - "We couldn't read this. A person will look at it." (failed)
- Never show an AI reading in a way that suggests a doctor has looked at it. Trends stay on the existing biomarker trend cards.
- Download: the existing records-export path, with each original file.
- Notification on completion and on a liaison upload: in-app, push or email via `private.patient_reminder_channel()` (no SMS, no WhatsApp). Text: "A new report has been added to your Tarragon Health record: <type>, <date>." The notification never carries a value or a finding.
- Sensitive kinds (`reproductive_health`, HIV and the S27 disclosure-held tests) keep their existing hiding and guardian rules; the read model inherits them because it is `security_invoker` over the source tables.

## 5. Laboratory liaison dashboard

Extends `/lab-liaison`. Sections: **Find patient**, **Upload report**, **Enter results**, **Recent uploads** (own), **Processing** / **Failed** / **Awaiting verification** (own uploads, status only, never values: the S27f neutral-list rule already in `liaison_recent_uploads`), **Upload history**, **Laboratory directory**, **My laboratories** (assignments).

### 5.1 Finding the right patient (spec §2.2)

- `liaison_find_patient(p_query)`: a `security definer` function in the shape of `coordinator_find_patient`. Accepts a patient number, a phone number, an email, or a name **plus** a date of birth. A name alone returns nothing (spec: "not solely on a name match"). Returns only: patient number, full name, year of birth, sex, state, phone masked to the last 4 digits. Every call is written to `audit_log`.
- Identity confirmation: before upload, the liaison must confirm at least two identifiers printed on the report (for example name and date of birth, or name and patient number) against the record. What matched is stored in `clinical_documents.identity_check`. A mismatch on date of birth or sex blocks the upload and offers "send to the patient-matching queue" instead (the existing `review_patient_match_candidate` flow).
- After extraction, the patient name and date of birth printed on the report are compared with the record by a deterministic check; a mismatch sets `doctor_review_required` with reason "possible wrong patient" and hides the document from the patient until a clinician confirms. This is the second barrier.
- The liaison's broad read of every org patient's `profiles` row (`profiles_select`, `is_lab_liaison()` branch) is removed once the search function ships. Changing an RLS policy on `profiles` gets `/code-review ultra`.

### 5.2 Manual entry

A form for many results in one submission: laboratory, investigation date, then rows of investigation (catalogue search with synonyms), value, unit (UCUM list for that analyte), the lab's printed range, the lab's flag, specimen, comment. Optional attached original. It submits through the S27 entry point (`private.submit_lab_result`) with `source = 'manual_entry'`, `entered_by`, `original_attached`, so the same classifier, alert rules and release machine apply. Manual entry is marked as manual everywhere and is **not** clinically verified: a clinician verifies it before release. What happens to a critical value entered by hand before a clinician verifies it is a CMO decision (OQ-CDE-02); the proposal is the same as for an unverified AI reading today: an immediate urgent **verification** alert, so a critical value is never held silently.

### 5.3 What a liaison cannot do

Enforced in the database, not only in the screens: no access to clinical tables beyond what they uploaded (status only), no review, interpretation, alert closure, prescribing or history edits. They may correct administrative metadata (date, facility, type) on their own uploads until a clinician has reviewed it; every correction is audited and versioned.

### 5.4 Admin (spec §10)

In the admin console: create, activate and deactivate liaison accounts (the existing staff-invite path with role `lab_liaison`), assign laboratories, upload statistics per liaison and laboratory, processing error rate, wrong-patient corrections, manual entry activity, and a per-liaison audit trail. Each page gets a console search entry (standing rule).

## 6. Doctor dashboard: Clinical Records and Investigations

A new tab on `/clinician/patients/[patientId]` (`patient-record-tabs.tsx`), filters: All, Laboratory, Imaging, Cardiology, Cancer screening, Histopathology, Clinical reports, Pending review.

- Each row from `clinical_record_items`: name, category, performed, uploaded, channel, source facility, processing and review status, important-finding marker, original.
- Opening a row shows the original (PDF or image viewer) on one side and the extracted fields on the other, reusing the existing per-kind panels (lab, ECG, imaging) inside one shell.
- **Previous of the same kind** is always shown: earlier mammograms with dates and reported BI-RADS; earlier creatinine and eGFR via the biomarker trend; earlier ECG intervals.
- Actions, all of which exist per pipeline today and are surfaced in one place: correct a field (recorded as a correction, never an overwrite), confirm, add an interpretation and a next step, request an investigation (existing order forms), create a follow-up task, raise or escalate an alert, mark reviewed.
- A single cross-kind **review queue** in the clinician worklist (counts on the command centre: "uploads awaiting verification", per the discovery report).

## 7. AI and extraction strategy per category

Principles, all already platform rules: every model call is a registered AI system routed through `runGovernedAi()`; models **transcribe, never decide**; each pipeline has its own schema and validation; output records model, prompt version and confidence per field; an unread or low-confidence field goes to a person.

| Pipeline | Approach | Status |
|---|---|---|
| Classifier (new) | Deterministic first pass on printed headings ("BI-RADS", "HbA1c", "12-lead", "Histopathology"); then a model returns a taxonomy code and confidence. Below the threshold: ask the uploader ("Is this a scan report or a lab result?"). Never forced into a category. | New AI system, assist only; needs eval + approval |
| Laboratory | AI-005 + catalogue/unit mapping + `qc.ts` + S27 classifier on CMO-signed ranges | Live |
| ECG | AI-006: rate, rhythm, PR, QRS, QT/QTc, axis, machine and clinician interpretation **as printed**. A tracing with no printed interpretation is stored and sent to a doctor; no waveform reading. | Live |
| Ultrasound, X-ray, CT, MRI | AI-016: modality, region (taxonomy path, e.g. MRI → Spine → Lumbar), laterality, indication, contrast, findings, measurements, impression, recommendations, radiologist, centre | Built, off; turn on after its eval passes |
| Mammography | Imaging schema plus density and BI-RADS **copied as printed**, per breast. The model never assigns or changes a BI-RADS category; a missing category stays missing. | Schema extension |
| Histopathology, cytology, biopsy | Specimen, site, macroscopic, microscopic, diagnosis line verbatim, grade/stage only if printed, pathologist, lab | New schema (no coded diagnosis) |
| Cervical screening, HPV | Test type, HPV result and genotypes as printed, cytology category as printed (Bethesda term), recommendation | New schema; a doctor files it into `screening_results` |
| Specialist, discharge, endoscopy, colonoscopy | AI-018 widened: document type, date, author, diagnoses as written, medicines listed, recommendations, follow-up asked for | Built, off |

Every new or newly enabled AI system needs: an `ai_systems` row, a golden test set, an evaluation run, and a human approval. None of these may be seeded by an agent (standing rule). Sending pathology, cervical and HIV-adjacent documents to the model vendor extends the T2-03 DPO decision to more sensitive data; that needs the founder's explicit yes (OQ-CDE-04).

## 8. Clinical safety and verification workflows

1. **Every upload reaches a human unless a signed rule says otherwise.** Lab values follow S27 (normal values may be released per T2-10; everything else to a doctor). Every imaging, ECG, pathology, cervical and narrative document goes to doctor review; there is no "auto-normal" for narrative reports.
2. **Priority, not safety, is what rules decide for narrative reports.** A deterministic rule list over the fields as reported (for example: BI-RADS 0, 4, 5 or 6 as printed; a report recommending urgent assessment; a histology diagnosis line containing a malignancy term; an ECG interpretation naming a listed arrhythmia; a radiology incidental finding marked significant) raises the review to an urgent alert on `escalation_slas`. A report matching no rule is routine review, never "safe". The rule list is a patient-harm item the CMO signs (OQ-CDE-01); until signed, every narrative report is routine doctor review and a doctor can escalate by hand.
3. **Failed processing** (scan, classify or extract) moves the document to `processing_failed`, raises a `clinician_review` alert and an ops exception, and keeps the original visible to staff. Proved with a sabotage test that forces the model call to fail.
4. **Uncertain extraction** (low confidence, unread value, implausible value, wrong unit) holds the item at `awaiting_verification`; it never classifies as normal. Already true for lab rows; extended to every pipeline.
5. **Duplicates**: the same file hash for the same patient is refused with a link to the existing record; same patient, same kind, same investigation date and same facility is flagged `duplicate_suspected` for a person to decide.
6. **Wrong patient**: identifier confirmation at upload (§5.1) plus the printed-identifier check after extraction; the document is hidden from the patient until resolved.
7. **Doctor corrections** are stored next to the AI reading (existing `lab_extraction_corrections` pattern, extended per pipeline); nothing is overwritten.
8. **Audit**: every upload, view of an original by staff (existing `staff_record_opens`), status change, correction, routing and liaison search is recorded.

## 9. Diagnostic images and DICOM (spec §6)

Supported now: a written report, a photo of a report, a screenshot of an image (stored as an attachment to the report, never read for findings). Not built: DICOM storage or a PACS. `imaging_reports` already keeps a study UID, accession number and PACS link, so a future viewer integration (an external DICOMweb viewer opened by link) can attach without a schema change. Build it only when a partner centre can actually send studies.

## 10. Database and API changes (summary)

New: `clinical_document_kinds`, `clinical_documents`, `clinical_document_jobs`, `lab_liaison_assignments`, a pathology/cervical record table, the `clinical_record_items` view; column `clinical_document_id` on the five specialised tables; a `manual_entry` value in the `lab_results.source` CHECK (live today: `portal_entry`, `pdf_upload`, `api`; `portal_entry` is a lab partner typing results into its own portal and requires a panel version, so a liaison's entry for a test outside the panel needs its own value).
Functions: `submit_clinical_document` (one upload entry point for patient, liaison, clinician), `confirm_clinical_document_kind`, `liaison_find_patient`, `submit_manual_lab_results`, `correct_clinical_document_metadata`, job runner functions.
Routes: one upload route for web and mobile (`/api/clinical-documents`), with Zod validation, replacing the per-kind mobile routes over time.
Every new table: `organisation_id`, RLS, explicit grants and the anon checks per the standing lessons; every new function: `revoke ... from public`, checked live with `has_function_privilege`.
Gates (G-01): no new master and no new feature guard. The classifier and each newly enabled extractor are gated by their own `ai_systems.is_enabled`; the narrative escalation rules by the CMO signature.

## 11. Incremental plan

Each step is its own PR, ends with a DB proof (with a sabotage step) or Jest test, and is reviewed with `/code-review high` (`ultra` for the RLS change in step 2).

1. **Shared intake under the lab path.** `clinical_documents`, kinds (seeded with the spec taxonomy), jobs, status, hash duplicate check, failed-job exception; lab uploads (patient and liaison) go through it unchanged downstream. Proof: failed extraction never reaches "normal"; duplicate refused.
2. **Liaison, end to end.** `liaison_find_patient`, identity confirmation, assignments, upload for every kind, patient notification, own-upload status lists, admin pages, removal of the broad `profiles` read.
3. **Manual entry** through S27 with provenance, attachment and the agreed critical-value behaviour (after OQ-CDE-02).
4. **Classifier** (new AI system) for "I'm not sure" uploads, with the type-confirmation question; evaluation and approval before it is switched on.
5. **Pipelines**: route ECG, imaging and narrative uploads through the intake; mammography fields; pathology/cervical schema; turn on AI-016 and AI-018 after their evaluations; narrative escalation rules once signed.
6. **Doctor tab and patient hub** over `clinical_record_items`, side-by-side viewer, prior-same-kind panel, cross-kind review queue and command-centre counts.
7. **Acceptance suite**: the spec §12 list as browser E2E against a local stack (Supabase branching is unavailable on this plan), using synthetic reports only.

Steps 1 to 3 can start now. Steps 4 to 6 depend on the open questions below for their switch-on, not for their build.

## 12. Coordination

Other sessions are working on T2 today (`t2-phase4`, `t2-trend`, `t2-release` worktrees) and the lab upload path was changed by #1676, #1678, #1681 and #1683. Step 1 touches the same upload actions, so it starts from current `main-dev` after those land and does not run in parallel with another change to `lib/lab-results/actions.ts`.

## 13. Step 1 as built (2026-11-04)

Migration `20261104160432_cde1_clinical_document_intake.sql`, proof `packages/db/tests/cde1_clinical_document_intake.sql`.

- `clinical_document_kinds` (40 nodes seeded from the spec taxonomy, admin-editable, audited), `clinical_documents`, `clinical_document_jobs`.
- Intake rows are opened by triggers on `lab_result_documents` and `lab_result_files`, so every current lab upload path is covered without changing its code. Status is derived by one function (`private.cde_refresh`) from the extraction, review, release and supersession facts.
- Duplicate refusal on the server-computed SHA-256: the patient web and mobile upload paths and every S27 file path compute it; `team_submit_lab_result` carries it to the file insert. Not yet fingerprinted (so not duplicate-checked): a patient's replacement upload (`replace_my_result_document`) and a patient-added or partner S27 file, whose functions do not pass it on. These close in step 2, when the upload entry point becomes one function.
- A failed or stuck read is on the ops exception queue (domain `documents`) immediately. A daily Vercel cron (`/api/cron/clinical-document-retry`) re-runs the reader on a patient's own upload, at most 3 attempts in all. Sub-daily retries would need pg_cron calling the route through pg_net with a stored secret; not done, because the ops queue already puts every failure in front of a person.
- Care Coordinator uploads (CDE-03) have their own channel value now; giving the coordinator the upload screen and permissions is step 2.

## 14. Step 2 as built (2026-11-04)

Migration `20261104162557_cde2_coordinator_lab_uploads.sql`, proof `packages/db/tests/cde2_coordinator_lab_uploads.sql`, screen `/dashboard/care-coordinator/lab-reports` (tab "Lab reports").

- Liaison work is the Care Coordinator's (CDE-03). The legacy `lab_liaison` role can use the same two functions; no account holds it.
- `find_patient_for_upload`: patient number, phone (any Nigerian form, matched on the last 10 digits), email, or name with date of birth. Never a name alone. Returns name, year of birth, sex, state and the last 4 characters of the patient number and the phone; never the full date of birth or patient number, so the identity check has to be answered from the report. Own organisation only; each search audited by kind and count, never its text.
- `coordinator_submit_lab_report`: the name on the report must share two words with the record (one, when the record holds a single name), plus the date of birth or the patient number; a date of birth or patient number that does not match refuses the upload outright. Fingerprint and laboratory (a directory lab or a typed name) are required. The file becomes a held S27 result, so the clinician release machine and INV-03 are unchanged. The intake row records what matched, who confirmed it, the laboratory, the test date and the coordinator's note.
- `correct_clinical_document_metadata` ("Correct details" on each upload): the uploader fixes test date, laboratory (a directory lab and a typed name replace each other) or note, with a reason, until a clinician has dealt with it; the old values go to the audit log.
- `staff_lab_assignments`: which laboratories a coordinator handles (admin-managed; the admin screen for it comes with the admin statistics, a later step).
- Step 1's fingerprint gaps are closed: `replace_my_result_document` takes `p_content_sha256` (dropped and re-created, one definition), `patient_add_lab_result` passes the fingerprint on.
- Lab reports only. Uploading an ECG, scan or other report for a patient arrives with step 5, when those kinds route through the intake record.
- CDE-08 (`20261104165832_cde3_values_free_upload_notice.sql`): a care-team upload sends the patient a values-free notice (in-app and push: a report was added, a doctor will review it). Nothing from the report is in it; the result stays held (INV-03).

## 15. Step 3 as built (2026-11-04): results typed in by hand (CDE-02)

Migration `20261104181133_cde4_hand_entered_lab_results.sql`, proof `packages/db/tests/cde3_hand_entered_lab_results.sql`, "Type in results" on the coordinator's Lab reports tab.

- Typed results become a **draft for a doctor**, exactly like an AI reading: the same validation (`validateExtractedRow`: catalogue code, unit conversion, plausibility; then the cross-row consistency checks), the same review panel, and filing through `confirm_lab_report_extraction` into the S27 result engine (signed ranges, abnormal alerts, release machine). Nothing reaches the patient's record until a doctor files it.
- **Provenance everywhere:** the draft is `entry_method = 'manual'` with who typed it, when, and where the values came from (required); the laboratory's own flag, specimen and comment per row are kept beside it; the intake record is `entered_by_hand`; the doctor's panel says "Typed in by hand, not yet checked" with those details instead of the AI label.
- **A source document always exists:** the original report when attached, otherwise a PDF the server makes of exactly what was typed (patient, laboratory, test date, source, who typed it and when, every row as typed, labelled as a transcription and not a laboratory report).
- **Always reviewed:** a care-team hand entry opens a clinician review alert whatever the patient's plan (`handle_lab_result_document`, CDE-02 branch), and a critical typed value raises it to urgent at once through the same escalation bridge an AI reading uses (`lib/lab-reports/escalation-bridge.ts`, now shared by both).
- The same identity check as a file upload (now one function, `private.cde_check_identity`), the same duplicate refusal, the CDE-08 values-free notice.
- Not counted as a reader attempt, so never retried and never an ops "could not be read" exception.

## 16. Step 4 as built (2026-11-04): "Not sure what a document is?" and the classifier (AI-024)

Migration `20261104184341_cde5_document_classifier.sql`, proof `packages/db/tests/cde4_document_classifier.sql`, card "Not sure what a document is?" at the top of the patient's Labs › Documents tab.

- **Upload without a type.** `submit_unsorted_document`: the patient's own file, in their own folder of the lab-result-documents bucket (the function checks the object exists there), fingerprinted, duplicates refused. The intake record has no kind and no routing yet (`classifying`) and is held under `reproductive_health`, the most protective category, until its kind is known (it could be a pelvic or obstetric report). Patients only; a caregiver viewing someone else's record does not get the form.
- **Order of sorting.** Fixed rules over the file name and the patient's note (`classify-rules.ts`) only ever *suggest*: they pre-select the answer. AI-024 (`classify.ts`, through `runGovernedAi`) returns one code from the active taxonomy and a confidence; it is **applied without asking** only at or above `documents.classifier.auto_apply_min_confidence` (proposed-config, 0.85, an operational setting) and when no rule points to a different pipeline. Anything else, including AI-024 being off or failing, asks the patient one question, "What kind of document is this?", with the best suggestion pre-selected.
- **AI-024 is registered disabled** (moderate risk, `assist`, fails closed), with four guardrails, a release-required suite of seven cases (two adversarial: a non-health document and a prompt injection), two cases on the shared safety baseline, and an evaluation harness the governance console can run (`run-classifier-eval-suites.ts`). No evaluation run or approval is seeded. Until a human runs the suite and approves v1, every upload is sorted by the patient's answer.
- **After the type is known.** A lab kind is routed in the same transaction: a `lab_result_documents` row for the same stored file (source `patient`), and `cde_open_intake` **adopts** the waiting intake row instead of opening a second one. From there it is an ordinary patient lab upload: the AI-005 reader starts, the review alert follows the patient's plan, S27 and INV-03 are unchanged. Any other kind has no reader routed through the intake yet (step 5): it is kept on the record, and when the patient's plan includes a doctor's review (an active programme, the same rule a patient's lab upload uses) a clinician review alert opens at once; otherwise the record says plainly that it is kept and not reviewed.
- **A failure moves toward a person.** `record_document_classification` (service role only) never routes on an error, whatever the caller passes; an unsure result asks. The daily cron (`/api/cron/clinical-document-retry`) finishes uploads interrupted mid-sort and, after `max_classify_attempts` (by job count or days since upload), asks the patient. A classify attempt is not a reader attempt (`cde_refresh` counts `extract` jobs only).
- **A doctor can read a kept document.** The review alert points to a new section on the patient's record, "Uploaded documents not yet read automatically": the original opens through a five-minute signed link after an RLS read in the document's category, and the doctor records the review with a note (`review_clinical_document`, active clinician who may read the record, audited).
- **Code review fixes (2026-11-04):** the upload must be an object the patient stored themselves (`storage.objects.owner_id`), so a held care-team file in the same folder cannot be registered as the patient's own; the answer is final once the type is known (no stale alert, no category change under a reviewing doctor); a question unanswered for 3 days, or an upload stuck while being sorted, is on the ops exception queue (domain `documents`); a doctor walkthrough the patient already paid for is linked when the upload becomes a lab document, as on the direct upload; an activated governed prompt for AI-024 is used, always with the two fixed rules and the code list; reader job rows take `clock_timestamp()` so "latest error" is not a tie inside one transaction; sorting errors are reported to the patient and the cron honestly.
- **Not in this step:** a care coordinator or clinician sorting a patient's unsorted document (the answer is the patient's, so the lab row is attributed correctly); unsorted uploads on mobile; a reminder to the patient about an unanswered question (the ops queue covers it).

## 17. Step 5a as built (2026-11-04): ECG and imaging through the intake record

Migration `20261104192801_cde6_ecg_imaging_through_intake.sql`, proof `packages/db/tests/cde5_ecg_imaging_through_intake.sql`.

- **Every ECG and imaging document has an intake record**, opened by a trigger as the lab stores already do: one status list, the fingerprint (the web, staff and mobile upload paths now compute it on the server) and the duplicate refusal across every store, so the same file cannot be in a patient's record as both a lab report and a scan. Their own handlers are unchanged: every ECG or imaging upload opens a clinician review alert on every plan and a care-team upload tells the patient; the CDE-08 lab notice is sent for the lab stores only, so nobody is told twice.
- **Imaging keeps the category of its kind.** `imaging_report_documents` and `imaging_reports` gain `access_category` (default `labs_results`, as before), their policies read the column, a filed report inherits its document's category, and a session cannot change it. A pelvic or obstetric scan sorted through the intake is `reproductive_health`, which break-glass never opens. Before this, every imaging record was readable under `labs_results` whatever it showed.
- **"Not sure" uploads reach the ECG and imaging readers.** Those readers keep files in their own buckets, which the database cannot copy, so a sorted ECG or imaging upload waits (`processing`); the server copies the file and calls `route_clinical_document` (service role only), which inserts the ECG or imaging row and the intake row is adopted; the AI-006 or AI-016 reader then starts (AI-016 is still off, so imaging goes straight to the doctor). A copy that fails leaves the document `processing`: on the ops exception queue after 30 minutes, retried by the daily sweep. A doctor who reads it from the step 4 review section first stops it being routed later.
- Pathology, cervical and narrative documents still use the step 4 review section; their structured records follow in 5b.

## 18. Step 5b as built (2026-11-04): pathology, cervical and mammography records; draft narrative rules

Migration `20261104193355_cde7_pathology_cervical_mammography.sql`, proof `packages/db/tests/cde6_pathology_cervical_mammography.sql`.

- **`pathology_reports`**: a doctor files a histopathology, cytology, cervical cytology or HPV result **as printed** from a kept document, from the review section on the patient's record ("File the result"). The diagnosis line is verbatim; grade and stage only if printed; the cytology category and HPV result as the laboratory wrote them. Nothing is coded. Filing records the doctor's review of the document. The record carries the document kind's category (cervical and HPV: `reproductive_health`) and is read by tied staff; the patient does not see the structured record in this step (they see the status and the doctor's follow-up), because a pathology result is discussed, not posted.
- A cervical result filed here does not create a `screening_results` row; the doctor files that through the existing screening path, so the abnormal-screening pipeline keeps one entry point (OQ-CDE-10, default taken).
- **Mammography**: `imaging_reports` keeps breast density and BI-RADS (left, right, overall) as printed, only on a breast study; the platform never assigns or changes a category. The filing action and its schema accept them.
- **Narrative urgent-finding rules (CDE-01)**: drafted from ACR BI-RADS, NICE NG12, NHS CSP and Bethesda, ASCCP, RCPath, ESC and RCR guidance as proposed config `documents.narrative_urgent_rules` v1, with a tested matcher. **Unsigned and inert**: nothing escalates from them until the CMO signs (OQ-CDE-11). Draft for the CMO: `docs/plans/narrative-urgent-finding-rules-draft-2026-11-04.md`.
- Still to do in step 5: wiring the signed rules (a signed table on the CMO hub), and switching on AI-016 and AI-018, which needs their evaluations run and approved by a person.
