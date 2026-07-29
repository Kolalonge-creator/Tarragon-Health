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

-- Append-only: revoke UPDATE/DELETE from everyone including service_role.
revoke update, delete on audit_log from public, anon, authenticated, service_role;

-- app_config: referenced throughout the spec (§4 accountability_model, Phase 2 L1-L4 guards)
-- but never explicitly DDL'd. Singleton-row config table, superadmin-writable only.
create table app_config (
  id boolean primary key default true check (id),  -- forces exactly one row
  accountability_model accountability_model not null default 'tech_layer',
  accountability_model_set_by uuid references profiles(id),
  accountability_model_set_at timestamptz,
  -- Phase 2 go-live guards (§1, build spec v3 phase 2) -- booleans off by default;
  -- each is a deliberate, named, audited flip, never a default-true.
  l1_who_hearts_v1_approved boolean not null default false,
  l1_set_by uuid references profiles(id),
  l1_set_at timestamptz,
  l2_ndpc_registration_complete boolean not null default false,
  l2_dpo_name text,
  l2_set_by uuid references profiles(id),
  l2_set_at timestamptz,
  l3_accountability_model_legal_advice boolean not null default false,
  l3_set_by uuid references profiles(id),
  l3_set_at timestamptz,
  l4_referral_criteria_v1_published boolean not null default false,
  l4_criteria_version text,
  l4_set_by uuid references profiles(id),
  l4_set_at timestamptz,
  updated_at timestamptz not null default now()
);
insert into app_config (id) values (true);

