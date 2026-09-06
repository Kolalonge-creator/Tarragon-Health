-- Proves 20260831001537_vitals_symptoms_timestamp_hardening.sql in
-- isolation. Self-contained (no profile_access/acting-for scaffolding) so
-- it is unaffected by the separate, pre-existing drift blocking
-- medication_logs_acting_for.sql and sponsor_care_status_and_funding.sql
-- (profile_access.clinical_access does not exist on the live project).
--
-- Uses `returning ... into` variables inside `do $$ ... $$` blocks, not a
-- temp-table-existence check — a first draft of this file used `insert into
-- ids select k, case when <condition> then gen_random_uuid() else null end`
-- then asserted on `exists(select 1 from ids where k = ...)`. That is a
-- vacuous pass: the row exists either way (the ids table's `v` column has
-- no NOT NULL constraint), so the assertion was checking "did this INSERT
-- statement run" (always true), not the condition it claimed to check. This
-- was caught only because the standing habit of sabotaging a check to
-- confirm it discriminates was followed here too — sabotaging
-- private.stamp_manual_vitals_timestamp() to apply table-wide (dropping the
-- source = 'manual' scope) should have flipped the "device backdated
-- preserved" check to FAIL, and it silently stayed PASS instead, exposing
-- the bug in the test itself, not the migration.
--
--   npx supabase db query --linked -f packages/db/tests/vitals_symptoms_timestamp_hardening.sql

begin;

create temp table results(check_name text, expected text, actual text) on commit drop;
create temp table ids(k text primary key, v uuid) on commit drop;
grant all on results to authenticated;
grant all on ids to authenticated;

insert into ids
select 'mum', id from public.profiles
 where id in (select id from auth.users where email = 'patient.complete.test@tarragon.test');

------------------------------------------------------------------
-- symptoms.reported_at: no legitimate backdating use case -- always
-- overridden with the real insert time.
------------------------------------------------------------------
do $$
declare
  v_mum uuid := (select v from ids where k = 'mum');
  v_reported_at timestamptz;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_mum::text, 'role', 'authenticated')::text, true);
  set local role authenticated;

  insert into public.symptoms (organisation_id, patient_id, description, symptom_type, severity, reported_at)
  values ('00000000-0000-0000-0000-000000000001', v_mum, 'Test symptom', 'fatigue', 2, now() - interval '5 days')
  returning reported_at into v_reported_at;

  reset role;

  insert into results values (
    'a spoofed 5-day-old symptoms.reported_at is overridden with the real insert time', 'true',
    (v_reported_at > now() - interval '1 hour')::text
  );
end $$;

------------------------------------------------------------------
-- vitals_readings.taken_at: source = 'manual' has no legitimate backdating
-- use case (no UI ever offers it) -- overridden. source = 'device' is real,
-- actively-used backdated clinical data (a BP cuff synced later) -- must
-- pass through untouched, or every device/wearable/CGM/FHIR-import reading
-- silently gets the wrong observation time.
------------------------------------------------------------------
do $$
declare
  v_mum uuid := (select v from ids where k = 'mum');
  v_manual_taken_at timestamptz;
  v_device_taken_at timestamptz;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_mum::text, 'role', 'authenticated')::text, true);
  set local role authenticated;

  insert into public.vitals_readings
    (organisation_id, patient_id, vital_type, systolic, diastolic, source, taken_at)
  values ('00000000-0000-0000-0000-000000000001', v_mum, 'blood_pressure', 120, 80, 'manual', now() - interval '5 days')
  returning taken_at into v_manual_taken_at;

  insert into public.vitals_readings
    (organisation_id, patient_id, vital_type, systolic, diastolic, source, taken_at)
  values ('00000000-0000-0000-0000-000000000001', v_mum, 'blood_pressure', 118, 76, 'device', now() - interval '5 days')
  returning taken_at into v_device_taken_at;

  reset role;

  insert into results values (
    'a spoofed manual-source taken_at is overridden with the real insert time', 'true',
    (v_manual_taken_at > now() - interval '1 hour')::text
  );
  insert into results values (
    'a genuinely backdated device-source taken_at is preserved, not overridden', 'true',
    (v_device_taken_at < now() - interval '4 days')::text
  );
end $$;

select check_name, expected, actual,
       case when expected = actual then 'PASS' else 'FAIL' end as result
from results;

rollback;
