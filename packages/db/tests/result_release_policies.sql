-- Tarragon Health
-- Live proof for the result_release_policies RLS gate
-- (20260829135012_result_release_policies.sql) — the seeded v1 config
-- restricts a positive HIV/hepatitis/cancer screen from direct patient
-- read, matching "a positive result must be doctor-delivered."
--
-- Cases:
--   1. An abnormal 'hiv' result is invisible to the patient directly.
--   2. The SAME row is visible to org staff (a restriction withholds from
--      the patient, never from the care team that has to deliver it).
--   3. A NORMAL 'hiv' result stays immediately visible to the patient —
--      restriction only withholds bad news, never a clean result of a
--      sensitive type.
--   4. An unconfigured screen type (hba1c) is never blocked, any status.
--   5. sign_result_release_policies rejects a non-Director caller.
--
-- TO CONFIRM CASE 1 DISCRIMINATES, break it on purpose: change
-- private.patient_result_blocked to always return false. Case 1 must FAIL,
-- showing the abnormal HIV result readable by the patient directly.
--
-- Run: npx supabase db query --linked -f packages/db/tests/result_release_policies.sql
-- Nothing here persists -- the whole file runs inside begin/rollback.

begin;

create temporary table test_result (
  case_num int, label text, outcome text, detail text
) on commit drop;

do $$
declare
  v_org           uuid;
  v_patient       uuid;
  v_staff_profile uuid;
  v_result_abn    uuid;
  v_result_normal uuid;
  v_visible_count int;
  v_blocked       boolean;
begin
  select id, organisation_id into v_patient, v_org
    from public.profiles where role = 'patient' limit 1;
  select p.id into v_staff_profile from public.profiles p
    where p.organisation_id = v_org and p.role = 'clinician' and p.id <> v_patient
    limit 1;

  if v_patient is null or v_staff_profile is null then
    raise exception 'Need one patient and one clinician-role profile in org %', v_org;
  end if;

  insert into public.screening_results (organisation_id, patient_id, result_status, screen_type_code)
  values (v_org, v_patient, 'abnormal', 'hiv')
  returning id into v_result_abn;

  insert into public.screening_results (organisation_id, patient_id, result_status, screen_type_code)
  values (v_org, v_patient, 'normal', 'hiv')
  returning id into v_result_normal;

  ---------------------------------------------------------------- case 1
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select count(*) into v_visible_count from public.screening_results where id = v_result_abn;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);

  insert into test_result values (1, 'Abnormal HIV result invisible to the patient directly',
    case when v_visible_count = 0 then 'PASS' else 'FAIL' end, 'visible_rows=' || v_visible_count);

  ---------------------------------------------------------------- case 2
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_staff_profile, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select count(*) into v_visible_count from public.screening_results where id = v_result_abn;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);

  insert into test_result values (2, 'Same row visible to org staff (never withheld from the care team)',
    case when v_visible_count = 1 then 'PASS' else 'FAIL' end, 'visible_rows=' || v_visible_count);

  ---------------------------------------------------------------- case 3
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select count(*) into v_visible_count from public.screening_results where id = v_result_normal;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);

  insert into test_result values (3, 'Normal HIV result stays immediately visible to the patient',
    case when v_visible_count = 1 then 'PASS' else 'FAIL' end, 'visible_rows=' || v_visible_count);

  ---------------------------------------------------------------- case 4
  v_blocked := private.patient_result_blocked('hba1c', 'critical');
  insert into test_result values (4, 'An unconfigured screen type is never blocked, any status',
    case when not v_blocked then 'PASS' else 'FAIL' end, 'blocked=' || v_blocked);

  ---------------------------------------------------------------- case 5
  v_blocked := false; -- reused as "was blocked" flag for the RPC call
  begin
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_staff_profile, 'role', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);
    perform public.sign_result_release_policies(
      (select id from public.result_release_policies where is_active limit 1)
    );
  exception when others then
    v_blocked := true;
  end;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);

  insert into test_result values (5, 'sign_result_release_policies rejects a non-Director caller',
    case when v_blocked then 'PASS' else 'FAIL' end, 'blocked=' || v_blocked);
end $$;

select
  'CASE ' || case_num || ' [' || outcome || '] ' || label ||
    case when detail = '' then '' else ' -- ' || detail end as line
from test_result
order by case_num;

rollback;
