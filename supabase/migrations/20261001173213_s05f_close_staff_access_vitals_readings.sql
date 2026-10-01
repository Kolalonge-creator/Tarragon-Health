-- S05f piece D, part 2: close the direct staff path on vitals_readings (INV-10, INV-12). Apply only after the code that uses the D1 read
-- functions has deployed.
--
-- Counted first (live): 12 rows. After the deploy the application has no staff user-session `.from("vitals_readings")` read: reads go
-- through read_patient_vitals_audited, patient_monitoring_latest_readings, patient_vitals_adherence and the hypertension quality view
-- (D1). There is no staff WRITE: nothing in the application inserts, updates or deletes a vitals row from a staff session (the one
-- staff-driven write, confirming a FHIR import, runs in a SECURITY DEFINER trigger). Patient, caregiver (acting supporter), device
-- (service role) and mobile ingestion write the patient's own rows and keep their policies.
--
-- SELECT keeps the patient and the 'vitals_readings' category grant (a family path); it loses is_org_staff, has_emergency_access and
-- can_support_view, which the audited read applies per category with an audit row. INSERT keeps the patient (and the acting-supporter
-- policy, unchanged). UPDATE narrows to the patient's own row. DELETE has no policy. The 17 triggers are untouched: the red-flag
-- engines (BP, SpO2, pulse, temperature, glucose backstop), the heart-failure weight check, validation flagging, the source lock,
-- manual-timestamp stamping and the rest still run for every patient, supporter and service-role insert.

drop policy if exists vitals_readings_select on public.vitals_readings;
create policy vitals_readings_select on public.vitals_readings
  for select to authenticated
  using (patient_id = (select auth.uid())
         or private.can_read_clinical(patient_id, 'vitals_readings'::public.care_access_category));

drop policy if exists vitals_readings_insert on public.vitals_readings;
create policy vitals_readings_insert on public.vitals_readings
  for insert to authenticated
  with check (patient_id = (select auth.uid()));

drop policy if exists vitals_readings_update on public.vitals_readings;
create policy vitals_readings_update on public.vitals_readings
  for update to authenticated
  using (patient_id = (select auth.uid()))
  with check (patient_id = (select auth.uid()));

drop policy if exists vitals_readings_delete on public.vitals_readings;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'vitals_readings'
               and (qual ilike '%is_org_staff%' or with_check ilike '%is_org_staff%'
                    or qual ilike '%has_emergency_access%' or with_check ilike '%has_emergency_access%'
                    or qual ilike '%can_support_view%' or with_check ilike '%can_support_view%')) then
    raise exception 'S05f assertion: a staff, break-glass or support-view clause remains on vitals_readings';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'vitals_readings' and cmd in ('DELETE', 'ALL')) then
    raise exception 'S05f assertion: a DELETE or ALL policy remains on vitals_readings';
  end if;
  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'vitals_readings') <> 5 then
    raise exception 'S05f assertion: expected select, own-entry select, insert, acting-supporter insert and update on vitals_readings';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.vitals_readings'::regclass) then
    raise exception 'S05f assertion: RLS is off on vitals_readings';
  end if;
  if (select count(*) from pg_trigger where not tgisinternal and tgrelid = 'public.vitals_readings'::regclass) <> 17 then
    raise exception 'S05f assertion: the 17 triggers on vitals_readings are not all present';
  end if;
  -- Not has_table_privilege('anon'): a fresh local replay carries the image's default table ACL (see CLAUDE.md). What matters is that no
  -- policy admits anon.
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'vitals_readings' and (roles::text ~ 'anon' or roles::text ~ 'public')) then
    raise exception 'S05f assertion: a policy on vitals_readings admits anon';
  end if;
end $$;
