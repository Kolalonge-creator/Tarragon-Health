-- ===========================================================================
-- Verification: patient_conditions (20260827195615_patient_conditions_
-- problem_list.sql) — a patient cannot insert or edit their own diagnosis
-- (unlike patient_allergies, by design — see that migration's header), org
-- staff can, the patient can still read it, a status change lands on
-- patient_timeline as condition_status_changed, and care_plans.patient_
-- condition_id links correctly without disturbing care_plans.condition.
--
-- Run via `supabase db query "$(cat this_file.sql)" --linked`, `psql
-- $DATABASE_URL -f this_file.sql`, or the Supabase SQL editor.
-- Wrapped in BEGIN/ROLLBACK.
-- ===========================================================================

begin;

create temporary table pcpl_fixture(k text primary key, v uuid) on commit drop;
create temporary table pcpl_result(
  check_name text, role text, observed text, expected text, verdict text
) on commit drop;

do $$
declare
  v_org       uuid;
  v_patient   uuid;
  v_clinician uuid := gen_random_uuid();
begin
  select organisation_id into v_org
  from public.profiles
  where role = 'patient' and organisation_id is not null
  group by organisation_id order by count(*) desc limit 1;
  if v_org is null then
    raise exception 'no organisation has patient profiles — cannot run this test';
  end if;

  select id into v_patient
  from public.profiles where role = 'patient' and organisation_id = v_org limit 1;

  insert into pcpl_fixture(k, v) values ('org', v_org), ('patient', v_patient), ('clinician', v_clinician);

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v_clinician, 'pcpl-test-clinician@example.invalid', 'x', now(), '{}', '{}');

  insert into public.profiles (id, organisation_id, role, full_name)
  values (v_clinician, v_org, 'clinician', 'PCPL Test Clinician')
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, full_name = excluded.full_name;
end $$;

-- ==========================================================================
-- 1. A patient session CANNOT insert their own condition.
-- ==========================================================================
do $$
declare
  v_org uuid := (select v from pcpl_fixture where k = 'org');
  v_patient uuid := (select v from pcpl_fixture where k = 'patient');
  v_caught boolean := false;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_patient::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    insert into public.patient_conditions (organisation_id, patient_id, condition_name, status)
    values (v_org, v_patient, 'Self-diagnosed condition', 'suspected');
  exception when others then
    v_caught := true;
  end;
  reset role;

  insert into pcpl_result values
    ('patient cannot self-insert a condition', 'patient', case when v_caught then 'blocked' else 'not blocked' end,
     'blocked', case when v_caught then 'PASS' else 'FAIL' end);
  if not v_caught then
    raise exception 'LEAK: a patient session inserted their own patient_conditions row';
  end if;
end $$;

-- ==========================================================================
-- 2. Org-staff (clinician) CAN insert and later update the status — and the
--    status change lands on patient_timeline.
-- ==========================================================================
do $$
declare
  v_org uuid := (select v from pcpl_fixture where k = 'org');
  v_patient uuid := (select v from pcpl_fixture where k = 'patient');
  v_clinician uuid := (select v from pcpl_fixture where k = 'clinician');
  v_condition uuid;
  v_timeline_count bigint;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_clinician::text, 'role', 'authenticated')::text, true);
  set local role authenticated;

  insert into public.patient_conditions
    (organisation_id, patient_id, condition_name, status, diagnosing_clinician_id, recorded_by)
  values (v_org, v_patient, 'Type 2 diabetes mellitus', 'suspected', v_clinician, v_clinician)
  returning id into v_condition;

  -- patient_conditions is one of the two reason-mandatory tables (see
  -- 20260827195333_record_corrections_platform_wide.sql) — omitting this
  -- would make the UPDATE below raise (covered separately in test 6).
  perform set_config('app.change_reason', 'confirmed on fasting glucose + HbA1c', true);
  update public.patient_conditions set status = 'active' where id = v_condition;
  reset role;

  insert into pcpl_fixture(k, v) values ('condition', v_condition);

  select count(*) into v_timeline_count from public.patient_timeline
    where source_table = 'patient_conditions' and source_id = v_condition
      and event_type in ('condition_recorded', 'condition_status_changed');

  insert into pcpl_result values
    ('condition insert + status change reach timeline', 'clinician', v_timeline_count::text, '2',
     case when v_timeline_count = 2 then 'PASS' else 'FAIL' end);
  if v_timeline_count <> 2 then
    raise exception 'BROKEN: expected 2 timeline rows (recorded + status_changed) for condition %, got %',
      v_condition, v_timeline_count;
  end if;
end $$;

-- ==========================================================================
-- 3. The status change is captured in record_corrections too (platform-wide
--    correction trail applies to this new table).
-- ==========================================================================
do $$
declare
  v_condition uuid := (select v from pcpl_fixture where k = 'condition');
  v_count bigint;
begin
  select count(*) into v_count from public.record_corrections
    where table_name = 'patient_conditions' and entity_id = v_condition
      and 'status' = any(changed_columns);
  insert into pcpl_result values
    ('status change captured in record_corrections', 'system', v_count::text, '>=1',
     case when v_count >= 1 then 'PASS' else 'FAIL' end);
  if v_count < 1 then
    raise exception 'BROKEN: patient_conditions status change was not captured in record_corrections';
  end if;
end $$;

-- ==========================================================================
-- 4. The patient can read their own condition (select-only).
-- ==========================================================================
do $$
declare
  v_patient uuid := (select v from pcpl_fixture where k = 'patient');
  v_condition uuid := (select v from pcpl_fixture where k = 'condition');
  v_count bigint;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_patient::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_count from public.patient_conditions where id = v_condition;
  reset role;

  insert into pcpl_result values
    ('patient reads own condition', 'patient', v_count::text, '1',
     case when v_count = 1 then 'PASS' else 'FAIL' end);
  if v_count <> 1 then
    raise exception 'BROKEN: patient could not read their own patient_conditions row';
  end if;
end $$;

-- ==========================================================================
-- 5. care_plans.patient_condition_id links without touching care_plans.
--    condition, and the FK resolves correctly.
-- ==========================================================================
do $$
declare
  v_org uuid := (select v from pcpl_fixture where k = 'org');
  v_patient uuid := (select v from pcpl_fixture where k = 'patient');
  v_clinician uuid := (select v from pcpl_fixture where k = 'clinician');
  v_condition uuid := (select v from pcpl_fixture where k = 'condition');
  v_plan uuid;
  v_linked_condition uuid;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_clinician::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.care_plans (organisation_id, patient_id, condition, status, assigned_clinician_id, patient_condition_id)
  values (v_org, v_patient, 'diabetes', 'active', v_clinician, v_condition)
  returning id into v_plan;
  reset role;

  select patient_condition_id into v_linked_condition from public.care_plans where id = v_plan;

  insert into pcpl_result values
    ('care_plans links to patient_conditions', 'clinician', coalesce(v_linked_condition::text, 'null'),
     v_condition::text, case when v_linked_condition = v_condition then 'PASS' else 'FAIL' end);
  if v_linked_condition is distinct from v_condition then
    raise exception 'BROKEN: care_plans.patient_condition_id did not persist the link';
  end if;
end $$;

-- ==========================================================================
-- 6. Reason is mandatory for patient_conditions: an UPDATE without
--    app.change_reason set raises rather than silently recording null.
-- ==========================================================================
do $$
declare
  v_clinician uuid := (select v from pcpl_fixture where k = 'clinician');
  v_condition uuid := (select v from pcpl_fixture where k = 'condition');
  v_caught boolean := false;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_clinician::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  -- app.change_reason is set via set_config(..., true) -- transaction-local,
  -- not per-statement -- so test 2's reason is still "set" this far into the
  -- same outer transaction unless explicitly cleared here. Empty string is
  -- what nullif(current_setting(...), '') in the trigger treats as "no
  -- reason", matching a real session that never called set_config at all.
  perform set_config('app.change_reason', '', true);
  begin
    update public.patient_conditions set status = 'controlled' where id = v_condition;
  exception when others then
    v_caught := true;
  end;
  reset role;

  insert into pcpl_result values
    ('reason is mandatory for patient_conditions', 'clinician',
     case when v_caught then 'raised' else 'not raised' end, 'raised',
     case when v_caught then 'PASS' else 'FAIL' end);
  if not v_caught then
    raise exception 'BROKEN: patient_conditions was updated without a reason, expected the mandatory-reason check to raise';
  end if;
end $$;

-- ==========================================================================
-- 7. The rejected update from test 6 did not silently partially apply — the
--    AFTER trigger's exception rolled back the whole statement.
-- ==========================================================================
do $$
declare
  v_condition uuid := (select v from pcpl_fixture where k = 'condition');
  v_status public.condition_clinical_status;
begin
  select status into v_status from public.patient_conditions where id = v_condition;

  insert into pcpl_result values
    ('rejected update did not persist', 'system', v_status::text, 'active',
     case when v_status = 'active' then 'PASS' else 'FAIL' end);
  if v_status is distinct from 'active' then
    raise exception 'BROKEN: the reason-less update from test 6 partially applied (status is %, expected it to stay active)', v_status;
  end if;
end $$;

select check_name, role, observed, expected, verdict
from pcpl_result
order by verdict desc, check_name, role;

rollback;
