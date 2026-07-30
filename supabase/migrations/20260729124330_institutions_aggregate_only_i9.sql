-- ---------------------------------------------------------------------------
-- I9 — institutions get aggregate only; only a superadmin may reach an
-- individual.
--
-- Founder decision 2026-07-29. This is not only the removal of the per-member
-- drill-down shipped 2026-07-16 — auditing it turned up a live exposure that
-- was wider than the UI:
--
--   private.is_org_staff(org) admitted EVERY non-patient role. corporate_admin
--   and hmo_admin therefore satisfied 314 policies across 110 patient-scoped
--   tables, giving an employer or HMO administrator direct RLS read access to
--   vitals, medications, screening results and clinical notes for every
--   patient in their organisation. Two such accounts exist today.
--
-- The 2026-07-16 build note reasoned that showing per-member care gaps was
-- "NOT new data exposure — org-staff already have RLS access to the underlying
-- tables". That was accurate, and it is exactly the problem: the underlying
-- access should never have been there. Hiding the UI would have left it.
--
-- So the fix is at the one place that governs all 110 tables rather than in
-- the dashboards. After this migration an institution session reads zero rows
-- from every patient-scoped table, and the aggregate dashboards are served by
-- an explicitly verified server-side path instead.
-- ---------------------------------------------------------------------------

-- 1. Name the role class ------------------------------------------------------
-- Institution roles are a distinct class from clinical/ops staff. Naming it
-- once means the rule is stated in a single place instead of being spelled out
-- as a role list in every policy that needs it.

create or replace function private.is_institution_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid())
      and role in ('corporate_admin', 'hmo_admin')
  );
$$;

comment on function private.is_institution_admin() is
  'True for an employer/HMO administrator. These accounts are deliberately '
  'excluded from private.is_org_staff (I9): they may never read an individual '
  'patient record, only verified server-side aggregates.';

-- 2. The single structural change ---------------------------------------------
-- Same shape as before, one clause added. Every patient-scoped policy in the
-- database inherits it.

create or replace function private.is_org_staff(org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid())
      and role <> 'patient'
      -- I9: an institution administrator is not care-team staff. Excluded here
      -- rather than in 314 individual policies.
      and role not in ('corporate_admin', 'hmo_admin')
      and (role = 'admin' or organisation_id = org)
  );
$$;

-- 3. Give the institution back what it legitimately owns -----------------------
-- The exclusion above is deliberately total, so the non-health surfaces an
-- employer genuinely administers have to be re-granted by name. Each of these
-- is either the employer's own HR data or an aggregate they are entitled to.
-- None of them is a patient health record.

-- The roster is the employer's own list of who they employ, supplied BY them.
drop policy if exists employer_roster_members_select on public.employer_roster_members;
drop policy if exists employer_roster_members_insert on public.employer_roster_members;
drop policy if exists employer_roster_members_update on public.employer_roster_members;
drop policy if exists employer_roster_members_delete on public.employer_roster_members;

create policy employer_roster_members_select on public.employer_roster_members
  for select to authenticated
  using (private.is_org_staff(organisation_id)
         or (private.is_institution_admin() and organisation_id = private.current_org_id()));

create policy employer_roster_members_insert on public.employer_roster_members
  for insert to authenticated
  with check (private.is_org_staff(organisation_id)
              or (private.is_institution_admin() and organisation_id = private.current_org_id()));

create policy employer_roster_members_update on public.employer_roster_members
  for update to authenticated
  using (private.is_org_staff(organisation_id)
         or (private.is_institution_admin() and organisation_id = private.current_org_id()));

create policy employer_roster_members_delete on public.employer_roster_members
  for delete to authenticated
  using (private.is_org_staff(organisation_id)
         or (private.is_institution_admin() and organisation_id = private.current_org_id()));

-- Outcome reports are frozen aggregate snapshots — the renewal evidence pack.
drop policy if exists outcome_reports_select on public.outcome_reports;
drop policy if exists outcome_reports_insert on public.outcome_reports;
drop policy if exists outcome_reports_update on public.outcome_reports;

create policy outcome_reports_select on public.outcome_reports
  for select to authenticated
  using (private.is_org_staff(organisation_id)
         or (private.is_institution_admin() and organisation_id = private.current_org_id()));

create policy outcome_reports_insert on public.outcome_reports
  for insert to authenticated
  with check (private.is_org_staff(organisation_id)
              or (private.is_institution_admin() and organisation_id = private.current_org_id()));

create policy outcome_reports_update on public.outcome_reports
  for update to authenticated
  using (private.is_org_staff(organisation_id)
         or (private.is_institution_admin() and organisation_id = private.current_org_id()));

-- Modelling constants behind the "cost avoided" estimate. Not patient data.
drop policy if exists cohort_cost_model_constants_select on public.cohort_cost_model_constants;

create policy cohort_cost_model_constants_select on public.cohort_cost_model_constants
  for select to authenticated
  using (organisation_id is null
         or private.is_org_staff(organisation_id)
         or (private.is_institution_admin() and organisation_id = private.current_org_id()));

-- 4. Small-cell suppression threshold ------------------------------------------
-- v3 §13: "any cell derived from fewer than organisations.min_cohort_size
-- individuals renders as 'insufficient data,' never a number. Small-cell
-- suppression is a re-identification control, not a nicety."
--
-- The platform had NO threshold at all — a two-person employer could read real
-- cohort percentages, which is individual health data wearing a percentage
-- sign. 10 is a conservative default; it is a per-organisation column so a
-- superadmin can raise it, and the CHECK stops anyone lowering it below 5.

alter table public.organisations
  add column if not exists min_cohort_size integer not null default 10
    check (min_cohort_size >= 5);

comment on column public.organisations.min_cohort_size is
  'I9 small-cell suppression threshold. Any institution-facing figure derived '
  'from fewer than this many individuals must render as "not enough people '
  'yet", never a number. Floor of 5 is enforced by CHECK.';

-- 5. Assertions ----------------------------------------------------------------

do $$
declare
  v_org uuid;
  v_inst uuid;
begin
  -- The exclusion actually took.
  if (select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'private' and p.proname = 'is_org_staff') not like '%corporate_admin%' then
    raise exception 'is_org_staff was not rewritten with the institution exclusion';
  end if;

  -- Prove it behaves, rather than trusting the text: an institution admin must
  -- fail is_org_staff for their OWN organisation, which is the whole point.
  select p.organisation_id, p.id into v_org, v_inst
  from public.profiles p
  where p.role in ('corporate_admin', 'hmo_admin') and p.organisation_id is not null
  limit 1;

  if v_inst is not null then
    if (select exists (
          select 1 from public.profiles
          where id = v_inst and role <> 'patient'
            and role not in ('corporate_admin', 'hmo_admin')
            and (role = 'admin' or organisation_id = v_org)
        )) then
      raise exception 'an institution admin still satisfies the is_org_staff predicate';
    end if;
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'organisations'
      and column_name = 'min_cohort_size'
  ) then
    raise exception 'min_cohort_size was not added';
  end if;

  -- Every organisation must carry a usable threshold; a null or zero here
  -- would silently disable suppression.
  if exists (select 1 from public.organisations where coalesce(min_cohort_size, 0) < 5) then
    raise exception 'an organisation has a suppression threshold below the floor';
  end if;

  -- The re-granted surfaces must still be reachable by an institution.
  if (select count(*) from pg_policies
      where schemaname = 'public'
        and tablename in ('employer_roster_members', 'outcome_reports', 'cohort_cost_model_constants')
        and coalesce(qual, with_check) like '%is_institution_admin%') <> 8 then
    raise exception 'the institution-facing policies were not all restored';
  end if;
end $$;
