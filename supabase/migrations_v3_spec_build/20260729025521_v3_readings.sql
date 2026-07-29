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

