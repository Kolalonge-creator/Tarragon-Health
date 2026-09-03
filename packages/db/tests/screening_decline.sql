-- Verifies the screening decline gap-closure (migrations
-- 20260829121649_screening_status_declined.sql and
-- 20260829121818_screening_schedule_decline.sql):
--   - a 'declined' row without declined_at/declined_reason is rejected
--   - a proper decline (both set) succeeds
--   - once declined, a fresh 'pending' insert for the SAME patient+screen
--     type is silently skipped, so the recommendation engine (or any other
--     schedule-creation path) can never resurrect a screening the patient
--     turned down
--   - a 'pending' insert for a DIFFERENT screen type is completely
--     unaffected
--
-- Run inside a rolled-back transaction.

begin;

create temp table probe (k text, v text);

do $$
declare
  v_org uuid;
  v_patient uuid;
  v_screen_type_id uuid;
  v_other_screen_type_id uuid;
begin
  select organisation_id into v_org from public.profiles where role = 'patient' limit 1;
  select id into v_patient from public.profiles where role = 'patient' and organisation_id = v_org limit 1;
  select id into v_screen_type_id from public.screen_types where is_active = true and frequency_months is not null limit 1;

  -- Case A: declining without a reason is rejected by the CHECK constraint.
  begin
    insert into public.screening_schedules (organisation_id, patient_id, screen_type_id, due_date, status, declined_at)
    values (v_org, v_patient, v_screen_type_id, current_date, 'declined', now());
    insert into probe values ('caseA_bad_decline_rejected', 'false (no exception raised!)');
  exception when check_violation then
    insert into probe values ('caseA_bad_decline_rejected', 'true');
  end;

  -- Case B: a proper decline succeeds.
  insert into public.screening_schedules (organisation_id, patient_id, screen_type_id, due_date, status, declined_at, declined_reason)
  values (v_org, v_patient, v_screen_type_id, current_date, 'declined', now(), 'Already tested privately');
  insert into probe values ('caseB_decline_count',
    (select count(*)::text from public.screening_schedules
     where patient_id = v_patient and screen_type_id = v_screen_type_id and status = 'declined'));

  -- Case C: a fresh 'pending' insert for the SAME patient+screen_type is silently skipped.
  insert into public.screening_schedules (organisation_id, patient_id, screen_type_id, due_date, status)
  values (v_org, v_patient, v_screen_type_id, current_date + 30, 'pending');
  insert into probe values ('caseC_pending_blocked_count',
    (select count(*)::text from public.screening_schedules
     where patient_id = v_patient and screen_type_id = v_screen_type_id and status = 'pending'));

  -- Case D: a 'pending' insert for a DIFFERENT screen type still works normally.
  select id into v_other_screen_type_id from public.screen_types where is_active = true and id <> v_screen_type_id limit 1;
  insert into public.screening_schedules (organisation_id, patient_id, screen_type_id, due_date, status)
  values (v_org, v_patient, v_other_screen_type_id, current_date, 'pending');
  insert into probe values ('caseD_other_screen_type_count',
    (select count(*)::text from public.screening_schedules
     where patient_id = v_patient and screen_type_id = v_other_screen_type_id and status = 'pending'));
end $$;

-- Expect: caseA_bad_decline_rejected=true, caseB_decline_count=1,
-- caseC_pending_blocked_count=0, caseD_other_screen_type_count=1.
select * from probe order by k;

rollback;
