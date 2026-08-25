-- Consolidate patient_blood_profile RLS: same access, cheaper plan.
--
-- Before: patient_blood_profile_staff_write (ALL, is_org_staff) overlapped
-- with three separate self-access policies (self_insert, select, self_update)
-- on every action, tripping the performance advisor's
-- multiple_permissive_policies warning on SELECT/INSERT/UPDATE (Postgres
-- must evaluate every permissive policy for a role+action and OR the
-- results, rather than short-circuiting on one). The three self-access
-- policies also called auth.uid() directly rather than via a subquery,
-- tripping auth_rls_initplan (re-evaluated per row instead of once per
-- query as a stable InitPlan). This table carries blood group/genotype PHI
-- and is read on most clinical summary views, so the redundant evaluation
-- cost isn't free.
--
-- After: one policy per command, self-or-staff folded into a single
-- USING/WITH CHECK via OR, auth.uid() wrapped in (select ...). Same access
-- matrix as before (verified against pg_policies before writing this):
--   SELECT: patient_id = self, OR org staff, OR can_read_clinical(patient_id)
--   INSERT: patient_id = self, OR org staff
--   UPDATE: patient_id = self, OR org staff
--   DELETE: org staff only (unchanged — no self-delete policy existed before)

drop policy if exists "patient_blood_profile_staff_write" on public.patient_blood_profile;
drop policy if exists "patient_blood_profile_self_insert" on public.patient_blood_profile;
drop policy if exists "patient_blood_profile_select" on public.patient_blood_profile;
drop policy if exists "patient_blood_profile_self_update" on public.patient_blood_profile;

create policy "patient_blood_profile_select"
  on public.patient_blood_profile
  for select
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or private.can_read_clinical(patient_id)
  );

create policy "patient_blood_profile_insert"
  on public.patient_blood_profile
  for insert
  with check (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
  );

create policy "patient_blood_profile_update"
  on public.patient_blood_profile
  for update
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
  )
  with check (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
  );

create policy "patient_blood_profile_staff_delete"
  on public.patient_blood_profile
  for delete
  using (private.is_org_staff(organisation_id));

do $$
declare
  v_count int;
begin
  select count(*) into v_count
  from pg_policies
  where schemaname = 'public' and tablename = 'patient_blood_profile';

  if v_count <> 4 then
    raise exception 'patient_blood_profile: expected exactly 4 policies after consolidation, found %', v_count;
  end if;

  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'patient_blood_profile'
      and cmd = 'ALL'
  ) then
    raise exception 'patient_blood_profile: an ALL-command policy still exists — overlap not resolved';
  end if;
end $$;
