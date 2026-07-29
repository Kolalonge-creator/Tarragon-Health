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

