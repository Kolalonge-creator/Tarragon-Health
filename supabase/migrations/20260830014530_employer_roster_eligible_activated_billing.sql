-- Tarragon Health — Employer roster: formal eligible/activated distinction + billing.
--
-- docs/FULL_SPECIFICATION_V4.md §94.2/§94.12 (Employer Health & B2B2C Platform)
-- shows an employer dashboard as "Eligible employees: 4,000 / Activated: 2,850"
-- and a billing formula "Eligible employees x Price per member = Monthly
-- invoice". employer_roster_members (20260715162958) already carries this
-- distinction *implicitly* via its status enum (removed = not eligible,
-- pending = eligible-not-activated, claimed = eligible-and-activated) but
-- nothing names it formally or makes it reusable, and there is no per-member
-- price anywhere to turn eligible headcount into an invoice number.
--
-- Deliberately narrow, per that migration's own note that billing/entitlement
-- "shouldn't be smuggled into a roster table": this migration (1) adds one
-- read-only function that names the eligible/activated counts so the roster
-- table itself is untouched, and (2) adds a genuinely separate finance-owned
-- per-member pricing config + billing-estimate RPC, mirroring the
-- finance_budgets (20260726120200) pattern exactly — RLS-locked table, no
-- direct PostgREST access, SECURITY DEFINER RPCs gated by private.is_finance()
-- / private.finance_can(). This is standard B2B per-seat pricing (Tarragon
-- billing the employer for platform access), not capitation — it never
-- determines what care an individual patient receives and does not touch
-- subscriptions/entitlement, so it does not reopen I8 ("no capitation, ever",
-- 20260729122912): there is no per-member fee deemed to cover an employee's
-- own plan, no risk transfer, and no bypass of the ordinary payment path.
-- finance_employer_billing_summary() is explicitly labelled an internal
-- estimate for finance review — it does not generate or send an invoice.

-- ---------------------------------------------------------------------------
-- 1. Eligible/activated roster counts — read-only, runs under the caller's
--    own session (not security definer), so employer_roster_members' existing
--    RLS (org staff, or the org's own institution admin) is the only gate.
-- ---------------------------------------------------------------------------

create or replace function public.employer_roster_counts(p_organisation_id uuid)
returns table (eligible_count integer, activated_count integer, pending_count integer)
language sql
stable
set search_path = ''
as $$
  select
    count(*) filter (where status <> 'removed')::integer as eligible_count,
    count(*) filter (where status = 'claimed')::integer as activated_count,
    count(*) filter (where status = 'pending')::integer as pending_count
  from public.employer_roster_members
  where organisation_id = p_organisation_id;
$$;

revoke execute on function public.employer_roster_counts(uuid) from public, anon;
grant execute on function public.employer_roster_counts(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Per-member pricing config — finance-owned, mirrors finance_budgets:
--    RLS enabled with zero policies, all access via gated SECURITY DEFINER
--    RPCs below.
-- ---------------------------------------------------------------------------

create table public.employer_billing_configs (
  id                     uuid primary key default gen_random_uuid(),
  organisation_id        uuid not null references public.organisations (id) on delete restrict,
  price_per_member_minor bigint not null check (price_per_member_minor > 0),
  currency               public.currency not null default 'NGN',
  effective_from         date not null default current_date,
  effective_to           date,
  is_active              boolean not null default true,
  notes                  text,
  created_by             uuid references public.profiles (id) on delete set null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
alter table public.employer_billing_configs enable row level security;
create index employer_billing_configs_org_idx on public.employer_billing_configs (organisation_id, is_active);

create trigger employer_billing_configs_set_updated_at
  before update on public.employer_billing_configs
  for each row execute function private.set_updated_at();

insert into public.permissions (key, label, category, description) values
  ('finance.employer_billing.manage', 'Manage employer billing', 'Finance',
   'Set per-member pricing for employer/HMO organisations.')
on conflict (key) do nothing;

create or replace function public.finance_upsert_employer_billing_config(
  p_id uuid, p_organisation_id uuid, p_price_per_member_minor bigint,
  p_currency text, p_effective_from date, p_effective_to date, p_is_active boolean, p_notes text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_org_type public.organisation_type;
begin
  if not private.finance_can('finance.employer_billing.manage') then raise exception 'not authorised'; end if;
  select type into v_org_type from public.organisations where id = p_organisation_id;
  if v_org_type is null then raise exception 'organisation not found'; end if;
  if v_org_type not in ('corporate', 'hmo') then
    raise exception 'employer billing configs are for corporate/hmo organisations only' using errcode = 'check_violation';
  end if;
  if coalesce(p_price_per_member_minor, 0) <= 0 then raise exception 'price per member must be positive'; end if;

  if p_id is null then
    insert into public.employer_billing_configs
      (organisation_id, price_per_member_minor, currency, effective_from, effective_to, is_active, notes, created_by)
    values (p_organisation_id, p_price_per_member_minor, coalesce(p_currency,'NGN')::public.currency,
            coalesce(p_effective_from, current_date), p_effective_to, coalesce(p_is_active,true), p_notes,
            (select auth.uid()))
    returning id into v_id;
  else
    update public.employer_billing_configs set
      organisation_id = p_organisation_id, price_per_member_minor = p_price_per_member_minor,
      currency = coalesce(p_currency,'NGN')::public.currency, effective_from = coalesce(p_effective_from, current_date),
      effective_to = p_effective_to, is_active = coalesce(p_is_active,true), notes = p_notes, updated_at = now()
    where id = p_id
    returning id into v_id;
  end if;

  perform private.log_audit('finance.employer_billing_config.upsert', 'employer_billing_configs', v_id,
    jsonb_build_object('organisation_id', p_organisation_id, 'price_per_member_minor', p_price_per_member_minor));
  return v_id;
end; $$;

create or replace function public.finance_delete_employer_billing_config(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.finance_can('finance.employer_billing.manage') then raise exception 'not authorised'; end if;
  delete from public.employer_billing_configs where id = p_id;
  perform private.log_audit('finance.employer_billing_config.delete', 'employer_billing_configs', p_id, '{}'::jsonb);
end; $$;

-- Register: every corporate/hmo org, its roster's eligible/activated counts,
-- its current active per-member rate (if any), and the resulting estimate.
-- monthly_invoice_estimate_minor is null with no active rate configured — a
-- missing price is never rendered as a zero invoice.
create or replace function public.finance_employer_billing_summary()
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when private.is_finance() then coalesce((
    select jsonb_agg(jsonb_build_object(
      'organisation_id', o.id,
      'organisation_name', o.name,
      'organisation_type', o.type,
      'eligible_count', coalesce(rc.eligible_count, 0),
      'activated_count', coalesce(rc.activated_count, 0),
      'pending_count', coalesce(rc.pending_count, 0),
      'billing_config_id', bc.id,
      'price_per_member_minor', bc.price_per_member_minor,
      'currency', bc.currency,
      'effective_from', bc.effective_from,
      'effective_to', bc.effective_to,
      'notes', bc.notes,
      'monthly_invoice_estimate_minor', case when bc.price_per_member_minor is not null
        then coalesce(rc.eligible_count, 0) * bc.price_per_member_minor else null end
    ) order by o.name)
    from public.organisations o
    left join lateral (
      select * from public.employer_roster_counts(o.id)
    ) rc on true
    left join public.employer_billing_configs bc
      on bc.organisation_id = o.id and bc.is_active
      and bc.effective_from <= current_date and (bc.effective_to is null or bc.effective_to >= current_date)
    where o.type in ('corporate', 'hmo') and o.is_active
  ), '[]'::jsonb) else '[]'::jsonb end;
$$;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure::text sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in (
      'employer_roster_counts', 'finance_upsert_employer_billing_config',
      'finance_delete_employer_billing_config', 'finance_employer_billing_summary'
    )
  loop
    execute format('revoke execute on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Assertions — provable, not hopeful.
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'employer_billing_configs' and c.relrowsecurity
  ) then
    raise exception 'employer_billing_configs must have RLS enabled';
  end if;

  if exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'employer_billing_configs'
  ) then
    raise exception 'employer_billing_configs must carry zero policies — access is RPC-only, matching finance_budgets';
  end if;

  if has_function_privilege('anon', 'public.employer_roster_counts(uuid)', 'EXECUTE') then
    raise exception 'anon must not have EXECUTE on employer_roster_counts';
  end if;
  if has_function_privilege('anon', 'public.finance_employer_billing_summary()', 'EXECUTE') then
    raise exception 'anon must not have EXECUTE on finance_employer_billing_summary';
  end if;
  if has_function_privilege('anon', 'public.finance_upsert_employer_billing_config(uuid,uuid,bigint,text,date,date,boolean,text)', 'EXECUTE') then
    raise exception 'anon must not have EXECUTE on finance_upsert_employer_billing_config';
  end if;
end $$;
