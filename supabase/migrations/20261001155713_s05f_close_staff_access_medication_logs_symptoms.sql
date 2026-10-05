-- S05f part 2 of 2 (piece B): close the direct staff path on medication_logs and symptoms (INV-10, INV-12). Apply only after the code
-- that uses public.read_medication_dose_log_audited has deployed.
--
-- Counted first (live): medication_logs 0 rows, symptoms 1 row. After the deploy the application has no staff user-session `.from()`
-- read of either table (see part 1 for the inventory).
--
-- medication_logs: SELECT keeps the patient's own rows and the caregiver category grant (`can_read_clinical(..., 'medications')`, a
-- family or supporter path, not a staff one); it loses `is_org_staff` and `has_emergency_access`, because staff, break-glass and
-- support-view reads now go through the audited functions, which apply the tie and write the audit row. Staff INSERT and DELETE go: no
-- staff screen writes a dose entry, the table is append-only, and every legitimate writer is the patient, an acting supporter
-- (medication_logs_insert_acting_supporter, unchanged), a SECURITY DEFINER trigger function or the service role.
-- symptoms: SELECT, INSERT and UPDATE narrow to the patient; staff DELETE goes. The acting-supporter insert and each supporter's
-- own-entry read-back policy are unchanged. No trigger is touched (the red-flag check, timestamp stamp, audit and correction trail run
-- exactly as before for the patient's own writes).

drop policy if exists medication_logs_select on public.medication_logs;
create policy medication_logs_select on public.medication_logs
  for select to authenticated
  using (patient_id = (select auth.uid())
         or private.can_read_clinical(patient_id, 'medications'::public.care_access_category));

drop policy if exists medication_logs_insert on public.medication_logs;
create policy medication_logs_insert on public.medication_logs
  for insert to authenticated
  with check (patient_id = (select auth.uid()));

drop policy if exists medication_logs_delete on public.medication_logs;

drop policy if exists symptoms_select on public.symptoms;
create policy symptoms_select on public.symptoms
  for select to authenticated
  using (patient_id = (select auth.uid()));

drop policy if exists symptoms_insert on public.symptoms;
create policy symptoms_insert on public.symptoms
  for insert to authenticated
  with check (patient_id = (select auth.uid()));

drop policy if exists symptoms_update on public.symptoms;
create policy symptoms_update on public.symptoms
  for update to authenticated
  using (patient_id = (select auth.uid()))
  with check (patient_id = (select auth.uid()));

drop policy if exists symptoms_delete on public.symptoms;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename in ('medication_logs', 'symptoms')
               and (qual ilike '%is_org_staff%' or with_check ilike '%is_org_staff%'
                    or qual ilike '%has_emergency_access%' or with_check ilike '%has_emergency_access%')) then
    raise exception 'S05f assertion: a staff or break-glass clause remains on medication_logs or symptoms';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename in ('medication_logs', 'symptoms') and cmd in ('DELETE', 'ALL')) then
    raise exception 'S05f assertion: a DELETE or ALL policy remains on medication_logs or symptoms';
  end if;
  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'medication_logs') <> 4
     or (select count(*) from pg_policies where schemaname = 'public' and tablename = 'symptoms') <> 5 then
    raise exception 'S05f assertion: unexpected policy count (medication_logs expects select, own-entry select, insert, acting-supporter insert; symptoms the same plus update)';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.medication_logs'::regclass)
     or not (select relrowsecurity from pg_class where oid = 'public.symptoms'::regclass) then
    raise exception 'S05f assertion: RLS is off on medication_logs or symptoms';
  end if;
  -- Not has_table_privilege('anon'): a fresh local replay carries the image's default table ACL (see CLAUDE.md). What matters is that no
  -- policy admits anon.
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename in ('medication_logs', 'symptoms')
               and (roles::text ~ 'anon' or roles::text ~ 'public')) then
    raise exception 'S05f assertion: a policy on medication_logs or symptoms admits anon';
  end if;
end $$;
