create table protocol_configs (
  id uuid primary key default gen_random_uuid(),
  code text not null,                  -- 'who_hearts'
  version text not null,               -- 'v1', 'v1.1'
  ruleset jsonb not null,              -- thresholds
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

