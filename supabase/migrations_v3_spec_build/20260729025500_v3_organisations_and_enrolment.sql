create table organisations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  rc_number text,
  contact_email text not null,
  aggregate_only boolean not null default true,   -- never set false
  min_cohort_size int not null default 15,        -- suppression threshold, see spec §13
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

