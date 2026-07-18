-- Tarragon Health — Sprint 1 foundation
-- 05 · B2B & Billing (Category 4)
--
-- Subscription plans + instances, HMO capitation contracts, and corporate
-- per-employee contracts. Money is stored in minor units (kobo for NGN,
-- pence for GBP, cents for USD) as bigint, tagged with a currency code.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

create type public.billing_interval as enum ('monthly', 'yearly');

create type public.currency as enum ('NGN', 'GBP', 'USD');

create type public.subscription_status as enum (
  'trialing', 'active', 'past_due', 'cancelled'
);

create type public.payment_provider as enum ('paystack', 'stripe');

create type public.contract_status as enum (
  'draft', 'submitted', 'approved', 'rejected', 'paid', 'active'
);

-- ---------------------------------------------------------------------------
-- subscription_plans (global catalogue)
-- ---------------------------------------------------------------------------

create table public.subscription_plans (
  id                uuid primary key default gen_random_uuid(),
  code              text not null unique,
  name              text not null,
  description       text,
  price_minor       bigint not null default 0,   -- minor units of `currency`
  currency          public.currency not null default 'NGN',
  interval          public.billing_interval not null default 'monthly',
  -- Which of the 5 categories / capabilities the plan unlocks.
  features          text[] not null default '{}',
  is_active         boolean not null default true,
  created_at        timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- subscriptions (per patient / family / employer / HMO)
-- ---------------------------------------------------------------------------

create table public.subscriptions (
  id                    uuid primary key default gen_random_uuid(),
  organisation_id       uuid not null references public.organisations (id) on delete restrict,
  subscriber_id         uuid references public.profiles (id) on delete set null,
  plan_id               uuid references public.subscription_plans (id) on delete set null,
  status                public.subscription_status not null default 'trialing',
  currency              public.currency not null default 'NGN',
  amount_minor          bigint not null default 0,
  interval              public.billing_interval not null default 'monthly',
  provider              public.payment_provider,
  provider_ref          text,
  current_period_end    timestamptz,
  started_at            timestamptz not null default now(),
  cancelled_at          timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index subscriptions_subscriber_idx on public.subscriptions (subscriber_id);
create index subscriptions_org_status_idx on public.subscriptions (organisation_id, status);
create index subscriptions_plan_idx on public.subscriptions (plan_id);

create trigger subscriptions_set_updated_at
  before update on public.subscriptions
  for each row execute function private.set_updated_at();

-- Deferred FK from migration 03: family plan membership -> subscription.
alter table public.family_plan_members
  add constraint family_plan_members_plan_id_fkey
  foreign key (plan_id) references public.subscriptions (id) on delete set null;

create index family_plan_members_plan_idx on public.family_plan_members (plan_id);

-- ---------------------------------------------------------------------------
-- hmo_contracts (capitation; NHIA-format monthly claim file)
-- ---------------------------------------------------------------------------

create table public.hmo_contracts (
  id                          uuid primary key default gen_random_uuid(),
  organisation_id             uuid not null references public.organisations (id) on delete restrict,
  name                        text not null,
  capitation_rate_kobo        bigint not null default 0,   -- per member per month
  member_count                integer not null default 0,
  status                      public.contract_status not null default 'draft',
  effective_from              date,
  effective_to                date,
  latest_claim                jsonb not null default '{}'::jsonb,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

create index hmo_contracts_org_idx on public.hmo_contracts (organisation_id, status);

create trigger hmo_contracts_set_updated_at
  before update on public.hmo_contracts
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- corporate_contracts (per employee per year; monthly invoicing)
-- ---------------------------------------------------------------------------

create table public.corporate_contracts (
  id                          uuid primary key default gen_random_uuid(),
  organisation_id             uuid not null references public.organisations (id) on delete restrict,
  name                        text not null,
  per_employee_per_year_kobo  bigint not null default 0,
  employee_count              integer not null default 0,
  status                      public.contract_status not null default 'draft',
  effective_from              date,
  effective_to                date,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

create index corporate_contracts_org_idx on public.corporate_contracts (organisation_id, status);

create trigger corporate_contracts_set_updated_at
  before update on public.corporate_contracts
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.subscription_plans   enable row level security;
alter table public.subscriptions        enable row level security;
alter table public.hmo_contracts        enable row level security;
alter table public.corporate_contracts  enable row level security;

-- subscription_plans: catalogue — authenticated read, admin write.
create policy subscription_plans_select on public.subscription_plans
  for select to authenticated using (true);
create policy subscription_plans_insert on public.subscription_plans
  for insert to authenticated with check (private.is_admin());
create policy subscription_plans_update on public.subscription_plans
  for update to authenticated using (private.is_admin()) with check (private.is_admin());
create policy subscription_plans_delete on public.subscription_plans
  for delete to authenticated using (private.is_admin());

-- subscriptions: subscriber sees own; staff manage org.
create policy subscriptions_select on public.subscriptions
  for select to authenticated
  using (subscriber_id = (select auth.uid()) or private.is_org_staff(organisation_id));
create policy subscriptions_insert on public.subscriptions
  for insert to authenticated
  with check (subscriber_id = (select auth.uid()) or private.is_org_staff(organisation_id));
create policy subscriptions_update on public.subscriptions
  for update to authenticated
  using (private.is_org_staff(organisation_id))
  with check (private.is_org_staff(organisation_id));
create policy subscriptions_delete on public.subscriptions
  for delete to authenticated
  using (private.is_org_staff(organisation_id));

-- Institutional contracts: org staff/admin only.
do $$
declare t text;
begin
  foreach t in array array['hmo_contracts', 'corporate_contracts']
  loop
    execute format($f$
      create policy %1$s_select on public.%1$I
        for select to authenticated using (private.is_org_staff(organisation_id));
      create policy %1$s_insert on public.%1$I
        for insert to authenticated with check (private.is_org_staff(organisation_id));
      create policy %1$s_update on public.%1$I
        for update to authenticated using (private.is_org_staff(organisation_id)) with check (private.is_org_staff(organisation_id));
      create policy %1$s_delete on public.%1$I
        for delete to authenticated using (private.is_org_staff(organisation_id));
    $f$, t);
  end loop;
end;
$$;

grant select on public.subscription_plans to authenticated;
grant insert, update, delete on public.subscription_plans to authenticated;
grant select, insert, update, delete on public.subscriptions to authenticated;
grant select, insert, update, delete on public.hmo_contracts to authenticated;
grant select, insert, update, delete on public.corporate_contracts to authenticated;
