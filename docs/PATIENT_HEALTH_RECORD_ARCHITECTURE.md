# Patient Health Record — Architecture & Gap Analysis

> Companion to `docs/ARCHITECTURE.md` and `docs/FEATURE_SPEC.md`. This file exists because a
> "Module 1: Patient Health Record" spec (26 subsections, §1.1–§1.26) was handed to engineering as
> if it were describing a greenfield build. **It is not one.** By the time this review ran
> (2026-08-27), the platform already had 567 migrations and most of what the spec asks for exists —
> scattered across dozens of features built for their own reasons over seven weeks, never assembled
> into one deliberate "this is the patient record" architecture. The job here was to find out, table
> by table, what is real; close the small number of genuine, low-risk gaps directly; and surface the
> handful of places where the spec's mental model (one clean layered record) collides with a real
> decision this platform already made, rather than silently picking a side.
>
> **Read this as a map, not a backlog.** Every §-numbered section below cites the actual table,
> migration, or file backing each claim, so a future reader can verify against the live code/DB
> rather than trusting a changelog. Status tags: **BUILT**, **PARTIAL** (real but incomplete against
> the spec's ask), **MISSING**, **BY DESIGN — DIFFERENT** (the platform deliberately does this
> differently and the spec's version would be a regression, not an enhancement).

## 0. What this pass actually changed

Three migrations landed alongside this document, all additive, all following an existing pattern in
the codebase rather than inventing a new one:

- `20260827192712_profiles_self_update_column_guard.sql` — closed a **confirmed security gap**
  (§1.5 below): `profiles_update`'s own 2026-07-05 comment claimed "role escalation is prevented by
  only allowing staff/admin to change organisation_id/role," but the policy body only ever checked
  row ownership, never which columns changed — the exact same class of bug already found and fixed
  once on this table for SELECT (`20260807112503_clinician_phone_admin_only_visibility.sql`). A
  patient's own JWT, called directly against PostgREST (not through the app), could set their own
  `role`, `organisation_id`, `patient_number`, `identity_verified_at`, or `hiv_status`/`hbv_status`/
  `hcv_status`. Fixed with a `BEFORE UPDATE` trigger denylisting those columns on a *direct,
  top-level, self-row* edit only — staff/admin editing someone else's row, and system-internal
  cascades like `advance_serology_status`, are untouched (verified in
  `packages/db/tests/profiles_self_update_column_guard.sql`, including a regression check that the
  serology cascade still fires end-to-end).
- `20260827193103_lab_analyte_reference_range_and_flag.sql` — added `reference_range_low/high`,
  `reference_range_text`, `abnormal_flag`, `specimen_collected_at` to `lab_analyte_readings` (§1.13).
- `20260827193149_vitals_respiratory_rate_and_peak_flow.sql` — added the two core vitals from §1.12
  with no home in `vitals_readings`: `respiratory_rate` and `peak_flow` (§1.12).

Everything else below is **findings and recommendations, not yet built** — either because it needs
a founder decision first (§8 "Open questions"), or because it's additive but larger in scope than a
single-pass schema tweak and is called out as follow-up work.

---

## 1. Section-by-section status

### §1.3 Patient identity — PARTIAL
The real internal key is `profiles.id` = `auth.users.id` (UUID, `20260705211044_core_auth_
multitenancy.sql:75`) — immutable, non-guessable, not phone-based. That satisfies the spec's actual
requirement. `profiles.patient_number` (`TH-000001`, `20260715003255_...sql:38`, via a plain
Postgres sequence) is a **human-facing reference number**, not the internal identity key — the same
role a hospital MRN or bank account number plays, and sequential-but-non-secret is normal for that
purpose *provided nothing treats it as a lookup credential*. `public.find_profile_by_phone`
(`20260712202559_...sql`) is a narrow, same-org, patient-role-only RPC for family/next-of-kin lookup
— not a general identifier. **No gap requiring action** — flagged here only so a future reader
doesn't mistake `patient_number`'s sequentiality for the spec violation it looks like at first read.

### §1.4 Demographics — PARTIAL
On `profiles`: `full_name`, `phone` (E.164 CHECK, nullable, not unique), `sex`, `date_of_birth`,
`state`/`city`/`area` (`20260716160000_profiles_location.sql`), `language` + `condition_language_
preference`, `emergency_contact_*`/`next_of_kin_*` (`20260716224736_emergency_escalation.sql`),
`identity_verified_at` + a separate `identity_verifications` table (NIN/BVN last-4 only,
`20260716182000_identity_verification.sql`), `avatar_url`, `patient_number`.
**Missing entirely: preferred/nickname name, country (state/city/area assumes Nigeria), occupation,
employer, insurance/HMO membership, preferred facility.** Email lives only in `auth.users`, not on
`profiles` — fine architecturally (Supabase owns it), but means no query can join "patient
demographics" without also touching `auth.users`.
**Also notable, not necessarily wrong:** `hbv_status`/`hcv_status`/`hiv_status` (clinical serology
state) live directly on the identity table rather than a separate clinical table — see §1.7 for why
this matters more once a real problem list exists.

### §1.5 Profile editing / field-level permissions — PARTIAL, one bug fixed this pass
The app layer is disciplined — every patient-facing server action builds a narrow, named
`.update({...})` object (`apps/web/src/app/(dashboard)/patient/actions.ts`, `condition-language-
actions.ts`, `family/care-access-actions.ts`, `supporting/actions.ts`, `onboarding/actions.ts`).
Confirmed direct-client patient self-writes today: `state/city/area`, `avatar_url`, `condition_
language_preference`, `emergency_contact_*`/`next_of_kin_*`, `receives_care` (paired with clearing
`onboarding_completed_at`), `onboarding_completed_at` itself (gated by its own `private.enforce_
onboarding_prereqs` trigger, unrelated to this pass), and — during onboarding — **`date_of_birth`
and `sex`** (`apps/web/src/app/onboarding/actions.ts:49-51`).
**The RLS gap** (comment-only intent, never enforced) is closed by `20260827192712_profiles_self_
update_column_guard.sql` — see §0.
**Left open, deliberately not decided here:** the spec's own table says phone/name/DOB "may require
verification" — implying an *ongoing* restriction. Today, `date_of_birth`/`sex` are freely
self-editable via the same RLS path **forever, not just during onboarding** — nothing distinguishes
"first-time intake" from "changing it two years later." DOB drives age-based risk scoring and
screening eligibility, so this is a real product question, not a bug — see §8 Q4.

### §1.6 Clinical summary — MISSING (as a persistent, patient-level artifact)
No `clinical_summary`/`patient_summary` table. Three unrelated, narrower composites exist instead:
`patient/summary.ts`'s `getPatientSummaryStats()` (dashboard stats, not narrative);
`clinician/patients/[patientId]/pre-visit-summary.tsx` (explicitly "read-only — nothing clinical is
decided here," no free-text narrative, no clinician sign-off field); and a referral-letter-scoped
`ClinicalSummary` in `clinician/referrals/[referralId]/actions.ts` (vitals+meds snapshot for one
referral, not a standing PHR summary). **No dynamically-generated "52yo male with HTN and
diabetes..." narrative exists anywhere, and no clinician can validate/pin one.**

### §1.7 Problem list — MISSING (this is the biggest real gap in the whole review)
No `patient_conditions`/`diagnoses`/`problem_list` table exists. The nearest analog, `care_plans`
(`20260705211129_chronic_disease.sql:82-90`, condition enum extended in `20260716223124_...sql`),
is a **care-management enrolment record**, not a problem list: it has `condition`, a *care-plan*
lifecycle `status` (draft/active/completed/cancelled — not Active/Controlled/Uncontrolled/Suspected/
Resolved/Historical), `target_ranges jsonb`, free-text `notes` — **no ICD-10 coding, no severity, no
diagnosing clinician, no supporting evidence, no last/next-review date**. A patient can have a real,
historical, resolved, or suspected condition with **no** active care plan (by definition — that's
what "resolved" and "historical" mean), so there is structurally nowhere to put it today.
Compounding this: `hbv_status`/`hcv_status`/`hiv_status` (§1.4) are a de facto mini problem-list
living directly on `profiles`, and `patient_blood_profile` (blood group/genotype) is its own
narrowly-scoped table — three different homes for "does this patient have condition X" with three
different shapes, none of them the general one the spec asks for.
**See §8 Q1 — this needs a founder decision on shape, not just schema.**

### §1.8 Allergies — BUILT, well-engineered
`patient_allergies` (`20260716121000_...sql`): `allergen`, `reaction`, `severity` (enum), `source`
(enum: patient/clinician), `recorded_by`, `noted_at`. **Propagation is real and load-bearing**:
`apps/web/src/lib/rules/drug-safety.ts` runs literal-name, same-class, and cross-reactivity checks
(penicillin/cephalosporin, ACE/ARB, aspirin/NSAID, sulfonamide) against active medications, wired
through `lib/clinical/patient-clinical-context.ts` into the clinician medication-safety panel, the
pharmacist order screen, and the patient's emergency QR card. This is the one section of the spec
that is fully done to a high standard — hold it up as the reference pattern for §1.7/§1.9/§1.10.

### §1.9 Family history — PARTIAL (EAV, one-time, missing fields)
No `family_history` table. Captured as fixed boolean/array fields inside `risk_assessment_responses`
(`20260706084905_prevention_risk_assessment.sql`, category `'family_history'`):
`family_diabetes`, `family_hypertension`, `family_heart_disease`, `family_sickle_cell`,
`family_cancer_types[]`. **Missing: relationship, age of onset, deceased/alive, and any mechanism to
update it after the one-time onboarding intake** — it's presence/absence only, patient-reported
only, frozen at signup.

### §1.10 Social history — PARTIAL (same EAV pattern, missing fields)
Same `risk_assessment_responses` table, category `'lifestyle'`: `smoking_status`, `cigarettes_per_
day`, `alcohol_use`, `exercise_days_per_week`/`minutes_per_session`, `diet_pattern[]`, `sleep_
hours`, `stress_level`, `height_cm`/`weight_kg`. Structured (enum-backed, not free text) but
**missing occupation, occupational exposure, living situation, healthcare access, socioeconomic
barriers** entirely, and — same limitation as §1.9 — a one-time intake snapshot, not a continuously
updated record.

### §1.11 Lifestyle profile — PARTIAL (two disconnected systems)
`packages/lifestyle-engine` (ongoing programme measurements: bp, glucose, weight, waist, derived
BMI, activity, steps, sleep, mood, food log) genuinely feeds chronic-care management via `lpe_
enrollments`/`lpe_goal_instances` linked to `care_plans.condition`. But smoking/alcohol/diet-risk
(the spec's own example fields) live only in the one-time `risk_assessment_responses` intake (§1.10)
feeding `prevention_risk_scores` — a **separate** scoring path the lifestyle engine doesn't read.
**No unified per-patient lifestyle profile joins the two.** "Prevention Engine"/"Care Management
Engine" as named systems don't exist in code — spec terminology, not an architecture already built.

### §1.12 Observations — PARTIAL, two gaps closed this pass
`vitals_readings` (wide-table design, one typed column per vital) covers BP, pulse, glucose, weight,
temperature, SpO2, waist circumference, ketones — each with `source` (manual/device/wearable/cgm/
fhir_import), `device_id`/`cgm_connection_id`/`wearable_connection_id`, and `logged_by_profile_id`
(NULL = patient-self, server-derived). `20260827193149_vitals_respiratory_rate_and_peak_flow.sql`
adds the two vitals from the spec's own list that had no home at all: **respiratory rate and peak
flow** (schema only — see §8 follow-up list for input-form/threshold wiring).
**Still missing:** height/BMI live only in the unrelated `obesity_assessments` table, disconnected
from `vitals_readings` — no unified observations view across BP/weight/height/BMI. **No `validated`/
confirmed status column** on `vitals_readings` itself (there's an edit-lock trigger for non-manual
rows, which is a different thing — see §1.18).

### §1.13 Laboratory results — PARTIAL, three gaps closed this pass
Fragmented across `lab_analyte_readings` (per-analyte value), `screening_results` (per-panel verdict
+ abnormal flags + free-text summary), `lab_orders` (which lab, order/result timestamps), and
`lab_result_documents` (the uploaded PDF + `reviewed_by`/`reviewed_at` — clinician review status
**does** exist, just at the document level). `20260827193103_lab_analyte_reference_range_and_flag.sql`
adds `reference_range_low/high`, `reference_range_text`, `abnormal_flag` (new `lab_analyte_flag`
enum), and `specimen_collected_at` directly to `lab_analyte_readings` — closing the three concrete
column-level gaps the spec's own worked example (§1.13) calls out.
**Deliberately not added:** a second review-status column on `lab_analyte_readings` — every row only
ever exists after a clinician confirms an extraction (`confirm_lab_report_extraction`), so review
status is already implied by the row's existence; a second column would just go stale independently.
**Still missing: trend tracking** (previous result, improving/worsening) at the DB layer — no
`previous_reading_id` or delta column anywhere; the only trend-adjacent thing is `patient_result_
explanations`, which explains the *latest* value only, and is a caching/plain-language layer, not a
trend engine. This is a query-time concern (compute "previous same-code reading for this patient"
from existing rows), not obviously a schema gap — flagged as a UI/query follow-up, not built here.

### §1.14 Imaging — MOSTLY MISSING; one narrow pipeline exists
No general `imaging_orders`/`imaging_reports` table, no DICOM/PACS reference anywhere. ECG has a
full, purpose-built three-table pipeline (`ecg_report_documents` → `ecg_report_extractions` → `ecg_
parameter_readings`, confirm-gated, "never patient-readable until confirmed") that is explicitly
ECG-only by its own migration comment, not a generalized imaging model. "Imaging" otherwise appears
only as screening-bundle line items (breast/abdominal/prostate ultrasound) inside the existing
lab_orders flow. The spec itself says "initially, storing the report may be sufficient" — see §8
follow-up list; this is additive and low-risk to build (mirrors the lab/ECG document pattern) but
was out of scope for this pass given everything else already in flight.

### §1.15 Medications: Prescribed → Dispensed → Received → Taken — BY DESIGN, DIFFERENT (see §8 Q2)
**Prescribed:** real (`medications` table, `source` enum clinician/patient/specialist, prescriber
fields, lifecycle fields). **Patient-reports-taking:** real and fully separate (`medication_logs`:
taken/missed/skipped). **Dispensed and Patient-received are collapsed into one table/row**
(`pharmacy_order_dispenses`, a single `dispensed_on` + `dispense_source` enum distinguishing *who
recorded it*, not two linked events). Critically, `20260803132008_medication_collected_anywhere.sql`
records an explicit **founder decision**: "Tarragon has no contracted pharmacy, and pharmacy_
medications has 0 rows" — the migration deliberately removed the pharmacy-routing requirement and
degraded the table to patient self-report ("I bought this at the chemist down the road"). Building
out a genuine second Dispensed-vs-Received event today would be modeling a supply chain that, by
founder decision, doesn't exist yet. **This is the spec's clearest collision with a real, dated
business decision** — flagged, not silently overridden. See §8 Q2.

### §1.16 Clinical encounters — PARTIAL, narrow
Only `video_consultations` exists, and it's Zoom-call scheduling metadata (context/status/timestamps
+ links to escalation/referral), not a clinical encounter record — **no speciality/reason/clinical-
notes/assessment/plan/diagnoses/actions/follow-up columns anywhere, and no `clinical_notes` table at
all** (confirmed absent; `case_briefs`' own migration comment treats `clinical_notes` as a
non-existent write target). Encounter types covered: pre-referral triage, post-referral specialist
telemedicine, self-serve check-in only — no nurse/pharmacist/dietitian/in-person/external-provider
encounter type or "visit note" content model. This is a real, structural gap but a large one (a
proper encounter/consultation-note model, not a column tweak) — out of scope for this pass, called
out for a deliberate follow-up decision rather than attempted quickly.

### §1.17 Patient timeline — PARTIAL, good spine, one real UI gap
`patient_timeline` is a solid append-only table (insert/select only, no update/delete grant) with a
15+-value `timeline_event_type` enum (lab_completed, lab_abnormal, medication_started/stopped/
missed/dispensed, referral_created/status_changed, screening_due/completed, vaccination_recorded,
escalation_raised/resolved, care_plan_updated, admission/discharge_recorded). **No appointments or
document-upload event types exist**, and — the concrete UI gap — `components/patient-timeline.tsx`
renders every row unconditionally with no filter state, and `usePatientTimeline` takes only
`patientId`/`limit`, no category param, despite the spec explicitly asking for filter-by-category.
This is a genuinely small, low-risk fix (add a client-side filter over the existing `event_type`
values — no new schema) — recommended as a quick follow-up.

### §1.18 Record versioning / correction trail — PARTIAL, platform-wide gap
A generic `private.audit_row_change()` trigger fires on 21 clinical-core tables into an append-only
`audit_log` (`20260812030853_row_change_audit_triggers.sql`) — but it **stores only changed column
names plus a SHA-256 hash of the row, never old/new values**, by explicit design. It can prove a
value changed; it cannot show what it changed *from*. The underlying tables (`vitals_readings`,
`medications`, `care_plans`, `profiles`, etc.) can still be `UPDATE`d/`DELETE`d in place — this is a
change-*detection* log, not a correction trail. The one genuine "preserve original + reason + author
+ timestamp" pattern in the codebase is `protocol_versions` (append-only, no update/delete policy,
`change_summary`/`approved_by` per version, comment: *"correcting a mistake means signing a new
version, not editing history"*) — but it governs clinical *protocols*, not patient records.
**No patient clinical-record table anywhere enforces the spec's §1.18 requirement.** Retrofitting
this platform-wide (append-only + correction-reason on ~20 live tables, each with its own RLS and
app-layer write paths) is a large, invasive change — see §8 Q3 for scope options.

### §1.19 Patient record search — MISSING
No full-text or structured search across a patient's history exists anywhere — no `tsvector`/GIN
index on any clinical table, no search component in `apps/web/src` (`*Search*` glob returns
nothing patient-record-related), no API route. The clinician patient-detail view is fixed sections
(timeline, referrals, medications) with no query box. Real gap, not attempted this pass — flagged as
follow-up (likely a `tsvector` generated column across the handful of highest-value tables — lab
results, medications, encounters once §1.16 exists — plus a simple search UI, once §1.7's problem
list gives it something structured to search).

### §1.20 Record permissions (granular, role-scoped) — BUILT, well-engineered
`private.is_org_staff(org)` is the single reused tenant-isolation predicate across ~314 policies/110
tables, and it **explicitly excludes** `pharmacist`, `lab_partner`, `lab_liaison`, `finance`,
`analyst`, `corporate_admin`, `hmo_admin` — each of those reaches data only through its own narrow
SECURITY DEFINER RPC scoped to a single order/record, never blanket care-team access. This was
iteratively hardened after finding real over-broad access more than once (documented in the
migrations themselves). This is the platform's strongest section against the whole spec — no action
needed.

### §1.21 External records — PARTIAL, no generic path
Two purpose-built pipelines exist (`lab_result_documents`, `ecg_report_documents`), each following
"AI drafts, marked unverified, never patient-readable until a clinician confirms." **No generic
`patient_documents` table exists for discharge summaries, prescriptions, or medical letters** — only
lab results and ECGs are upload-supported document types today, and `patient_hospital_admissions`
captures only self-reported *text*, not an attached discharge-summary file. This is additive and
low-risk to build (same pattern, one more document-type table) — recommended follow-up, not built
this pass given the volume of other findings in this review.

### §1.22 Record reconciliation on conflict — MISSING
Grepping `discrepan`/`reconcil`/`conflict` across the codebase surfaces only *finance* reconciliation
(Paystack/Stripe) — unrelated. The one clinical near-miss, a medication-pack-photo check
(`lib/medications/pack-actions.ts`), is explicitly stateless: no discrepancy row is ever persisted,
the patient is just pointed at in-app messaging. **No allergy/condition/medication table has a
conflict-flag or reconciliation-queue mechanism**, and an uploaded external document that contradicts
existing structured data raises only a generic "review needed" alert, not a conflict-aware one.
Genuinely missing; needs §1.21's generic document table to exist first (a discrepancy needs two
things to compare) — sequenced as follow-up after §1.21, not attempted standalone.

### §1.23 Patient-facing health record UI — PARTIAL
The patient dashboard already covers **My results**, **My medications**, **My care plan/referrals**,
and **My health timeline** as real, distinct sections. **My documents** exists only as lab/ECG
upload, not a general library. **No dedicated "My conditions" page** — condition state is scattered
across programme-specific cards (diabetes-*, foot-risk-status, complication-status) rather than one
section, which is the patient-facing symptom of the missing §1.7 problem list. **No unified "My
appointments"** — booking exists (`booking-requests-list.tsx`, `book-video-visit.tsx`, `annual-
health-check-booking.tsx`) but scattered across sections, not one page. Plain-language translation
is real and good: `patient_result_explanations` (AI-drafted, multi-language: en/pcm/yo/ha/ig) plus
doctor-authored `lab_result_document_patient_interpretation`.

### §1.24 Record export — PARTIAL
Real PDF export routes exist for quarterly reports, health passport, health-check reports, lab
results (single and combined), vaccination certificates, and referral letters. **No structured
JSON/FHIR/CCD export anywhere** (PDF-only). **No export audit trail** — the existing `audit_log`/
`pgaudit` machinery logs clinician *reads* and table *writes*, but nothing logs "patient X downloaded
PDF Y at time Z." This is a small, additive fix (a shared helper writing one `audit_log`-style row
from each of the ~6 export routes) — recommended follow-up, not built this pass.

### §1.25 Record security — PARTIAL
MFA (TOTP, AAL2 step-up) is real but **opt-in for everyone, not role-mandated** — no code path forces
clinicians specifically into MFA. No field-level/column encryption for PHI beyond Supabase's at-rest
default. Write-audit and one clinician-chart-read-audit path exist (see §1.18); `pgaudit`
object-level read logging exists but **writes to the Postgres server log, not a queryable table** —
the introducing migration flags this itself as an unbuilt follow-up. **No abnormal-access anomaly
detection, no data-retention policy, no right-to-erasure/export RPC anywhere.** The one concrete,
scoped fix from this review — the profiles column-level write gap — is closed (§0); the rest here is
larger security-programme work (retention policy, erasure, mandatory-MFA-for-staff, durable read-audit
storage) that needs its own dedicated review, not a byproduct of a record-architecture pass.

---

## 2. What this review deliberately did NOT try to fix

Per the instruction driving this review — **enhance the present design, don't replace it** — several
findings above are large enough that a schema change without a product decision first would be
guessing, not enhancing. They're listed as open questions in §3, not implemented.

Smaller, genuinely low-risk items **not** built this pass simply because of volume, not difficulty,
are worth a short follow-up PR each: the timeline category filter (§1.17, no schema change, just
wire the existing `event_type` enum into `patient-timeline.tsx` and `usePatientTimeline`), a generic
`patient_documents` table (§1.21, mirrors `lab_result_documents` exactly), export audit logging
(§1.24, one shared helper called from ~6 existing routes), lab result trend display (§1.13, a
query over existing rows, no schema change), and a unified "My conditions"/"My appointments" page
once — and only once — §1.7 gives the former something structured to render.

## 3. Open questions for the founder (spec vs. real architecture collisions)

These are the places the spec's mental model doesn't just add something missing — it implies a
design choice this platform hasn't made yet, or asks for something that would contradict a real,
dated decision already on record. Raised rather than decided.

1. **Problem list shape (§1.7).** Build a genuinely new `patient_conditions` table (ICD coding,
   status ladder, severity, diagnosing clinician, review dates) that `care_plans` references by FK
   once a condition gets an active care programme — keeping `care_plans` as the enrolment/programme
   record it already is, not duplicating "what conditions does this patient have" a second time? Or
   extend `care_plans` in place to carry the missing fields, accepting that a resolved/historical/
   suspected condition with no care plan still has nowhere to live? The former avoids a second
   source of truth (the same principle already applied to wearables vs. `vitals_readings`); the
   latter is a smaller change but doesn't actually close the gap for non-enrolled conditions.

2. **Medication Dispensed vs. Received (§1.15).** `pharmacy_order_dispenses` collapsing these two
   events was a deliberate 2026-08-03 founder decision made *because* Tarragon has no contracted
   pharmacy and the routing infrastructure had zero production rows. Build the second, distinct
   event now (future-proofing for when/if a pharmacy partnership exists), or leave it collapsed to
   match today's actual supply chain and revisit only if that changes?

3. **Correction-trail scope (§1.18).** Retrofitting append-only-with-reason onto all ~20
   clinician-editable clinical tables platform-wide is a large, invasive change (new RLS, new
   app-layer write paths, on live tables). Take it on fully now, or scope it first to the
   highest-stakes fields — problem-list status changes (once §1.7 exists) and allergy corrections —
   following the existing `protocol_versions` precedent, and treat the rest as phased follow-up?

4. **Family/social history architecture (§1.9/§1.10).** Promote these to dedicated, continuously-
   editable relational tables (relationship/age-of-onset/deceased-or-alive for family; occupation/
   exposure/living-situation for social) — a genuine architecture change from the current one-time
   onboarding EAV design — or keep `risk_assessment_responses` as-is and just add the missing keys
   to its existing question set, accepting it stays a point-in-time intake rather than a living
   record?

5. **Date of birth / sex / full name — ongoing vs. onboarding-only edit rights (§1.5).** Today these
   are freely patient-self-editable via the same RLS path indefinitely, not just during initial
   intake, which sits uneasily next to the spec's "may require verification" framing and against the
   fact that DOB drives clinical age-based logic. Leave as-is, or add a rule (e.g. app-layer,
   possibly backed by a trigger once onboarding is complete) requiring staff involvement or a
   verification step for a *post-onboarding* change to these three fields specifically?
