-- Tarragon Health — close the reproductive_health category-scoping gap on
-- menstrual_cycles / menstrual_daily_logs.
--
-- BACKGROUND. 20260902195623_menstrual_cycle_tracking.sql (merged today as
-- part of PR #323, the Women's Health platform) was written against
-- 20260724001210_reproductive_health_profile.sql's ORIGINAL caregiver-access
-- shape: a bare `EXISTS(profile_access WHERE grantee_user_id = auth.uid())`
-- for SELECT, and the same EXISTS narrowed to `permission_level = 'manage'`
-- for INSERT/UPDATE/DELETE -- ANY relationship, ANY category. That shape was
-- deliberately replaced on 2026-08-30 (20260830103251_category_scoped_
-- clinical_access_and_emergency_access.sql): reproductive_health became a
-- specially-protected access category requiring its own explicit
-- profile_access_categories grant, never unlocked by a blanket "some
-- relationship exists" check or by the dependent-account bypass (see
-- private.can_read_clinical's own definition -- the dependent-account branch
-- explicitly excludes p_category = 'reproductive_health'), and never by
-- cross-org break-glass access either (private.has_emergency_access excludes
-- it too, by design).
--
-- menstrual_cycles/menstrual_daily_logs never got that memo -- they were
-- authored and merged five days later, reusing the pre-2026-08-30 pattern
-- verbatim (its own header even says "RLS -- identical shape to
-- reproductive_health_profiles, deliberately", but reproductive_health_
-- profiles had already moved on by then). Net effect, live today: any
-- caregiver holding ANY profile_access grant on a patient -- even a bare
-- view-only grant for, say, medications -- can read that patient's full
-- period/symptom/mood history, and any 'manage'-level grantee (again
-- regardless of category) can write to it. This is the exact bug
-- 20260830012429 and 20260902213714 both closed for reproductive_health_
-- profiles, reintroduced by a table that shipped after both fixes.
--
-- FIX. Route SELECT through private.can_read_clinical(patient_id,
-- 'reproductive_health') and private.has_emergency_access(patient_id,
-- 'reproductive_health') -- the latter always evaluates false for this
-- category today (see has_emergency_access's own definition), included only
-- for the same forward-compatible consistency every other clinical table's
-- policy carries. INSERT/UPDATE/DELETE move from "permission_level='manage',
-- any category" to "permission_level='manage' AND an explicit
-- profile_access_categories grant for 'reproductive_health'" -- deliberately
-- NOT private.can_read_clinical alone, since that function is a READ gate
-- (a view-level category grant satisfies it) and every other write-capable
-- caregiver policy on this platform requires 'manage', not merely a category
-- grant; this table's constraint is the union of both requirements, matching
-- what reproductive_health_profiles' write side SHOULD already require (see
-- the follow-up note below).
--
-- Org-staff/caregiver read-vs-write asymmetry is unchanged from the original
-- design: org staff still get SELECT only, never write -- a cycle log is the
-- patient's own account of their body.
--
-- NOTE for a future session: reproductive_health_profiles' own INSERT/UPDATE
-- policies (20260902205713_adolescent_confidentiality_waivers.sql) still gate
-- writes on a bare `permission_level = 'manage'` EXISTS with NO category
-- check at all (only an age-band check, which is a no-op for adult
-- patients) -- i.e. today, ANY manage-level caregiver, of ANY category, can
-- still WRITE to an adult patient's reproductive_health_profiles row. That is
-- a real, separate gap from the one this migration closes (today's
-- 20260902213714 fix explicitly scoped itself to the SELECT regression only)
-- and is out of scope here since it requires touching reproductive_health_
-- profiles' own policies, which this migration deliberately does not do --
-- flagged for its own follow-up.

drop policy if exists menstrual_cycles_select on public.menstrual_cycles;
create policy menstrual_cycles_select on public.menstrual_cycles
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or private.can_read_clinical(patient_id, 'reproductive_health')
    or private.has_emergency_access(patient_id, 'reproductive_health')
  );

drop policy if exists menstrual_cycles_insert on public.menstrual_cycles;
create policy menstrual_cycles_insert on public.menstrual_cycles
  for insert to authenticated
  with check (
    patient_id = (select auth.uid())
    or exists (
      select 1 from public.profile_access pa
      join public.profile_access_categories pac on pac.profile_access_id = pa.id
      where pa.profile_id = menstrual_cycles.patient_id
        and pa.grantee_user_id = (select auth.uid())
        and pa.permission_level = 'manage'
        and pac.category = 'reproductive_health'
    )
  );

drop policy if exists menstrual_cycles_update on public.menstrual_cycles;
create policy menstrual_cycles_update on public.menstrual_cycles
  for update to authenticated
  using (
    patient_id = (select auth.uid())
    or exists (
      select 1 from public.profile_access pa
      join public.profile_access_categories pac on pac.profile_access_id = pa.id
      where pa.profile_id = menstrual_cycles.patient_id
        and pa.grantee_user_id = (select auth.uid())
        and pa.permission_level = 'manage'
        and pac.category = 'reproductive_health'
    )
  )
  with check (
    patient_id = (select auth.uid())
    or exists (
      select 1 from public.profile_access pa
      join public.profile_access_categories pac on pac.profile_access_id = pa.id
      where pa.profile_id = menstrual_cycles.patient_id
        and pa.grantee_user_id = (select auth.uid())
        and pa.permission_level = 'manage'
        and pac.category = 'reproductive_health'
    )
  );

drop policy if exists menstrual_cycles_delete on public.menstrual_cycles;
create policy menstrual_cycles_delete on public.menstrual_cycles
  for delete to authenticated
  using (
    patient_id = (select auth.uid())
    or exists (
      select 1 from public.profile_access pa
      join public.profile_access_categories pac on pac.profile_access_id = pa.id
      where pa.profile_id = menstrual_cycles.patient_id
        and pa.grantee_user_id = (select auth.uid())
        and pa.permission_level = 'manage'
        and pac.category = 'reproductive_health'
    )
  );

drop policy if exists menstrual_daily_logs_select on public.menstrual_daily_logs;
create policy menstrual_daily_logs_select on public.menstrual_daily_logs
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or private.can_read_clinical(patient_id, 'reproductive_health')
    or private.has_emergency_access(patient_id, 'reproductive_health')
  );

drop policy if exists menstrual_daily_logs_insert on public.menstrual_daily_logs;
create policy menstrual_daily_logs_insert on public.menstrual_daily_logs
  for insert to authenticated
  with check (
    patient_id = (select auth.uid())
    or exists (
      select 1 from public.profile_access pa
      join public.profile_access_categories pac on pac.profile_access_id = pa.id
      where pa.profile_id = menstrual_daily_logs.patient_id
        and pa.grantee_user_id = (select auth.uid())
        and pa.permission_level = 'manage'
        and pac.category = 'reproductive_health'
    )
  );

drop policy if exists menstrual_daily_logs_update on public.menstrual_daily_logs;
create policy menstrual_daily_logs_update on public.menstrual_daily_logs
  for update to authenticated
  using (
    patient_id = (select auth.uid())
    or exists (
      select 1 from public.profile_access pa
      join public.profile_access_categories pac on pac.profile_access_id = pa.id
      where pa.profile_id = menstrual_daily_logs.patient_id
        and pa.grantee_user_id = (select auth.uid())
        and pa.permission_level = 'manage'
        and pac.category = 'reproductive_health'
    )
  )
  with check (
    patient_id = (select auth.uid())
    or exists (
      select 1 from public.profile_access pa
      join public.profile_access_categories pac on pac.profile_access_id = pa.id
      where pa.profile_id = menstrual_daily_logs.patient_id
        and pa.grantee_user_id = (select auth.uid())
        and pa.permission_level = 'manage'
        and pac.category = 'reproductive_health'
    )
  );

drop policy if exists menstrual_daily_logs_delete on public.menstrual_daily_logs;
create policy menstrual_daily_logs_delete on public.menstrual_daily_logs
  for delete to authenticated
  using (
    patient_id = (select auth.uid())
    or exists (
      select 1 from public.profile_access pa
      join public.profile_access_categories pac on pac.profile_access_id = pa.id
      where pa.profile_id = menstrual_daily_logs.patient_id
        and pa.grantee_user_id = (select auth.uid())
        and pa.permission_level = 'manage'
        and pac.category = 'reproductive_health'
    )
  );

-- ---------------------------------------------------------------------------
-- Self-assertions.
-- ---------------------------------------------------------------------------
do $$
declare
  v_bad text;
begin
  -- The specific regression this migration fixes: a bare, category-blind
  -- EXISTS over profile_access with no can_read_clinical/category gate.
  select string_agg(schemaname||'.'||tablename||'.'||policyname, ', ')
  into v_bad
  from pg_policies
  where schemaname = 'public'
    and tablename in ('menstrual_cycles', 'menstrual_daily_logs')
    and (
      (coalesce(qual,'') ilike '%exists (%select 1 from public.profile_access pa%'
       and coalesce(qual,'') not ilike '%profile_access_categories%'
       and coalesce(qual,'') not ilike '%can_read_clinical%')
      or
      (coalesce(with_check,'') ilike '%exists (%select 1 from public.profile_access pa%'
       and coalesce(with_check,'') not ilike '%profile_access_categories%')
    );
  if v_bad is not null then
    raise exception 'these policies still contain the ungated, category-blind profile_access EXISTS pattern: %', v_bad;
  end if;

  if (select count(*) from pg_policies
      where schemaname = 'public' and tablename = 'menstrual_cycles'
        and (coalesce(qual,'') || coalesce(with_check,'')) ilike '%can_read_clinical(%'
           or (coalesce(qual,'') || coalesce(with_check,'')) ilike '%reproductive_health%') = 0 then
    raise exception 'menstrual_cycles policies are not gated on the reproductive_health category';
  end if;
  if (select count(*) from pg_policies
      where schemaname = 'public' and tablename = 'menstrual_daily_logs'
        and (coalesce(qual,'') || coalesce(with_check,'')) ilike '%can_read_clinical(%'
           or (coalesce(qual,'') || coalesce(with_check,'')) ilike '%reproductive_health%') = 0 then
    raise exception 'menstrual_daily_logs policies are not gated on the reproductive_health category';
  end if;

  if (select count(*) from pg_policies
      where schemaname = 'public' and tablename = 'menstrual_cycles') <> 4 then
    raise exception 'menstrual_cycles should still have exactly 4 policies';
  end if;
  if (select count(*) from pg_policies
      where schemaname = 'public' and tablename = 'menstrual_daily_logs') <> 4 then
    raise exception 'menstrual_daily_logs should still have exactly 4 policies';
  end if;
end $$;
