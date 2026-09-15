-- ===========================================================================
-- Verification: public.report_medication_safety_finding (20260829143601) —
-- medication safety pathway 64.16-64.18. Org staff can raise a real
-- clinician_review clinician_alerts row (medication_safety or
-- potential_interaction) for a patient in their own organisation; every
-- other caller and every other type_code is rejected.
--
-- Run via `supabase db query "$(cat this_file.sql)" --linked`, `psql
-- $DATABASE_URL -f this_file.sql`, or the Supabase SQL editor.
-- Wrapped in BEGIN/ROLLBACK.
-- ===========================================================================

begin;

create temporary table rmsf_fixture(k text primary key, v uuid) on commit drop;
create temporary table rmsf_result(
  check_name text, role text, observed text, expected text, verdict text
) on commit drop;

do $$
declare
  v_org_a uuid;
  v_org_b uuid := gen_random_uuid();
  v_patient_a uuid;
  v_patient_b uuid := gen_random_uuid();
  v_staff_a uuid := gen_random_uuid();
begin
  select organisation_id into v_org_a
  from public.profiles
  where role = 'patient' and organisation_id is not null
  group by organisation_id order by count(*) desc limit 1;
  if v_org_a is null then
    raise exception 'no organisation has patient profiles — cannot run this test';
  end if;
  select id into v_patient_a from public.profiles where role = 'patient' and organisation_id = v_org_a limit 1;

  insert into public.organisations (id, name, type) values (v_org_b, 'RMSF Test Other Org', 'clinic');

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values
    (v_patient_b, 'rmsf-test-patient-b@example.invalid', 'x', now(), '{}', '{}'),
    (v_staff_a, 'rmsf-test-staff-a@example.invalid', 'x', now(), '{}', '{}');

  insert into public.profiles (id, organisation_id, role, full_name)
  values
    (v_patient_b, v_org_b, 'patient', 'RMSF Test Patient B'),
    (v_staff_a, v_org_a, 'clinician', 'RMSF Test Staff A')
  on conflict (id) do update
    set organisation_id = excluded.organisation_id, role = excluded.role, full_name = excluded.full_name;

  insert into rmsf_fixture(k, v) values
    ('org_a', v_org_a), ('org_b', v_org_b),
    ('patient_a', v_patient_a), ('patient_b', v_patient_b), ('staff_a', v_staff_a);
end $$;

-- ==========================================================================
-- 1. Org staff raises a medication_safety alert for a patient in their org.
-- ==========================================================================
do $$
declare
  v_staff uuid := (select v from rmsf_fixture where k = 'staff_a');
  v_org uuid := (select v from rmsf_fixture where k = 'org_a');
  v_patient uuid := (select v from rmsf_fixture where k = 'patient_a');
  v_alert_id uuid;
  v_count bigint;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_staff::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select public.report_medication_safety_finding(
    v_patient, v_org, 'RMSF Test: dual RAS blockade', 'Ramipril and Losartan together.', 'medication_safety'
  ) into v_alert_id;
  reset role;

  select count(*) into v_count
  from public.clinician_alerts
  where id = v_alert_id and patient_id = v_patient and type_code = 'medication_safety'
    and category = 'clinical' and level = 'clinician_review';

  insert into rmsf_result values
    ('org staff raises a medication_safety alert for their own org''s patient', 'clinician',
     v_count::text, '1', case when v_count = 1 then 'PASS' else 'FAIL' end);
  if v_count <> 1 then
    raise exception 'BROKEN: org staff calling report_medication_safety_finding did not create the expected clinician_alerts row';
  end if;
end $$;

-- ==========================================================================
-- 2. Negative control: a patient (not staff) cannot call this RPC at all.
-- ==========================================================================
do $$
declare
  v_patient uuid := (select v from rmsf_fixture where k = 'patient_a');
  v_org uuid := (select v from rmsf_fixture where k = 'org_a');
  v_caught boolean := false;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_patient::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.report_medication_safety_finding(
      v_patient, v_org, 'RMSF Test: patient self-call', 'Should never succeed.', 'medication_safety'
    );
  exception when others then
    v_caught := true;
  end;
  reset role;

  insert into rmsf_result values
    ('a patient cannot call report_medication_safety_finding', 'patient',
     case when v_caught then 'rejected' else 'accepted' end, 'rejected',
     case when v_caught then 'PASS' else 'FAIL' end);
  if not v_caught then
    raise exception 'BROKEN: a patient (non-staff) call to report_medication_safety_finding was accepted';
  end if;
end $$;

-- ==========================================================================
-- 3. Negative control: staff cannot raise this for a patient in ANOTHER org.
-- ==========================================================================
do $$
declare
  v_staff uuid := (select v from rmsf_fixture where k = 'staff_a');
  v_org_b uuid := (select v from rmsf_fixture where k = 'org_b');
  v_patient_b uuid := (select v from rmsf_fixture where k = 'patient_b');
  v_caught boolean := false;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_staff::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.report_medication_safety_finding(
      v_patient_b, v_org_b, 'RMSF Test: cross-org call', 'Should never succeed.', 'medication_safety'
    );
  exception when others then
    v_caught := true;
  end;
  reset role;

  insert into rmsf_result values
    ('staff cannot raise a finding for a patient outside their org', 'clinician',
     case when v_caught then 'rejected' else 'accepted' end, 'rejected',
     case when v_caught then 'PASS' else 'FAIL' end);
  if not v_caught then
    raise exception 'BROKEN: staff from org A raised a medication safety finding for a patient in org B';
  end if;
end $$;

-- ==========================================================================
-- 4. Negative control: an out-of-taxonomy type_code is rejected.
-- ==========================================================================
do $$
declare
  v_staff uuid := (select v from rmsf_fixture where k = 'staff_a');
  v_org uuid := (select v from rmsf_fixture where k = 'org_a');
  v_patient uuid := (select v from rmsf_fixture where k = 'patient_a');
  v_caught boolean := false;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_staff::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.report_medication_safety_finding(
      v_patient, v_org, 'RMSF Test: wrong type_code', 'Should never succeed.', 'abnormal_result'
    );
  exception when others then
    v_caught := true;
  end;
  reset role;

  insert into rmsf_result values
    ('an out-of-taxonomy type_code is rejected', 'clinician',
     case when v_caught then 'rejected' else 'accepted' end, 'rejected',
     case when v_caught then 'PASS' else 'FAIL' end);
  if not v_caught then
    raise exception 'BROKEN: report_medication_safety_finding accepted a non medication_safety/potential_interaction type_code';
  end if;
end $$;

select check_name, role, observed, expected, verdict
from rmsf_result
order by verdict desc, check_name, role;

rollback;
