-- Tarragon Health — module 27, part 1: the payer as an operator.
--
-- What already exists (20260829011711 / 20260829011713, both dormant) is the
-- TARRAGON side of an insurance relationship: Tarragon staff record a
-- patient's policy, ask an insurer for pre-authorisation, and submit a claim.
-- Every decision in it is one Tarragon transcribes from a phone call, an
-- email or an insurer portal.
--
-- Module 27 is the other side of the same transaction: the insurer itself
-- gets a login and operates on Tarragon — its plans, its benefit schedule,
-- its provider network, its own authorisation decisions, its own claims
-- adjudication and settlement, and aggregate analytics over its membership.
-- It deliberately EXTENDS the existing tables rather than growing a parallel
-- payer_* copy of them: one policy row, one authorisation row, one claim row,
-- seen from two sides. A second set would guarantee the two drift.
--
-- Three things this migration will not do, and will not be quietly walked
-- back later:
--
--   * No capitation. I8 removed it as a product, enum values and all
--     (20260729122912). A payer here is a per-service purchaser — it
--     configures a benefit, may pre-authorise, pays a claim. There is no
--     per-member-per-month arrangement anywhere in module 27 and nothing in
--     it can express one.
--   * No individual clinical data to the payer, ever. I9's rule for
--     institutions applies with at least equal force to an insurer: what a
--     payer may see is eligibility, benefits, authorisation and claims —
--     administrative facts about its own contract — plus suppressed
--     aggregates. Everything clinical stays on the Tarragon side of the
--     line, enforced by column-level splits and views in the migrations that
--     follow, not by what the UI happens to render.
--   * Nothing switches on. Every table here is gated on
--     private.module_enabled('payer_platform'), which ships false.
--
-- ---------------------------------------------------------------------------
-- 1. Enums.
-- ---------------------------------------------------------------------------
do $$ begin
  create type public.payer_onboarding_status as enum (
    'prospect', 'contracting', 'configuring', 'live', 'suspended', 'terminated'
  );
exception when duplicate_object then null; end $$;

comment on type public.payer_onboarding_status is
  'Where an insurer is in its commercial relationship with Tarragon. Distinct from insurers.is_active, which is the operational switch the coverage/claim RPCs check: a payer can be "live" commercially and still be switched off for an incident.';

do $$ begin
  create type public.payer_plan_status as enum ('draft', 'active', 'closed');
exception when duplicate_object then null; end $$;

-- 27.14 in enum form. A payer seat only ever holds the powers its job needs;
-- "give them owner" has to be a visible choice, not the only option.
do $$ begin
  create type public.payer_admin_role as enum (
    'owner',                -- everything below, plus managing other seats
    'benefits_manager',     -- plans, benefit schedules, network
    'authorisation_officer',-- pre-authorisation queue decisions
    'claims_officer',       -- claims adjudication and settlement
    'analyst'               -- read-only: aggregates and their own registers
  );
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- 2. insurers becomes an operator, not just a directory entry.
-- ---------------------------------------------------------------------------
alter table public.insurers
  add column if not exists organisation_id  uuid references public.organisations (id) on delete set null,
  add column if not exists code             text,
  add column if not exists onboarding_status public.payer_onboarding_status not null default 'prospect',
  add column if not exists activated_at     timestamptz,
  add column if not exists activated_by     uuid references public.profiles (id) on delete set null,
  add column if not exists member_id_format text,
  add column if not exists settlement_terms_days integer,
  add column if not exists min_cohort_size  integer not null default 10;

do $$ begin
  alter table public.insurers add constraint insurers_code_key unique (code);
exception when duplicate_table then null; when duplicate_object then null; end $$;

do $$ begin
  alter table public.insurers
    add constraint insurers_min_cohort_size_floor check (min_cohort_size >= 5);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.insurers
    add constraint insurers_settlement_terms_sane
      check (settlement_terms_days is null or (settlement_terms_days >= 0 and settlement_terms_days <= 365));
exception when duplicate_object then null; end $$;

-- An insurer cannot be operationally active unless it is commercially live.
-- This is the invariant that stops "we switched it on to test" turning into a
-- payer transacting against no contract.
do $$ begin
  alter table public.insurers
    add constraint insurers_active_requires_live
      check (not is_active or onboarding_status = 'live');
exception when duplicate_object then null; end $$;

comment on column public.insurers.organisation_id is
  'The Tarragon organisations row that owns this payer''s staff logins, when it has any. Nullable and deliberately NOT the tenancy anchor for member data: an insurer''s members are patients of whichever organisation actually cares for them, never of the insurer.';
comment on column public.insurers.min_cohort_size is
  'Small-cell suppression floor for this payer''s aggregate analytics, mirroring organisations.min_cohort_size and the same I9 reasoning: a percentage over four people is individual health data wearing a percentage sign. Floor of 5 is enforced; it cannot be switched off.';
comment on column public.insurers.member_id_format is
  'Human-readable description of this insurer''s own member-number format (27.3, "linked through insurance identifiers"). Documentation for whoever reconciles an import, not a validation regex — real Nigerian HMO member IDs are not consistent enough to reject on.';

-- ---------------------------------------------------------------------------
-- 3. Scoping helpers. Every payer-side policy and RPC in module 27 goes
--    through these two and nothing else.
-- ---------------------------------------------------------------------------
create table public.payer_administrators (
  id            uuid primary key default gen_random_uuid(),
  insurer_id    uuid not null references public.insurers (id) on delete cascade,
  profile_id    uuid not null references public.profiles (id) on delete cascade,
  payer_role    public.payer_admin_role not null default 'analyst',
  is_active     boolean not null default true,
  job_title     text,
  invited_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (insurer_id, profile_id)
);

comment on table public.payer_administrators is
  'Which login administers which insurer, and with what powers. A profile with role=payer_admin and no row here can reach nothing — membership is the grant, the account role only decides which dashboard exists.';

create index payer_administrators_profile_idx on public.payer_administrators (profile_id) where is_active;
create index payer_administrators_insurer_idx on public.payer_administrators (insurer_id) where is_active;

create trigger payer_administrators_set_updated_at
  before update on public.payer_administrators
  for each row execute function private.set_updated_at();

-- A payer seat must belong to an account provisioned as one. Without this,
-- an admin could hand a patient or a clinician an insurer's claims register
-- by inserting a single row.
create or replace function private.payer_administrators_role_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.user_role;
begin
  select role into v_role from public.profiles where id = new.profile_id;
  if v_role is null then
    raise exception 'no such profile' using errcode = '23503';
  end if;
  if v_role not in ('payer_admin', 'admin') then
    raise exception 'a payer administrator seat needs an account with role payer_admin (this one is %)', v_role
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger payer_administrators_role_guard
  before insert or update of profile_id on public.payer_administrators
  for each row execute function private.payer_administrators_role_guard();

-- The predicate. Superadmin always passes — somebody has to be able to
-- configure a payer BEFORE the module is switched on, and that is the only
-- exception. Everyone else needs the module live, an active seat, an active
-- account, and (optionally) one of a named set of payer roles.
create or replace function private.is_payer_admin_for(
  p_insurer uuid,
  p_roles text[] default null
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_admin()
    or (
      private.module_enabled('payer_platform')
      and exists (
        select 1
        from public.payer_administrators pa
        join public.profiles p on p.id = pa.profile_id
        where pa.profile_id = (select auth.uid())
          and pa.insurer_id = p_insurer
          and pa.is_active
          and p.is_active
          and p.role = 'payer_admin'
          and (
            p_roles is null
            or pa.payer_role = 'owner'
            or pa.payer_role::text = any (p_roles)
          )
      )
    );
$$;

comment on function private.is_payer_admin_for(uuid, text[]) is
  'True when the caller may act for this insurer. Requires the payer_platform module to be enabled — a dormant module means every payer policy evaluates false, which is what "built but not live" is enforced by. The owner payer_role implicitly satisfies any requested role set. Superadmin passes unconditionally, so the platform can be configured before activation.';

revoke all on function private.is_payer_admin_for(uuid, text[]) from public;

-- Every insurer the caller can act for, for the "list my own" queries.
create or replace function private.payer_insurer_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select pa.insurer_id
  from public.payer_administrators pa
  join public.profiles p on p.id = pa.profile_id
  where pa.profile_id = (select auth.uid())
    and pa.is_active
    and p.is_active
    and p.role = 'payer_admin'
    and private.module_enabled('payer_platform');
$$;

revoke all on function private.payer_insurer_ids() from public;

alter table public.payer_administrators enable row level security;

-- A seat-holder sees their own row and their colleagues'; an owner manages
-- them; Tarragon's own insurance admins manage everything.
create policy payer_administrators_select on public.payer_administrators
  for select to authenticated
  using (
    private.is_insurance_admin()
    or profile_id = (select auth.uid())
    or private.is_payer_admin_for(insurer_id)
  );

create policy payer_administrators_manage on public.payer_administrators
  for all to authenticated
  using (private.is_insurance_admin() or private.is_payer_admin_for(insurer_id, array['owner']))
  with check (private.is_insurance_admin() or private.is_payer_admin_for(insurer_id, array['owner']));

grant select, insert, update, delete on public.payer_administrators to authenticated;
revoke all on public.payer_administrators from anon;

-- ---------------------------------------------------------------------------
-- 4. Plans (27.2). Until now a "plan" was a free-text plan_name on a policy
--    and on a benefit row, matched by string equality. That is fine for
--    transcribing a patient's card and hopeless for a payer administering
--    its own products. This gives a plan an identity; plan_name keeps
--    working underneath (see the sync trigger below) so nothing that reads
--    it today changes behaviour.
-- ---------------------------------------------------------------------------
create table public.payer_plans (
  id              uuid primary key default gen_random_uuid(),
  insurer_id      uuid not null references public.insurers (id) on delete restrict,
  code            text not null,
  name            text not null,
  description     text,
  plan_year       integer,
  status          public.payer_plan_status not null default 'draft',
  effective_from  date,
  effective_to    date,
  created_by      uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (insurer_id, code),
  unique (insurer_id, name),
  constraint payer_plans_dates_ordered
    check (effective_to is null or effective_from is null or effective_to >= effective_from),
  constraint payer_plans_plan_year_sane
    check (plan_year is null or (plan_year between 2020 and 2100))
);

comment on table public.payer_plans is
  '27.2 Plans. unique(insurer_id, name) is not decoration: insurance_policies.plan_name and insurance_benefits.plan_name are matched by string, so two plans sharing a name would make the legacy benefit lookup ambiguous.';

create index payer_plans_insurer_idx on public.payer_plans (insurer_id, status);

create trigger payer_plans_set_updated_at
  before update on public.payer_plans
  for each row execute function private.set_updated_at();

alter table public.payer_plans enable row level security;

-- Product configuration, not patient data: once the module is live any
-- signed-in account may read the catalogue (a clinician needs to know what a
-- patient's plan is called). Dormant, only Tarragon's insurance admins see it.
create policy payer_plans_select on public.payer_plans
  for select to authenticated
  using (private.is_insurance_admin() or private.module_enabled('payer_platform'));

create policy payer_plans_manage on public.payer_plans
  for all to authenticated
  using (
    private.is_insurance_admin()
    or private.is_payer_admin_for(insurer_id, array['benefits_manager'])
  )
  with check (
    private.is_insurance_admin()
    or private.is_payer_admin_for(insurer_id, array['benefits_manager'])
  );

grant select, insert, update, delete on public.payer_plans to authenticated;
revoke all on public.payer_plans from anon;

-- ---------------------------------------------------------------------------
-- 5. Wire plans into the existing policy/benefit tables, additively.
-- ---------------------------------------------------------------------------
alter table public.insurance_policies
  add column if not exists payer_plan_id uuid references public.payer_plans (id) on delete set null;

alter table public.insurance_benefits
  add column if not exists payer_plan_id uuid references public.payer_plans (id) on delete cascade;

create index if not exists insurance_policies_payer_plan_idx
  on public.insurance_policies (payer_plan_id) where payer_plan_id is not null;
create index if not exists insurance_benefits_payer_plan_idx
  on public.insurance_benefits (payer_plan_id) where payer_plan_id is not null;

-- The one thing that must never drift: if a row names a plan by id, its
-- plan_name text is that plan's name, so check_insurance_coverage()'s
-- string match and the payer's structured view can never disagree about
-- which benefit applies. Also refuses a plan belonging to a different
-- insurer, which string matching could never have caught.
create or replace function private.payer_sync_plan_name()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan public.payer_plans%rowtype;
begin
  if new.payer_plan_id is null then
    return new;
  end if;

  select * into v_plan from public.payer_plans where id = new.payer_plan_id;
  if v_plan.id is null then
    raise exception 'no such payer plan' using errcode = '23503';
  end if;
  if v_plan.insurer_id <> new.insurer_id then
    raise exception 'plan % belongs to a different insurer', v_plan.name using errcode = '23514';
  end if;

  new.plan_name := v_plan.name;
  return new;
end;
$$;

create trigger insurance_policies_sync_plan_name
  before insert or update of payer_plan_id, plan_name, insurer_id on public.insurance_policies
  for each row execute function private.payer_sync_plan_name();

create trigger insurance_benefits_sync_plan_name
  before insert or update of payer_plan_id, plan_name, insurer_id on public.insurance_benefits
  for each row execute function private.payer_sync_plan_name();

-- ---------------------------------------------------------------------------
-- 6. Assertions.
-- ---------------------------------------------------------------------------
do $$
declare
  v_insurer uuid;
  v_plan    uuid;
  v_other   uuid;
  v_name    text;
begin
  -- Grants: a freshly created table needs its own grant, RLS is not access
  -- (CLAUDE.md's own standing lesson — this has silently broken access three
  -- separate times on this platform).
  if not has_table_privilege('authenticated', 'public.payer_plans', 'SELECT')
     or not has_table_privilege('authenticated', 'public.payer_administrators', 'SELECT') then
    raise exception 'FAIL: authenticated has no SELECT on the new payer tables';
  end if;
  if has_table_privilege('anon', 'public.payer_plans', 'SELECT') then
    raise exception 'FAIL: anon can read payer_plans';
  end if;

  -- The dormancy gate really is wired into the payer predicate. Text check,
  -- because the behavioural half needs a payer_admin account that does not
  -- exist yet and is proved in packages/db/tests/.
  if pg_get_functiondef('private.is_payer_admin_for(uuid,text[])'::regprocedure)
       not like '%module_enabled(''payer_platform'')%' then
    raise exception 'FAIL: is_payer_admin_for does not gate on the module switch';
  end if;

  -- No insurer may be operationally active while not commercially live.
  if exists (select 1 from public.insurers where is_active and onboarding_status <> 'live') then
    raise exception 'FAIL: an insurer is active without being live';
  end if;

  -- Plan-name sync discriminates rather than passing vacuously: set a
  -- deliberately wrong plan_name alongside a real payer_plan_id and confirm
  -- the trigger overwrites it, then confirm a cross-insurer plan is refused.
  begin
    select id into v_insurer from public.insurers order by name limit 1;
    select id into v_other from public.insurers where id <> v_insurer order by name limit 1;

    insert into public.payer_plans (insurer_id, code, name, status)
    values (v_insurer, 'ASSERT-TMP', 'Assertion Temp Plan', 'draft')
    returning id into v_plan;

    insert into public.insurance_benefits
      (insurer_id, payer_plan_id, plan_name, service_category, coverage_pct)
    values (v_insurer, v_plan, 'DELIBERATELY WRONG', 'consultation', 0.8);

    select plan_name into v_name from public.insurance_benefits
      where payer_plan_id = v_plan;
    if v_name <> 'Assertion Temp Plan' then
      raise exception 'FAIL: plan_name was not synced from payer_plan_id (got %)', v_name;
    end if;

    begin
      insert into public.insurance_benefits
        (insurer_id, payer_plan_id, service_category, coverage_pct)
      values (v_other, v_plan, 'laboratory', 0.5);
      raise exception 'FAIL: a benefit accepted a plan belonging to another insurer';
    exception
      when check_violation then null;
    end;

    raise exception 'ROLLBACK_ASSERTIONS';
  exception
    when others then
      if sqlerrm <> 'ROLLBACK_ASSERTIONS' then raise; end if;
  end;

  if exists (select 1 from public.payer_plans where code = 'ASSERT-TMP') then
    raise exception 'FAIL: the assertion fixture survived — it should have rolled back';
  end if;

  raise notice 'PASS: payer core in place, dormant, plan-name sync proved to discriminate';
end $$;
