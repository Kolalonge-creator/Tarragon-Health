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

-- screening_participants (§5.10 in the spec; created here because it needs consent_records + enrolments)
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

