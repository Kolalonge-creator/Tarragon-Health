-- Tarragon Health — close the write-side counterpart of the reproductive_health_profiles
-- SELECT-side access-category regression fixed by 20260902213714.
--
-- BACKGROUND. reproductive_health_profiles' INSERT/UPDATE policies have never, at any
-- point in this table's history, required an explicit 'reproductive_health'
-- profile_access_categories grant (checked directly: neither 20260830012429 nor
-- 20260830103251 — the migration that introduced category-scoped access at all — touched
-- INSERT/UPDATE; only 20260902213714 said so explicitly while fixing the unrelated SELECT
-- regression). Confirmed live today via pg_policies before writing this migration: both
-- policies still gate purely on
--   patient_id = auth.uid()
--   or ( profile_access.permission_level = 'manage' and guardian_may_edit_confidential_domain(patient_id) )
-- with no reference to profile_access_categories at all.
--
-- IMPACT. Any caregiver holding a 'manage'-level profile_access grant on an adult
-- patient — regardless of which categories that patient actually ticked for them (e.g.
-- only 'medications' or 'vitals_readings', never 'reproductive_health') — can INSERT/
-- UPDATE that patient's reproductive_health_profiles row today: life_stage,
-- last_period_date, average_cycle_length_days, current_contraception_method. This is not
-- a new regression; it is a gap that has existed since category-scoped access shipped
-- 2026-08-30 and was simply never closed on this table's write side.
--
-- FIX. Require the same explicit 'reproductive_health' category grant on INSERT/UPDATE
-- that SELECT already requires (via can_read_clinical), in addition to — not instead of —
-- the existing permission_level = 'manage' and guardian_may_edit_confidential_domain
-- checks. Deliberately NOT routed through private.can_read_clinical(): that function
-- authorises on the category grant alone regardless of permission_level (a view-level
-- category grant is enough to READ), which is correct for SELECT but would wrongly let a
-- view-only grantee write here — the write path must keep requiring 'manage' on top of
-- the category grant, so the category check is written out directly instead.
--
-- The dependent-account bypass inside can_read_clinical (permission_level='manage' AND
-- is_dependent_account, category<>'reproductive_health') is deliberately not reproduced
-- here either — it explicitly excludes reproductive_health already, so it would never
-- apply to this table regardless.

drop policy if exists reproductive_health_profiles_insert on public.reproductive_health_profiles;
create policy reproductive_health_profiles_insert on public.reproductive_health_profiles
  for insert to authenticated
  with check (
    patient_id = (select auth.uid())
    or (
      exists (
        select 1 from public.profile_access pa
        where pa.profile_id = reproductive_health_profiles.patient_id
          and pa.grantee_user_id = (select auth.uid())
          and pa.permission_level = 'manage'
          and exists (
            select 1 from public.profile_access_categories pac
            where pac.profile_access_id = pa.id
              and pac.category = 'reproductive_health'
          )
      )
      and private.guardian_may_edit_confidential_domain(reproductive_health_profiles.patient_id)
    )
  );

drop policy if exists reproductive_health_profiles_update on public.reproductive_health_profiles;
create policy reproductive_health_profiles_update on public.reproductive_health_profiles
  for update to authenticated
  using (
    patient_id = (select auth.uid())
    or (
      exists (
        select 1 from public.profile_access pa
        where pa.profile_id = reproductive_health_profiles.patient_id
          and pa.grantee_user_id = (select auth.uid())
          and pa.permission_level = 'manage'
          and exists (
            select 1 from public.profile_access_categories pac
            where pac.profile_access_id = pa.id
              and pac.category = 'reproductive_health'
          )
      )
      and private.guardian_may_edit_confidential_domain(reproductive_health_profiles.patient_id)
    )
  )
  with check (
    patient_id = (select auth.uid())
    or (
      exists (
        select 1 from public.profile_access pa
        where pa.profile_id = reproductive_health_profiles.patient_id
          and pa.grantee_user_id = (select auth.uid())
          and pa.permission_level = 'manage'
          and exists (
            select 1 from public.profile_access_categories pac
            where pac.profile_access_id = pa.id
              and pac.category = 'reproductive_health'
          )
      )
      and private.guardian_may_edit_confidential_domain(reproductive_health_profiles.patient_id)
    )
  );

-- ===========================================================================
-- Self-assertions — the migration is the test.
-- ===========================================================================
do $$
declare
  v_insert_check text;
  v_update_qual  text;
  v_update_check text;
begin
  select pg_get_expr(pol.polwithcheck, pol.polrelid) into v_insert_check
  from pg_policy pol join pg_class c on c.oid = pol.polrelid
  where c.relname = 'reproductive_health_profiles' and pol.polname = 'reproductive_health_profiles_insert';

  select pg_get_expr(pol.polqual, pol.polrelid), pg_get_expr(pol.polwithcheck, pol.polrelid)
    into v_update_qual, v_update_check
  from pg_policy pol join pg_class c on c.oid = pol.polrelid
  where c.relname = 'reproductive_health_profiles' and pol.polname = 'reproductive_health_profiles_update';

  if v_insert_check is null or v_insert_check not like '%profile_access_categories%'
     or v_insert_check not like '%reproductive_health%' then
    raise exception 'FAIL: reproductive_health_profiles_insert must require an explicit reproductive_health category grant, got: %', v_insert_check;
  end if;
  if v_insert_check not like '%permission_level = ''manage''%' then
    raise exception 'FAIL: reproductive_health_profiles_insert must still require permission_level = manage, got: %', v_insert_check;
  end if;
  if v_insert_check not like '%guardian_may_edit_confidential_domain%' then
    raise exception 'FAIL: reproductive_health_profiles_insert must still call guardian_may_edit_confidential_domain, got: %', v_insert_check;
  end if;

  if v_update_qual is null or v_update_qual not like '%profile_access_categories%'
     or v_update_qual not like '%reproductive_health%' then
    raise exception 'FAIL: reproductive_health_profiles_update USING must require an explicit reproductive_health category grant, got: %', v_update_qual;
  end if;
  if v_update_check is null or v_update_check not like '%profile_access_categories%'
     or v_update_check not like '%reproductive_health%' then
    raise exception 'FAIL: reproductive_health_profiles_update WITH CHECK must require an explicit reproductive_health category grant, got: %', v_update_check;
  end if;

  raise notice 'PASS: reproductive_health_profiles INSERT/UPDATE now require an explicit reproductive_health category grant, on top of manage-level access and the adolescent write gate';
end $$;
