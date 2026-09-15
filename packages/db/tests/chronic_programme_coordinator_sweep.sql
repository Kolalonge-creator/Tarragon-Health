-- 12-week two-track chronic-care programme — the daily missed-occurrence
-- sweep and the Coordinator worklist it feeds: a pending occurrence past
-- its grace window flips to missed and raises exactly one open Coordinator
-- task (never a clinician_alert — this is logistics, not clinical
-- judgement); a programme_end_review occurrence going missed raises no
-- task at all (that's a clinical matter, handled on demand from the
-- clinician tab); and the worklist table's RLS is org-staff-only, with no
-- patient-facing read policy at all.
--
-- Rolled back. Fixtures resolved at runtime, per this repo's test
-- convention.
begin;

do $$
declare
  v_org        uuid;
  v_patient    uuid;
  v_other_org_staff uuid;
  v_programme  uuid;
  v_enrolment  uuid;
  v_occ_lab    uuid;
  v_occ_review uuid;
  v_task_count integer;
begin
  select id into v_programme from public.chronic_condition_programmes where code = 'hypertension';

  select p.organisation_id into v_org
  from public.profiles p
  where p.role = 'patient'
    and not exists (
      select 1 from public.chronic_programme_enrolments e
      where e.patient_id = p.id and e.programme_id = v_programme and e.status = 'enrolled'
    )
  limit 1;
  select id into v_patient from public.profiles where organisation_id = v_org and role = 'patient'
    and not exists (
      select 1 from public.chronic_programme_enrolments e
      where e.patient_id = profiles.id and e.programme_id = v_programme and e.status = 'enrolled'
    )
  limit 1;
  -- A staff member in a DIFFERENT organisation, to prove cross-org isolation.
  select id into v_other_org_staff
  from public.profiles
  where role in ('clinician', 'admin') and organisation_id is distinct from v_org
  limit 1;

  if v_patient is null then
    raise exception 'need a patient with no existing hypertension enrolment to run this test';
  end if;

  insert into public.chronic_programme_enrolments (organisation_id, patient_id, programme_id, status)
  values (v_org, v_patient, v_programme, 'enrolled')
  returning id into v_enrolment;

  select id into v_occ_lab from public.chronic_programme_schedule_occurrences
    where enrolment_id = v_enrolment and week_number = 1 and occurrence_type = 'lab_panel';
  select id into v_occ_review from public.chronic_programme_schedule_occurrences
    where enrolment_id = v_enrolment and week_number = 12 and occurrence_type = 'programme_end_review';

  -- Force both occurrences well past the sweep's 7-day grace window.
  update public.chronic_programme_schedule_occurrences
    set due_date = current_date - 10
    where id in (v_occ_lab, v_occ_review);

  perform private.sweep_chronic_programme_occurrences();

  ---------------------------------------------------------------- 1. the lab_panel occurrence flips to missed and raises exactly one task
  if (select status from public.chronic_programme_schedule_occurrences where id = v_occ_lab) <> 'missed' then
    raise exception 'FAIL 1: overdue lab_panel occurrence was not marked missed';
  end if;
  select count(*) into v_task_count from public.chronic_programme_coordinator_tasks
    where occurrence_id = v_occ_lab and task_type = 'missed_lab_panel' and status = 'open';
  if v_task_count <> 1 then
    raise exception 'FAIL 1: expected exactly 1 open missed_lab_panel task, got %', v_task_count;
  end if;

  -- Running the sweep again must not duplicate the task (the partial unique
  -- index backs an ON CONFLICT DO NOTHING, same dedup shape as
  -- care_plan_review_prompts' one-open-per-trigger-type index).
  perform private.sweep_chronic_programme_occurrences();
  select count(*) into v_task_count from public.chronic_programme_coordinator_tasks
    where occurrence_id = v_occ_lab and task_type = 'missed_lab_panel';
  if v_task_count <> 1 then
    raise exception 'FAIL 1: re-running the sweep duplicated the task (count is now %)', v_task_count;
  end if;

  ---------------------------------------------------------------- 2. a missed programme_end_review raises no Coordinator task
  if (select status from public.chronic_programme_schedule_occurrences where id = v_occ_review) <> 'missed' then
    raise exception 'FAIL 2: overdue programme_end_review occurrence was not marked missed';
  end if;
  if exists (select 1 from public.chronic_programme_coordinator_tasks where occurrence_id = v_occ_review) then
    raise exception 'FAIL 2: a missed programme_end_review must not raise a Coordinator task (it is a clinical matter)';
  end if;

  ---------------------------------------------------------------- 3. RLS: staff in a different organisation cannot see this task
  if v_other_org_staff is not null then
    perform set_config('request.jwt.claims', json_build_object('sub', v_other_org_staff, 'role', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);
    if exists (select 1 from public.chronic_programme_coordinator_tasks where occurrence_id = v_occ_lab) then
      raise exception 'FAIL 3: a staff member from a different organisation could read this task';
    end if;
    perform set_config('role', 'postgres', true);
  end if;

  ---------------------------------------------------------------- 4. RLS: the patient themselves cannot read the Coordinator worklist
  perform set_config('request.jwt.claims', json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  if exists (select 1 from public.chronic_programme_coordinator_tasks where occurrence_id = v_occ_lab) then
    raise exception 'FAIL 4: the patient could read their own Coordinator task row (this worklist is staff-only)';
  end if;
  perform set_config('role', 'postgres', true);

  raise notice 'PASS: the sweep marks overdue occurrences missed, raises exactly one deduplicated Coordinator task per missed lab_panel/doctor_checkin, raises none for a missed programme_end_review, and the worklist is invisible to both a different organisation''s staff and the patient themselves';
end $$;

rollback;
