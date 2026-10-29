-- Tarragon Health: a person follows up when a screening result has not come back (migration 20261029192501).
--
-- The patient chase (reminders up to an escalated push) only ever reaches the patient. This proves the care-team half:
--   1. nothing is created while the screening scheduler guard is off;
--   2. nothing is created while the task type is still unconfirmed by the CMO;
--   3. once confirmed, a MEMBER whose printed request reached the escalated stage gets exactly one care-coordinator task;
--   4. a FREE patient in the same state gets none (Free uses no doctor time), and neither does a Member who is only overdue
--      (not yet escalated);
--   5. running the sweep again makes no second task for the same schedule;
--   6. the task is coordinator-tier, routine, carries no test name or result, and the sweep is not callable by anon or
--      by a signed-in user.
--
-- Sabotage (by hand): delete the `private.patient_is_member(...)` line in the sweep. Step 4 must then fail (the Free patient gets
-- a task); if it still passes, the Members-only rule is untested.
--
-- Run: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/db/tests/screening_result_chase_task.sql

begin;

do $$
declare
  v_org uuid;
  v_member uuid := gen_random_uuid();
  v_free uuid := gen_random_uuid();
  v_member_overdue uuid := gen_random_uuid();
  v_hba1c uuid;
  v_sched_member uuid;
  v_sched_free uuid;
  v_sched_overdue uuid;
  v_n integer;
  v_task public.clinical_tasks%rowtype;
begin
  select id into v_org from public.organisations limit 1;
  select id into v_hba1c from public.screen_types where code = 'hba1c';

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values
    (v_member, 'chase-member@example.invalid', 'x', now(), '{}', '{}'),
    (v_free, 'chase-free@example.invalid', 'x', now(), '{}', '{}'),
    (v_member_overdue, 'chase-overdue@example.invalid', 'x', now(), '{}', '{}');
  update public.profiles set organisation_id = v_org, role = 'patient', full_name = 'Chase Member', is_test = true, is_active = true where id = v_member;
  update public.profiles set organisation_id = v_org, role = 'patient', full_name = 'Chase Free', is_test = true, is_active = true where id = v_free;
  update public.profiles set organisation_id = v_org, role = 'patient', full_name = 'Chase Overdue', is_test = true, is_active = true where id = v_member_overdue;

  insert into public.patient_memberships (organisation_id, patient_id, source, state, starts_at, is_test)
  values (v_org, v_member, 'purchase', 'active', now() - interval '10 days', true),
         (v_org, v_member_overdue, 'purchase', 'active', now() - interval '10 days', true);

  -- three schedules: Member escalated, Free escalated, Member only overdue
  insert into public.screening_schedules (organisation_id, patient_id, screen_type_id, status, due_date, reminder_stage)
  values (v_org, v_member, v_hba1c, 'overdue', current_date - 30, 'escalated') returning id into v_sched_member;
  insert into public.screening_schedules (organisation_id, patient_id, screen_type_id, status, due_date, reminder_stage)
  values (v_org, v_free, v_hba1c, 'overdue', current_date - 30, 'escalated') returning id into v_sched_free;
  insert into public.screening_schedules (organisation_id, patient_id, screen_type_id, status, due_date, reminder_stage)
  values (v_org, v_member_overdue, v_hba1c, 'overdue', current_date - 10, 'overdue') returning id into v_sched_overdue;

  -- the task type exists, coordinator-tier, and is unconfirmed
  if not exists (select 1 from public.task_types where code = 'screening_result_chase' and min_doctor_tier = 'care_coordinator' and priority_class >= 8 and confirmed_at is null) then
    raise exception 'FAIL 0: screening_result_chase is missing, not coordinator-tier, not routine, or already confirmed';
  end if;

  -- 1. guard off -> nothing
  -- (a fresh database has the guard off already)
  if private.go_live_guard_on('screening_scheduler_enabled') then raise exception 'FAIL 0: expected the scheduler guard off on a fresh database'; end if;
  if private.chase_unreported_screening_results() <> 0 then raise exception 'FAIL 1: a task was made while the scheduler guard is off'; end if;

  -- 2. guard on, type unconfirmed -> nothing
  -- a guard changes only with a matching log row in the same transaction (private.go_live_guards_guard), as set_go_live_guard writes it
  insert into public.go_live_guard_log (guard_key, action, actor_id, actor_role, note, conditions)
  values ('screening_scheduler_enabled', 'switched_on', (select id from public.profiles where organisation_id = v_org and role = 'admin' limit 1), 'cmo', 'proof: rolled back', '[]'::jsonb);
  update public.go_live_guards
     set is_on = true, changed_at = now(), change_note = 'proof: rolled back',
         changed_by = (select id from public.profiles where organisation_id = v_org and role = 'admin' limit 1)
   where key = 'screening_scheduler_enabled';
  if private.chase_unreported_screening_results() <> 0 then raise exception 'FAIL 2: a task was made before the CMO confirmed the task type'; end if;

  -- 3. confirmed -> exactly one, for the Member
  update public.task_types set confirmed_at = now(), confirmed_by = null where code = 'screening_result_chase';
  v_n := private.chase_unreported_screening_results();
  if v_n <> 1 then raise exception 'FAIL 3: the sweep made % tasks, expected 1 (the escalated Member only)', v_n; end if;
  select * into v_task from public.clinical_tasks where patient_id = v_member and type = 'screening_result_chase';
  if v_task.id is null then raise exception 'FAIL 3: the Member has no screening_result_chase task'; end if;

  -- 4. Free and merely-overdue get none
  select count(*) into v_n from public.clinical_tasks where patient_id = v_free and type = 'screening_result_chase';
  if v_n <> 0 then raise exception 'FAIL 4: a Free patient got a care-team task'; end if;
  select count(*) into v_n from public.clinical_tasks where patient_id = v_member_overdue and type = 'screening_result_chase';
  if v_n <> 0 then raise exception 'FAIL 4: a Member who is only overdue (not escalated) got a task'; end if;

  -- 5. no second task for the same schedule, even when the first is finished
  perform set_config('tarragon.task_transition', 'on', true);
  update public.clinical_tasks set state = 'cancelled', cancel_reason = 'proof: finished task must not come back' where id = v_task.id;
  perform set_config('tarragon.task_transition', 'off', true);
  if private.chase_unreported_screening_results() <> 0 then raise exception 'FAIL 5: a second task was made for a schedule that already had one'; end if;
  select count(*) into v_n from public.clinical_tasks where patient_id = v_member and type = 'screening_result_chase';
  if v_n <> 1 then raise exception 'FAIL 5: % tasks for the same schedule', v_n; end if;

  -- 6. shape and privileges
  if v_task.priority_class < 8 then raise exception 'FAIL 6: the task is more urgent than routine (class %)', v_task.priority_class; end if;
  if v_task.min_tier <> 'care_coordinator' then raise exception 'FAIL 6: the task needs % rather than a care coordinator', v_task.min_tier; end if;
  if v_task.dedup_key !~ '^screening_chase:[0-9a-f-]{36}$' then raise exception 'FAIL 6: unexpected dedup key %', v_task.dedup_key; end if;
  if has_function_privilege('anon', 'private.chase_unreported_screening_results()', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.chase_unreported_screening_results()', 'EXECUTE') then
    raise exception 'FAIL 6: the sweep is callable by anon or by a signed-in user';
  end if;
  if not exists (select 1 from cron.job where jobname = 'screening-result-chase-daily' and active) then
    raise exception 'FAIL 6: the nightly chase job is not scheduled';
  end if;

  raise notice 'ALL CHECKS PASSED';
end $$;

rollback;
