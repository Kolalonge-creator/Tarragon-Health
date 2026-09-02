# Remote Patient Monitoring Engine — Design Spec & Gap Analysis

> **Status: design/reconciliation doc, not a build order.** This reconciles an incoming "Remote
> Patient Monitoring Engine" spec (§54.1–54.17 below) against what actually exists in the codebase,
> and proposes a phased path. It does not itself authorise building the guardrailed pieces — see §3.
> Subordinate to `CLAUDE.md`, which remains authoritative on scope-gating language if the two ever
> conflict.

## 0. What this document is

A "Remote Patient Monitoring Engine" spec (§54.1–54.17, reproduced in full in §6) was handed in
describing the clinical layer that turns home/device measurements into active care: programme
structure, a hypertension and a diabetes worked example, a triaged clinician queue, alert
prioritisation and deduplication, an acknowledgement lifecycle, clinician and patient escalation, a
multi-role RPM care team, task management, documentation, treatment adjustment, outcomes tracking,
and programme completion. It frames itself explicitly as sitting on top of three prior modules —
"Module 51 collects measurements. Module 52 connects devices. Module 53 handles wearables."

Two things needed to happen before this could turn into a build plan: (1) find out what of it
already exists, and (2) check what's left against this codebase's standing rules on touching
clinical-safety code and on building ahead of an explicit ask. Both are done below, and the answer to
(1) is the load-bearing finding of this document — see §1.

## 1. How this fits, and the finding that changes the plan

Module 54's numbered modules 51–53 map cleanly onto real, shipped infrastructure already documented
in `CLAUDE.md`'s "Device & Wearable Integration" section: clinical Bluetooth device pairing
(`patient_devices`, `vitals_readings.source = 'device'`) and consumer wearable sync
(`wearable_connections`/`wearable_readings`, Apple HealthKit/Android Health Connect bridges) are both
live, un-gated, and already write into the same `vitals_readings` table patients use for manual
entry — exactly the "no dual source of truth" model `CLAUDE.md` mandates. Module 54's own
groundwork question — "is there data to build a clinical layer on top of" — is settled: yes.

**The load-bearing finding:** a large fraction of Module 54 itself — specifically §54.5–§54.10
(the clinician queue, alert prioritisation, deduplication, acknowledgement lifecycle, clinician
escalation chain, and patient emergency escalation) — was **already built two days before this
document**, under the name "Alert System" (migrations dated 2026-08-28, six files starting
`20260828013011_alert_system_taxonomy_and_governance.sql` through
`20260828020801_alert_analytics_rpcs.sql`, merged to `main-dev`). That build is real, live,
tested-in-migration (every migration ends in a `DO` block of assertions), and already wired into the
clinician-facing worklist UI. It was not yet logged in `docs/CLAUDE_SPRINT_HISTORY_ARCHIVE.md` at the
time of writing (the archive's last entries predate it), which is almost certainly *why* this
Module 54 spec reads as if none of it exists yet — the spec and the shipped code are close enough in
wording (see the migration's own section references: "8.2 severity model", "8.3" lifecycle,
"8.4 ownership", "8.7 dedup", "8.8" queue wireframe, "8.11" ack-timeout) that they most likely
trace back to the same or a closely related upstream numbering, just handed to two different
sessions two days apart without either one being told about the other.

**The framing risk this creates:** treating §54.5–§54.10 as unbuilt and re-implementing a second
alert/queue/escalation pipeline would directly violate this project's own explicit reuse principle
(`CLAUDE.md`: "no dual source of truth", "reuse `patient_risk_scores`/`care_plans`... rather than
rebuilding") and would fragment the clinician's single worklist inbox into two competing systems on
day one. The reconciliation that avoids that: **treat the shipped Alert System as Module 54's
alert/queue/escalation layer, in full**, and scope Module 54's genuine remaining work to what it
does not yet cover — an explicit RPM *programme* concept (§54.2, §54.16), a multi-role RPM care team
(§54.11), trend/persistence/baseline-aware severity inputs (part of §54.6), a documented link from
alert → treatment change (§54.14), and an outcomes rollup (§54.15). Those are real gaps; see §2 for
the full accounting and §4 for what to build.

## 2. Section-by-section reconciliation

Legend: 🟢 built and working · 🟡 partially built / schema-only · 🔴 not built · ⚠️ guardrail-adjacent

### 54.2 RPM programme structure — 🔴
The chain *Programme → Eligible population → Measurements → Frequency → Clinical thresholds →
Escalation → Review → Outcome* has no single owning entity today. `care_plans`
(`20260705211129_chronic_disease.sql`) carries `condition`, `status`, `target_ranges jsonb`, and
`assigned_nurse_id` — close in spirit but has no eligibility criteria, no measurement-type/frequency
schedule, and no link to a governed threshold config (thresholds today live inside per-vital-type
trigger functions and `alert_rules`, not per-programme). **This is the core net-new piece** — see
§4 Phase 1.

### 54.3 Example: hypertension — 🟡
*Patient enrolled → BP monitor assigned → 7-day readings → Data received → Trend analysed →
Clinician review → Treatment decision → Repeat monitoring.* BP monitor assignment (`patient_devices`),
data receipt (`vitals_readings`, `source in ('device','manual','wearable')`), and clinician review
(the worklist, `clinician/patients/monitoring/page.tsx`) are all real. **"Trend analysed" is not** —
`private.handle_bp_reading_red_flag()` (`20260720015223_bp_red_flag_engine.sql`) classifies each
reading independently against EMERGENCY/RED/AMBER/GREEN bands; it does not look at the patient's
prior 7 days of readings as a set. "Treatment decision → repeat monitoring" as a closed loop with a
new schedule is not modelled anywhere (see §54.14).

### 54.4 Example: diabetes — 🟡
*Monitoring → Glucose → Weight → Symptoms → Adherence → Clinical review.* Glucose and weight both
land in `vitals_readings` (`vital_type in ('glucose','weight')`); a diabetes-specific glucose safety
engine exists (`20260720120000_diabetes_glucose_safety.sql`); adherence has its own ladder
(`medication_adherence_alerts`, bridged into `clinician_alerts` as `adherence_problem` by
`20260828015618_alert_generators_previously_uncovered_types.sql`). **"Symptoms" has no structured,
longitudinal log** — confirmed no `symptom_logs`/`patient_symptoms` table exists; symptom data today
is one-off (a danger-symptom check feeding `emergency_events`, `20260716224736_emergency_escalation.sql`),
not a trend input alongside glucose/weight/adherence.

### 54.5 RPM clinician queue — 🟢, exact match
*URGENT n / HIGH n / ROUTINE n.* `apps/web/src/app/(dashboard)/clinician/worklist.tsx:33-38` —
`severityBucket()` (`apps/web/src/lib/queries/clinician-alerts.ts`) buckets every open
`clinician_alerts` row by `severity` into exactly these three labels, rendered as a 3-tile count
summary with SLA countdowns and acknowledge/snooze/resolve/escalate actions per row. Nothing to add.

### 54.6 Alert prioritisation — 🟡
*Severity, persistence, trend, symptoms, clinical context, previous baseline.* **Severity** is 🟢:
deterministic, derived from `level`/threshold bands, never client-settable
(`private.classify_and_assign_clinician_alert()`, `20260828014055…sql`). **Persistence, trend, and
previous-baseline deviation are 🔴** — confirmed: no existing generator looks at more than the single
triggering reading. **Symptoms** are 🟡 — a `symptom_escalation` type_code exists and routes
correctly, but symptom co-occurrence isn't fused into a vitals reading's own severity (e.g. an
elevated-but-not-red-flag BP reading with a reported headache is scored identically to one without).
**Clinical context** is 🟡 — `category`/`type_code` taxonomy plus `alert_rules`' per-type
`owner_tier`/`ack_timeout_minutes` is real governed context, but nothing yet accounts for
patient-specific context (comorbidities, current medication changes). This is the genuine,
scoped-buildable gap in §54's alert half — see §4 Phase 2.

### 54.7 Alert deduplication — 🟢, matches the intent, differs in shape
*Five abnormal readings in an hour → one episode, not five alerts.* `dedup_key` (`type_code:patient_id`)
+ `duplicate_of`, computed in the same BEFORE INSERT trigger, links same-type/same-patient alerts
within a rolling 24h window; **suppression** (hiding the duplicate from active counts, vs. just
linking it) only fires when `alert_rules.config[].auto_suppress_duplicates` is true for that type —
a duplicate is always still inserted and visible unless a governed policy says otherwise (never a
silent drop). One real difference from the spec's "group into one episode": this is a flat,
same-type-code dedup, not a true clinical-episode model that could group *different* but related
type_codes (e.g. `abnormal_monitoring` + `symptom_escalation` on the same patient within an hour)
into one episode. Worth noting as a future refinement, not urgent — see §5.

### 54.8 Alert acknowledgement lifecycle — 🟢, near-verbatim match
*Created → Assigned → Acknowledged → Reviewed → Actioned → Closed.* The 2026-08-28 migration's own
header describes its lifecycle as "Generated/Assigned/Delivered/Actioned... as timestamps... /
Acknowledged/Resolved/Closed as status values" — the same six-stage shape, different label for two
stages (Reviewed≈Delivered, Actioned carries through to Resolved). Concretely: `created_at` (Created),
`responsible_clinician_id`/`assigned_at` auto-populated at insert from the governed `owner_tier`
(Assigned), `status='acknowledged'` (Acknowledged, self-assigns an owner if none existed),
`resolution_action`/`resolution_outcome` — **required by a CHECK constraint** for any resolved/closed
alert of severity ≥ 2 (Reviewed/Actioned), `status='closed'` + `closed_by`/`closed_at` (Closed, a
distinct later step from Resolved). Deletion of an unresolved severity≥2 alert is blocked outright
(`private.guard_clinician_alert_deletion()`). Nothing to add.

### 54.9 Escalation (clinician → backup → clinical lead) — 🟢
Two independent, complementary mechanisms cover this: an **ack-timeout ladder**
(`20260828015134_clinician_alert_ack_timeout_escalation_ladder.sql`, hop 1 at 1×`ack_timeout_minutes`
→ `backup_clinician_id`, hop 2 at 2× → senior tier or Clinical Director, hop 3 at 3× → every platform
admin, all deduped and audit-logged, cron every 10 min), and a separate **resolution-SLA breach
sweep** on `sla_due_at`. "The exact escalation should be programme-specific" is already true in
effect — every knob (`ack_timeout_minutes`, `owner_tier`, `backup_tier`, `senior_tier`) is per
`alert_type_code` in `alert_rules`, so a future RPM-specific type_code gets its own escalation
timing for free, no new mechanism needed.

### 54.10 Patient escalation (measurement → emergency criteria → urgent care, no human required) — 🟢
`emergency_events` (`20260716224736_emergency_escalation.sql`): danger-symptom self-report, BP-crisis
band, and AI-coach sources all route here; acknowledge-gated (10 min) auto-notify of the patient's
consented emergency contact, a 2-hour SLA alert to staff, and a 2-day follow-up-after-discharge nudge
— all cron-scheduled, none of it dependent on a clinician being at a screen. Matches "the system
should not rely on someone sitting at a computer waiting for an alert" exactly.

### 54.11 RPM care team (doctor/nurse/pharmacist/coordinator/specialist) — 🔴
`care_team_assignment` (`20260712201000_care_team_assignment.sql`) is **one row per patient**,
upserted on reassignment, with exactly three slots: `clinician_id`, `clinical_director_id`,
`care_coordinator_id` (the last added later, `20260723010024_care_team_coordinator.sql`). There is
no pharmacist or specialist slot, and no per-programme variation — a patient enrolled in two RPM
programmes would need the same three people covering both. **This is a genuine, well-scoped gap** —
see §4 Phase 1. Note `care_team_assignment` itself is not being proposed for replacement: it powers
the patient-facing "Your Care Team" trust card (`docs/CLINICAL_TRUST_MODEL_SPEC.md` §2/§4) and stays
exactly as-is; the RPM care team is additive, scoped to programme enrolment.

### 54.12 RPM task management — 🟡, reuse candidate exists
*Patient X → finding → Task: review within 24h → Owner: Nurse Y.* Two existing task tables already
do this shape: `care_outreach_tasks` (general staff tasks — `trigger_type`, `priority`, `assigned_to`,
`outcome_note`) and `alert_follow_up_tasks` (snooze-driven, created automatically when a clinician
snoozes an alert with a reason, `20260828020247…sql`). For an alert-originated finding, the alert
lifecycle itself already carries "review within N hours" (`ack_timeout_minutes`) and "Owner"
(`responsible_clinician_id`) — a third parallel task table would duplicate that. Recommendation:
**do not build a new RPM task table**; an RPM programme's task needs should route through
`clinician_alerts` (if it's a finding needing clinical judgement) or `care_outreach_tasks` (if it's
pure logistics, per the Care Coordinator's non-clinical scope in `CLAUDE.md`'s Clinical Tier Ladder).

### 54.13 RPM documentation — 🟡
*Interpretation, decision, communication, treatment change, follow-up.* `resolution_action` +
`resolution_outcome` on `clinician_alerts` capture interpretation and decision at the alert level
(required for severity ≥ 2). `clinical_encounter_notes` (SOAP-style, draft→finalized, built
2026-08-27 per `docs/CLINICAL_NETWORK_SPEC.md` §4.10) is the fuller clinical-documentation surface
already wired into `patient_timeline` and is the better reuse target for a genuine RPM review note,
rather than inventing an RPM-specific documentation table. "Communication" and "treatment change" as
distinct structured fields (vs. free text inside `resolution_action`/an encounter note) don't exist
yet — a real but small gap, see §4 Phase 1's `treatment_adjustments` proposal.

### 54.14 Treatment adjustment — 🟡
*RPM finding → Clinical review → Medication adjustment → Updated care plan → New monitoring schedule.*
`medication_reviews` (`20260716172000_medication_review_engine.sql`) already rolls forward
automatically per `care_plan_id` on a condition-specific cadence, and `care_plans` carries
`target_ranges`. What's missing is the **causal link backwards**: no column anywhere records that a
given medication/care-plan change was *caused by* a specific `clinician_alerts` row. Without it, "RPM
finding → treatment change" is real in practice (a clinician who resolves an alert can separately go
adjust a prescription) but not provable or queryable after the fact. This is the smallest, most
concrete gap in the whole spec — a single nullable FK, see §4 Phase 1.

### 54.15 RPM outcomes — 🟡
*Baseline, intervention, subsequent measurements, control, adherence, escalation, hospitalisation.*
`patient_risk_scores` (generic `score_type`/`risk_level`/`inputs jsonb`) is the established reuse
pattern for exactly this kind of longitudinal tracking (`CLAUDE.md` cites it for the Annual Health
Review). Adherence and escalation counts are already queryable
(`medication_adherence_alerts`, `public.analytics_alert_burden()`/`analytics_alert_quality()`,
`public.analytics_escalation_quality()`). **Hospitalisation has no field anywhere in the schema** —
confirmed, no table or column tracks it — this needs a founder decision on data source before it can
be built (see §5). No unified "programme outcome" view exists yet that stitches baseline vs. current
vs. control-achieved into one row per enrolment.

### 54.16 Programme completion — 🔴
*Monitoring goal achieved → Clinical review → RPM completed → Routine monitoring.* Depends entirely
on §54.2's programme entity existing first — there is no state machine to complete because there is
no programme to be enrolled in. Falls out naturally once `rpm_programme_enrolments` exists (§4
Phase 1): `status` transitions to `completed`, stamped by a clinician, with the patient's care plan
continuing under `care_plans` as before (routine monitoring was never a separate system).

### 54.17 Acceptance criteria — restated against the above
*Continuous data → clinically meaningful signal → accountable review → intervention → measurable
outcome.* "Continuous data" (🟢, Modules 51–53) and "accountable review → intervention" (🟢, the
Alert System's lifecycle + escalation ladder) are both strong today. "Clinically meaningful signal"
is 🟡 — the deterministic threshold-band signal is real, but the trend/persistence/baseline layer
§54.6 asks for isn't built. "Measurable outcome" is 🟡 for the reasons in §54.15. The two genuinely
unbuilt links in the acceptance chain are the **programme wrapper** (§54.2/§54.16) and the
**outcomes rollup** (§54.15) — everything else in the chain already has a real, working piece under
it, even if not badged "RPM."

## 3. Guardrails — read before building any of this

`CLAUDE.md` does not name "Remote Patient Monitoring" among its explicit Phase 2/3 gated items, so
nothing here is blocked outright the way the referral-matching engine or Employer/HMO dashboards are.
That said, several standing rules bear directly on what should and shouldn't be built without a
further explicit ask:

- **Do not touch the 9 live clinical-safety trigger functions** that insert into `clinician_alerts`
  (`private.handle_abnormal_screening_result`, `private.handle_bp_reading_red_flag`,
  `private.handle_emergency_event`, the SpO2/temperature/diabetes-glucose red-flag engines, etc.).
  The 2026-08-28 taxonomy migration made this an explicit, deliberate design choice — "editing 9+
  live clinical-safety trigger functions this migration's author has not read in full would be a
  materially riskier change than this feature needs" — and built a single new BEFORE INSERT trigger
  instead that classifies every row uniformly regardless of which function created it. Any
  trend/persistence/baseline severity work (§4 Phase 2) must follow that same pattern: a new,
  additive generator calling the existing `private.raise_clinician_alert()` helper
  (`20260828015618…sql`), never a rewrite of an existing red-flag engine.
- **`alert_rules` v1 is active-but-unsigned.** Any new RPM-specific `alert_type_code` values or
  config entries go through the same governed, versioned-jsonb-ledger pattern
  (`public.sign_alert_rules()`, Clinical-Director-gated) that the rest of the taxonomy uses — never
  a code-only bypass of that governance layer.
- **A severity-scoring change is a clinical-safety change**, not a schema change, even when it's
  "just" adding a trend factor. `CLAUDE.md` treats `private.is_org_staff()`-class functions as
  platform-wide risk precisely because a single wrong classification is a PHI/safety issue, not a
  local bug — the same caution applies to anything that changes which patients get flagged urgent.
  Recommend the same review-then-build split this repo already uses elsewhere (schema first, get
  it live and inert; algorithmic/classification logic reviewed separately before it goes live) —
  see §4's phase split.
- **`care_team_assignment` is load-bearing for patient-facing trust copy**
  (`docs/CLINICAL_TRUST_MODEL_SPEC.md` §2/§4, the "Your Care Team" card). The proposed RPM care team
  (§54.11) must stay additive and scoped to programme enrolment — do not modify
  `care_team_assignment`'s shape or its patient-facing surface as part of this work.
- **Never re-split the account role** (`profiles.role`) to represent RPM-specific staff types
  (nurse/pharmacist/specialist) — per `CLAUDE.md`'s standing rule, every clinical role stays
  `clinician` (or `care_coordinator`), and any RPM-team-member "role in this programme" (doctor,
  nurse, pharmacist, coordinator, specialist) belongs on the *join* table proposed in §4, not on
  `profiles`.

## 4. Proposed phasing

### Phase 1 — additive schema only, no behaviour change to any existing path
Safe to build without a further explicit ask, on the same bar this repo applies elsewhere to
purely-structural, zero-blast-radius additions:

- **`rpm_programmes`** — `organisation_id`, `condition` (reuse `care_plan_condition` enum), `name`,
  `eligibility_criteria jsonb`, `measurement_types public.vital_type[]`, `measurement_frequency`
  (e.g. an interval or a cadence descriptor), `status` (`draft`/`active`/`retired`). Deliberately
  does not duplicate `alert_rules`' threshold governance — a programme *references* the relevant
  `alert_type_code`(s) it cares about rather than carrying its own copy of clinical thresholds.
- **`rpm_programme_enrolments`** — `programme_id`, `patient_id`, `care_plan_id` FK (an enrolment
  rides on the patient's existing `care_plans` row, never a parallel one), `enrolled_at`, `status`
  (`active`/`completed`/`discontinued`), `baseline_snapshot jsonb` (captured at enrolment, feeds
  §54.15's outcomes comparison), `completed_at`, `completed_by → clinical_staff`.
- **`rpm_care_team_members`** — `enrolment_id`, `clinical_staff_id`, `role_in_programme`
  (`doctor`/`nurse`/`pharmacist`/`care_coordinator`/`specialist`), `assigned_at`. Additive,
  many-to-many, sits alongside `care_team_assignment` rather than replacing it (§3).
- **`treatment_adjustments`** — the §54.14 causal link: `originating_alert_id → clinician_alerts`,
  `patient_id`, `decision text`, `medication_id`/`care_plan_id` (whichever changed, nullable),
  `new_monitoring_note`, `decided_by → clinical_staff`, `decided_at`. Small, low-risk, and closes
  the single most concrete gap found in §2.

None of the above touches an existing table's columns, RLS policy, or trigger — every new table
gets its own `organisation_id` + RLS following the codebase's standard `private.is_org_staff()`
pattern, per `CLAUDE.md`'s non-negotiable rule.

### Phase 2 — needs a real clinical review before shipping, not just a code review
- **Trend/persistence/baseline-deviation severity input** (§54.6): a new, additive generator (per
  the §3 guardrail) that looks at a patient's last N `vitals_readings` of a given `vital_type`,
  computes a trend/persistence signal, and — only when it crosses a governed threshold — raises a
  `deterioration`-category `clinician_alerts` row via `private.raise_clinician_alert()`. This
  changes which patients get flagged; it should not ship without the same sign-off posture
  `alert_rules` already uses for its thresholds.
- **RPM outcomes rollup** — either a `patient_risk_scores` entry per enrolment (reusing the existing
  generic pattern) or a dedicated `analytics_rpm_outcomes()` RPC mirroring
  `analytics_escalation_quality()`'s shape. Hospitalisation tracking specifically needs a founder
  decision on data source first (see §5) — there is nothing to roll up yet.

### Phase 3 — build only on explicit ask
- A programme-specific clinician queue/dashboard view — a **filtered view of the existing worklist**
  by `rpm_programmes`/`rpm_programme_enrolments`, never a second, parallel queue.
- Programme-completion UI (the `rpm_programme_enrolments.status → completed` transition and its
  patient-facing "graduated to routine monitoring" messaging).
- A dedicated RPM documentation surface, only if `clinical_encounter_notes` proves insufficient in
  practice — untested assumption, don't build ahead of that finding.

## 5. Open questions for the founder

- **Is "RPM" meant as a literal, billable service line** (the US/Medicare-style time-based CPT
  99453/99454/99457/99458 billing construct the term usually implies) **or as an internal label for
  chronic-disease monitoring as it already exists** on this Nigeria-first platform? This changes
  whether §4's `rpm_programmes` needs any billing/time-tracking fields at all — nothing in the spec
  as handed over mentions billing, but the term itself carries that baggage elsewhere.
- Should enrolment in an `rpm_programmes` row be plan-tier-gated (mirroring the existing
  `vitals_red_flag_doctor_escalation` paid-plan feature flag), or open to every patient with a
  matching `care_plans` condition regardless of plan?
- Hospitalisation outcome tracking (§54.15) has no data source today — is this meant to be
  patient/family self-reported, sourced from an HMO claims feed, or something else? Worth settling
  before Phase 2's outcomes rollup is designed in detail.
- Should the flat type+patient alert dedup (§54.7) be extended toward a true cross-type clinical
  "episode" model, or is the current shape (visible duplicate linkage + governed suppression)
  sufficient for RPM's needs? No evidence yet that the current shape is causing real alert fatigue —
  recommend leaving as-is until it demonstrably isn't.

## 6. Original spec, for reference

> 54.1 Purpose
> This is the clinical layer that converts home/device data into active care.
> Module 51 collects measurements.
> Module 52 connects devices.
> Module 53 handles wearables.
> Module 54 decides how those data participate in clinical care.
>
> 54.2 RPM programme structure
> Each programme should define:
> Programme → Eligible population → Measurements → Frequency → Clinical thresholds → Escalation →
> Review → Outcome
>
> 54.3 Example: hypertension
> Patient enrolled → BP monitor assigned → 7-day readings → Data received → Trend analysed →
> Clinician review → Treatment decision → Repeat monitoring
>
> 54.4 Example: diabetes
> Potentially: Monitoring → Glucose → Weight → Symptoms → Adherence → Clinical review
> The exact measurements depend on the clinical programme.
>
> 54.5 RPM clinician queue
> Clinician sees patients requiring attention: URGENT 3 patients / HIGH 11 patients /
> ROUTINE 42 patients
>
> 54.6 Alert prioritisation
> Do not generate an alert for every abnormal number. The system should consider: severity,
> persistence, trend, symptoms, clinical context, previous baseline.
>
> 54.7 Alert deduplication
> If five abnormal BP readings arrive in one hour: do not create five separate clinician alerts.
> Group them into one episode where appropriate.
>
> 54.8 Alert acknowledgement
> Every clinically significant alert should have: Created → Assigned → Acknowledged → Reviewed →
> Actioned → Closed
>
> 54.9 Escalation
> If clinician doesn't respond within the configured timeframe: Clinician → Backup clinician →
> Clinical lead. The exact escalation should be programme-specific.
>
> 54.10 Patient escalation
> If a measurement meets emergency criteria: Measurement → Emergency criteria → Patient instructed
> to seek urgent/emergency care → Appropriate emergency pathway. The system should not rely on
> someone sitting at a computer waiting for an alert.
>
> 54.11 RPM care team
> A programme can assign: doctor, nurse, pharmacist, care coordinator, specialist — according to
> programme design.
>
> 54.12 RPM task management
> Example: Patient X → Abnormal BP trend / Task: Review within 24 hours / Owner: Nurse Y
>
> 54.13 RPM documentation
> Clinician records: interpretation, decision, communication, treatment change, follow-up.
>
> 54.14 Treatment adjustment
> If treatment changes: RPM finding → Clinical review → Medication adjustment → Updated care plan
> → New monitoring schedule. This connects directly to the medication and care-plan modules.
>
> 54.15 RPM outcomes
> Track: baseline, intervention, subsequent measurements, control, adherence, escalation,
> hospitalisation where available.
>
> 54.16 Programme completion
> Monitoring goal achieved → Clinical review → RPM completed → Routine monitoring
>
> 54.17 Acceptance criteria
> RPM should create: continuous data → clinically meaningful signal → accountable review →
> intervention → measurable outcome.
