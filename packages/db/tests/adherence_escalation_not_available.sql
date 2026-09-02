-- ===========================================================================
-- Verification: private.evaluate_adherence_escalation() counts
-- 'not_available' dose logs alongside 'missed' ones (20260829142858) —
-- medication safety pathway 64.8. 'not_available' (couldn't get the
-- medicine) is a genuine non-adherence signal and must climb the same
-- coach -> doctor ladder as 'missed'. 'skipped' and the new 'delayed' must
-- NOT count — a deliberate/clinician-sanctioned skip, or a dose taken late,
-- carries no such risk.
--
-- Run via `supabase db query "$(cat this_file.sql)" --linked`, `psql
-- $DATABASE_URL -f this_file.sql`, or the Supabase SQL editor.
-- Wrapped in BEGIN/ROLLBACK.
-- ===========================================================================

begin;

create temporary table aena_fixture(k text primary key, v uuid) on commit drop;
create temporary table aena_result(
  check_name text, role text, observed text, expected text, verdict text
) on commit drop;

do $$
declare
  v_org uuid;
  v_patient uuid;
  v_med_not_available uuid;
  v_med_benign uuid;
begin
  select organisation_id into v_org
  from public.profiles
  where role = 'patient' and organisation_id is not null
  group by organisation_id order by count(*) desc limit 1;
  if v_org is null then
    raise exception 'no organisation has patient profiles — cannot run this test';
  end if;
  select id into v_patient from public.profiles where role = 'patient' and organisation_id = v_org limit 1;

  insert into public.medications (organisation_id, patient_id, drug_name, dose, frequency, is_active, source)
  values (v_org, v_patient, 'AENA Test Amlodipine', '5mg', 'once daily', true, 'clinician')
  returning id into v_med_not_available;

  insert into public.medications (organisation_id, patient_id, drug_name, dose, frequency, is_active, source)
  values (v_org, v_patient, 'AENA Test Paracetamol', '500mg', 'as needed', true, 'clinician')
  returning id into v_med_benign;

  insert into aena_fixture(k, v) values
    ('org', v_org), ('patient', v_patient),
    ('med_not_available', v_med_not_available), ('med_benign', v_med_benign);
end $$;

-- ==========================================================================
-- 1. Three 'not_available' logs -> a coach-level alert, missed_count = 3.
-- ==========================================================================
do $$
declare
  v_org uuid := (select v from aena_fixture where k = 'org');
  v_patient uuid := (select v from aena_fixture where k = 'patient');
  v_med uuid := (select v from aena_fixture where k = 'med_not_available');
  v_level text;
  v_count integer;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_patient::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.medication_logs (organisation_id, patient_id, medication_id, status)
  values (v_org, v_patient, v_med, 'not_available'),
         (v_org, v_patient, v_med, 'not_available'),
         (v_org, v_patient, v_med, 'not_available');
  reset role;

  select level::text, missed_count into v_level, v_count
  from public.medication_adherence_alerts where medication_id = v_med;

  insert into aena_result values
    ('3 not_available logs raise a coach-level alert', 'patient',
     coalesce(v_level, 'none') || '/' || coalesce(v_count::text, '0'), 'coach/3',
     case when v_level = 'coach' and v_count = 3 then 'PASS' else 'FAIL' end);
  if v_level is distinct from 'coach' or v_count is distinct from 3 then
    raise exception 'BROKEN: 3 not_available logs did not raise a coach-level medication_adherence_alerts row';
  end if;
end $$;

-- ==========================================================================
-- 2. Three MORE 'not_available' logs (6 total in 30d) -> upgrades to doctor.
-- ==========================================================================
do $$
declare
  v_org uuid := (select v from aena_fixture where k = 'org');
  v_patient uuid := (select v from aena_fixture where k = 'patient');
  v_med uuid := (select v from aena_fixture where k = 'med_not_available');
  v_level text;
  v_count integer;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_patient::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.medication_logs (organisation_id, patient_id, medication_id, status)
  values (v_org, v_patient, v_med, 'not_available'),
         (v_org, v_patient, v_med, 'not_available'),
         (v_org, v_patient, v_med, 'not_available');
  reset role;

  select level::text, missed_count into v_level, v_count
  from public.medication_adherence_alerts where medication_id = v_med;

  insert into aena_result values
    ('6 not_available logs upgrade the same alert to doctor-level', 'patient',
     coalesce(v_level, 'none') || '/' || coalesce(v_count::text, '0'), 'doctor/6',
     case when v_level = 'doctor' and v_count = 6 then 'PASS' else 'FAIL' end);
  if v_level is distinct from 'doctor' or v_count is distinct from 6 then
    raise exception 'BROKEN: 6 not_available logs did not upgrade the alert to doctor-level';
  end if;
end $$;

-- ==========================================================================
-- 3. Negative control: 'skipped' and 'delayed' logs raise no alert at all.
-- ==========================================================================
do $$
declare
  v_org uuid := (select v from aena_fixture where k = 'org');
  v_patient uuid := (select v from aena_fixture where k = 'patient');
  v_med uuid := (select v from aena_fixture where k = 'med_benign');
  v_alert_count bigint;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_patient::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.medication_logs (organisation_id, patient_id, medication_id, status)
  values (v_org, v_patient, v_med, 'skipped'),
         (v_org, v_patient, v_med, 'skipped'),
         (v_org, v_patient, v_med, 'skipped'),
         (v_org, v_patient, v_med, 'delayed'),
         (v_org, v_patient, v_med, 'delayed'),
         (v_org, v_patient, v_med, 'delayed');
  reset role;

  select count(*) into v_alert_count
  from public.medication_adherence_alerts where medication_id = v_med;

  insert into aena_result values
    ('skipped/delayed logs never raise an adherence alert', 'patient',
     v_alert_count::text, '0', case when v_alert_count = 0 then 'PASS' else 'FAIL' end);
  if v_alert_count <> 0 then
    raise exception 'BROKEN: skipped/delayed logs incorrectly raised a medication_adherence_alerts row';
  end if;
end $$;

select check_name, role, observed, expected, verdict
from aena_result
order by verdict desc, check_name, role;

rollback;
