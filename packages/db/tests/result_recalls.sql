-- Tarragon Health
-- Live proof for the Result Lifecycle recall workflow
-- (20260829122500_screening_results_structured_action_and_review.sql,
-- 20260829122600_result_recalls.sql) — the §58.19 acceptance criterion this
-- whole feature exists for: "result delivered" must not be assumable to
-- mean "result managed." Specifically:
--   1. action_type = 'repeat_test' with no due date is BLOCKED (22023) —
--      a clinician cannot record "repeat this test" without committing to
--      when.
--   2. action_type = 'repeat_test' WITH a due date auto-creates a
--      result_recalls row — scheduling cannot be silently skipped by a
--      call site that forgets to.
--   3. Recording the repeat test's own result (same patient + screen_type)
--      auto-completes the recall — closing the loop without depending on
--      anyone remembering to come back and mark it.
--   4. RLS: a patient can read their own recall but not another patient's.
--
-- TO CONFIRM CASE 1 DISCRIMINATES, break it on purpose: remove the
-- `raise exception ... using errcode = '22023'` guard from
-- enforce_screening_result_action_fields. Case 1 must FAIL, showing a
-- repeat_test action accepted with no due date.
--
-- Run: npx supabase db query --linked -f packages/db/tests/result_recalls.sql
-- Nothing here persists -- the whole file runs inside begin/rollback.

begin;

create temporary table test_result (
  case_num int, label text, outcome text, detail text
) on commit drop;

do $$
declare
  v_org        uuid;
  v_patient    uuid;
  v_patient2   uuid;
  v_staff      uuid;
  v_result1_id uuid;
  v_result2_id uuid;
  v_recall_id  uuid;
  v_status     text;
  v_blocked    boolean;
  v_count      int;
begin
  select id, organisation_id into v_patient, v_org
    from public.profiles where role = 'patient' limit 1;
  select id into v_staff from public.profiles p
    where p.organisation_id = v_org and p.role = 'clinician' and p.id <> v_patient
    limit 1;
  select id into v_patient2 from public.profiles
    where role = 'patient' and organisation_id = v_org and id <> v_patient
    limit 1;

  if v_patient is null or v_staff is null then
    raise exception 'Need one patient and one clinician-role profile in org %', v_org;
  end if;

  insert into public.screening_results (organisation_id, patient_id, result_status, screen_type_code)
  values (v_org, v_patient, 'abnormal', 'hba1c')
  returning id into v_result1_id;

  ---------------------------------------------------------------- case 1
  v_blocked := false;
  begin
    update public.screening_results
      set action_type = 'repeat_test'
      where id = v_result1_id;
  exception when others then
    v_blocked := true;
  end;
  insert into test_result values (1, 'action_type=repeat_test with no due date -> BLOCKED',
    case when v_blocked then 'PASS' else 'FAIL' end, 'blocked=' || v_blocked);

  ---------------------------------------------------------------- case 2
  update public.screening_results
    set action_type = 'repeat_test',
        action_repeat_due_date = current_date + 90,
        follow_up_action = 'Repeat HbA1c in 3 months'
    where id = v_result1_id;

  select id, status::text into v_recall_id, v_status
    from public.result_recalls where screening_result_id = v_result1_id;
  insert into test_result values (2, 'repeat_test with a due date -> result_recalls row auto-created',
    case when v_recall_id is not null and v_status = 'scheduled' then 'PASS' else 'FAIL' end,
    'recall_id=' || coalesce(v_recall_id::text, 'null') || ' status=' || coalesce(v_status, 'null'));

  ---------------------------------------------------------------- case 3
  insert into public.screening_results (organisation_id, patient_id, result_status, screen_type_code)
  values (v_org, v_patient, 'normal', 'hba1c')
  returning id into v_result2_id;

  select status::text into v_status from public.result_recalls where id = v_recall_id;
  insert into test_result values (3, 'A fresh same-patient/same-screen_type result -> recall auto-completes',
    case when v_status = 'completed' then 'PASS' else 'FAIL' end, 'status=' || coalesce(v_status, 'null'));

  ---------------------------------------------------------------- case 4
  if v_patient2 is not null then
    -- A real recall belonging to a second patient, so there is something
    -- genuine to wrongly leak if RLS is broken.
    insert into public.screening_results (organisation_id, patient_id, result_status, screen_type_code)
    values (v_org, v_patient2, 'abnormal', 'hba1c')
    returning id into v_result2_id;
    update public.screening_results
      set action_type = 'repeat_test', action_repeat_due_date = current_date + 90
      where id = v_result2_id;

    perform set_config('request.jwt.claims',
      json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);
    select count(*) into v_count from public.result_recalls where patient_id = v_patient2;
    perform set_config('role', 'postgres', true);
    perform set_config('request.jwt.claims', '', true);

    insert into test_result values (4, 'Patient A cannot read patient B''s recall via RLS',
      case when v_count = 0 then 'PASS' else 'FAIL' end, 'visible_rows=' || v_count);
  else
    insert into test_result values (4, 'Cross-patient RLS check', 'SKIP', 'only one patient in seed org');
  end if;
end $$;

select
  'CASE ' || case_num || ' [' || outcome || '] ' || label ||
    case when detail = '' then '' else ' -- ' || detail end as line
from test_result
order by case_num;

rollback;
