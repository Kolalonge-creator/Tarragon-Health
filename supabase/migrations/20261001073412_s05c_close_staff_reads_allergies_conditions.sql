-- S05c: close the direct staff read path on patient_allergies and patient_conditions (INV-10, OQ-03, OQ-54).
-- Staff read both through public.read_patient_chart_audited (sections allergies, conditions) and public.search_patient_ids_by_condition.
--
-- Counted first (live, 2026-10-01): patient_allergies 0 rows, patient_conditions 0 rows. Readers re-checked after the S05b code deployed
-- (PR #820, production deployment confirmed complete before this was written):
--   * code: every staff user-session read (loadMedicationSafety, the care-management case file, the clinician patient-list filter) now
--     uses the audited path; the remaining `.from()` readers are the patient's own screens, the AI coach, the export, the emergency
--     dataset and the mobile app, all reading their own rows as the patient.
--   * database: the only functions that write either table or read it are SECURITY DEFINER (RLS-bypassing); no view other than the two
--     S05 security_invoker views reads them, and those are reached only through the audited functions.
-- Staff WRITES: no staff screen inserts, updates or deletes either table (FHIR acceptance writes through a SECURITY DEFINER function).
-- The staff INSERT / UPDATE / DELETE policies stay as they are; an UPDATE or DELETE needs a visible row, so a future staff edit of a
-- patient's entry goes through an audited write path, the same as S05 documented for patient_documents and family_history.
--
-- A staff member can still read back the row she inserted in the same transaction (INSERT ... RETURNING needs a SELECT policy), bounded
-- by created_at = now() so it never becomes a standing read.

drop policy if exists patient_allergies_select on public.patient_allergies;
create policy patient_allergies_select on public.patient_allergies
  for select to authenticated
  using (patient_id = (select auth.uid()));

drop policy if exists patient_allergies_select_own_entry on public.patient_allergies;
create policy patient_allergies_select_own_entry on public.patient_allergies
  for select to authenticated
  using (recorded_by = (select auth.uid()) and created_at = now());

drop policy if exists patient_conditions_select on public.patient_conditions;
create policy patient_conditions_select on public.patient_conditions
  for select to authenticated
  using (patient_id = (select auth.uid()));

drop policy if exists patient_conditions_select_own_entry on public.patient_conditions;
create policy patient_conditions_select_own_entry on public.patient_conditions
  for select to authenticated
  using (recorded_by = (select auth.uid()) and created_at = now());

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename in ('patient_allergies', 'patient_conditions')
               and cmd = 'SELECT' and qual ilike '%is_org_staff%') then
    raise exception 'S05c assertion: an org-staff SELECT policy remains on patient_allergies or patient_conditions';
  end if;
  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'patient_allergies' and cmd = 'SELECT') <> 2
     or (select count(*) from pg_policies where schemaname = 'public' and tablename = 'patient_conditions' and cmd = 'SELECT') <> 2 then
    raise exception 'S05c assertion: expected exactly 2 SELECT policies on each table';
  end if;
  if has_table_privilege('anon', 'public.patient_allergies', 'SELECT') or has_table_privilege('anon', 'public.patient_conditions', 'SELECT') then
    raise exception 'S05c assertion: anon can read one of the tables';
  end if;
end $$;
