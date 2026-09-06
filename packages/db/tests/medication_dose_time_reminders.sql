-- ===========================================================================
-- Verification: private.queue_medication_dose_reminders() (20260829190315)
-- — medication safety pathway 64.7/64.8. A schedule_times entry matching
-- "right now" (Africa/Lagos) queues a whatsapp + in_app reminder and is
-- deduped on a second run; a slot already logged, or far outside the
-- window, is never reminded.
--
-- Uses the ACTUAL current Africa/Lagos time (truncated to the minute) as
-- the "due" schedule_time rather than a hardcoded clock value, since this
-- function keys entirely off now() with no way to inject a fake clock in a
-- plain SQL test — this makes the test correct at whatever time it runs.
--
-- Run via `supabase db query "$(cat this_file.sql)" --linked`, `psql
-- $DATABASE_URL -f this_file.sql`, or the Supabase SQL editor.
-- Wrapped in BEGIN/ROLLBACK.
-- ===========================================================================

begin;

create temporary table mdtr_fixture(k text primary key, v text) on commit drop;
create temporary table mdtr_result(
  check_name text, role text, observed text, expected text, verdict text
) on commit drop;

do $$
declare
  v_org uuid;
  v_patient uuid;
  v_now_time text := to_char((now() at time zone 'Africa/Lagos'), 'HH24:MI');
  v_med_due uuid;
  v_med_far uuid;
  v_med_logged uuid;
begin
  select organisation_id into v_org
  from public.profiles
  where role = 'patient' and organisation_id is not null
  group by organisation_id order by count(*) desc limit 1;
  if v_org is null then
    raise exception 'no organisation has patient profiles — cannot run this test';
  end if;
  select id into v_patient from public.profiles where role = 'patient' and organisation_id = v_org limit 1;

  -- Due right now: schedule_times contains the current minute.
  insert into public.medications
    (organisation_id, patient_id, drug_name, dose, frequency, is_active, source, schedule_times)
  values (v_org, v_patient, 'MDTR Test Amlodipine', '5mg', 'once daily', true, 'clinician',
    jsonb_build_array(v_now_time))
  returning id into v_med_due;

  -- Far outside any 15-minute window: fixed at 03:00.
  insert into public.medications
    (organisation_id, patient_id, drug_name, dose, frequency, is_active, source, schedule_times)
  values (v_org, v_patient, 'MDTR Test Metformin', '500mg', 'twice daily', true, 'clinician',
    jsonb_build_array('03:00'))
  returning id into v_med_far;

  -- Due right now, but already logged as taken for this exact slot.
  insert into public.medications
    (organisation_id, patient_id, drug_name, dose, frequency, is_active, source, schedule_times)
  values (v_org, v_patient, 'MDTR Test Losartan', '50mg', 'once daily', true, 'clinician',
    jsonb_build_array(v_now_time))
  returning id into v_med_logged;
  insert into public.medication_logs
    (organisation_id, patient_id, medication_id, status, scheduled_for_date, scheduled_time)
  values (v_org, v_patient, v_med_logged, 'taken', (now() at time zone 'Africa/Lagos')::date, v_now_time);

  insert into mdtr_fixture(k, v) values
    ('org', v_org::text), ('patient', v_patient::text), ('now_time', v_now_time),
    ('med_due', v_med_due::text), ('med_far', v_med_far::text), ('med_logged', v_med_logged::text);
end $$;

-- ==========================================================================
-- 1. A schedule_times entry matching now queues whatsapp + in_app and
--    stamps the dedup table; a second run does not double-send.
-- ==========================================================================
do $$
declare
  v_patient uuid := (select v from mdtr_fixture where k = 'patient')::uuid;
  v_med uuid := (select v from mdtr_fixture where k = 'med_due')::uuid;
  v_whatsapp_1 bigint;
  v_in_app_1 bigint;
  v_dedup_1 bigint;
  v_whatsapp_2 bigint;
begin
  perform private.queue_medication_dose_reminders();

  select count(*) into v_whatsapp_1 from public.notifications
  where recipient_id = v_patient and template = 'medication_dose_reminder' and channel = 'whatsapp'
    and (payload->>'medication_id')::uuid = v_med;
  select count(*) into v_in_app_1 from public.notifications
  where recipient_id = v_patient and template = 'medication_dose_reminder' and channel = 'in_app'
    and (payload->>'medication_id')::uuid = v_med;
  select count(*) into v_dedup_1 from public.medication_dose_reminders where medication_id = v_med;

  insert into mdtr_result values
    ('a dose due right now queues whatsapp + in_app and stamps the dedup table', 'system',
     format('whatsapp=%s/in_app=%s/dedup=%s', v_whatsapp_1, v_in_app_1, v_dedup_1),
     'whatsapp=1/in_app=1/dedup=1',
     case when v_whatsapp_1 = 1 and v_in_app_1 = 1 and v_dedup_1 = 1 then 'PASS' else 'FAIL' end);
  if v_whatsapp_1 <> 1 or v_in_app_1 <> 1 or v_dedup_1 <> 1 then
    raise exception 'BROKEN: a due-now dose did not queue exactly one whatsapp + one in_app reminder';
  end if;

  perform private.queue_medication_dose_reminders();
  select count(*) into v_whatsapp_2 from public.notifications
  where recipient_id = v_patient and template = 'medication_dose_reminder' and channel = 'whatsapp'
    and (payload->>'medication_id')::uuid = v_med;

  insert into mdtr_result values
    ('running the sweep again does not double-send for the same slot', 'system',
     v_whatsapp_2::text, '1', case when v_whatsapp_2 = 1 then 'PASS' else 'FAIL' end);
  if v_whatsapp_2 <> 1 then
    raise exception 'BROKEN: re-running the sweep sent a duplicate reminder for the same slot';
  end if;
end $$;

-- ==========================================================================
-- 2. A schedule_time far outside the window (03:00, fixed) is never
--    reminded (unless the test happens to run between 02:45-03:00 Lagos
--    time, an acceptable, rare flake window shared with any fixed-clock
--    test of this shape).
-- ==========================================================================
do $$
declare
  v_patient uuid := (select v from mdtr_fixture where k = 'patient')::uuid;
  v_med uuid := (select v from mdtr_fixture where k = 'med_far')::uuid;
  v_count bigint;
begin
  select count(*) into v_count from public.notifications
  where recipient_id = v_patient and template = 'medication_dose_reminder'
    and (payload->>'medication_id')::uuid = v_med;

  insert into mdtr_result values
    ('a 03:00 schedule_time is not reminded right now', 'system',
     v_count::text, '0', case when v_count = 0 then 'PASS' else 'FAIL' end);
  if v_count <> 0 then
    raise exception 'BROKEN: a schedule_time far outside the current window was incorrectly reminded';
  end if;
end $$;

-- ==========================================================================
-- 3. A dose due right now but already logged as taken is not reminded.
-- ==========================================================================
do $$
declare
  v_patient uuid := (select v from mdtr_fixture where k = 'patient')::uuid;
  v_med uuid := (select v from mdtr_fixture where k = 'med_logged')::uuid;
  v_count bigint;
begin
  select count(*) into v_count from public.notifications
  where recipient_id = v_patient and template = 'medication_dose_reminder'
    and (payload->>'medication_id')::uuid = v_med;

  insert into mdtr_result values
    ('a dose already logged for this exact slot is not reminded', 'system',
     v_count::text, '0', case when v_count = 0 then 'PASS' else 'FAIL' end);
  if v_count <> 0 then
    raise exception 'BROKEN: an already-logged dose was incorrectly reminded';
  end if;
end $$;

select check_name, role, observed, expected, verdict
from mdtr_result
order by verdict desc, check_name, role;

rollback;
