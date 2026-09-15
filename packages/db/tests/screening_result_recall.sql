-- Verifies private.apply_screening_result_recall() (migration
-- 20260829121900_screening_result_recall.sql): setting recall_months on a
-- screening_results row (the same second step setScreeningResultFollowUpAction
-- already uses for follow_up_action) tightens or creates the patient's next
-- screening_schedules row for that screen type, distinct from the routine
-- cadence private.refresh_screening_schedule_on_result already applies at
-- insert time.
--
-- Run inside a rolled-back transaction. Two cases:
--   1. A recurring screen type: the insert-time trigger opens a routine
--      next-cycle row; setting recall_months afterwards pulls that SAME
--      row's due date in to exactly today + recall_months, marks it
--      is_recall, and carries follow_up_action into recall_reason.
--   2. A one-off screen type (frequency_months null): the insert-time
--      trigger opens no follow-up row at all; a recall still opens one,
--      since the recall itself is the only reason a next cycle should
--      exist.

begin;

create temp table probe (k text, v text);

do $$
declare
  v_org uuid;
  v_patient uuid;
  v_screen_type_id uuid;
  v_freq int;
  v_result_id uuid;
  v_oneoff_screen_type_id uuid;
  v_oneoff_result_id uuid;
begin
  select organisation_id into v_org from public.profiles where role = 'patient' limit 1;
  select id into v_patient from public.profiles where role = 'patient' and organisation_id = v_org limit 1;
  select id, frequency_months into v_screen_type_id, v_freq
  from public.screen_types
  where is_active = true and frequency_months is not null and frequency_months > 2
  limit 1;

  -- Case 1
  insert into public.screening_results (organisation_id, patient_id, result_status, screen_type_code)
  select v_org, v_patient, 'borderline', code from public.screen_types where id = v_screen_type_id
  returning id into v_result_id;

  insert into probe values ('case1_routine_due_matches_frequency',
    ((select due_date from public.screening_schedules
      where patient_id = v_patient and screen_type_id = v_screen_type_id and status = 'pending')
     = (current_date + (v_freq || ' months')::interval)::date)::text);

  update public.screening_results
  set follow_up_action = 'Repeat in 2 months, borderline result', recall_months = 2
  where id = v_result_id;

  insert into probe values ('case1_recall_due_matches_2mo',
    ((select due_date from public.screening_schedules
      where patient_id = v_patient and screen_type_id = v_screen_type_id and status = 'pending')
     = (current_date + interval '2 months')::date)::text);
  insert into probe values ('case1_is_recall',
    (select is_recall::text from public.screening_schedules
     where patient_id = v_patient and screen_type_id = v_screen_type_id and status = 'pending'));
  insert into probe values ('case1_recall_reason',
    (select recall_reason from public.screening_schedules
     where patient_id = v_patient and screen_type_id = v_screen_type_id and status = 'pending'));
  insert into probe values ('case1_row_count',
    (select count(*)::text from public.screening_schedules
     where patient_id = v_patient and screen_type_id = v_screen_type_id));

  -- Case 2: one-off screen type.
  select id into v_oneoff_screen_type_id from public.screen_types where is_active = true and frequency_months is null limit 1;
  if v_oneoff_screen_type_id is not null then
    insert into public.screening_results (organisation_id, patient_id, result_status, screen_type_code)
    select v_org, v_patient, 'borderline', code from public.screen_types where id = v_oneoff_screen_type_id
    returning id into v_oneoff_result_id;

    insert into probe values ('case2_no_routine_row_count',
      (select count(*)::text from public.screening_schedules
       where patient_id = v_patient and screen_type_id = v_oneoff_screen_type_id));

    update public.screening_results
    set follow_up_action = 'Repeat once, inconclusive', recall_months = 3
    where id = v_oneoff_result_id;

    insert into probe values ('case2_recall_row_count',
      (select count(*)::text from public.screening_schedules
       where patient_id = v_patient and screen_type_id = v_oneoff_screen_type_id));
    insert into probe values ('case2_recall_is_recall',
      (select is_recall::text from public.screening_schedules
       where patient_id = v_patient and screen_type_id = v_oneoff_screen_type_id));
  else
    insert into probe values ('case2_skipped', 'no one-off screen_type in catalogue');
  end if;
end $$;

-- Expect: case1_routine_due_matches_frequency=true,
-- case1_recall_due_matches_2mo=true, case1_is_recall=true,
-- case1_recall_reason='Repeat in 2 months, borderline result',
-- case1_row_count=1 (tightened in place, not duplicated),
-- case2_no_routine_row_count=0, case2_recall_row_count=1,
-- case2_recall_is_recall=true.
select * from probe order by k;

rollback;
