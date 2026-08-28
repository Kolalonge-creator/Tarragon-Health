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

**Round 1 — the audit itself, plus the low-risk fixes it surfaced with no judgment call attached.**
Three migrations, all additive, all following an existing pattern in the codebase rather than
inventing a new one:

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

**Round 2 — the four founder decisions from §3 (below), each now built.** Six more migrations:

- `20260827195333_record_corrections_platform_wide.sql` — the platform-wide correction trail (§1.18,
  Q3: full retrofit now), delivered as a new `record_corrections` table + `capture_record_
  correction()` trigger attached to all 21 tables `audit_row_change` already covers, capturing real
  old/new values for exactly the columns that changed (not the whole row), on both **UPDATE and
  DELETE**. Read access is `private.can_read_record_correction()`, a function whose every clause was
  checked against the **live `pg_policies` on the production project** (not assumed from migration
  history) — it mirrors each covered table's actual current reader set rather than inventing a
  single blunter bar. `20260827201314_patient_allergies_audit_and_corrections.sql` closes a real gap
  this review's own audit found: `patient_allergies` — the platform's reference-quality pattern for
  a safety-critical field — was missing from `audit_row_change`'s original 21-table list entirely.
  Reason is **mandatory** (the trigger raises, not silently records null) for corrections to
  `patient_conditions` and `patient_allergies` specifically, confirmed safe because neither has any
  existing UPDATE/DELETE call site in `apps/web/src` to break. See §1.18 for the full design and the
  first version of this migration's more conservative mistake, corrected here.
- `20260827195559_timeline_condition_event_types.sql` + `20260827195615_patient_conditions_
  problem_list.sql` — the structured problem list (§1.7, Q1: new table). `care_plans` gets a new
  nullable `patient_condition_id` FK; its own `condition` enum and lifecycle are untouched.
- `20260827195741_family_history.sql` and `20260827195802_social_history.sql` — dedicated,
  continuously-editable records (§1.9/§1.10, Q4), additive to the existing one-time `risk_
  assessment_responses` intake, not a replacement for it (see each migration's header for exactly
  which fields stayed put and why).
- `20260827195857_medication_receipt_confirmations.sql` — the distinct "Patient received" event
  (§1.15, Q2: build it now), separate from `pharmacy_order_dispenses` and `medication_logs`.

Every new/changed table in both rounds has a matching test in `packages/db/tests/` (session pattern:
`set_config('request.jwt.claims', ...)` + `set local role authenticated` to simulate real sessions,
wrapped in `BEGIN`/`ROLLBACK`) — see the file list in §4.

Everything else below is **findings and recommendations, not built this round** — smaller, lower-risk
items called out as follow-up work (§5), not gated on a decision.

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
screening eligibility, so this is a real product question, not a bug — see §4, still open.

### §1.6 Clinical summary — MISSING (as a persistent, patient-level artifact)
No `clinical_summary`/`patient_summary` table. Three unrelated, narrower composites exist instead:
`patient/summary.ts`'s `getPatientSummaryStats()` (dashboard stats, not narrative);
`clinician/patients/[patientId]/pre-visit-summary.tsx` (explicitly "read-only — nothing clinical is
decided here," no free-text narrative, no clinician sign-off field); and a referral-letter-scoped
`ClinicalSummary` in `clinician/referrals/[referralId]/actions.ts` (vitals+meds snapshot for one
referral, not a standing PHR summary). **No dynamically-generated "52yo male with HTN and
diabetes..." narrative exists anywhere, and no clinician can validate/pin one.**

### §1.7 Problem list — BUILT this round (was the biggest real gap in the whole review)
Founder decision (§3 Q1): a genuinely new table, not an extension of `care_plans`. Built in
`20260827195615_patient_conditions_problem_list.sql`: `public.patient_conditions` carries
`condition_name`, `icd10_code`, `status` (new `condition_clinical_status` enum: suspected/
under_investigation/active/controlled/uncontrolled/resolved/historical), `severity` (new
`clinical_severity` enum: mild/moderate/severe), `date_identified`, `diagnosing_clinician_id`,
`supporting_evidence`, `current_treatment`, `last_reviewed_at`, `next_review_due_at`. `care_plans`
gets a new nullable `patient_condition_id` FK (its own `condition` enum and lifecycle `status` are
completely untouched — nothing reading/writing `care_plans.condition` today changes behaviour).
Per the spec's own intro ("a patient should never be able to simply edit a diagnosis") this table's
RLS is **org-staff insert/update only** — the patient gets SELECT on their own rows, no write path
at all, unlike `patient_allergies`' patient-reported model. Insert/update also feed `patient_
timeline` (new `condition_recorded`/`condition_status_changed` event types) and the platform-wide
correction trail (§1.18). Verified in `packages/db/tests/patient_conditions_problem_list.sql`.
Previous three-different-homes problem remains true of `hbv_status`/`hcv_status`/`hiv_status` and
`patient_blood_profile` — this migration did not move or duplicate that data into `patient_
conditions`; a future pass could decide whether serology status belongs there too.

### §1.8 Allergies — BUILT, well-engineered (and now covered by the correction trail)
`patient_allergies` (`20260716121000_...sql`): `allergen`, `reaction`, `severity` (enum), `source`
(enum: patient/clinician), `recorded_by`, `noted_at`. **Propagation is real and load-bearing**:
`apps/web/src/lib/rules/drug-safety.ts` runs literal-name, same-class, and cross-reactivity checks
(penicillin/cephalosporin, ACE/ARB, aspirin/NSAID, sulfonamide) against active medications, wired
through `lib/clinical/patient-clinical-context.ts` into the clinician medication-safety panel, the
pharmacist order screen, and the patient's emergency QR card. This is the one section of the spec
that is fully done to a high standard — hold it up as the reference pattern for §1.7/§1.9/§1.10.
**Gap found and closed this round (§1.18):** despite being the reference pattern, this table was
missing from `audit_row_change`'s original 21-table clinical-core list — a wrongly corrected or
deleted allergy left no trail anywhere, not even a hash. `20260827201314_patient_allergies_audit_
and_corrections.sql` adds it to both `audit_row_change_trg` and `capture_record_correction_trg`
(reason mandatory on correction, same as `patient_conditions`).

### §1.9 Family history — BUILT this round (dedicated table, additive to the existing intake)
Founder decision (§3 Q4): promote to a dedicated, continuously-editable record rather than just add
keys to the existing intake. Built in `20260827195741_family_history.sql`: `public.family_history`,
one row per (condition, relative), with `relationship` (new `family_relationship` enum + a
`relationship_detail` free-text refinement), `age_of_onset_years`, `is_deceased` (nullable — never
defaults to false when unasked). RLS mirrors `patient_allergies`: patient can insert/update/delete
their own rows, org staff manage org rows — family history is patient-sourced data, not a restricted
diagnosis. **Deliberately does not touch or migrate** `risk_assessment_responses`' existing
`family_diabetes`/`family_hypertension`/`family_heart_disease`/`family_sickle_cell`/`family_cancer_
types[]` booleans, which stay exactly as-is and keep feeding `prevention_risk_scores` — this is an
additional, more granular record, not a replacement (see the migration header for the full
reasoning). Verified in `packages/db/tests/family_and_social_history.sql`.

### §1.10 Social history — BUILT this round (dedicated table, additive to the existing intake)
Same founder decision and same non-destructive split as §1.9. Built in `20260827195802_social_
history.sql`: `public.social_history`, **one row per patient** (continuously updated, not an
append-only history table — its edit history is the platform-wide `record_corrections` trail from
§1.18, not a separate versioning mechanism), covering exactly what was missing: `occupation`,
`occupational_exposure`, `living_situation`, `healthcare_access`, `socioeconomic_barriers` (text
array, same open-ended-tag shape as `screening_results.abnormal_flags`). `risk_assessment_
responses`' existing smoking/alcohol/exercise/diet/sleep/stress/height/weight fields are untouched
and remain the system of record for those specific fields feeding `prevention_risk_scores` — moving
them would have been a breaking change to a live scoring pipeline, not what was asked for. Patient
can insert/update their own row; org staff manage org rows. Verified in `packages/db/tests/family_
and_social_history.sql`.

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
flow** (schema only — see §2 for input-form/threshold wiring, not built this round).
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
lab_orders flow. The spec itself says "initially, storing the report may be sufficient" — see §2;
this is additive and low-risk to build (mirrors the lab/ECG document pattern) but
was out of scope for this pass given everything else already in flight.

### §1.15 Medications: Prescribed → Dispensed → Received → Taken — BUILT this round (4th event added)
**Prescribed:** real (`medications` table, `source` enum clinician/patient/specialist, prescriber
fields, lifecycle fields). **Patient-reports-taking:** real and fully separate (`medication_logs`:
taken/missed/skipped). **Dispensed** (`pharmacy_order_dispenses`, a `dispensed_on` + `dispense_
source` enum) is a real but optional event — `20260803132008_medication_collected_anywhere.sql`'s
founder decision ("Tarragon has no contracted pharmacy") means most medication today has no
dispense row at all (self-arranged fulfilment). **Patient received is now its own, genuinely
distinct event** (§3 Q2: build it now, ahead of a real pharmacy partnership) —
`20260827195857_medication_receipt_confirmations.sql` adds `public.medication_receipt_
confirmations`, linkable to a `medication_id` and/or a `pharmacy_order_dispense_id`, with its own
`confirmation_source` (patient_self_report/delivery_confirmed/pharmacy_confirmed) and its own
`medication_received` timeline event. **Deliberately not wired** to `pharmacy_orders.delivery_
confirmed_at` — that delivery pathway is switched off in the UI with zero production rows, so
auto-deriving a confirmation from it would be automation on top of a currently-dormant feature; the
migration header calls this out as a follow-up once that pathway goes live. Verified in `packages/
db/tests/medication_receipt_confirmations.sql`.

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

### §1.18 Record versioning / correction trail — BUILT this round, platform-wide
Founder decision (§3 Q3): full retrofit now, not phased. `private.audit_row_change()` (`20260812
030853_row_change_audit_triggers.sql`) still exists exactly as before — it stores changed column
names plus a SHA-256 hash into `audit_log`, never old/new values, by a deliberate design documented
in its own header (some tables' real access differs from `audit_log`'s uniform `is_org_staff()` read
policy in ways that matter — copying full values into that one broadly-read table would have created
an exposure for those). That reasoning still holds for `audit_log` itself, so it was **not** reused
wholesale for this.

`20260827195333_record_corrections_platform_wide.sql` adds a **second**, purpose-built table,
`public.record_corrections`, via a new `capture_record_correction()` trigger attached to the same 21
tables (plus every new table this review added, and — a real gap the audit itself surfaced —
`patient_allergies`, added in `20260827201314_patient_allergies_audit_and_corrections.sql` because it
was missing from the original 21 entirely despite being this platform's own reference-quality
pattern for a safety-critical field). It fires on **UPDATE and DELETE** (a bare `updated_at` touch is
suppressed, same rule as `audit_row_change`; a DELETE preserves the full old row with `new_values =
null`, so a removed clinical record — the most extreme correction there is — still leaves a
recoverable trail, not just a hash proving it once existed). It records the actual old and new values
of exactly the columns that changed — not the whole row — plus `reason`, `corrected_by`, and
`corrected_at`.

**Read access — `private.can_read_record_correction()` — was built by checking the LIVE
`pg_policies` on the production project for every one of the 21 tables, not by assuming a bar was
needed and picking one.** That query showed 19 of the 21 already grant blanket same-org-staff
`SELECT` on the *current* row (`is_org_staff()`, with no per-patient-assignment narrowing), often
unioned with `private.can_read_clinical(patient_id)` (a real third path: a `profile_access` grantee
with `clinical_access`, or an eldercare "manage" grantee for a dependent account). Letting that same
set of people see that a value used to be different is not a new exposure category — it's the
existing exposure model, extended to one more fact about a row they can already read in full today.
Three tables needed their real, narrower-or-wider shape reproduced explicitly: `lab_result_documents`
and `profiles` both additionally admit an in-org `lab_liaison` (verified live, not assumed);
`clinical_staff` is readable by anyone in the same organisation, patient or staff (wider, not
narrower). `private.can_read_record_correction()` also always admits `private.is_admin()` and the
correction's own `corrected_by` (mirroring `audit_log`'s own `actor_id = auth.uid()`
self-visibility clause). **An earlier version of this migration used a single flat `is_admin() or
patient-self` policy for every table** — safe, but needlessly narrower than 19 of the 21 tables'
real access model, cutting off genuine clinical utility (a same-org clinician who can already see a
patient's current vitals couldn't see that a value had been corrected) for no matching security
benefit. Corrected once the live-policy data made that visible, rather than left as the shipped
design.

**Reason is mandatory, not just optional, for the two tables this review's own audit flagged as the
spec's clearest "never let this be silently changed" cases**: `patient_conditions` (diagnoses) and
`patient_allergies` (safety-critical). The trigger raises rather than recording a null reason for an
`UPDATE`/`DELETE` on either — confirmed safe to enforce immediately because neither had any existing
UPDATE/DELETE call site in `apps/web/src` (`patient_conditions` is new this review; grepping
`patient_allergies` across `apps/web/src` turns up only read-only consumers). Every other table keeps
`reason` optional via the `app.change_reason` session GUC (same idiom as `audit_row_change`'s
existing `app.audit_actor_id` fallback) — mandating it everywhere would have risked breaking live
UPDATE call sites this review did not audit one-by-one. `record_corrections` is itself append-only
(`private.reject_mutation()`, reused from `audit_log`). Verified in `packages/db/tests/record_
corrections_platform_wide.sql` (old/new capture on UPDATE and DELETE, reason capture, the no-op
suppression rule, append-only enforcement, and — the access checks — that an ordinary same-org
clinician who did *not* make the edit can still read it while a *different* organisation's clinician
cannot) and `packages/db/tests/patient_conditions_problem_list.sql` (the mandatory-reason raise).

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

## 2. What this review deliberately did not try to fix

Smaller, genuinely low-risk items **not** built this round simply because of volume, not difficulty,
are worth a short follow-up PR each: the timeline category filter (§1.17, no schema change, just
wire the existing `event_type` enum into `patient-timeline.tsx` and `usePatientTimeline`), a generic
`patient_documents` table (§1.21, mirrors `lab_result_documents` exactly), export audit logging
(§1.24, one shared helper called from ~6 existing routes), lab result trend display (§1.13, a
query over existing rows, no schema change), record reconciliation/discrepancy flagging (§1.22,
sequenced after `patient_documents` since a discrepancy needs two things to compare), a generalized
imaging model (§1.14, mirrors the lab/ECG document pattern), a proper clinical-encounter/consultation-
note model (§1.16, larger — needs its own design pass, not a column tweak), and wiring the new
`app.change_reason` GUC (§1.18) into the highest-stakes call sites so corrections start carrying a
human-readable reason instead of `null`. A unified "My conditions" and "My appointments" page on the
patient dashboard (§1.23) is now unblocked by §1.7's `patient_conditions` table but wasn't built this
round either.

## 3. Founder decisions made this round (previously open questions)

Four questions were raised here as genuine spec-vs-architecture collisions — places the spec implied
a design choice this platform hadn't made yet, or asked for something that looked like it would
contradict a real, dated decision already on record. All four were decided and built (§0, §1.7,
§1.9, §1.10, §1.15, §1.18 above have the details); recorded here for the trail of *why*, not just
*what*:

1. **Problem list shape (§1.7) → new `patient_conditions` table**, with `care_plans` referencing it
   by FK rather than extending `care_plans` in place — avoids a second source of truth for "what
   conditions does this patient have" (the same principle already applied to wearables vs.
   `vitals_readings`), and is the only shape that gives a resolved/historical/suspected condition
   with no active care plan somewhere to live.

2. **Medication Dispensed vs. Received (§1.15) → build the distinct event now**, ahead of any real
   pharmacy partnership, rather than waiting for one to exist. `pharmacy_order_dispenses` and its
   2026-08-03 "no contracted pharmacy" decision are untouched; `medication_receipt_confirmations` is
   additive.

3. **Correction-trail scope (§1.18) → full platform-wide retrofit now**, not phased to a handful of
   fields first. First delivered with a single flat "admin or the record's own patient" read policy
   to avoid reopening the PHI-exposure risk `audit_row_change` was originally designed to avoid —
   then corrected once the live `pg_policies` on the production project showed that policy was
   needlessly narrower than 19 of the 21 tables' real access model, cutting off genuine clinical
   utility for no matching security benefit. The final design (`private.can_read_record_correction()`)
   mirrors each table's actual live policy instead of assuming one bar fits all — see §1.18. Also
   extended to DELETE (not just UPDATE) and given a mandatory reason for the two highest-stakes
   tables (`patient_conditions`, `patient_allergies`) once the audit confirmed neither had an
   existing call site that enforcement could break.

4. **Family/social history (§1.9/§1.10) → promote to dedicated tables**, additive to — not replacing
   — the existing `risk_assessment_responses` onboarding intake, which stays the system of record for
   the fields it already owns (family boolean flags feeding `prevention_risk_scores`; smoking/
   alcohol/diet/etc. feeding the same). The new tables cover exactly the fields that had no home at
   all, and are continuously editable rather than a one-time snapshot.

## 4. Still open

**5. Date of birth / sex / full name — ongoing vs. onboarding-only edit rights (§1.5).** Not part of
the four decisions above; still genuinely open. Today these are freely patient-self-editable via the
same RLS path indefinitely, not just during initial intake, which sits uneasily next to the spec's
"may require verification" framing and against the fact that DOB drives clinical age-based logic.
Leave as-is, or add a rule (app-layer, possibly backed by a trigger once onboarding is complete)
requiring staff involvement or a verification step for a *post-onboarding* change to these three
fields specifically?

## 5. Tests

Every table this review added or changed has a matching verification script in `packages/db/tests/`,
following the codebase's existing pattern (`set_config('request.jwt.claims', ...)` + `set local role
authenticated` to simulate real sessions, wrapped in `BEGIN`/`ROLLBACK` so nothing persists):

- `profiles_self_update_column_guard.sql` — the §1.5 security fix, including the serology-cascade
  regression check.
- `patient_conditions_problem_list.sql` — patient cannot self-write, org staff can, timeline +
  correction-trail wiring, and the mandatory-reason raise.
- `family_and_social_history.sql` — patient self-write allowed, one-row-per-patient enforcement on
  `social_history`, correction capture on both.
- `medication_receipt_confirmations.sql` — the context check constraint, timeline wiring.
- `record_corrections_platform_wide.sql` — old/new capture on UPDATE and DELETE, reason-GUC capture,
  the no-op suppression rule, append-only enforcement, and the access checks: a same-org clinician
  who did not make the edit can still read it (matching care_plans' own live policy), a different
  organisation's clinician cannot.

**Verification method, and its real limit.** No local Supabase/Docker stack was available in the
environment this review ran in, but this session did have live, read-only MCP access to the actual
production project (`koiplnmbgnqnbywhpjlf`) — used to query `pg_policies` and `pg_proc` directly for
every table this migration touches, which is how the §1.18 policy mistake was caught and corrected
(design verified against live reality, not assumed from migration history). **What that access was
NOT used for: actually executing these test scripts against the production database.** Running them
would mean inserting and rolling back fixture rows (synthetic patients, clinicians, corrections) in a
live system serving real patient data — a call for whoever is driving the merge to make deliberately,
not one to make unilaterally from within an architecture review. Treat every test in `packages/db/
tests/` here as reviewed carefully by hand against the live schema and RLS helper functions, not as
having been run — running them for real (`supabase db query "$(cat packages/db/tests/<file>.sql)"
--linked`, ideally against a branch/staging copy rather than production directly) is still worth
doing before merging.
