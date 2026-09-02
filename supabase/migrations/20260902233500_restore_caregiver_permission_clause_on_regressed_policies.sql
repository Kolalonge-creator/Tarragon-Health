-- Caregiver Proxy Access, fix-forward: restore the view_care_plan/
-- view_medication/view_results caregiver_permission clause on
-- care_plans_select, medications_select, and lab_orders_select, dropped by
-- 20260902233000_fix_six_policies_can_read_clinical_overload_ambiguity.sql.
--
-- That migration (independently pushed to fix main-dev's 20260902232555
-- ambiguity, see 20260902225000_rename_caregiver_permission_overload_to_
-- avoid_ambiguity.sql immediately before this one for the real fix) redrew
-- six policies from main-dev's own body, which has no knowledge of this
-- branch's unmerged work — three of those six (care_plans_select,
-- medications_select, lab_orders_select) are also policies this branch's
-- own 20260902223916_caregiver_view_permissions_wired.sql had separately
-- layered a caregiver_permission clause onto, and that migration's
-- drop-then-recreate silently dropped it: confirmed live via pg_policies
-- immediately before this fix, care_plans_select/medications_select/
-- lab_orders_select carried only the two care_access_category/
-- has_emergency_access clauses, missing the third. A caregiver holding
-- only a permissions-scoped grant (view_care_plan/view_medication/
-- view_results, no clinical_access, no care_access_category grant) lost
-- read access to exactly the three data types this branch's own spec
-- (23.2) exists to grant. screening_results_select and
-- lab_analyte_readings_select were not among the six 20260902233000
-- touched and were confirmed live to still carry their clause intact — not
-- reproduced here, nothing to fix.
--
-- Applied directly to the live project (koiplnmbgnqnbywhpjlf) ahead of
-- this file's commit, closing the live regression immediately rather than
-- leaving it open until this branch merges — same fix-forward-for-a-live-
-- regression pattern as 20260902224511 and the rename migration before
-- this one. Uses can_read_clinical_permission (the renamed overload), not
-- can_read_clinical, since this migration is positioned after the rename.

drop policy if exists care_plans_select on public.care_plans;
create policy care_plans_select on public.care_plans
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or private.can_read_clinical(patient_id, 'appointments_care_plan'::public.care_access_category)
    or private.has_emergency_access(patient_id, 'appointments_care_plan'::public.care_access_category)
    or private.can_read_clinical_permission(patient_id, 'view_care_plan'::public.caregiver_permission)
  );

drop policy if exists medications_select on public.medications;
create policy medications_select on public.medications
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or private.can_read_clinical(patient_id, 'medications'::public.care_access_category)
    or private.has_emergency_access(patient_id, 'medications'::public.care_access_category)
    or private.can_read_clinical_permission(patient_id, 'view_medication'::public.caregiver_permission)
  );

drop policy if exists lab_orders_select on public.lab_orders;
create policy lab_orders_select on public.lab_orders
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or private.can_read_clinical(patient_id, 'labs_results'::public.care_access_category)
    or private.has_emergency_access(patient_id, 'labs_results'::public.care_access_category)
    or private.can_read_clinical_permission(patient_id, 'view_results'::public.caregiver_permission)
  );

do $$
declare
  v_tables text[] := array['care_plans', 'medications', 'lab_orders', 'screening_results', 'lab_analyte_readings'];
  v_missing text[];
begin
  select array_agg(tablename || '.' || policyname) into v_missing
  from pg_policies
  where schemaname = 'public'
    and tablename = any(v_tables)
    and policyname like '%_select'
    and coalesce(qual, '') !~ 'can_read_clinical_permission'
    and tablename in ('care_plans', 'medications', 'lab_orders');

  if v_missing is not null then
    raise exception 'these policies are still missing their caregiver_permission clause: %', v_missing;
  end if;

  -- All five of this branch's originally-wired policies (23.2) must carry
  -- the category+emergency clauses too, not just the permission one.
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = any(v_tables) and policyname like '%_select'
      and (coalesce(qual, '') !~ 'care_access_category' or coalesce(qual, '') !~ 'has_emergency_access')
  ) then
    raise exception 'a clinical-read policy is missing its category-scoped or emergency-access clause';
  end if;
end $$;
