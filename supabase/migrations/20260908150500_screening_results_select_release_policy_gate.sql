-- Tarragon Health — carry the patient-result-release gate forward onto the
-- actual current screening_results_select shape.
--
-- 20260829135012_result_release_policies.sql installed the
-- private.patient_result_blocked gate against the 2026-08-29 shape of this
-- policy (the 1-arg can_read_clinical(uuid) form) rather than today's, for
-- the same forward-reference reason 20260906145717_lab_specimens_select_
-- category_scoped.sql exists: a CREATE POLICY ... USING clause is type-
-- checked immediately, so an explicit cast to public.care_access_category or
-- public.caregiver_permission would fail on a from-scratch replay run before
-- 20260830103251_category_scoped_clinical_access_and_emergency_access.sql
-- (which defines both) has had a chance to run. That migration has run by
-- now (it sorts before this file), so this migration brings the policy
-- forward to its real, live shape: the 2026-09-02 platform-wide fix for six
-- tables still calling the legacy 1-arg can_read_clinical overload
-- (CLAUDE.md's own documented recurring issue) already touched this exact
-- table independently, adding a category-scoped can_read_clinical branch, an
-- emergency-access branch, and a caregiver-permission branch — confirmed via
-- a live pg_get_expr(polqual) pull immediately before writing this, not
-- assumed. Only the release-policy block check is new here; every other
-- branch is carried across unchanged.
--
-- org staff and emergency access are NEVER gated by release policy — a
-- restriction is about what's shown to the PATIENT pending a doctor's
-- delivery, not about hiding a result from a clinician who has to act on it
-- (emergency break-glass access exists precisely so that clinician can act).
-- Only the patient-direct and delegated-caregiver-access branches are gated,
-- matching 20260829135012's own original reasoning for this exact split.

drop policy if exists screening_results_select on public.screening_results;
create policy screening_results_select on public.screening_results
  for select to authenticated
  using (
    private.is_org_staff(organisation_id)
    or private.has_emergency_access(patient_id, 'labs_results'::public.care_access_category)
    or (
      not private.patient_result_blocked(screen_type_code, result_status)
      and (
        patient_id = (select auth.uid())
        or private.can_read_clinical(patient_id, 'labs_results'::public.care_access_category)
        or private.can_read_clinical(patient_id, 'view_results'::public.caregiver_permission)
      )
    )
  );

-- ---------------------------------------------------------------------------
-- Proof, not hope.
-- ---------------------------------------------------------------------------
do $$
declare
  v_qual text;
begin
  select pg_get_expr(pol.polqual, pol.polrelid) into v_qual
    from pg_policy pol
    join pg_class c on c.oid = pol.polrelid
   where c.relname = 'screening_results' and pol.polname = 'screening_results_select';

  if v_qual is null then
    raise exception 'screening_results_select does not exist after this migration';
  end if;
  if v_qual not like '%is_org_staff%' then
    raise exception 'screening_results_select lost its is_org_staff branch';
  end if;
  if v_qual not like '%has_emergency_access%' then
    raise exception 'screening_results_select lost its emergency-access branch';
  end if;
  if v_qual not like '%view_results%' then
    raise exception 'screening_results_select lost its caregiver-permission branch';
  end if;
  if v_qual not like '%patient_result_blocked%' then
    raise exception 'screening_results_select lost the patient-result-release gate';
  end if;

  raise notice 'PASS: screening_results_select carries every access branch plus the release-policy gate';
end $$;
