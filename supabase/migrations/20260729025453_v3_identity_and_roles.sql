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

