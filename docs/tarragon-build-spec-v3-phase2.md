# Tarragon Health — Build Specification v3, Phase 2

**For execution by Claude Code. Read `tarragon-build-spec-v3.md` (Phase 1) first — this document extends it and does not repeat it.**

Tarragon Health Ltd · RC 9702108
Companion documents: `tarragon-build-spec-v3.md`, `tarragon-strategy-v3.md`

---

## 0. What Phase 2 is for

Phase 1 built a working clinical loop. Phase 2 does four things, and nothing else:

| # | Objective | Note |
|---|---|---|
| **A** | **Prove the ratio.** Make 1:2,000 real rather than assumed. | Build it; keep every caseload figure in config, not in code (§1.1) |
| **B** | **Prove the outcome.** Build the evidence layer that becomes the sales asset, the funding case and the moat. | Needs 12–18 months of accumulated data — instrument first, analyse later |
| **C** | **Close the supply chain.** Labs and pharmacy integrated end to end, verified molecule provable. | Build the integration surface now; activate per partner as contracts land |
| **D** | **Reach past the smartphone.** Bluetooth, USSD, Nigerian languages. | Each expands addressable market independently of the others |

**Objective B is the company.** Livongo's $18.5bn outcome rested on accumulated clinical evidence proving cost savings to payers, not on the app. Everything else in this document is instrumentation for it.

---

## 1. Build now, gate at go-live

**There are no build gates. Phase 1 and Phase 2 are built in parallel.** Claude Code should never stop Phase 2 work waiting on operational data.

Four conditions are not build sequencing — they govern the moment **real patient data enters production**, and they exist in law and clinical safety rather than in the plan. Implement them as runtime guards in `app_config`, so the code ships complete and production simply refuses to accept live patients until each is satisfied.

| Guard | Condition | Runtime effect while unmet |
|---|---|---|
| **L1** | `who_hearts` v1 approved by the CMO; `v0-provisional` retired | Triage runs, but every classification is forced to `needs_review` and no batch clear is permitted |
| **L2** | NDPC registration complete; DPO appointed and named in `app_config` | Production enrolment endpoint returns a blocked state; synthetic and staging data unaffected |
| **L3** | `app_config.accountability_model` set on written legal advice | No `clinical_notes` row may be signed; drafting still works |
| **L4** | Referral criteria v1 published and resolvable by `referrals.criteria_version` | Referral creation blocked; escalation to voice still available |

Each guard is a single boolean in `app_config` with a `set_by` and `set_at`, flipped deliberately by a named person, written to `audit_log`. **None of them blocks writing code, running tests, or seeding synthetic data.**

### 1.1 One assumption to keep visible

The stable fraction — the proportion of readings the engine clears without a clinician — is still unmeasured, and the ₦1,500–2,500 Control price depends on it. Build the ratio-dependent parts, but **never hard-code the assumption**: caseload size, queue sizing and clinician-per-cohort figures all read from `app_config`, never from a constant. When the real number arrives, it changes a config row rather than a codebase. If it lands below 70%, the volume SKU is repriced or dropped — see `tarragon-strategy-v3.md` §10.

---

## 2. Additional invariants

Extending §3 of Phase 1. Same rule: a failing test per invariant, written first.

| # | Invariant | Enforcement point |
|---|---|---|
| **I11** | No AI-generated content reaches a patient as clinical advice without a `clinical_notes` signature row referencing it. | FK constraint: `ai_drafts.approved_note_id` must be non-null before the draft can be released to a patient channel |
| **I12** | An AI or engine titration proposal is a proposal. No medication row is created, changed or stopped without a clinician signature. | `medications` insert/update trigger requires `prescribed_by`; `titration_proposals` has no write path to `medications` |
| **I13** | Research and partner exports are anonymised by a documented, tested pipeline. The re-identification key never leaves the production database and is never included in any export. | Separate `research` schema; export function has no grant on `patients`; key held in a table with zero grants outside `superadmin` |
| **I14** | A reading originating from a paired device cannot be edited by a patient, and carries device serial and firmware version. | `readings.source = 'patient_device_bt'` → update policy denies patient role |
| **I15** | USSD carries no clinical content, on the same terms as SMS. | `comms_channel` gains `ussd`; the §9.2 check constraints extend to it in the same migration |
| **I16** | Public outcome figures are computed from immutable dated snapshots, never live queries. A published number can always be reproduced. | `outcome_snapshots` is append-only; `apps/public` has no grant on source tables |
| **I17** | A lab result ingested by API must reconcile to an existing `lab_orders` row. Orphan results are quarantined, never auto-attached to a patient. | Ingestion writes to `lab_results_inbox`; promotion requires a matched order |
| **I18** | A medication dispensed on the Control pathway must trace to a licensed partner and a batch number. Unverified batches are blocked, not warned. | `medication_dispenses` check: `verification = 'verified'` required when the enrolment programme is `control` |

---

## 3. Schema additions

Migrations continue the existing numbering. No Phase 1 table is dropped or renamed.

### 3.1 Evidence layer

```sql
create table cohort_definitions (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  description text not null,
  inclusion jsonb not null,      -- declarative filter, versioned
  exclusion jsonb not null default '{}',
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

create table outcome_snapshots (
  id uuid primary key default gen_random_uuid(),
  cohort_code text not null references cohort_definitions(code),
  organisation_id uuid references organisations(id),
  as_of date not null,
  denominator int not null,
  numerator int not null,
  metric text not null,          -- 'bp_control','hba1c_control','screening_completion','engagement'
  method_version text not null,  -- how it was computed
  computed_at timestamptz not null default now(),
  unique (cohort_code, organisation_id, as_of, metric, method_version)
);

create table baseline_measures (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references patients(id) on delete cascade,
  metric text not null,
  value numeric(6,2) not null,
  captured_at timestamptz not null,
  source_reading_id uuid references readings(id),
  unique (patient_id, metric)    -- baseline is set once and never revised
);

create table clinical_events (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references patients(id) on delete cascade,
  event_type text not null,      -- 'admission','er_visit','stroke','mi','amputation','death','none_reported'
  occurred_on date,
  reported_by text not null,     -- 'patient','family','employer','clinician'
  verified boolean not null default false,
  verification_note text,
  recorded_at timestamptz not null default now()
);
```

**`baseline_measures` is unique per patient per metric and never revised.** A baseline that moves is not a baseline. Every outcome claim is `baseline → current`, both reproducible.

**`clinical_events` is the field that eventually sells to an HMO.** Avoided admissions are the number a payer buys. Capture it from month one even though it will be sparse and self-reported at first, with `verified` distinguishing what you can stand behind. Never publish unverified events as outcomes.

### 3.2 Triage v2 — adherence and silence

```sql
create table adherence_signals (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references patients(id) on delete cascade,
  window_start date not null,
  window_end date not null,
  expected_readings int not null,
  actual_readings int not null,
  expected_refills int not null,
  actual_refills int not null,
  notification_open_rate numeric(4,3),
  score numeric(4,3) not null,   -- 0.000–1.000
  trend text not null,           -- 'improving','stable','declining'
  computed_at timestamptz not null default now()
);

create table silence_flags (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references patients(id) on delete cascade,
  raised_at timestamptz not null default now(),
  days_silent int not null,
  last_reading_at timestamptz,
  push_delivery_healthy boolean not null,   -- distinguishes disengagement from channel failure
  resolved_at timestamptz,
  resolution text
);
```

**Silence is a clinical signal, and it is free.** A patient who stops logging is disengaging, and disengagement precedes deterioration. `push_delivery_healthy` is what stops you mistaking a dead notification channel for a disengaged patient — reuse `device_heartbeats` from Phase 1.

Feed `adherence_signals.score` and open `silence_flags` into the exception queue ranking as inputs alongside classification severity. A stable patient going quiet outranks a mildly raised reading from an engaged one.

### 3.3 Protocol titration

```sql
create table titration_proposals (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references patients(id) on delete cascade,
  current_medication_id uuid references medications(id),
  proposed_action text not null,     -- 'start','increase','add_second_agent','no_change','refer'
  proposed_inn text,
  proposed_strength text,
  protocol_config_id uuid not null references protocol_configs(id),
  rule_fired text not null,
  ai_assisted boolean not null default false,
  proposed_at timestamptz not null default now(),
  reviewed_by uuid references clinicians(id),
  reviewed_at timestamptz,
  outcome text,                      -- 'accepted','modified','rejected'
  resulting_note_id uuid references clinical_notes(id)
);
```

**I12 is the whole point of this table.** The engine proposes; a clinician decides. There is no code path from `titration_proposals` to `medications`. A proposal accepted becomes a clinician action that creates the medication row, signed.

Instrument `outcome` obsessively. Acceptance rate is how you know whether the protocol config is right — the same role `clinician_override` plays for classification.

### 3.4 Devices — Bluetooth

```sql
create table device_pairings (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references devices(id) on delete cascade,
  serial_number text not null,
  firmware_version text,
  paired_at timestamptz not null default now(),
  last_sync_at timestamptz,
  unpaired_at timestamptz,
  unique (serial_number) where unpaired_at is null
);

alter table readings add column device_serial text;
alter table readings add column device_firmware text;
```

A device-linked reading is evidence; a typed number is a claim. Where a paired device exists, patient manual entry for that `reading_type` is disabled by default with a documented override path (device failure) that flags the reading `source = 'patient_manual'` and notes the reason.

### 3.5 Lab integration

```sql
create table lab_integrations (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references partners(id),
  mode text not null,                -- 'api' | 'sftp' | 'manual_upload'
  endpoint text,
  credential_ref text,               -- vault reference, never the secret
  result_format text not null,       -- 'hl7v2' | 'fhir_r4' | 'csv' | 'pdf_only'
  active boolean not null default false
);

create table lab_results_inbox (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references partners(id),
  raw_payload jsonb not null,
  received_at timestamptz not null default now(),
  matched_order_id uuid references lab_orders(id),
  quarantined boolean not null default true,
  quarantine_reason text,
  promoted_at timestamptz
);

create table lab_results (
  id uuid primary key default gen_random_uuid(),
  lab_order_id uuid not null references lab_orders(id) on delete cascade,
  patient_id uuid not null references patients(id) on delete cascade,
  analyte text not null,
  value_numeric numeric(10,3),
  value_text text,
  unit text,
  reference_low numeric(10,3),
  reference_high numeric(10,3),
  abnormal_flag text,
  resulted_at timestamptz not null,
  reviewed_by uuid references clinicians(id),
  reviewed_at timestamptz,
  patient_released_at timestamptz
);
```

**I17: everything lands in `lab_results_inbox` quarantined.** Promotion requires a matched `lab_orders` row. An unmatched result is an ops task, never an automatic attachment — attaching one person's results to another person's record is the single worst failure this system can produce.

**Patient release is a separate, explicit step** (`patient_released_at`). An abnormal result reaches the patient with a clinician's plain-language note attached, or it does not reach them yet. The notification is still non-clinical: *"Your result is ready — open the app."*

Prefer FHIR R4 where a partner supports it. Most Nigerian labs will be `pdf_only` at first; build `manual_upload` first and treat API integration as a per-partner project.

### 3.6 Pharmacy and verified supply

```sql
create table medication_batches (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references partners(id),
  inn_name text not null,
  strength text not null,
  batch_number text not null,
  manufacturer text not null,
  nafdac_reg_number text not null,
  expiry_date date not null,
  received_at timestamptz not null default now(),
  verification medication_verification not null default 'unknown',
  verified_by uuid references profiles(id),
  verified_at timestamptz,
  unique (partner_id, batch_number, inn_name, strength)
);

alter table medication_dispenses add column batch_id uuid references medication_batches(id);
```

**I18: on the Control pathway, `verification = 'verified'` is required to dispense.** In a market where NAFDAC estimates falsified medicines at 13–15%, "we know where your tablets came from" is a clinical control and a differentiator, not logistics.

Patient-facing: `My medication` shows verified status and, on tap, the manufacturer, NAFDAC registration and expiry. This is one of the few places where showing the patient more raw detail increases trust rather than confusion.

### 3.7 USSD and language

```sql
alter type comms_channel add value 'ussd';

create table ussd_sessions (
  id uuid primary key default gen_random_uuid(),
  msisdn_e164 text not null,
  patient_id uuid references patients(id),
  session_ref text not null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  path text[] not null default '{}',   -- menu path taken
  readings_captured int not null default 0
);

create table content_strings (
  key text not null,
  locale text not null,               -- 'en-NG','yo-NG','ha-NG','ig-NG','pcm-NG'
  value text not null,
  reviewed_by uuid references profiles(id),
  primary key (key, locale)
);
```

USSD is the only route to the market beyond smartphone owners, and it is how mDoc reaches basic phones. Scope it narrowly: **log a reading, check next appointment, request a callback.** Nothing else. Menu depth of three. I15 applies — no clinical content, ever, on a channel that renders on a shared handset.

**Language is a clinical safety feature, not localisation.** Every string in a patient-facing clinical path requires `reviewed_by` before a locale goes live. A mistranslated dose instruction is a patient safety incident. Ship `en-NG` and `pcm-NG` (Nigerian Pidgin) first — Pidgin has the widest practical reach.

### 3.8 AI coach

```sql
create table ai_drafts (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references patients(id) on delete cascade,
  purpose text not null,             -- 'reply_draft','education','adherence_nudge','summary'
  model text not null,
  prompt_ref text not null,          -- versioned prompt template id, not the raw prompt
  draft_body text not null,
  approved_note_id uuid references clinical_notes(id),
  approved_by uuid references clinicians(id),
  approved_at timestamptz,
  rejected_at timestamptz,
  rejection_reason text,
  created_at timestamptz not null default now()
);
```

**I11: nothing in `ai_drafts` reaches a patient without `approved_note_id`.** Two permitted uses:

1. **Clinician-facing drafting** — draft the reply, the clinician edits and signs. This is the leverage: it shortens review time without moving the decision.
2. **Non-clinical education and nudges** — general, non-personalised content, pre-approved by the CMO as a library, not generated live against a patient's numbers.

**Not permitted:** live generation of personalised clinical advice delivered to a patient. That is diagnosis by algorithm, and it fails the MDCN position Phase 1 encodes at schema level.

Cost control: Haiku for classification assist and nudges, Sonnet for drafting. Prompt caching on the protocol and patient-context prefix. Track spend per patient per month and alert on threshold, the same way WhatsApp cost is tracked.

### 3.9 Research and partner data

```sql
create schema research;

create table research.export_definitions (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  purpose text not null,
  recipient text not null,
  lawful_basis text not null,          -- NDPA basis, documented
  ethics_ref text,
  fields text[] not null,
  k_anonymity_min int not null default 20,
  approved_by uuid references profiles(id),
  approved_at timestamptz
);

create table research.exports (
  id uuid primary key default gen_random_uuid(),
  definition_id uuid not null references research.export_definitions(id),
  row_count int not null,
  generated_at timestamptz not null default now(),
  generated_by uuid references profiles(id),
  checksum text not null
);
```

**I13 governs this entirely.** The export function runs in the `research` schema with no grant on `patients`, `profiles` or any direct identifier. Pseudonymous IDs are salted per export definition so two exports cannot be joined. k-anonymity enforced at generation: any output group below `k_anonymity_min` is suppressed, and the export fails rather than silently dropping rows.

Only patients with an active `consent_records` grant of scope `research_anonymised` are included. Revocation removes them from all future exports; note in the definition that it cannot recall an export already delivered, and say so in the consent language.

Longitudinal chronic-disease data on African patients is one of the genuinely scarce assets in world medicine, and that is precisely why the governance has to be built before the first request arrives. Get it wrong and it is not a compliance problem, it is a legitimacy problem.

---

## 4. Milestones

Each has an exit test. Same rule as Phase 1: do not start the next until the previous passes.

| # | Milestone | Exit test |
|---|---|---|
| **P1** | Evidence layer: `baseline_measures`, `cohort_definitions`, `outcome_snapshots`, `clinical_events`; nightly snapshot job; public dashboard reads snapshots only | A published control rate from 60 days ago is reproduced exactly from the snapshot table; I16 passes |
| **P2** | Triage v2: `who_hearts` v1 live, `adherence_signals`, `silence_flags`, queue ranking rebuilt | Silence flag raised for a disengaged patient and **not** raised for one with unhealthy push delivery |
| **P3** | `titration_proposals`, clinician accept/modify/reject flow, acceptance-rate dashboard | I12 passes: no path creates a `medications` row without a clinician signature |
| **P4** | Lab integration: `manual_upload` first, then per-partner API; inbox quarantine and promotion | I17 passes: an unmatched result quarantines and never attaches |
| **P5** | Pharmacy: `medication_batches`, verified-supply gate, patient-visible provenance | I18 passes: unverified batch blocked on a `control` enrolment |
| **P6** | Bluetooth pairing, device-linked readings, manual-entry lockout with documented override | I14 passes: patient cannot edit a paired-device reading |
| **P7** | USSD (three-item menu) + `en-NG` and `pcm-NG` locales with clinical review gate | I15 passes; no unreviewed string renders in a clinical path |
| **P8** | AI coach: clinician drafting assist, pre-approved education library, cost telemetry | I11 passes: no draft reaches a patient without an approved note |

**P1 first, deliberately.** Evidence needs calendar time more than engineering time — every month it is not instrumented is a month of outcome data you cannot recover. Everything else can be built later; this cannot be backfilled.

Institutional and HMO integration work sits alongside P1 and P4 and is contract-shaped, not milestone-shaped: build to the specific integration a signed partner requires, never speculatively.

---

## 5. Still out of scope

Phase 1 §19 remains binding in full. Additionally, and specifically:

- Insurance, claims adjudication, capitation, or any per-member-per-month risk transfer — unchanged, permanent
- Family or household plans — permanent
- Owned clinics, kiosks or screening hardware — permanent
- Screening outside age- and sex-appropriate guideline recommendations — permanent
- Conditions beyond the cardiometabolic cluster (hypertension, type 2 diabetes, obesity)
- Live AI-generated personalised clinical advice to patients
- UK or any non-Nigerian market launch
- Wearables and continuous glucose monitoring
- Telemedicine video consultation as a product line
- Any data export or partnership that has not passed §3.9 governance

---

## 6. Decisions still open

Stop and ask before implementing:

1. **Second SKU depth vs second condition.** Recommendation: deepen cardiometabolic control before adding a condition. Three companies converged on this cluster; the risk was never the condition list.
2. **Evidence layer's first buyer** — HMO procurement, a research funder, or a state programme. This shapes `cohort_definitions` and which metrics the snapshot job computes first. Recommendation: HMO, because avoided admissions is the number that converts and the same data serves the other two.
3. **Lab integration order** — which partner first, and whether to fund their API work. Most will be `pdf_only`.
4. **USSD aggregator** — shortcode acquisition is slow in Nigeria; start the process at P1, not P7.
5. **Bluetooth device SKU** — which validated cuff, sourced through which NAFDAC-registered distributor.
6. **Whether `clinical_events` self-report is sufficient** for a first HMO conversation, or whether verification via employer HR records is required. Affects consent scope wording.

---

*Regulatory positions require confirmation by Nigerian counsel. NDPA 2023 obligations around research exports and cross-border transfer are the highest-risk area in this phase and should be reviewed before P1 ships, not before P8.*
