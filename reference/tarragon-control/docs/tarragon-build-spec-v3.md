# Tarragon Health — Build Specification v3

**For execution by Claude Code. Read this document fully before writing any code.**

Tarragon Health Ltd · RC 9702108 · Target launch 31 December 2026
Supersedes Build Specification v2. Companion document: `tarragon-strategy-v3.md`.

---

## 0. Instructions to the implementing agent

1. **Do not infer product decisions from prose.** If something is not specified here, stop and ask. Do not build features mentioned in the strategy document that are absent from this spec.
2. **Section 3 (Invariants) overrides everything else.** If any instruction later in this document appears to conflict with an invariant, the invariant wins and you should flag the conflict.
3. **Build in the milestone order in Section 20.** Each milestone has an exit test. Do not begin a milestone until the previous one passes its test.
4. **Every invariant in Section 3 must have a failing test written before the code that satisfies it.** These are not stylistic rules; several of them are the legal position of the company expressed as code.
5. **Section 19 is the out-of-scope list. Treat it as binding.** Adding anything on that list is a defect, not an improvement.
6. Write migrations, never manual schema edits. Every schema change is a numbered migration file.
7. All money is stored as integer minor units (kobo) with an explicit currency column. Never floats.
8. All timestamps are `timestamptz`, stored UTC, displayed in `Africa/Lagos` by default.

---

## 1. What is being built

A cardiometabolic detection-and-control platform for Nigeria. The clinical loop:

> **Measure repeatedly → classify by protocol → deliver a verified generic → prove the outcome.**

Three surfaces, one record:

| Surface | Users | Client |
|---|---|---|
| Patient app | Enrolled patients | Expo / React Native (iOS + Android) |
| Clinician workspace | Doctors, nurses, coordinators | Next.js web |
| Institution portal | Employer / HMO administrators | Next.js web (same app, separate role) |

Plus a **public outcomes dashboard** (Next.js, unauthenticated) and a **screening-day capture tool** (Expo, offline-first, operated by field staff).

### 1.1 The two commercial products

| SKU | `programmes.code` | Description |
|---|---|---|
| Control | `control` | Protocol-only. Sold per covered life to organisations. Engine-first: triage clears the stable majority, coordinators chase non-response, clinicians handle exceptions only. |
| Concierge | `concierge` | Human-heavy. Assigned coordinator, proactive contact, faster SLAs, logistics, structured reports to a consenting funder. |

Both are the same clinical protocol. They differ in service level and price, never in standard of care.

### 1.2 Enrolment model

- **Individual enrolment only.** No family plans, no household pricing, no per-family discount.
- Under-18s enrol as **dependants** on an adult account (`patients.guardian_patient_id`).
- Any third party may fund any patient via the **Health Wallet**. Funding grants **no** access to the clinical record; access requires separate explicit consent from the patient.

---

## 2. Stack and repository

### 2.1 Confirmed stack

| Layer | Choice |
|---|---|
| Monorepo | Turborepo + pnpm (existing) |
| Database / auth / storage | Supabase (Postgres 15+, RLS, Auth, Storage, Edge Functions) |
| Patient client | Expo SDK (latest stable), React Native, TypeScript |
| Web clients | Next.js App Router, TypeScript, React Server Components where sensible |
| Styling | Tailwind (web), NativeWind (Expo) |
| Push | Expo Push Notification service |
| WhatsApp | Meta WhatsApp Cloud API — **WABA must be registered in Nigeria** (see §9.6) |
| SMS | Nigeria-domiciled provider (Termii or Africa's Talking) behind an adapter interface |
| Voice | Masked-number provider behind an adapter interface — vendor decision deferred, interface is not |
| Email | Resend, with separate transactional and marketing subdomains |
| Payments (NGN) | Paystack |
| Payments (international cards) | Stripe |
| AI triage assist | Anthropic API — Haiku for first-pass classification assist, Sonnet for draft note generation |
| Error monitoring | Sentry |

**Every external vendor sits behind an adapter interface in `packages/integrations`.** No vendor SDK may be imported directly by application code. This is non-negotiable: the WhatsApp downgrade (§9) exists precisely because a vendor changed its pricing model, and the same will happen again.

### 2.2 Repository layout

```
tarragon/
├── apps/
│   ├── patient/            # Expo — patient app
│   ├── screening/          # Expo — offline-first screening day capture
│   ├── console/            # Next.js — clinician workspace + institution portal
│   ├── public/             # Next.js — public outcomes dashboard
│   └── marketing/          # existing marketing site
├── packages/
│   ├── db/                 # migrations, generated types, seed
│   ├── protocol/           # versioned clinical rulesets (WHO HEARTS)
│   ├── triage/             # classification engine (pure functions)
│   ├── notifications/      # rail router, template registry, enforcement
│   ├── integrations/       # vendor adapters (whatsapp, sms, voice, email, pay)
│   ├── shared/             # types, zod schemas, constants, enums
│   └── ui/                 # shared primitives
└── supabase/
    ├── migrations/
    └── functions/          # Edge Functions
```

### 2.3 Environments

`local` → `staging` → `production`. Separate Supabase projects. **No production data ever enters staging.** Seed staging with generated synthetic patients (`packages/db/seed`).

---

## 3. Invariants

These are the rules the system exists to enforce. Each requires an automated test that fails before implementation.

| # | Invariant | Enforcement point |
|---|---|---|
| **I1** | No clinical content leaves the app. A template with `content_class = 'clinical'` cannot be dispatched to `whatsapp`, `sms` or `email`. | `packages/notifications` send function throws; also a Postgres `CHECK` constraint on `notification_sends` |
| **I2** | Every reading produces exactly one classification row, including stable ones. | DB trigger on `readings` insert; test asserts `count(readings) == count(triage_classifications)` |
| **I3** | Every reading carries provenance. `source` and `source_detail` are `NOT NULL`. | Schema constraint |
| **I4** | Consent is checked at query time, never at account creation. Every cross-account read joins `consent_records` and filters on an active, unrevoked, unexpired grant. | RLS policy; test attempts cross-account read after revocation |
| **I5** | Any classification of `urgent` or `emergency` cannot be closed by a text-only note. Closure requires a linked `clinical_contacts` row of type `voice` or `synchronous_in_app`. | DB constraint + application guard |
| **I6** | Escalation counts per clinician are never exposed to any query, view or export reachable by compensation logic. The saved audit query targets the **lowest**-escalating clinicians. | Dedicated Postgres role with no grant on `v_clinician_escalation_rate`; documented in `docs/clinical-governance.md` |
| **I7** | Patient data export is always available, from first login, regardless of subscription or payment status. | Feature is unconditional; test asserts export succeeds for a patient with a lapsed subscription |
| **I8** | No billing structure may resemble per-member-per-month risk transfer. Only `service_fee` and `performance_bonus` line types exist. | Enum restriction on `invoice_lines.line_type`; no `capitation` value may be added |
| **I9** | Institutional users can never reach an individual record. Aggregate queries only, enforced at the query layer. | RLS returns zero rows for `role = 'institution_admin'` on all patient-scoped tables; only `v_institution_aggregate` is granted |
| **I10** | Every clinical action writes a patient-visible `proof_log` row. | Trigger on `clinical_notes`, `triage_classifications`, `escalations`, `medication_dispenses` |

---

## 4. Clinical accountability model — configurable

Built both ways, selected by `app_config.accountability_model`, values `tech_layer` | `provider`. **Default `tech_layer`.**

| | `tech_layer` | `provider` |
|---|---|---|
| Note signature | Individual clinician, under own MDCN registration | Tarragon Health Ltd, countersigned by clinician |
| Required on `clinicians` | `mdcn_number`, `mdcn_expiry`, `indemnity_provider`, `indemnity_policy_no`, `indemnity_expiry` — all `NOT NULL` and verified before activation | `mdcn_number` only |
| Signature block rendered to patient | Clinician name + MDCN number + "practising under own registration" | Clinician name + MDCN number + "on behalf of Tarragon Health Ltd" |
| Blocks clinician activation | Expired indemnity or MDCN → account auto-suspended by nightly job | Expired MDCN → suspended |

The flag is read at runtime, not build time. A change of model must not require a migration. Store the model in force **on every signature row** (`clinical_notes.accountability_model_at_signing`) so historical notes remain interpretable after a switch.

---

## 5. Data model

Full DDL below. All tables in schema `public` unless stated. `id` is `uuid default gen_random_uuid()`. All tables carry `created_at timestamptz not null default now()` and, where mutable, `updated_at`.

### 5.1 Enums

```sql
create type accountability_model as enum ('tech_layer','provider');
create type user_role as enum ('patient','clinician','coordinator','institution_admin','ops_admin','superadmin');
create type sex_at_birth as enum ('female','male');
create type reading_type as enum ('bp','glucose_fasting','glucose_random','hba1c','weight','height','waist','pulse');
create type reading_source as enum ('patient_manual','patient_device_bt','screening_day','clinician_entered','lab_import');
create type device_validation as enum ('validated','unvalidated_advisory','wrist_advisory','unknown');
create type triage_class as enum ('stable','needs_review','urgent','emergency');
create type criticality as enum ('routine','important','urgent','emergency');
create type comms_channel as enum ('push','in_app','whatsapp','sms','email','voice');
create type content_class as enum ('clinical','non_clinical');
create type delivery_state as enum ('queued','sent','delivered','failed','opened','acted');
create type contact_type as enum ('voice','synchronous_in_app','async_in_app','field_visit');
create type consent_scope as enum ('funder_summary','institution_aggregate','clinical_share','escalation_contact','research_anonymised');
create type enrolment_status as enum ('pending','active','paused','exited');
create type programme_code as enum ('control','concierge');
create type invoice_line_type as enum ('service_fee','performance_bonus','device','onboarding');
create type medication_verification as enum ('verified','unverified','unknown');
create type referral_reason as enum (
  'out_of_protocol','secondary_hypertension_suspected','type_1_diabetes',
  'pregnancy','ckd_stage_3plus','cardiac_symptoms','uncontrolled_at_max_protocol',
  'patient_request','other'
);
```

### 5.2 Identity and roles

```sql
-- extends auth.users
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role user_role not null default 'patient',
  full_name text not null,
  phone_e164 text,
  email text,
  locale text not null default 'en-NG',
  timezone text not null default 'Africa/Lagos',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table patients (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid unique references profiles(id) on delete cascade, -- null for dependants with no login
  guardian_patient_id uuid references patients(id),                -- under-18 dependants only
  date_of_birth date not null,
  sex_at_birth sex_at_birth not null,
  state_of_residence text,
  lga text,
  next_of_kin_name text,
  next_of_kin_phone_e164 text,
  no_smartphone boolean not null default false,   -- drives the voice/SMS-primary flow
  created_at timestamptz not null default now()
);

-- a dependant must be under 18 at creation
alter table patients add constraint dependant_is_minor
  check (guardian_patient_id is null or date_of_birth > (current_date - interval '18 years'));

create table clinicians (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid unique not null references profiles(id) on delete cascade,
  mdcn_number text not null,
  mdcn_expiry date not null,
  indemnity_provider text,
  indemnity_policy_no text,
  indemnity_expiry date,
  scope text[] not null default '{}',   -- e.g. {'hypertension','t2dm'}
  active boolean not null default false,
  suspended_reason text
);
```

> **Clinician activation guard.** A nightly Edge Function suspends any clinician whose `mdcn_expiry` has passed, or — when `accountability_model = 'tech_layer'` — whose `indemnity_expiry` has passed or whose indemnity fields are null. Suspension revokes the clinician role grant immediately.

### 5.3 Organisations and enrolment

```sql
create table organisations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  rc_number text,
  contact_email text not null,
  aggregate_only boolean not null default true,   -- never set false
  min_cohort_size int not null default 15,        -- suppression threshold, see §13
  created_at timestamptz not null default now()
);

create table programmes (
  code programme_code primary key,
  display_name text not null,
  active boolean not null default true
);

create table enrolments (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references patients(id) on delete cascade,
  programme_code programme_code not null references programmes(code),
  organisation_id uuid references organisations(id),
  status enrolment_status not null default 'pending',
  started_at timestamptz,
  ended_at timestamptz,
  assigned_coordinator_id uuid references profiles(id),
  created_at timestamptz not null default now()
);

create unique index one_active_enrolment_per_patient
  on enrolments (patient_id) where status = 'active';
```

### 5.4 Devices

```sql
create table devices (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references patients(id) on delete cascade,
  device_kind reading_type not null,          -- bp | glucose_* | weight
  make text not null,
  model text not null,
  is_wrist boolean not null default false,
  arm_circumference_cm numeric(4,1),
  cuff_size text,
  approx_age_years int,
  photo_path text,                            -- Supabase Storage, private bucket
  first_reading_photo_path text,
  validation device_validation not null default 'unknown',
  validated_by uuid references clinicians(id),
  validated_at timestamptz,
  supplied_by_tarragon boolean not null default false,
  created_at timestamptz not null default now()
);
```

**Validation rules (implemented in `packages/protocol/devices.ts`):**
- `is_wrist = true` → `validation = 'wrist_advisory'`, always.
- Make/model absent from the validated-device list → `unvalidated_advisory`.
- `approx_age_years > 4` → `unvalidated_advisory`.
- BP cuff with no `arm_circumference_cm` → block enrolment completion until captured.
- Any non-`validated` device causes a persistent banner on every clinician screen showing that patient's readings: *"Unvalidated device — readings advisory."*

**Enrolment gate:** a patient cannot reach `enrolments.status = 'active'` on a pathway requiring a device without a `devices` row of the matching `device_kind`. Attestation is permitted; a tick-box is not — all capture fields above are required.

### 5.5 Readings and provenance

```sql
create table readings (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references patients(id) on delete cascade,
  type reading_type not null,
  value_numeric numeric(6,2),          -- single-value readings
  systolic int, diastolic int,         -- bp only
  unit text not null,
  taken_at timestamptz not null,
  source reading_source not null,
  source_detail text not null,         -- device id, screening event id, clinician id, lab name
  device_id uuid references devices(id),
  screening_event_id uuid references screening_events(id),
  entered_by uuid references profiles(id),
  notes text,
  created_at timestamptz not null default now()
);

alter table readings add constraint bp_has_both
  check (type <> 'bp' or (systolic is not null and diastolic is not null));
alter table readings add constraint nonbp_has_value
  check (type = 'bp' or value_numeric is not null);
```

`source_detail` is `NOT NULL` by design (**I3**). There is no "unknown source" path. A reading whose origin cannot be stated is not a reading.

### 5.6 Protocol and triage

```sql
create table protocol_configs (
  id uuid primary key default gen_random_uuid(),
  code text not null,                  -- 'who_hearts'
  version text not null,               -- 'v1', 'v1.1'
  ruleset jsonb not null,              -- thresholds, see §7
  effective_from timestamptz not null,
  effective_to timestamptz,
  approved_by uuid references clinicians(id) not null,
  approved_at timestamptz not null,
  unique (code, version)
);

create table triage_classifications (
  id uuid primary key default gen_random_uuid(),
  reading_id uuid not null unique references readings(id) on delete cascade,
  patient_id uuid not null references patients(id) on delete cascade,
  classification triage_class not null,
  protocol_config_id uuid not null references protocol_configs(id),
  rule_fired text not null,            -- human-readable rule identifier
  ai_assisted boolean not null default false,
  ai_model text,
  cleared_at timestamptz,
  cleared_by uuid references clinicians(id),
  batch_signature_id uuid,
  clinician_override triage_class,     -- set when a clinician disagrees
  override_reason text,
  created_at timestamptz not null default now()
);
```

**`clinician_override` is the single most important instrumentation field in the system.** Override rate against the engine is how you know whether the ruleset is right and whether the ratio in the business model is achievable. Surface it on an internal dashboard from day one.

### 5.7 Clinical record

```sql
create table clinical_contacts (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references patients(id) on delete cascade,
  clinician_id uuid references clinicians(id),
  coordinator_id uuid references profiles(id),
  contact_type contact_type not null,
  started_at timestamptz not null,
  ended_at timestamptz,
  duration_seconds int,
  masked_call_ref text,                -- provider call id
  created_at timestamptz not null default now()
);

create table clinical_notes (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references patients(id) on delete cascade,
  clinician_id uuid not null references clinicians(id),
  note_type text not null,             -- 'review' | 'escalation' | 'contact' | 'handover' | 'referral'
  body text not null,
  linked_contact_id uuid references clinical_contacts(id),
  linked_classification_id uuid references triage_classifications(id),
  accountability_model_at_signing accountability_model not null,
  mdcn_number_at_signing text not null,
  signed_at timestamptz not null default now()
);
```

**I5 enforcement.** A `clinical_notes` row closing a classification of `urgent` or `emergency` must have `linked_contact_id` pointing at a `clinical_contacts` row whose `contact_type` is `voice` or `synchronous_in_app`. Implement as a `BEFORE INSERT` trigger that raises, plus an application-level guard that greys the submit button. Both. This is the MDCN asynchronous-diagnosis rule expressed in code and it must not be defeatable through the API.

```sql
create table escalations (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references patients(id) on delete cascade,
  classification_id uuid references triage_classifications(id),
  criticality criticality not null,
  raised_by uuid references profiles(id),
  raised_at timestamptz not null default now(),
  due_by timestamptz not null,         -- computed from the SLA table, §9.4
  resolved_at timestamptz,
  resolution_note_id uuid references clinical_notes(id),
  breached boolean generated always as (
    resolved_at is null and now() > due_by
  ) stored
);

create table referrals (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references patients(id) on delete cascade,
  reason referral_reason not null,
  reason_detail text,
  referred_to text,                    -- facility or specialty
  referred_at timestamptz not null default now(),
  clinician_id uuid not null references clinicians(id),
  patient_informed_at timestamptz,
  criteria_version text not null       -- which published referral criteria applied
);
```

### 5.8 Consent and proof

```sql
create table consent_records (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references patients(id) on delete cascade,
  scope consent_scope not null,
  granted_to_profile_id uuid references profiles(id),
  granted_to_organisation_id uuid references organisations(id),
  granted_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  captured_by uuid references profiles(id),
  capture_method text not null,        -- 'in_app' | 'voice_recorded' | 'wet_signature' | 'field_tablet'
  evidence_path text                   -- Storage path for recording or scan
);

create index consent_active on consent_records (patient_id, scope)
  where revoked_at is null;

create table proof_log (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references patients(id) on delete cascade,
  event_type text not null,            -- 'reading_classified','review_completed','contact_made', etc.
  actor_profile_id uuid references profiles(id),
  actor_display text not null,         -- what the patient sees, e.g. "Dr A. Adetunbi (MDCN 12345)"
  summary text not null,               -- plain language, patient-facing
  occurred_at timestamptz not null default now(),
  source_table text not null,
  source_id uuid not null
);
```

`proof_log` is **patient-facing**. Every `summary` must be written in plain language a patient reads without help. It is populated by triggers (**I10**), never by application code, so it cannot be forgotten.

### 5.9 Communications

```sql
create table notification_templates (
  id uuid primary key default gen_random_uuid(),
  key text unique not null,
  channel comms_channel not null,
  content_class content_class not null,
  criticality criticality not null,
  body_template text not null,
  vendor_template_name text,           -- Meta-approved template name for whatsapp
  active boolean not null default true
);

-- I1, at the database level
alter table notification_templates add constraint no_clinical_on_open_rails
  check (not (content_class = 'clinical'
              and channel in ('whatsapp','sms','email')));

create table notification_sends (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references notification_templates(id),
  patient_id uuid not null references patients(id) on delete cascade,
  channel comms_channel not null,
  criticality criticality not null,
  content_class content_class not null,
  vendor_message_id text,
  cost_minor int,                      -- kobo; populated from vendor webhook
  queued_at timestamptz not null default now()
);

alter table notification_sends add constraint sends_no_clinical_on_open_rails
  check (not (content_class = 'clinical'
              and channel in ('whatsapp','sms','email')));

create table notification_events (
  id uuid primary key default gen_random_uuid(),
  send_id uuid not null references notification_sends(id) on delete cascade,
  state delivery_state not null,
  occurred_at timestamptz not null default now(),
  detail jsonb
);

create table device_heartbeats (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references patients(id) on delete cascade,
  expo_push_token text,
  push_permission_granted boolean not null,
  app_version text,
  os text, os_version text, device_model text,
  last_seen_at timestamptz not null default now(),
  consecutive_push_failures int not null default 0,
  forced_channel comms_channel          -- set to 'whatsapp' or 'sms' when push is unreliable
);
```

### 5.10 Medication, labs, screening, billing

```sql
create table medications (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references patients(id) on delete cascade,
  inn_name text not null,              -- international non-proprietary name
  strength text not null,
  dose_instruction text not null,
  started_at date not null,
  stopped_at date,
  protocol_step int,                   -- which HEARTS step this represents
  prescribed_by uuid references clinicians(id)
);

create table medication_dispenses (
  id uuid primary key default gen_random_uuid(),
  medication_id uuid not null references medications(id) on delete cascade,
  patient_id uuid not null references patients(id) on delete cascade,
  partner_pharmacy_id uuid references partners(id),
  batch_number text,
  verification medication_verification not null default 'unknown',
  quantity int not null,
  days_supply int not null,
  dispensed_at timestamptz not null default now()
);

create table partners (
  id uuid primary key default gen_random_uuid(),
  kind text not null,                  -- 'lab' | 'pharmacy' | 'device_distributor'
  name text not null,
  accreditation text,
  nafdac_licence text,
  pcn_licence text,
  commission_bps int,                  -- basis points; labs default 1000 (10%)
  active boolean not null default true
);

create table lab_orders (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references patients(id) on delete cascade,
  partner_id uuid not null references partners(id),
  panel_code text not null,
  patient_price_minor int not null,    -- what the patient pays the lab
  commission_minor int not null,       -- Tarragon's share, never shown to the patient
  ordered_at timestamptz not null default now(),
  collected_at timestamptz,
  resulted_at timestamptz
);

create table screening_events (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid references organisations(id),
  name text not null,
  held_on date not null,
  location text,
  operator_profile_id uuid references profiles(id),
  participants_expected int,
  created_at timestamptz not null default now()
);

create table screening_participants (
  id uuid primary key default gen_random_uuid(),
  screening_event_id uuid not null references screening_events(id) on delete cascade,
  patient_id uuid references patients(id),         -- null until they convert
  temp_ref text not null,                          -- offline capture reference
  consented boolean not null default false,
  consent_record_id uuid references consent_records(id),
  converted_to_enrolment_id uuid references enrolments(id),
  converted_at timestamptz
);

create table subscriptions (
  id uuid primary key default gen_random_uuid(),
  enrolment_id uuid not null references enrolments(id) on delete cascade,
  payer_profile_id uuid not null references profiles(id),
  provider text not null,              -- 'paystack' | 'stripe' | 'wallet' | 'invoice'
  interval text not null,              -- 'monthly' | 'annual'
  amount_minor int not null,
  currency char(3) not null default 'NGN',
  status text not null,
  next_charge_at timestamptz
);

create table wallets (
  id uuid primary key default gen_random_uuid(),
  owner_profile_id uuid not null references profiles(id),
  balance_minor int not null default 0,
  currency char(3) not null default 'NGN'
);

create table wallet_transactions (
  id uuid primary key default gen_random_uuid(),
  wallet_id uuid not null references wallets(id) on delete cascade,
  amount_minor int not null,           -- signed
  beneficiary_patient_id uuid references patients(id),
  reference text not null,
  occurred_at timestamptz not null default now()
);

create table invoice_lines (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations(id),
  line_type invoice_line_type not null,   -- I8: no capitation value exists
  description text not null,
  quantity int not null,
  unit_amount_minor int not null,
  period_start date not null,
  period_end date not null
);
```

### 5.11 Audit

```sql
create table audit_log (
  id bigserial primary key,
  actor_profile_id uuid references profiles(id),
  actor_role user_role,
  action text not null,
  table_name text not null,
  row_id uuid,
  before jsonb,
  after jsonb,
  ip inet,
  occurred_at timestamptz not null default now()
);
```

Append-only. Revoke `UPDATE` and `DELETE` from all roles including service role. Attach a generic trigger to every table holding patient data.

---

## 6. Row-level security

RLS enabled on **every** table. No table ships without a policy. Default deny.

### 6.1 Policy summary

| Role | Access |
|---|---|
| `patient` | Own rows only, matched on `patients.profile_id = auth.uid()`, plus rows for dependants where `guardian_patient_id` resolves to them |
| `clinician` | Patients with an active enrolment assigned to their caseload, or any patient with an open `needs_review`+ classification in the shared queue |
| `coordinator` | Same patient set as clinician, but **no** access to `clinical_notes.body`; may read `proof_log` and non-clinical fields only |
| `institution_admin` | **Zero rows on every patient-scoped table.** Access only to `v_institution_aggregate` |
| `ops_admin` | Non-clinical operational tables; no `clinical_notes`, no `readings` values |
| `superadmin` | Break-glass only, every access written to `audit_log`, alerts to Sentry |

### 6.2 The consent-at-query-time policy (I4)

Funder access to a Concierge patient's summary is expressed as a policy, not application logic:

```sql
create policy funder_reads_summary on proof_log
for select using (
  exists (
    select 1 from consent_records c
    where c.patient_id = proof_log.patient_id
      and c.scope = 'funder_summary'
      and c.granted_to_profile_id = auth.uid()
      and c.revoked_at is null
      and (c.expires_at is null or c.expires_at > now())
  )
);
```

Revocation must take effect on the next query with no cache invalidation step. Write the test that revokes consent and immediately re-reads.

---

## 7. Triage engine

`packages/triage` — **pure functions, no I/O, no database access, fully unit-testable.**

### 7.1 Ruleset format

The WHO HEARTS thresholds live in `protocol_configs.ruleset` as JSON, versioned and clinician-approved. Never inline conditionals.

```json
{
  "code": "who_hearts",
  "version": "v1",
  "bp": {
    "emergency": { "systolic_gte": 180, "or_diastolic_gte": 110, "with_symptoms": true },
    "urgent":    { "systolic_gte": 180, "or_diastolic_gte": 110 },
    "needs_review": { "systolic_gte": 140, "or_diastolic_gte": 90, "consecutive": 2 },
    "stable":    { "systolic_lt": 140, "diastolic_lt": 90 }
  },
  "glucose_fasting": { "...": "..." },
  "hba1c": { "...": "..." },
  "modifiers": {
    "unvalidated_device_downgrade": true,
    "new_patient_first_90_days_tighter": true
  }
}
```

**Populate `v1` from the first screening day, not from assumption.** Ship the engine with a ruleset marked `version: 'v0-provisional'` that classifies conservatively (anything outside target → `needs_review`), and replace it with a clinician-approved `v1` once 200 real readings have been hand-classified. The strategy document explains why: the stable fraction *is* the business model, and it must be measured before it is coded around.

### 7.2 Pipeline

1. `readings` insert fires a trigger enqueuing a job.
2. Edge Function loads the active `protocol_configs` row for `taken_at`.
3. `classify(reading, patientContext, ruleset)` returns `{classification, rule_fired}`.
4. Optional AI assist (Haiku): flags patterns the deterministic ruleset may miss. **AI can only escalate, never downgrade.** A deterministic `needs_review` cannot become `stable` because a model said so. Record `ai_assisted` and `ai_model`.
5. Write `triage_classifications` — always, including stable (**I2**).
6. If `needs_review`+ → create `escalations` row with `due_by` from the SLA table.
7. Write `proof_log`.

### 7.3 Batch clear

The clinician queue supports selecting a page of `stable` classifications and clearing them under one `batch_signature_id`. One clinician action; one `clinical_notes` row of `note_type = 'review'`; every classification row individually stamped with `cleared_by`, `cleared_at` and the shared `batch_signature_id`. Auditable both ways.

**Batch clear is available for `stable` only.** `needs_review` and above require individual handling. Enforce server-side.

---

## 8. Screening-day capture (`apps/screening`)

Offline-first. Field staff run this on a tablet at an employer site with no reliable connectivity.

**Requirements:**
- Full offline operation with local queue and background sync; never blocks on network.
- Participant capture: name, DOB, sex, phone, consent (**captured before any measurement**), `temp_ref`.
- Measurement capture: BP ×2 with a mandatory rest interval timer, glucose, height, weight, waist. Auto-computes BMI.
- Every reading writes `source = 'screening_day'` and `source_detail = screening_event_id`.
- On-device instant result card for the participant with a plain-language band and a referral flag.
- Aggregate report generated for the organisation at event close: prevalence bands, severe range count, **previously undiagnosed count**, suppressed below `min_cohort_size`.
- **Attach-rate instrumentation:** `screening_participants.converted_to_enrolment_id` and `converted_at`. The internal dashboard reports 30-day attach rate per event. This is the primary go-to-market metric.

Conflict resolution on sync: last-write-wins is forbidden for readings. Duplicate detection on `(screening_event_id, temp_ref, type, taken_at)`; genuine duplicates are surfaced to the operator, never silently merged.

---

## 9. Communications — the five rails

### 9.1 Rail responsibilities

| Rail | Carries | Never carries |
|---|---|---|
| App / in-app | The record. All clinical conversation, review, results, care plan, consent | — |
| Voice | All clinical judgement. Masked number, logged, written back to `clinical_notes` | Routine notification |
| SMS | Urgent redundancy, no-smartphone fallback | Clinical content |
| WhatsApp | Non-clinical notification only, exception-triggered | Clinical conversation, any health value, any result |
| Email | Documents, receipts, reports, consent records, institutional and diaspora communication | Anything time-critical |

### 9.2 The WhatsApp downgrade — what changes

WhatsApp was previously the primary clinical channel. **It is now a notification rail only.** Implement as follows:

- Only two template shapes are permitted, both `content_class = 'non_clinical'`:
  - *"Your result is ready — open the app."*
  - *"It's time for your check-in — open the app."*
- No numeric health value, no result, no diagnosis, no medication name may appear in any WhatsApp template. Enforced by **I1** at three levels: the DB check constraint on `notification_templates`, the constraint on `notification_sends`, and a throw in the send function.
- **Inbound free-text is ingested, never answered clinically.** Patients will reply "my chest is hurting" to a medication reminder — this cannot be prevented, so it is handled: auto-acknowledge, write the inbound message into the record as a logged patient message, and trigger the escalation ladder by criticality keyword match. A clinician replying clinically in WhatsApp is a defect; the console provides no such control.
- Meta begins charging for service-window replies from **1 October 2026**. Model cost per patient per month in the internal dashboard from `notification_sends.cost_minor`, and alert when WhatsApp cost per patient exceeds a configurable threshold.

### 9.3 Send pipeline

```
send(templateKey, patientId, params)
  → load template
  → assert content_class/channel legality       [I1 — throws]
  → resolve rail:
       push if heartbeat healthy and no forced_channel
       else forced_channel
  → dispatch via adapter
  → write notification_sends
  → vendor webhook writes notification_events
```

### 9.4 Escalation SLA table (data, not code)

Seeded into `notification_templates.criticality` and an `escalation_slas` config table:

| Tier | SLA | Channel sequence |
|---|---|---|
| `routine` | 7 days | Batched digest, push only |
| `important` | 48 hours | Push → automated WhatsApp nudge (non-clinical) |
| `urgent` | 2 hours | Phone call — **never a message** |
| `emergency` | Immediate | Push + WhatsApp + SMS fired simultaneously, then documented next-of-kin attempt |

`escalations.due_by` is computed from this table. Breaches are visible on the clinician queue and reported weekly. **This table is the medico-legal defence and the first artefact an HMO's clinical governance reviewer will request — build it before the code that reads it.**

### 9.5 Delivery states — three, not two

Track `delivered`, `opened` and `acted` separately (**§5.9**). Transsion devices hold roughly half the Nigerian market and budget Android ROMs kill background processes aggressively, so *not acted* frequently means *never arrived*.

- **Not delivered within window** → escalate immediately; this is channel failure, not patient choice.
- **Delivered, not opened** → patient-behaviour ladder.
- **Opened, not acted** → different ladder, different script.

A silent heartbeat (`device_heartbeats`) confirms the app is alive and detects revoked notification permission. Three consecutive push failures sets `forced_channel` permanently to WhatsApp or SMS.

### 9.6 Vendor configuration notes

- **Register the WhatsApp Business Account in Nigeria.** Nigeria carries a separate authentication-international rate applied when codes are sent to Nigerian users from a WABA registered elsewhere, at a multiple of the standard rate.
- Email: separate subdomains for transactional and marketing. A patient who unsubscribes from marketing **must still receive lab reports and consent records**. Warm the sending domain before launch.
- Voice: number masking mandatory. Click-to-call from the patient record, both numbers hidden, call auto-logged to `clinical_contacts`, **note required before the record closes**. Never a clinician's personal phone.

### 9.7 Non-response chase — automate step one, humans at step two

No response → automated non-clinical template. Still nothing → a **non-clinical coordinator** calls from a script, escalating to a clinician only when clinical content appears. **Clinicians never chase.** Enforce by role: the non-response queue is not visible to `clinician`.

---

## 10. Patient app (`apps/patient`)

Phone-first, low-bandwidth, resumable. Every flow survives a dropped connection mid-task.

| Screen | Contents |
|---|---|
| Home | One number: current control status. One action: today's task. Nothing else. |
| Log a reading | Structured entry, device-linked where available, **three taps maximum** |
| My trend | Single chart, target band shaded, plain-language status |
| Messages | All clinical conversation. Clinician name and MDCN number on **every** message |
| My medication | Drug, timing, verification status, refill countdown, one-tap reorder |
| Results | Lab name, accreditation status, plain-language explanation, clinician note |
| My screening calendar | What is due, when, book from here |
| Health Passport | Export, share, "this is yours to keep" |
| My proof | Reads `proof_log` directly — every review, contact and dispense, timestamped |

**No screen asks a patient to type a clinical judgement.** Structured input only.

**Consent for escalation is captured at onboarding:** *"If we don't hear from you, we'll message or call."* One explicit step, written to `consent_records` with scope `escalation_contact`. Required before enrolment activates.

### 10.1 The no-smartphone cohort

`patients.no_smartphone = true` inverts the flow: voice is primary and permanent, SMS is backup, and the silence signal comes from **missing readings**, not unopened notifications. Build as a distinct notification strategy in `packages/notifications`, selected on the patient record, not as a set of conditionals scattered through the send path.

---

## 11. Clinician workspace (`apps/console`, role `clinician`)

| Screen | Contents |
|---|---|
| Exception queue | Only `needs_review`+ classifications, ranked by criticality clock, breach state visible |
| Patient review | Trend, provenance flags, medication history, last contact, one-tap escalate |
| Batch clear | `stable` only, signed under one `batch_signature_id` |
| Escalation | Criticality tier, channel forced by the SLA table, mandatory note |
| Call | Click-to-call, masked, auto-logged, note required before close |
| Handover | Structured note — reasoning, not just data |
| Referral | Reason from the published criteria enum, records `criteria_version` |

Phone-first and resumable mid-queue — clinicians will use this on a phone between shifts.

**I6 applies here.** No screen, export or query in this app aggregates escalations per clinician in any form reachable by compensation logic. The internal governance query targets the *lowest*-escalating clinicians.

---

## 12. Coordinator workspace (`apps/console`, role `coordinator`)

Non-clinical. Non-response queue, chase scripts, call logging, device dispatch tracking, appointment coordination. **No access to `clinical_notes.body`.** Enforced by RLS column-level grant, not by hiding the UI.

---

## 13. Institution portal (`apps/console`, role `institution_admin`)

Aggregate only, enforced at the query layer (**I9**).

- Control rate over time
- Screening completion rate
- New diagnoses found
- Cohort risk distribution
- Engagement rate

**Suppression:** any cell derived from fewer than `organisations.min_cohort_size` individuals renders as "insufficient data," never a number. Small-cell suppression is a re-identification control, not a nicety.

The UI states plainly, on the screen: *"Tarragon does not share individual health records with your employer."*

---

## 14. Public outcomes dashboard (`apps/public`)

Unauthenticated. Live control rate sourced from `proof_log` and `triage_classifications` aggregates. Cached, rebuilt nightly.

No Nigerian competitor publishes this. It is simultaneously the marketing asset and the discipline mechanism — once public, nothing is allowed to matter more than the number on that page. Include methodology and denominator; a control rate without a denominator is marketing, not evidence.

---

## 15. Billing

- **Paystack** for NGN; **Stripe** for international cards. One naira price list. **No currency-based price discrimination** — the same SKU costs the same amount to everyone.
- Annual prepaid is the default presentation; device included free on annual (§16).
- Monthly plans: device sold at cost with a service credit rebate after six continuous months.
- **Health Wallet** funds any patient without granting record access. Access requires separate `consent_records` grant.
- Institutional billing produces `invoice_lines` of type `service_fee` and `performance_bonus` only (**I8**). Onboarding fee per identified case is `onboarding`. There is no capitation line type and none may be added.

---

## 16. Devices — commercial logic

| Plan | Device treatment |
|---|---|
| Annual prepaid | Included, dispatched on activation |
| Monthly | Sold at cost, service-credit rebate after 6 continuous months |
| Concierge / parent enrolment | Deposit and loan; device remains Tarragon property |

**Never finance over instalments.** Test strips for the diabetes pathway are included in the subscription — if strips are not bundled, the pathway silently dies in month three.

Sourcing: BP monitors are Class B devices under NAFDAC. `partners.kind = 'device_distributor'` requires a `nafdac_licence` value before any dispatch is permitted.

---

## 17. Data export and portability (I7)

- **Health Passport**: PDF, generated server-side, containing readings, results, medication history, screenings, vaccinations.
- **Full export**: machine-readable JSON of every row referencing the patient.
- Available from first login, unconditional on payment status.
- Export requests are logged to `audit_log` and surfaced in `proof_log`.

Delivery is by expiring secure link, never as an email attachment (see NDPA cross-border position). Log every link generation and access.

---

## 18. Testing requirements

Nothing merges without:

1. **One failing-first test per invariant** in §3. Name them `I1_...` through `I10_...`.
2. **RLS test suite** running as each role against a seeded fixture, asserting exact row counts — including asserting **zero** rows for `institution_admin` on every patient-scoped table.
3. **Triage golden-file tests**: a fixture of ~200 readings with expected classifications per ruleset version. When the ruleset changes, the golden file changes in the same commit, reviewed by a clinician.
4. **Notification enforcement tests**: attempt to send a clinical template on WhatsApp, SMS and email; assert all three throw and nothing is written.
5. **Offline sync tests** for `apps/screening`: airplane-mode capture, duplicate detection, conflict surfacing.
6. **Consent revocation test**: grant, read, revoke, re-read in the same session; assert zero rows without cache clearing.

---

## 19. Out of scope — do not build

Binding. Adding any of these is a defect.

- Care coordination across conditions outside the protocol
- Specialist referral management beyond recording a referral and its reason
- Complex multimorbidity handling
- Any feature requiring individualised clinical judgement rather than an algorithm
- Family or household plans, household pricing, any per-family discount
- Insurance, claims, capitation, risk transfer, or any per-member-per-month risk structure
- Owned physical screening infrastructure, kiosks or clinics
- Screening tests outside age- and sex-appropriate guideline recommendations
- Clinician chat in WhatsApp, in any form
- Any GBP or USD price list separate from the naira list
- USSD (revisit post-launch)
- Bluetooth device pairing (phase two)
- AI-authored clinical advice delivered to a patient without clinician signature

---

## 20. Build order

Each milestone has an exit test. Do not begin the next until it passes.

| # | Milestone | Exit test |
|---|---|---|
| **M1** | Supabase project, migrations, all enums and tables, RLS on every table default-deny, audit trigger | RLS suite passes as all six roles; `institution_admin` returns zero rows everywhere |
| **M2** | Auth, profiles, patients, clinicians, activation guard, accountability config flag | Expired-MDCN clinician auto-suspends overnight; note signature block renders correctly under both models |
| **M3** | `apps/screening` offline capture, consent-before-measurement, aggregate report with suppression | 200 synthetic readings captured offline, synced, duplicates surfaced not merged |
| **M4** | Readings, devices, provenance, device validation gate | I2 and I3 tests pass; enrolment blocked without a captured device |
| **M5** | `packages/triage`, `protocol_configs`, classification pipeline, batch clear | Golden-file suite passes; batch clear rejects a `needs_review` row |
| **M6** | `packages/notifications`, five rails, SLA table, delivery-state tracking, heartbeat, forced-channel fallback | I1 tests pass on all three open rails; forced-channel flips after three push failures |
| **M7** | Patient app all screens; Health Passport and export; escalation consent at onboarding | I7 passes for a lapsed-subscription patient; export completes offline-resumable |
| **M8** | Clinician + coordinator + institution consoles; masked calling; referrals; public dashboard | I5 blocks text-only closure of an `urgent`; I6 grant audit shows no compensation-reachable path |

Billing (§15) may be built in parallel from M4 onward; it has no dependency on the triage engine.

---

## 21. Decisions still open — do not guess

Stop and ask before implementing any of these:

1. **Voice vendor** — the adapter interface is specified; the provider is not. Blocks the Call screen in M8.
2. **`who_hearts` v1 thresholds** — ship `v0-provisional`, replace after the first screening day with a clinician-approved ruleset.
3. **Head of Clinical Operations** — named signature block on the About page and in `clinicians`.
4. **Validated-device list source** — which published list `packages/protocol/devices.ts` checks against.
5. **Referral criteria v1** — the published document that `referrals.criteria_version` points at must exist before M8.
6. **Accountability model in force at launch** — built both ways; the production value of `app_config.accountability_model` requires written legal advice, not a build decision.

---

*Companion documents: `tarragon-strategy-v3.md` (strategy and site brief). Regulatory positions in this spec reflect NDPA 2023, the MDCN 2022 Telemedicine Practice Guideline, the NHIA Act 2022, the PCN Act and NAFDAC device rules as summarised in the strategy document, and require confirmation by Nigerian counsel before launch.*
