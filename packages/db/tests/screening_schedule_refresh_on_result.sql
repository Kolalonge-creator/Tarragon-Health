-- Verifies private.refresh_screening_schedule_on_result() (migration
-- 20260802232211): recording a screening_results row refreshes the patient's
-- screening_schedules calendar instead of leaving it stale.
--
-- Run inside a rolled-back transaction. Three cases, one per screen_type
-- shape the trigger has to handle correctly:
--   1. An existing active (pending) schedule for a recurring screen type ->
--      closed as 'completed' and a next-cycle 'pending' row is opened dated
--      today + frequency_months.
--   2. A one-off screen type (frequency_months is null) -> closed as
--      'completed', no follow-up row created.
--   3. A patient with zero prior schedule row for a recurring screen type
--      (a first-time/ad hoc result) -> still opens the next-cycle row,
--      never errors.

begin;

create temp table probe (k text, v text);

do $$
declare
  v_org uuid;
  v_patient uuid;
  v_screen_type_id uuid;
  v_freq int;
  v_oneoff_screen_type_id uuid;
  v_fresh_patient uuid;
begin
  select organisation_id into v_org from public.profiles where role = 'patient' limit 1;
  select id into v_patient from public.profiles where role = 'patient' and organisation_id = v_org limit 1;

  select id, frequency_months into v_screen_type_id, v_freq
  from public.screen_types
  where is_active = true and frequency_months is not null
  limit 1;

  -- Case 1
  insert into public.screening_schedules (organisation_id, patient_id, screen_type_id, due_date, status)
  values (v_org, v_patient, v_screen_type_id, current_date, 'pending');

  insert into public.screening_results (organisation_id, patient_id, result_status, screen_type_code)
  select v_org, v_patient, 'normal', code from public.screen_types where id = v_screen_type_id;

  insert into probe values ('case1_old_status',
    (select status from public.screening_schedules
     where patient_id = v_patient and screen_type_id = v_screen_type_id and due_date = current_date));
  insert into probe values ('case1_new_pending_count',
    (select count(*)::text from public.screening_schedules
     where patient_id = v_patient and screen_type_id = v_screen_type_id and status = 'pending' and due_date > current_date));
  insert into probe values ('case1_new_due_date_matches',
    ((select due_date from public.screening_schedules
      where patient_id = v_patient and screen_type_id = v_screen_type_id and status = 'pending' and due_date > current_date)
     = (current_date + (v_freq || ' months')::interval)::date)::text);

  -- Case 2: one-off screen type
  select id into v_oneoff_screen_type_id
  from public.screen_types where is_active = true and frequency_months is null limit 1;

  if v_oneoff_screen_type_id is not null then
    insert into public.screening_schedules (organisation_id, patient_id, screen_type_id, due_date, status)
    values (v_org, v_patient, v_oneoff_screen_type_id, current_date, 'pending');

    insert into public.screening_results (organisation_id, patient_id, result_status, screen_type_code)
    select v_org, v_patient, 'normal', code from public.screen_types where id = v_oneoff_screen_type_id;

    insert into probe values ('case2_row_count',
      (select count(*)::text from public.screening_schedules
       where patient_id = v_patient and screen_type_id = v_oneoff_screen_type_id));
    insert into probe values ('case2_statuses',
      (select array_agg(status)::text from public.screening_schedules
       where patient_id = v_patient and screen_type_id = v_oneoff_screen_type_id));
  else
    insert into probe values ('case2_skipped', 'no one-off screen_type in catalogue');
  end if;

  -- Case 3: fresh patient, zero prior schedule row for the recurring screen type
  select id into v_fresh_patient
  from public.profiles where role = 'patient' and organisation_id = v_org and id <> v_patient limit 1;

  if v_fresh_patient is not null then
    insert into public.screening_results (organisation_id, patient_id, result_status, screen_type_code)
    select v_org, v_fresh_patient, 'normal', code from public.screen_types where id = v_screen_type_id;

    insert into probe values ('case3_row_count',
      (select count(*)::text from public.screening_schedules
       where patient_id = v_fresh_patient and screen_type_id = v_screen_type_id));
    insert into probe values ('case3_status',
      (select status from public.screening_schedules
       where patient_id = v_fresh_patient and screen_type_id = v_screen_type_id));
  else
    insert into probe values ('case3_skipped', 'only one patient profile in this org');
  end if;
end $$;

-- Expect: case1_old_status=completed, case1_new_pending_count=1,
-- case1_new_due_date_matches=true, case2_row_count=1, case2_statuses={completed},
-- case3_row_count=1, case3_status=pending.
select * from probe order by k;

rollback;
