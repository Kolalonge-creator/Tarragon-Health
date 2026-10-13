-- SR2 (scale-readiness plan, advisor finding auth_rls_initplan). scribe_consents_insert_clinical called auth.uid() once per row; it is
-- wrapped as (select auth.uid()) so Postgres evaluates it once per statement. Nothing else in the expression changes: same
-- private.staff_may_write(..., 'medical_history') tie rule from S39g, same active-clinician-owns-this-staff-row check. ALTER POLICY keeps
-- the policy in force throughout (no drop and create) and keeps its role list.
-- Held back from the first SR2 advisor change because private.staff_may_write exists only from S39g (20261007193000), which was applied
-- live but not yet merged, so a fresh replay failed on this policy. Merged after S39g.
alter policy scribe_consents_insert_clinical on public.scribe_consents
  with check (
    private.staff_may_write(patient_id, organisation_id, 'medical_history'::public.care_access_category)
    and exists (
      select 1 from public.clinical_staff cs
       where cs.id = scribe_consents.clinician_staff_id and cs.profile_id = (select auth.uid()) and cs.active = true));

do $$
declare v text;
begin
  select with_check into v from pg_policies where tablename = 'scribe_consents' and policyname = 'scribe_consents_insert_clinical';
  if v is null or v !~ 'staff_may_write' or v !~ 'cs\.active = true' then raise exception 'SR2: scribe_consents_insert_clinical lost its tie or active-clinician rule'; end if;
  if regexp_replace(v, '\(\s*SELECT\s+auth\.uid\(\)\s+AS\s+uid\s*\)', '', 'gi') ~ 'auth\.uid\(\)' then raise exception 'SR2: scribe_consents_insert_clinical still calls auth.uid() per row'; end if;
end $$;
