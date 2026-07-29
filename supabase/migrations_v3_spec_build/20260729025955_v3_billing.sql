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

