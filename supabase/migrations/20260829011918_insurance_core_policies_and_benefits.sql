-- Tarragon Health — insurance, part 1: insurers, policies, benefits (spec
-- §25.16). The platform has membership entitlements (subscription plans),
-- employer-funded entitlements (the sponsor/Care Voucher model), and now
-- this: a third, independent payer dimension. Nothing about this changes
-- how membership or sponsor entitlement already work — §25.10's flow
-- ("check membership → check insurance → check employer → determine patient
-- responsibility") stays a chain of independent checks, and this migration
-- only builds the "check insurance" link.
--
-- Deliberately does NOT touch the checkout/booking-payment flow — actually
-- charging a reduced co-pay instead of full price at booking time, and
-- whether Tarragon bills the insurer directly (creating a real receivable)
-- or the patient pays in full and claims reimbursement themselves, are
-- genuine unresolved business decisions this migration is not positioned to
-- make. What ships here is the data model and a coverage-check RPC a
-- checkout flow could call once that decision is made — see part 2's header
-- for the same discipline applied to claims/pre-authorisation.
--
-- No capitation anywhere in this: an insurer here is a per-service payer
-- (checks a benefit, may pre-authorise, may pay a claim), never a fixed
-- per-member-per-month arrangement — that stays permanently retired per I8
-- (20260729122912_remove_hmo_capitation_i8.sql).

-- ---------------------------------------------------------------------------
-- 1. Permissions.
-- ---------------------------------------------------------------------------
insert into public.permissions (key, label, category, description) values
  ('insurance.manage', 'Manage insurers & benefits', 'Insurance', 'Create/edit insurers and their benefit schedules.'),
  ('insurance.claims.manage', 'Process insurance claims', 'Insurance', 'Record patient policies, pre-authorisation and claim decisions.')
on conflict (key) do nothing;

create or replace function private.is_insurance_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_permission('insurance.manage')
    or exists (select 1 from public.profiles where id = (select auth.uid()) and role = 'admin');
$$;

revoke all on function private.is_insurance_admin() from public;

-- ---------------------------------------------------------------------------
-- 2. Insurers — a global payer directory, same shape as lab_providers /
-- pharmacy_partners (no organisation_id: an insurer is not specific to one
-- Tarragon tenant). claim_submission_method exists because the spec is
-- explicit that "Tarragon should not assume every insurer uses the same
-- process" — some take an emailed claim, some a portal upload, none of them
-- (yet) a real API Tarragon can call, so this is descriptive metadata for
-- whoever is submitting the claim, not a code branch.
-- ---------------------------------------------------------------------------
create table public.insurers (
  id                      uuid primary key default gen_random_uuid(),
  name                    text not null unique,
  claim_submission_method text not null default 'manual'
    check (claim_submission_method in ('manual', 'portal', 'email', 'api')),
  portal_url              text,
  contact_email           text,
  contact_phone           text,
  is_active               boolean not null default true,
  notes                   text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

drop trigger if exists insurers_set_updated_at on public.insurers;
create trigger insurers_set_updated_at
  before update on public.insurers
  for each row execute function private.set_updated_at();

alter table public.insurers enable row level security;

create policy insurers_select on public.insurers
  for select to authenticated using (true);

create policy insurers_manage on public.insurers
  for all to authenticated
  using (private.is_insurance_admin())
  with check (private.is_insurance_admin());

grant select, insert, update on public.insurers to authenticated;
revoke all on public.insurers from anon;

-- Real HMOs already named as Tarragon's market references (CLAUDE.md "Key
-- Partners & Market References") — seeded here per this codebase's own
-- convention of using real names in seed data rather than "Insurer A".
insert into public.insurers (name, claim_submission_method) values
  ('Reliance HMO', 'portal'),
  ('Avon HMO', 'email'),
  ('Ronsberger HMO', 'email'),
  ('Wellahealth', 'portal')
on conflict (name) do nothing;

-- ---------------------------------------------------------------------------
-- 3. A patient's policy. Self-reportable (a patient adding their own
-- insurance card is normal UX) but not self-verifiable — verified_at/by
-- stays null-gated the same way clinical attribution does elsewhere on this
-- platform, so a patient's own unverified entry never silently reads as
-- confirmed coverage.
-- ---------------------------------------------------------------------------
do $$ begin
  create type public.insurance_policy_status as enum ('active', 'expired', 'suspended', 'cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.insurance_relationship as enum ('self', 'spouse', 'child', 'other');
exception when duplicate_object then null; end $$;

create table public.insurance_policies (
  id                  uuid primary key default gen_random_uuid(),
  organisation_id     uuid not null references public.organisations (id) on delete restrict,
  patient_id          uuid not null references public.profiles (id) on delete cascade,
  insurer_id          uuid not null references public.insurers (id) on delete restrict,
  member_id           text not null,
  plan_name           text,
  policy_holder_name  text,
  relationship        public.insurance_relationship not null default 'self',
  group_number        text,
  effective_from      date,
  effective_to        date,
  status              public.insurance_policy_status not null default 'active',
  verified_at         timestamptz,
  verified_by         uuid references public.profiles (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (insurer_id, member_id)
);

comment on column public.insurance_policies.verified_at is
  'Null until care-team/finance staff have actually checked the card/portal — same null-gated-attribution discipline as ReviewedByDoctor. A patient-entered policy with verified_at null is a claim, not a confirmed fact, and check_insurance_coverage() below treats it that way.';

create index insurance_policies_patient_idx on public.insurance_policies (patient_id, status);
create index insurance_policies_insurer_idx on public.insurance_policies (insurer_id);

drop trigger if exists insurance_policies_set_updated_at on public.insurance_policies;
create trigger insurance_policies_set_updated_at
  before update on public.insurance_policies
  for each row execute function private.set_updated_at();

alter table public.insurance_policies enable row level security;

create policy insurance_policies_patient_select on public.insurance_policies
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

create policy insurance_policies_patient_insert on public.insurance_policies
  for insert to authenticated
  with check (patient_id = (select auth.uid()) and verified_at is null and verified_by is null);

create policy insurance_policies_staff_write on public.insurance_policies
  for all to authenticated
  using (private.is_org_staff(organisation_id) or private.is_insurance_admin())
  with check (private.is_org_staff(organisation_id) or private.is_insurance_admin());

grant select, insert, update on public.insurance_policies to authenticated;
revoke all on public.insurance_policies from anon;

-- ---------------------------------------------------------------------------
-- 4. Benefits — what a plan actually covers. Keyed to insurer + plan_name
-- (plan_name null = applies to every plan from that insurer that has no
-- more specific row) rather than to an individual policy: real benefit
-- schedules are negotiated per plan, not per member.
-- ---------------------------------------------------------------------------
create table public.insurance_benefits (
  id                    uuid primary key default gen_random_uuid(),
  insurer_id            uuid not null references public.insurers (id) on delete restrict,
  plan_name             text,
  service_category      text not null check (service_category in
    ('consultation', 'laboratory', 'pharmacy', 'referral')),
  coverage_pct          numeric not null default 1.0 check (coverage_pct >= 0 and coverage_pct <= 1),
  copay_fixed_kobo      bigint not null default 0 check (copay_fixed_kobo >= 0),
  annual_limit_kobo     bigint check (annual_limit_kobo is null or annual_limit_kobo >= 0),
  requires_preauth      boolean not null default false,
  preauth_threshold_kobo bigint check (preauth_threshold_kobo is null or preauth_threshold_kobo >= 0),
  notes                 text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (insurer_id, plan_name, service_category)
);

comment on column public.insurance_benefits.plan_name is
  'Null = the default benefit for this insurer/category when no plan-specific row exists. A specific plan_name row always wins over a null one for the same insurer + category.';
comment on column public.insurance_benefits.preauth_threshold_kobo is
  'Null with requires_preauth=true means every claim in this category needs pre-authorisation regardless of amount. A value means only claims at or above it do.';

create index insurance_benefits_insurer_idx on public.insurance_benefits (insurer_id, service_category);

drop trigger if exists insurance_benefits_set_updated_at on public.insurance_benefits;
create trigger insurance_benefits_set_updated_at
  before update on public.insurance_benefits
  for each row execute function private.set_updated_at();

alter table public.insurance_benefits enable row level security;

create policy insurance_benefits_select on public.insurance_benefits
  for select to authenticated using (true);

create policy insurance_benefits_manage on public.insurance_benefits
  for all to authenticated
  using (private.is_insurance_admin())
  with check (private.is_insurance_admin());

grant select, insert, update on public.insurance_benefits to authenticated;
revoke all on public.insurance_benefits from anon;

-- ---------------------------------------------------------------------------
-- 5. The entitlement check — spec §25.10/§25.11's "check insurance,
-- determine patient responsibility" step. Always resolves against the
-- CALLER's own patient_id argument; RLS on the underlying tables (not this
-- function, which is SECURITY DEFINER) is irrelevant here since this reads
-- insurers/insurance_policies/insurance_benefits and returns only a coverage
-- summary, never raw policy rows — org staff and the patient themselves can
-- both call this safely.
--
-- An unverified (patient-self-reported, staff has not confirmed it) policy
-- still returns coverage info, clearly flagged verified=false, rather than
-- silently pretending no insurance exists — a booking flow can decide for
-- itself whether to trust an unverified policy or ask the patient to wait
-- for verification; that is a UX decision, not this function's to make.
-- ---------------------------------------------------------------------------
create or replace function public.check_insurance_coverage(
  p_patient_id uuid,
  p_service_category text,
  p_amount_kobo bigint
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_patient_org uuid;
  v_policy public.insurance_policies%rowtype;
  v_insurer_name text;
  v_benefit public.insurance_benefits%rowtype;
  v_requires_preauth boolean;
  v_copay bigint;
begin
  if v_caller is null then
    raise exception 'not authenticated';
  end if;

  if p_service_category not in ('consultation', 'laboratory', 'pharmacy', 'referral') then
    raise exception 'unknown service_category: %', p_service_category using errcode = '22023';
  end if;

  -- Same coverage details a patient can see about themselves; an
  -- unrelated caller must not be able to query someone else's insurance
  -- status by guessing their patient_id — only the patient themselves or
  -- staff of that patient's own organisation may call this.
  if p_patient_id <> v_caller then
    select organisation_id into v_patient_org from public.profiles where id = p_patient_id;
    if v_patient_org is null or not private.is_org_staff(v_patient_org) then
      raise exception 'not authorised to view this patient''s insurance coverage' using errcode = '42501';
    end if;
  end if;

  select * into v_policy
    from public.insurance_policies
   where patient_id = p_patient_id
     and status = 'active'
     and (effective_to is null or effective_to >= current_date)
   order by verified_at is not null desc, created_at desc
   limit 1;

  if v_policy.id is null then
    return jsonb_build_object(
      'has_coverage', false,
      'requires_preauth', false,
      'patient_responsibility_kobo', p_amount_kobo
    );
  end if;

  select name into v_insurer_name from public.insurers where id = v_policy.insurer_id;

  -- A plan-specific row, if one exists, always wins over the insurer's
  -- default (plan_name is null) row for the same category.
  select * into v_benefit
    from public.insurance_benefits
   where insurer_id = v_policy.insurer_id
     and service_category = p_service_category
     and (plan_name = v_policy.plan_name or plan_name is null)
   order by plan_name is not null desc
   limit 1;

  if v_benefit.id is null then
    return jsonb_build_object(
      'has_coverage', false,
      'policy_id', v_policy.id,
      'insurer_name', v_insurer_name,
      'verified', v_policy.verified_at is not null,
      'requires_preauth', false,
      'patient_responsibility_kobo', p_amount_kobo,
      'note', 'A policy exists but this insurer has no benefit configured for ' || p_service_category || '.'
    );
  end if;

  v_requires_preauth := v_benefit.requires_preauth
    and (v_benefit.preauth_threshold_kobo is null or p_amount_kobo >= v_benefit.preauth_threshold_kobo);

  v_copay := greatest(
    0,
    round(p_amount_kobo * (1 - v_benefit.coverage_pct)) + v_benefit.copay_fixed_kobo
  );
  v_copay := least(v_copay, p_amount_kobo);

  return jsonb_build_object(
    'has_coverage', true,
    'policy_id', v_policy.id,
    'insurer_name', v_insurer_name,
    'verified', v_policy.verified_at is not null,
    'coverage_pct', v_benefit.coverage_pct,
    'requires_preauth', v_requires_preauth,
    'annual_limit_kobo', v_benefit.annual_limit_kobo,
    'insurer_covered_kobo', p_amount_kobo - v_copay,
    'patient_responsibility_kobo', v_copay
  );
end;
$$;

revoke all on function public.check_insurance_coverage(uuid, text, bigint) from public;
revoke all on function public.check_insurance_coverage(uuid, text, bigint) from anon;
grant execute on function public.check_insurance_coverage(uuid, text, bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Assertions.
-- ---------------------------------------------------------------------------
do $$
begin
  if (select count(*) from public.insurers) < 4 then
    raise exception 'FAIL: the four reference HMOs were not seeded';
  end if;

  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'insurance_benefits'
  ) then
    raise exception 'FAIL: insurance_benefits was not created';
  end if;

  if not has_function_privilege('authenticated', 'public.check_insurance_coverage(uuid,text,bigint)', 'EXECUTE') then
    raise exception 'FAIL: authenticated cannot execute check_insurance_coverage';
  end if;

  if pg_get_functiondef('public.check_insurance_coverage(uuid,text,bigint)'::regprocedure)
       not like '%not authorised to view this patient%' then
    raise exception 'FAIL: check_insurance_coverage is missing its cross-patient authorisation guard';
  end if;

  raise notice 'PASS: insurers, insurance_policies, insurance_benefits, and check_insurance_coverage all in place';
end $$;
