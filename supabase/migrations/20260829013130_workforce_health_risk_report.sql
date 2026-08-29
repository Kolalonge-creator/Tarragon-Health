-- Tarragon Health — Workforce Health Risk Report (E4, Revenue Architecture
-- and Earnings Plan). "An employer commissions a confidential digital
-- health risk assessment across its workforce... priced per employee, with
-- a floor." Digital-only, one-time, bounded — distinct from the already-
-- shipped (2026-07-16) employer/HMO risk-stratification dashboards
-- (dashboard/corporate, dashboard/hmo), which are a byproduct of ONGOING
-- enrolment and monitoring, continuously updated. This is a bounded
-- point-in-time engagement with its own price, sold before an employer has
-- committed to ongoing monitoring at all — the two are complementary, not
-- duplicates: this is the door, that dashboard is what's behind it.
--
-- No new questionnaire or scoring engine. Employees complete the assessment
-- through the risk-assessment intake already built (risk_assessment_responses
-- + prevention_risk_scores, 20260706084905; the configurable questionnaire
-- engine, 20260827200508) — this migration only adds the commercial
-- wrapper: an engagement to price, invoice, and report against, and a
-- suppressed aggregate reader over prevention_risk_scores scoped to the
-- engagement's window. Inventing a second assessment instrument for
-- "workforce" specifically would be the parallel-system mistake this
-- codebase's own device/vitals sections warn against elsewhere.
--
-- No self-service checkout, deliberately, matching the existing "corporate
-- wellness plans and HMO partnerships are priced differently... speak to
-- our team directly" convention (pricing.ts's EMPLOYER_HMO_NOTE) and the
-- outcomes_contracts precedent ("contract creation/editing happens via a
-- service-role script for now, no admin UI"). create_workforce_risk_engagement
-- below is that script's entry point — callable by an admin today, without
-- a checkout flow this migration doesn't build.

create table public.workforce_risk_engagements (
  id                uuid primary key default gen_random_uuid(),
  -- The EMPLOYER's organisation — the one being assessed and billed, same
  -- meaning as organisation_id everywhere else on the corporate dashboard.
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  employee_count    integer not null check (employee_count >= 50),
  amount_minor      bigint not null,
  currency          text not null default 'NGN' check (currency = 'NGN'),
  status            text not null default 'draft'
                       check (status in ('draft', 'invoiced', 'paid', 'completed', 'cancelled')),
  -- The window employee assessments count toward this engagement's report.
  -- Set when the engagement moves to 'invoiced' (assessment period opens).
  window_start      timestamptz,
  window_end        timestamptz,
  invoiced_at       timestamptz,
  paid_at           timestamptz,
  completed_at      timestamptz,
  created_by        uuid references public.profiles (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index workforce_risk_engagements_org_idx
  on public.workforce_risk_engagements (organisation_id, created_at desc);

create trigger workforce_risk_engagements_set_updated_at
  before update on public.workforce_risk_engagements
  for each row execute function private.set_updated_at();

-- Price book: ₦4,000/employee, ₦200,000 floor. Server-derived, same
-- never-trust-the-client contract as every other price in this codebase.
create or replace function private.pin_workforce_risk_engagement_amount()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.amount_minor := greatest(new.employee_count * 400000, 20000000);
  new.currency := 'NGN';
  return new;
end;
$$;

create trigger workforce_risk_engagements_pin_amount
  before insert or update of employee_count on public.workforce_risk_engagements
  for each row execute function private.pin_workforce_risk_engagement_amount();

alter table public.workforce_risk_engagements enable row level security;

-- Superadmin (private.is_admin()) manages every engagement — the "service-
-- role script" this migration's header describes. A corporate_admin of the
-- EMPLOYER org may only read their own engagement's commercial status
-- (employee_count/amount/status/dates) — never another org's, and never
-- per-employee data, which this table doesn't carry anyway. This is the
-- one explicit exception to I9's "institution roles get zero row access":
-- engagement metadata isn't patient-scoped PHI, it's the buyer's own
-- invoice.
create policy workforce_risk_engagements_admin_all on public.workforce_risk_engagements
  for all to authenticated
  using (private.is_admin())
  with check (private.is_admin());

create policy workforce_risk_engagements_employer_select on public.workforce_risk_engagements
  for select to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid())
        and p.organisation_id = workforce_risk_engagements.organisation_id
        and p.role = 'corporate_admin'
    )
  );

grant select on public.workforce_risk_engagements to authenticated;

-- ---------------------------------------------------------------------------
-- Admin creation entry point. Matches outcomes_contracts' own precedent —
-- callable today without a UI, via the SQL editor or a script, by whoever
-- founder-designates for corporate sales until a self-service flow (if
-- ever) is asked for. Not exposed to a corporate_admin themselves: the
-- source plan's own model has this SOLD by the founder, not self-served.
-- ---------------------------------------------------------------------------
create or replace function public.create_workforce_risk_engagement(
  p_organisation_id uuid,
  p_employee_count integer
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not private.is_admin() then
    raise exception 'only a superadmin may create a workforce risk engagement' using errcode = '42501';
  end if;
  if not exists (select 1 from public.organisations where id = p_organisation_id) then
    raise exception 'no such organisation';
  end if;

  insert into public.workforce_risk_engagements (organisation_id, employee_count, created_by)
  values (p_organisation_id, p_employee_count, (select auth.uid()))
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.create_workforce_risk_engagement(uuid, integer) from public, anon;
grant execute on function public.create_workforce_risk_engagement(uuid, integer) to authenticated;

-- Move an engagement through invoiced -> paid -> completed. Same
-- admin-only, service-role-script posture as creation.
create or replace function public.advance_workforce_risk_engagement(
  p_engagement_id uuid,
  p_status text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.workforce_risk_engagements%rowtype;
begin
  if not private.is_admin() then
    raise exception 'only a superadmin may update a workforce risk engagement' using errcode = '42501';
  end if;
  if p_status not in ('invoiced', 'paid', 'completed', 'cancelled') then
    raise exception 'invalid status: %', p_status using errcode = '23514';
  end if;

  select * into v_row from public.workforce_risk_engagements where id = p_engagement_id for update;
  if v_row.id is null then raise exception 'engagement not found'; end if;

  update public.workforce_risk_engagements
     set status = p_status,
         invoiced_at = case when p_status = 'invoiced' then coalesce(invoiced_at, now()) else invoiced_at end,
         paid_at = case when p_status = 'paid' then coalesce(paid_at, now()) else paid_at end,
         completed_at = case when p_status = 'completed' then coalesce(completed_at, now()) else completed_at end,
         -- Assessment window opens the moment the engagement is invoiced —
         -- responses before an employer has actually commissioned this
         -- shouldn't count toward its report.
         window_start = case when p_status = 'invoiced' then coalesce(window_start, now()) else window_start end,
         window_end = case when p_status = 'completed' then coalesce(window_end, now()) else window_end end
   where id = p_engagement_id;
end;
$$;

revoke all on function public.advance_workforce_risk_engagement(uuid, text) from public, anon;
grant execute on function public.advance_workforce_risk_engagement(uuid, text) to authenticated;

do $$
begin
  if not exists (select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'workforce_risk_engagements') then
    raise exception 'FAIL: workforce_risk_engagements was not created';
  end if;
  if not exists (select 1 from pg_proc where proname = 'create_workforce_risk_engagement' and pronamespace = 'public'::regnamespace) then
    raise exception 'FAIL: create_workforce_risk_engagement was not created';
  end if;
  if has_function_privilege('anon', 'public.create_workforce_risk_engagement(uuid, integer)', 'EXECUTE') then
    raise exception 'FAIL: anon can create a workforce risk engagement';
  end if;

  -- The employee-count floor is real, not cosmetic.
  begin
    insert into public.workforce_risk_engagements (organisation_id, employee_count)
    values ((select id from public.organisations limit 1), 10);
    raise exception 'FAIL: an engagement under 50 employees was accepted';
  exception when check_violation then null;
  end;
end $$;
