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

