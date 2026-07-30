-- Tarragon Control — M1: schema
-- Source: docs/tarragon-build-spec-v3.md §5 (Phase 1 data model)
-- Tables are ordered to satisfy forward references (spec presents them by topic, not dependency order).
-- Do not alter this file after it has shipped to staging; add a new migration instead.

-- =========================================================================
-- 5.1 Enums
-- =========================================================================

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

-- =========================================================================
-- Runtime config / go-live guards
-- Referenced by §4 (accountability_model) and Phase 2 §1 (L1-L4 guards).
-- Not given as explicit DDL in the spec — key/value shape chosen so each
-- guard is exactly "a single boolean in app_config with a set_by and set_at"
-- per Phase 2 §1's own description.
-- =========================================================================

create table app_config (
  key text primary key,
  value jsonb not null,
  set_by uuid references auth.users(id),
  set_at timestamptz not null default now()
);

comment on table app_config is
  'Deliberately not gated by application code alone — every guard read here must also be enforced at the DB/RLS layer where the spec says so (see Phase 2 §1 table). Flipping a key is a legal/clinical-safety act, not a config toggle; write set_by every time.';

-- =========================================================================
-- 5.2 Identity and roles
-- =========================================================================

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

-- =========================================================================
-- 5.3 Organisations and enrolment
-- =========================================================================

create table organisations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  rc_number text,
  contact_email text not null,
  aggregate_only boolean not null default true,   -- never set false
  min_cohort_size int not null default 15,        -- suppression threshold, §13
  created_at timestamptz not null default now()
);

-- I9 backstop: aggregate_only must never be false. A CHECK is a stronger
-- guarantee than "never set false in application code" — the spec's own
-- wording for this column is an invariant, so enforce it as one.
alter table organisations add constraint aggregate_only_is_always_true
  check (aggregate_only = true);

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

-- =========================================================================
-- 5.4 Devices
-- =========================================================================

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

-- =========================================================================
-- 5.6 (part 1) Protocol — protocol_configs must exist before triage_classifications
-- and before screening/readings so device-validation + triage FKs resolve.
-- =========================================================================

create table protocol_configs (
  id uuid primary key default gen_random_uuid(),
  code text not null,                  -- 'who_hearts'
  version text not null,               -- 'v1', 'v1.1'
  ruleset jsonb not null,              -- thresholds, §7
  effective_from timestamptz not null,
  effective_to timestamptz,
  approved_by uuid references clinicians(id) not null,
  approved_at timestamptz not null,
  unique (code, version)
);

-- =========================================================================
-- 5.8 (part 1) consent_records must exist before screening_participants
-- =========================================================================

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

-- =========================================================================
-- 5.10 (part 1) screening_events / screening_participants must exist before
-- readings (readings.screening_event_id references screening_events).
-- =========================================================================

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

-- =========================================================================
-- 5.5 Readings and provenance
-- =========================================================================

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

comment on column readings.source_detail is
  'I3: NOT NULL by design. There is no "unknown source" path — a reading whose origin cannot be stated is not a reading.';

-- I14 (Phase 2 §2, extended here since the column exists from M1): a
-- device-linked reading carries device serial/firmware and is not editable
-- by the patient once written. The edit-lockout itself is an RLS UPDATE
-- policy (see 0002_rls.sql); this migration only adds the columns so
-- Phase 2's device_pairings work has somewhere to write them.
alter table readings add column device_serial text;
alter table readings add column device_firmware text;

-- =========================================================================
-- 5.6 (part 2) Triage
-- =========================================================================

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

comment on column triage_classifications.clinician_override is
  'The single most important instrumentation field in the system — override rate against the engine is how you know whether the ruleset (and the ratio in the business model) is right. Surface on an internal dashboard from day one.';

-- I2's enforcement point (spec §3: "DB trigger on readings insert") is the
-- classification pipeline itself, which does not exist until M5
-- (packages/triage + the Edge Function). Deliberately not stubbed here —
-- a stub that always writes 'needs_review' would let the M1/M4 exit tests
-- pass without the real engine existing, defeating the point of the milestone
-- gate. Tracked as an M5 dependency, not a gap in this migration.

-- =========================================================================
-- 5.7 Clinical record
-- =========================================================================

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

-- I5: a clinical_notes row closing an urgent/emergency classification must
-- link a voice or synchronous_in_app contact. Enforced here as a trigger
-- (the spec requires both a DB trigger AND an application-level guard —
-- the app-level half is apps/console's job, M8).
create or replace function enforce_urgent_closure_requires_live_contact()
returns trigger
language plpgsql
as $$
declare
  v_classification triage_class;
  v_contact_type contact_type;
begin
  if new.linked_classification_id is null then
    return new;
  end if;

  select classification into v_classification
  from triage_classifications
  where id = new.linked_classification_id;

  if v_classification not in ('urgent', 'emergency') then
    return new;
  end if;

  if new.linked_contact_id is null then
    raise exception
      'I5 violation: a clinical_notes row closing an urgent/emergency classification must reference a clinical_contacts row (voice or synchronous_in_app). This is the MDCN asynchronous-diagnosis rule expressed in code and may not be bypassed.'
      using errcode = '23514';
  end if;

  select contact_type into v_contact_type
  from clinical_contacts
  where id = new.linked_contact_id;

  if v_contact_type not in ('voice', 'synchronous_in_app') then
    raise exception
      'I5 violation: the linked clinical_contacts row must be of type voice or synchronous_in_app for an urgent/emergency closure, got %', v_contact_type
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger trg_enforce_urgent_closure
  before insert on clinical_notes
  for each row
  execute function enforce_urgent_closure_requires_live_contact();

create table escalations (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references patients(id) on delete cascade,
  classification_id uuid references triage_classifications(id),
  criticality criticality not null,
  raised_by uuid references profiles(id),
  raised_at timestamptz not null default now(),
  due_by timestamptz not null,         -- computed from the SLA table, §9.4
  resolved_at timestamptz,
  resolution_note_id uuid references clinical_notes(id)
);

-- The spec's own DDL (§5.7) specifies `breached` as
-- `generated always as (resolved_at is null and now() > due_by) stored`,
-- which Postgres rejects at migration time: now() is STABLE, not IMMUTABLE,
-- and a stored generated column requires an immutable expression (error
-- 42P17). This is a real bug in the spec, not a judgment call — breach
-- status changes continuously with the clock without any write to the row,
-- so it cannot be a stored value at all; it has to be computed at read
-- time. Fixed here with a view instead of a stored column so the exact
-- semantics the spec describes ("breached" = unresolved past due_by) are
-- still available under the same name to any later query.
create view escalations_with_breach_status as
  select
    e.*,
    (e.resolved_at is null and now() > e.due_by) as breached
  from escalations e;

comment on view escalations_with_breach_status is
  'Read-time replacement for the spec''s stored `breached` generated column, which is not valid Postgres (now() is not immutable, error 42P17). §9.4: "Breaches are visible on the clinician queue and reported weekly" reads from this view, not the base table.';

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

-- =========================================================================
-- 5.8 (part 2) proof_log
-- =========================================================================

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

comment on table proof_log is
  'Patient-facing. Every summary must be plain language a patient reads without help. Populated by triggers only (I10), never application code, so it cannot be forgotten. Trigger wiring per source table lands with the milestone that introduces that table''s write path (clinical_notes/escalations/medication_dispenses land in M5-M8, not here) — the table exists from M1 so downstream migrations can attach to it without a schema change.';

-- =========================================================================
-- 5.9 Communications
-- =========================================================================

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

-- =========================================================================
-- 5.10 (part 2) Medication, labs, billing
-- =========================================================================

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

comment on column invoice_lines.line_type is
  'I8: the invoice_line_type enum has no capitation value and none may be added by a later migration without amending Phase 1 §3 first.';

-- =========================================================================
-- 5.11 Audit
-- =========================================================================

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

comment on table audit_log is
  'Append-only. UPDATE/DELETE revoked from all roles including service_role in 0003_audit.sql, once the generic trigger function exists.';
