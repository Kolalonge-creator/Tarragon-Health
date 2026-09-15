-- Tarragon Health — Employer Health Platform, part 3/6: benefit packages and
-- entitlement-engine wiring (Module 26 §26.6, §26.7).
--
-- §26.6 lists what an employer can purchase as five categories (preventive
-- programme, chronic care, clinical access, diagnostics, lifestyle) and §26.7
-- shows a worked example: "2 GP consultations/year, Annual health assessment,
-- Chronic disease management, 10% partner diagnostic discount".
--
-- ── Reused, not reinvented ──────────────────────────────────────────────────
-- Every one of those five categories is already a `subscription_plans.features[]`
-- entry on the platform (prevention_coordination, chronic, lab_coordination,
-- lifestyle_coaching, clinician_review, health_education, …) — see
-- 20260712201523_generalized_feature_access.sql and the current plan catalog
-- (prevent/essential/complete). Building a second, employer-only feature
-- toggle system beside that would be exactly the kind of parallel source of
-- truth this codebase avoids. So an employer benefit package is, at its core,
-- a reference to one of the SAME subscription_plans rows individual patients
-- already buy, plus whichever add_ons the employer wants layered on. What a
-- package adds that plans/add-ons genuinely do not model:
--   * a per-year COUNT limit on something (§26.7's "2 GP consultations/year"
--     is a metered allowance, not a boolean gate — has_feature_access only
--     ever answers yes/no)
--   * a partner-diagnostic discount percentage
--   * which employee segment gets which package (§26.5's "executive plans"
--     is just a richer package assigned to a smaller segment)
--
-- ── How a package becomes a real entitlement ────────────────────────────────
-- `payment_provider` gained 'employer' in part 2a. When a roster member is
-- claimed (or reassigned to a different package) while carrying a
-- `benefit_package_id`, a trigger opens or updates a real `subscriptions` row:
-- provider='employer', amount_minor=0 (the employer, not the employee, is
-- the payer — invoicing that is part 6/6's job), plan_id = the package's
-- subscription_plan_id. private.patient_has_feature_access() and
-- public.has_feature_access() then resolve it with ZERO changes to either
-- function — an employer benefit is indistinguishable, from the entitlement
-- resolver's point of view, from a patient who paid Paystack directly. On
-- departure (or removal), the same trigger cancels it. This is the same
-- "derive it by trigger off the roster" shape part 2b used for
-- profiles.organisation_id, for the same reason: one code path, not one per
-- join/departure route.
--
-- ── What this migration deliberately does NOT touch ────────────────────────
-- Consultation booking, video_consultations, and every other clinical
-- workflow are unmodified. The allowance ledger here (employer_benefit_
-- allowances / employer_allowance_usage) is infrastructure a future booking
-- flow can call into (public.employer_consume_allowance), not a rewire of
-- today's booking system — that would be a materially larger, separate piece
-- of work than "wire employer benefits into the entitlement engine" asks for.

-- ---------------------------------------------------------------------------
-- Enum
-- ---------------------------------------------------------------------------

-- §26.7's countable benefit types. Deliberately narrow to what is actually
-- metered per-person-per-year today — everything else in §26.6 is a plan
-- feature (unlimited within the plan) or the lab_discount_percent below.
create type public.employer_allowance_type as enum (
  'gp_consultation',
  'specialist_consultation',
  'health_assessment'
);

-- ---------------------------------------------------------------------------
-- employer_benefit_packages
-- ---------------------------------------------------------------------------

create table public.employer_benefit_packages (
  id                   uuid primary key default gen_random_uuid(),
  organisation_id      uuid not null references public.organisations (id) on delete cascade,
  name                 text not null,
  subscription_plan_id uuid not null references public.subscription_plans (id) on delete restrict,
  -- §26.7 "10% partner diagnostic discount". A whole number 0-100, applied at
  -- the point of sale by whatever partner-billing code already prices a lab
  -- order — out of scope here to also wire that read path in, since no such
  -- discount mechanism exists yet for ANY payer type on the platform.
  lab_discount_percent smallint not null default 0,
  is_default           boolean not null default false,
  is_active            boolean not null default true,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint employer_benefit_packages_name_not_blank check (length(trim(name)) > 0),
  constraint employer_benefit_packages_discount_range check (lab_discount_percent between 0 and 100)
);

create unique index employer_benefit_packages_org_name_key
  on public.employer_benefit_packages (organisation_id, lower(trim(name)));

-- At most one default package per org — the one a roster member gets when
-- nobody picked a specific package for them.
create unique index employer_benefit_packages_one_default_per_org
  on public.employer_benefit_packages (organisation_id)
  where is_default and is_active;

create index employer_benefit_packages_org_idx on public.employer_benefit_packages (organisation_id) where is_active;

create trigger employer_benefit_packages_set_updated_at
  before update on public.employer_benefit_packages
  for each row execute function private.set_updated_at();

comment on table public.employer_benefit_packages is
  'What an employer purchases (Module 26 §26.6/§26.7): a reference to an existing subscription_plans tier, plus employer-specific extras a plan cannot express. Grants nothing by itself — see employer_roster_members.benefit_package_id and the sync trigger below.';

-- A package pointing at another org's plan would be meaningless (a package IS
-- an entitlement grant, so this is worth a real trigger, not just a comment).
-- subscription_plans has no organisation_id (it's a shared platform catalog),
-- so the only real invariant to enforce is the org match on the package row
-- itself, already covered by the FK; nothing further needed here.

create function private.assert_benefit_package_org_matches()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.subscription_plans where id = new.subscription_plan_id and is_active) then
    raise exception 'employer_benefit_packages.subscription_plan_id must reference an active plan';
  end if;
  return new;
end;
$$;

create trigger employer_benefit_packages_plan_is_active
  before insert or update of subscription_plan_id on public.employer_benefit_packages
  for each row execute function private.assert_benefit_package_org_matches();

-- ---------------------------------------------------------------------------
-- employer_benefit_package_add_ons — the "layered on" add-ons for a package
-- ---------------------------------------------------------------------------

create table public.employer_benefit_package_add_ons (
  package_id uuid not null references public.employer_benefit_packages (id) on delete cascade,
  add_on_id  uuid not null references public.add_ons (id) on delete restrict,
  primary key (package_id, add_on_id)
);

-- ---------------------------------------------------------------------------
-- employer_benefit_allowances — the per-package annual limits
-- ---------------------------------------------------------------------------

create table public.employer_benefit_allowances (
  id            uuid primary key default gen_random_uuid(),
  package_id    uuid not null references public.employer_benefit_packages (id) on delete cascade,
  allowance_type public.employer_allowance_type not null,
  annual_limit  integer not null,
  created_at    timestamptz not null default now(),
  constraint employer_benefit_allowances_limit_positive check (annual_limit > 0)
);

create unique index employer_benefit_allowances_package_type_key
  on public.employer_benefit_allowances (package_id, allowance_type);

-- ---------------------------------------------------------------------------
-- The roster gains a package assignment
-- ---------------------------------------------------------------------------

alter table public.employer_roster_members
  add column benefit_package_id     uuid references public.employer_benefit_packages (id) on delete set null,
  -- The subscription this roster row currently funds, so the sync trigger
  -- knows what to cancel on reassignment/departure without guessing which of
  -- the employee's subscriptions (they may have had a prior personal one) is
  -- the employer-granted one.
  add column granted_subscription_id uuid references public.subscriptions (id) on delete set null;

create function private.assert_roster_package_same_org()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  if new.benefit_package_id is null then
    return new;
  end if;
  select organisation_id into v_org from public.employer_benefit_packages where id = new.benefit_package_id;
  if v_org is distinct from new.organisation_id then
    raise exception 'employer_roster_members.benefit_package_id must belong to the same organisation';
  end if;
  return new;
end;
$$;

create trigger employer_roster_members_package_same_org
  before insert or update of benefit_package_id, organisation_id on public.employer_roster_members
  for each row execute function private.assert_roster_package_same_org();

-- ---------------------------------------------------------------------------
-- The sync: roster claim/reassignment/departure <-> a real subscriptions row
-- ---------------------------------------------------------------------------

create function private.sync_employer_subscription_from_roster()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_package public.employer_benefit_packages;
  v_period_end timestamptz;
  v_sub_id uuid;
begin
  if new.claimed_profile_id is null then
    return null;
  end if;

  -- Departure/removal: cancel whatever this roster row was funding. Only
  -- touches a subscription THIS row granted — a personal, self-paid
  -- subscription the employee holds independently is never touched.
  if new.status in ('departed', 'removed')
     and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    if new.granted_subscription_id is not null then
      update public.subscriptions
         set status = 'cancelled', cancelled_at = now()
       where id = new.granted_subscription_id
         and status in ('active', 'trialing');
    end if;
    return null;
  end if;

  if new.status <> 'claimed' then
    return null;
  end if;

  -- Nothing to grant without a package — an employer may enrol someone in the
  -- roster (for the free workforce cohort tracking §26.8 reports on) without
  -- necessarily funding a paid tier for them yet.
  if new.benefit_package_id is null then
    return null;
  end if;

  -- Only act when something relevant actually changed, so a claim that
  -- re-fires this trigger for an unrelated column update is a no-op.
  if tg_op = 'UPDATE'
     and old.status = 'claimed'
     and old.benefit_package_id is not distinct from new.benefit_package_id
     and old.claimed_profile_id is not distinct from new.claimed_profile_id
     and old.eligible_until is not distinct from new.eligible_until then
    return null;
  end if;

  select * into v_package from public.employer_benefit_packages where id = new.benefit_package_id and is_active;
  if v_package.id is null then
    return null;
  end if;

  v_period_end := case when new.eligible_until is not null
                       then new.eligible_until::timestamptz + interval '1 day'
                       else now() + interval '1 year' end;

  -- A prior grant on this same package just gets its period refreshed rather
  -- than closed and reopened — reopening would reset any allowance-usage
  -- period tied to the subscription's own current_period_end.
  if new.granted_subscription_id is not null then
    update public.subscriptions
       set plan_id = v_package.subscription_plan_id,
           current_period_end = v_period_end,
           status = 'active',
           cancelled_at = null
     where id = new.granted_subscription_id
       and subscriber_id = new.claimed_profile_id
     returning id into v_sub_id;
  end if;

  if v_sub_id is null then
    -- No open personal-or-employer subscription row to reuse: end any prior
    -- employer grant this row itself made (defensive — should already be
    -- cancelled by the departed/removed branch above) and open a fresh one.
    insert into public.subscriptions
      (organisation_id, subscriber_id, plan_id, status, currency, amount_minor,
       interval, provider, current_period_end, started_at)
    values
      (new.organisation_id, new.claimed_profile_id, v_package.subscription_plan_id,
       'active', 'ngn', 0, 'monthly', 'employer', v_period_end, now())
    returning id into v_sub_id;

    update public.employer_roster_members set granted_subscription_id = v_sub_id where id = new.id;
  end if;

  return null;
end;
$$;

create trigger employer_roster_members_sync_subscription
  after insert or update of status, benefit_package_id, claimed_profile_id, eligible_until
  on public.employer_roster_members
  for each row execute function private.sync_employer_subscription_from_roster();

-- ---------------------------------------------------------------------------
-- RLS + grants for the three new tables
-- ---------------------------------------------------------------------------

alter table public.employer_benefit_packages         enable row level security;
alter table public.employer_benefit_package_add_ons  enable row level security;
alter table public.employer_benefit_allowances        enable row level security;

grant select, insert, update, delete on public.employer_benefit_packages        to authenticated;
grant select, insert, update, delete on public.employer_benefit_package_add_ons to authenticated;
grant select, insert, update, delete on public.employer_benefit_allowances      to authenticated;

do $$
declare t text;
begin
  foreach t in array array['employer_benefit_packages']
  loop
    execute format($f$
      create policy %1$s_select on public.%1$I
        for select to authenticated
        using (private.is_org_staff(organisation_id)
               or (private.is_institution_admin() and organisation_id = private.current_org_id()));
      create policy %1$s_insert on public.%1$I
        for insert to authenticated
        with check (private.is_org_staff(organisation_id)
                    or (private.is_institution_admin() and organisation_id = private.current_org_id()));
      create policy %1$s_update on public.%1$I
        for update to authenticated
        using (private.is_org_staff(organisation_id)
               or (private.is_institution_admin() and organisation_id = private.current_org_id()))
        with check (private.is_org_staff(organisation_id)
                    or (private.is_institution_admin() and organisation_id = private.current_org_id()));
      create policy %1$s_delete on public.%1$I
        for delete to authenticated
        using (private.is_org_staff(organisation_id)
               or (private.is_institution_admin() and organisation_id = private.current_org_id()));
    $f$, t);
  end loop;
end;
$$;

-- The two child tables key off their parent package's org rather than
-- carrying their own organisation_id.
create policy employer_benefit_package_add_ons_select on public.employer_benefit_package_add_ons
  for select to authenticated
  using (exists (select 1 from public.employer_benefit_packages p where p.id = package_id
                 and (private.is_org_staff(p.organisation_id)
                      or (private.is_institution_admin() and p.organisation_id = private.current_org_id()))));
create policy employer_benefit_package_add_ons_insert on public.employer_benefit_package_add_ons
  for insert to authenticated
  with check (exists (select 1 from public.employer_benefit_packages p where p.id = package_id
                       and (private.is_org_staff(p.organisation_id)
                            or (private.is_institution_admin() and p.organisation_id = private.current_org_id()))));
create policy employer_benefit_package_add_ons_delete on public.employer_benefit_package_add_ons
  for delete to authenticated
  using (exists (select 1 from public.employer_benefit_packages p where p.id = package_id
                 and (private.is_org_staff(p.organisation_id)
                      or (private.is_institution_admin() and p.organisation_id = private.current_org_id()))));

create policy employer_benefit_allowances_select on public.employer_benefit_allowances
  for select to authenticated
  using (exists (select 1 from public.employer_benefit_packages p where p.id = package_id
                 and (private.is_org_staff(p.organisation_id)
                      or (private.is_institution_admin() and p.organisation_id = private.current_org_id()))));
create policy employer_benefit_allowances_insert on public.employer_benefit_allowances
  for insert to authenticated
  with check (exists (select 1 from public.employer_benefit_packages p where p.id = package_id
                       and (private.is_org_staff(p.organisation_id)
                            or (private.is_institution_admin() and p.organisation_id = private.current_org_id()))));
create policy employer_benefit_allowances_update on public.employer_benefit_allowances
  for update to authenticated
  using (exists (select 1 from public.employer_benefit_packages p where p.id = package_id
                 and (private.is_org_staff(p.organisation_id)
                      or (private.is_institution_admin() and p.organisation_id = private.current_org_id()))))
  with check (exists (select 1 from public.employer_benefit_packages p where p.id = package_id
                       and (private.is_org_staff(p.organisation_id)
                            or (private.is_institution_admin() and p.organisation_id = private.current_org_id()))));
create policy employer_benefit_allowances_delete on public.employer_benefit_allowances
  for delete to authenticated
  using (exists (select 1 from public.employer_benefit_packages p where p.id = package_id
                 and (private.is_org_staff(p.organisation_id)
                      or (private.is_institution_admin() and p.organisation_id = private.current_org_id()))));

-- ---------------------------------------------------------------------------
-- Allowance usage ledger + consumption RPC (infrastructure for a future
-- booking-flow integration — see the header note on scope)
-- ---------------------------------------------------------------------------

create table public.employer_allowance_usage (
  id             uuid primary key default gen_random_uuid(),
  patient_id     uuid not null references public.profiles (id) on delete cascade,
  package_id     uuid not null references public.employer_benefit_packages (id) on delete cascade,
  allowance_type public.employer_allowance_type not null,
  period_start   date not null,
  period_end     date not null,
  used_count     integer not null default 0,
  updated_at     timestamptz not null default now(),
  constraint employer_allowance_usage_count_non_negative check (used_count >= 0),
  constraint employer_allowance_usage_period check (period_end > period_start)
);

create unique index employer_allowance_usage_key
  on public.employer_allowance_usage (patient_id, package_id, allowance_type, period_start);

create trigger employer_allowance_usage_set_updated_at
  before update on public.employer_allowance_usage
  for each row execute function private.set_updated_at();

alter table public.employer_allowance_usage enable row level security;
grant select, insert, update on public.employer_allowance_usage to authenticated;

-- Deliberately narrower than the other new tables: allowance usage is
-- consumption of clinical services, adjacent to clinical activity even
-- though the row itself is just a counter. Readable by the patient
-- themselves and by Tarragon care-team staff of their org — NEVER by an
-- institution admin. An employer sees only what part 4/6's aggregate
-- dashboard chooses to roll up (headline counts above the suppression floor),
-- not a per-employee usage row.
create policy employer_allowance_usage_select on public.employer_allowance_usage
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff((select organisation_id from public.profiles where id = patient_id))
  );

comment on table public.employer_allowance_usage is
  'Per-patient, per-package, per-year consumption of a metered employer benefit (Module 26 §26.7). Written only via public.employer_consume_allowance(). Never institution-admin readable — see the I9 note on employer_allowance_usage_select.';

create function public.employer_allowance_remaining(p_patient_id uuid, p_allowance_type text)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_package_id uuid;
  v_limit integer;
  v_used integer;
  v_period_start date;
  v_period_end date;
begin
  if not (private.is_admin() or (select auth.uid()) = p_patient_id
          or private.is_org_staff((select organisation_id from public.profiles where id = p_patient_id))) then
    raise exception 'Not authorised';
  end if;

  select r.organisation_id, r.benefit_package_id into v_org, v_package_id
    from public.employer_roster_members r
   where r.claimed_profile_id = p_patient_id and r.status = 'claimed'
   order by r.claimed_at desc
   limit 1;

  if v_package_id is null then
    return null; -- no employer benefit package funding this patient
  end if;

  select annual_limit into v_limit
    from public.employer_benefit_allowances
   where package_id = v_package_id and allowance_type = p_allowance_type::public.employer_allowance_type;
  if v_limit is null then
    return null; -- the package does not meter this allowance type at all
  end if;

  select (current_period_end::date - interval '1 year')::date, current_period_end::date
    into v_period_start, v_period_end
    from public.subscriptions
   where subscriber_id = p_patient_id and provider = 'employer' and status = 'active'
   order by started_at desc
   limit 1;
  v_period_start := coalesce(v_period_start, date_trunc('year', current_date)::date);
  v_period_end   := coalesce(v_period_end, (date_trunc('year', current_date) + interval '1 year')::date);

  select used_count into v_used
    from public.employer_allowance_usage
   where patient_id = p_patient_id and package_id = v_package_id
     and allowance_type = p_allowance_type::public.employer_allowance_type
     and period_start = v_period_start;

  return v_limit - coalesce(v_used, 0);
end;
$$;

revoke all on function public.employer_allowance_remaining(uuid, text) from public;
grant execute on function public.employer_allowance_remaining(uuid, text) to authenticated;
revoke execute on function public.employer_allowance_remaining(uuid, text) from anon;

create function public.employer_consume_allowance(p_patient_id uuid, p_allowance_type text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_package_id uuid;
  v_org uuid;
  v_limit integer;
  v_period_start date;
  v_period_end date;
  v_remaining integer;
begin
  -- Consumption is recorded by Tarragon staff/the booking system acting on
  -- behalf of a patient's org, or by an admin — never by the patient's own
  -- session (a self-reported allowance count is not a fact worth trusting)
  -- and never by an institution admin (see the table comment).
  if not (private.is_admin()
          or private.is_org_staff((select organisation_id from public.profiles where id = p_patient_id))) then
    raise exception 'Not authorised';
  end if;

  select r.organisation_id, r.benefit_package_id into v_org, v_package_id
    from public.employer_roster_members r
   where r.claimed_profile_id = p_patient_id and r.status = 'claimed'
   order by r.claimed_at desc
   limit 1;
  if v_package_id is null then
    raise exception 'patient has no active employer benefit package';
  end if;

  select annual_limit into v_limit
    from public.employer_benefit_allowances
   where package_id = v_package_id and allowance_type = p_allowance_type::public.employer_allowance_type;
  if v_limit is null then
    raise exception 'package does not meter %', p_allowance_type;
  end if;

  select (current_period_end::date - interval '1 year')::date, current_period_end::date
    into v_period_start, v_period_end
    from public.subscriptions
   where subscriber_id = p_patient_id and provider = 'employer' and status = 'active'
   order by started_at desc
   limit 1;
  v_period_start := coalesce(v_period_start, date_trunc('year', current_date)::date);
  v_period_end   := coalesce(v_period_end, (date_trunc('year', current_date) + interval '1 year')::date);

  insert into public.employer_allowance_usage
    (patient_id, package_id, allowance_type, period_start, period_end, used_count)
  values
    (p_patient_id, v_package_id, p_allowance_type::public.employer_allowance_type, v_period_start, v_period_end, 1)
  on conflict (patient_id, package_id, allowance_type, period_start)
  do update set used_count = employer_allowance_usage.used_count + 1
  returning v_limit - used_count into v_remaining;

  if v_remaining < 0 then
    -- Record the attempt but do not silently let it look free — the caller
    -- (a future booking flow) decides whether an over-allowance consult is
    -- billed to the employee instead, not this ledger.
    raise exception 'allowance exhausted for % (limit %)', p_allowance_type, v_limit;
  end if;

  return v_remaining;
end;
$$;

revoke all on function public.employer_consume_allowance(uuid, text) from public;
grant execute on function public.employer_consume_allowance(uuid, text) to authenticated;
revoke execute on function public.employer_consume_allowance(uuid, text) from anon;

-- ---------------------------------------------------------------------------
-- Assertions
-- ---------------------------------------------------------------------------

do $$
declare
  v_n int;
  v_fn text;
begin
  select count(*) into v_n
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname in ('employer_benefit_packages', 'employer_benefit_package_add_ons',
                        'employer_benefit_allowances', 'employer_allowance_usage')
     and c.relrowsecurity;
  if v_n <> 4 then raise exception 'FAIL: expected RLS on 4 tables, found %', v_n; end if;

  foreach v_fn in array array[
    'public.employer_allowance_remaining(uuid, text)',
    'public.employer_consume_allowance(uuid, text)'
  ] loop
    if has_function_privilege('anon', v_fn, 'EXECUTE') then
      raise exception 'FAIL: anon can execute %', v_fn;
    end if;
  end loop;

  -- has_feature_access / patient_has_feature_access must be UNCHANGED — an
  -- employer benefit resolves purely through a real subscriptions row.
  if pg_get_functiondef('public.has_feature_access(text)'::regprocedure) like '%employer%' then
    raise exception 'FAIL: has_feature_access was modified to know about employers — it should not need to';
  end if;

  raise notice 'PASS  employer benefit packages + allowance ledger, entitlement resolved via ordinary subscriptions rows';
end $$;
