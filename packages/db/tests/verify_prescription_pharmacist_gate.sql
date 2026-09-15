-- Tarragon Health
-- Live proof for 20260829011500_verify_prescription.sql — spec §62.7.
-- Verification must require BOTH rx_number and verification_code, and must
-- be reachable only by role='pharmacist' — never a clinician, never the
-- patient, never with a right rx_number but wrong code.
--
-- Cases:
--   1. Pharmacist, correct rx_number + verification_code -> ALLOWED, one row back
--   2. Pharmacist, correct rx_number, WRONG verification_code -> zero rows
--   3. Clinician (not a pharmacist), correct rx_number + code -> zero rows
--   4. Unknown rx_number -> zero rows (same shape as a wrong code — no
--      distinguishing "not found" from "wrong code" in the response)
--
-- TO CONFIRM THIS TEST DISCRIMINATES, break it on purpose: remove the
-- `and m.verification_code = ...` predicate from verify_prescription's
-- lookup. Case 2 must FAIL, showing rx_number alone (a predictable sequence)
-- is enough to pull up a patient's prescription.
--
-- Run: npx supabase db query --linked -f packages/db/tests/verify_prescription_pharmacist_gate.sql
-- Nothing here persists -- the whole file runs inside begin/rollback.

begin;

create temporary table test_result (
  case_num int, label text, outcome text, detail text
) on commit drop;

do $$
declare
  v_org       uuid := '00000000-0000-0000-0000-000000000001';
  v_pat       uuid;
  v_clin      uuid;
  v_pharm     uuid;
  v_med       uuid;
  v_rx        text;
  v_code      text;
  v_row_count integer;
begin
  select id into v_pat from public.profiles
   where role = 'patient' and organisation_id = v_org limit 1;

  select p.id into v_clin from public.profiles p
   where p.organisation_id = v_org
     and p.role = 'clinician'
     and p.id <> v_pat
     and not exists (select 1 from public.clinical_staff cs where cs.profile_id = p.id)
   limit 1;

  select id into v_pharm from public.profiles where role = 'pharmacist' limit 1;

  if v_pat is null or v_clin is null or v_pharm is null then
    raise exception
      'Need one patient, one bare clinician-role profile, and one pharmacist account in org %', v_org;
  end if;

  insert into public.medications (
    organisation_id, patient_id, drug_name, dose, frequency, source, is_active
  ) values (
    v_org, v_pat, 'Verify Probe Drug', '5mg', 'daily', 'clinician', true
  ) returning id, rx_number, verification_code into v_med, v_rx, v_code;

  ---------------------------------------------------------------- case 1
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_pharm, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select count(*) into v_row_count from public.verify_prescription(v_rx, v_code);
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);

  insert into test_result values (1, 'Pharmacist, correct rx_number + code -> ALLOWED',
    case when v_row_count = 1 then 'PASS' else 'FAIL' end, 'rows=' || v_row_count);

  ---------------------------------------------------------------- case 2
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_pharm, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select count(*) into v_row_count from public.verify_prescription(v_rx, 'WRONGC');
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);

  insert into test_result values (2, 'Pharmacist, correct rx_number, wrong code -> zero rows',
    case when v_row_count = 0 then 'PASS' else 'FAIL' end, 'rows=' || v_row_count);

  ---------------------------------------------------------------- case 3
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_clin, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select count(*) into v_row_count from public.verify_prescription(v_rx, v_code);
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);

  insert into test_result values (3, 'Non-pharmacist, correct rx_number + code -> zero rows',
    case when v_row_count = 0 then 'PASS' else 'FAIL' end, 'rows=' || v_row_count);

  ---------------------------------------------------------------- case 4
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_pharm, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select count(*) into v_row_count from public.verify_prescription('TRG-RX-0000-000000', v_code);
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);

  insert into test_result values (4, 'Unknown rx_number -> zero rows',
    case when v_row_count = 0 then 'PASS' else 'FAIL' end, 'rows=' || v_row_count);
end $$;

select
  'CASE ' || case_num || ' [' || outcome || '] ' || label ||
    case when detail = '' then '' else ' -- ' || detail end as line
from test_result
order by case_num;

rollback;
