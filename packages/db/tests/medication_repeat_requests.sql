-- Tarragon Health
-- Live proof for 20260829011000_medication_repeat_requests.sql — spec
-- §62.11/§62.12. The eligibility gate must reject before a clinician ever
-- sees the request (no repeats left, already expired, one already pending),
-- and review authority must be exactly private.can_confirm_medication_refill
-- (any active clinical tier, never a Care Coordinator, never the patient).
--
-- Cases:
--   1. Patient requests a repeat on an eligible prescription -> ALLOWED, status=pending
--   2. A second request while one is pending -> BLOCKED (duplicate)
--   3. Care Coordinator (org staff, no clinical authority) attempts to approve -> BLOCKED
--   4. Tier 1 approves -> ALLOWED, status=approved, reviewed_by/reviewed_at stamped
--   5. Re-reviewing an already-approved request -> BLOCKED (already reviewed)
--   6. A further request once repeats are exhausted (repeats_allowed=1, one already
--      approved) -> BLOCKED
--   7. Requesting a repeat on an expired prescription -> BLOCKED
--   8. Denying without a reason -> BLOCKED; denying with a reason -> ALLOWED
--
-- TO CONFIRM THIS TEST DISCRIMINATES, break it on purpose: change
-- medication_repeat_requests_update's USING clause to drop the
-- can_confirm_medication_refill conjunct (leave only is_org_staff). Case 3
-- must FAIL, showing a Care Coordinator approving a repeat request.
--
-- Run: npx supabase db query --linked -f packages/db/tests/medication_repeat_requests.sql
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
  v_coord     uuid;
  v_staff_id  uuid;
  v_med       uuid;
  v_med_expired uuid;
  v_req       uuid;
  v_raised    text;
  v_status    public.medication_repeat_request_status;
begin
  select id into v_pat from public.profiles
   where role = 'patient' and organisation_id = v_org limit 1;

  select p.id into v_clin from public.profiles p
   where p.organisation_id = v_org
     and p.role = 'clinician'
     and p.id <> v_pat
     and not exists (select 1 from public.clinical_staff cs where cs.profile_id = p.id)
   limit 1;

  select id into v_coord from public.profiles
   where role = 'care_coordinator' and organisation_id = v_org limit 1;

  if v_pat is null or v_clin is null or v_coord is null then
    raise exception
      'Need one patient, one bare clinician-role profile, and one care_coordinator in org %', v_org;
  end if;

  insert into public.clinical_staff (
    organisation_id, profile_id, full_name, active, license_verified_at,
    is_clinical_director, doctor_tier,
    indemnity_insurer, indemnity_policy_number, indemnity_expires_at
  ) values (
    v_org, v_clin, 'Repeat Request Probe', true, now(),
    false, 'tier_1',
    'Probe Indemnity Ltd', 'PROBE-REPEAT-RX', now() + interval '1 year'
  ) returning id into v_staff_id;

  insert into public.medications (
    organisation_id, patient_id, drug_name, dose, frequency, source, is_active, repeats_allowed
  ) values (
    v_org, v_pat, 'Repeat Probe Drug', '5mg', 'daily', 'clinician', true, 1
  ) returning id into v_med;

  insert into public.medications (
    organisation_id, patient_id, drug_name, dose, frequency, source, is_active,
    repeats_allowed, expires_at
  ) values (
    v_org, v_pat, 'Repeat Probe Drug (expired)', '5mg', 'daily', 'clinician', true,
    2, now() - interval '1 day'
  ) returning id into v_med_expired;

  ---------------------------------------------------------------- case 1
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  insert into public.medication_repeat_requests (organisation_id, patient_id, medication_id)
    values (v_org, v_pat, v_med) returning id into v_req;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);

  select status into v_status from public.medication_repeat_requests where id = v_req;
  insert into test_result values (1, 'Patient requests a repeat -> ALLOWED, pending',
    case when v_status = 'pending' then 'PASS' else 'FAIL' end, 'status=' || v_status);

  ---------------------------------------------------------------- case 2
  v_raised := null;
  begin
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);
    insert into public.medication_repeat_requests (organisation_id, patient_id, medication_id)
      values (v_org, v_pat, v_med);
  exception when others then
    v_raised := sqlerrm;
  end;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);

  insert into test_result values (2, 'Second request while one is pending -> BLOCKED',
    case when v_raised like '%already pending%' then 'PASS' else 'FAIL' end,
    coalesce(v_raised, 'no error raised'));

  ---------------------------------------------------------------- case 3
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_coord, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  update public.medication_repeat_requests set status = 'approved' where id = v_req;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);

  select status into v_status from public.medication_repeat_requests where id = v_req;
  insert into test_result values (3, 'Care Coordinator attempts to approve -> BLOCKED (RLS filters, no-op)',
    case when v_status = 'pending' then 'PASS' else 'FAIL' end, 'status=' || v_status);

  ---------------------------------------------------------------- case 4
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_clin, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  update public.medication_repeat_requests set status = 'approved' where id = v_req;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);

  insert into test_result values (4, 'Tier 1 approves -> ALLOWED, reviewer stamped',
    case when (select status from public.medication_repeat_requests where id = v_req) = 'approved'
      and (select reviewed_by from public.medication_repeat_requests where id = v_req) = v_staff_id
      and (select reviewed_at from public.medication_repeat_requests where id = v_req) is not null
      then 'PASS' else 'FAIL' end, '');

  ---------------------------------------------------------------- case 5
  v_raised := null;
  begin
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_clin, 'role', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);
    update public.medication_repeat_requests set status = 'denied', denial_reason = 'changed my mind' where id = v_req;
  exception when others then
    v_raised := sqlerrm;
  end;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);

  insert into test_result values (5, 'Re-reviewing an already-approved request -> BLOCKED',
    case when v_raised like '%already been reviewed%' then 'PASS' else 'FAIL' end,
    coalesce(v_raised, 'no error raised'));

  ---------------------------------------------------------------- case 6
  v_raised := null;
  begin
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);
    insert into public.medication_repeat_requests (organisation_id, patient_id, medication_id)
      values (v_org, v_pat, v_med);
  exception when others then
    v_raised := sqlerrm;
  end;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);

  insert into test_result values (6, 'Further request once repeats exhausted (1 allowed, 1 approved) -> BLOCKED',
    case when v_raised like '%No repeats remaining%' then 'PASS' else 'FAIL' end,
    coalesce(v_raised, 'no error raised'));

  ---------------------------------------------------------------- case 7
  v_raised := null;
  begin
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);
    insert into public.medication_repeat_requests (organisation_id, patient_id, medication_id)
      values (v_org, v_pat, v_med_expired);
  exception when others then
    v_raised := sqlerrm;
  end;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);

  insert into test_result values (7, 'Requesting a repeat on an expired prescription -> BLOCKED',
    case when v_raised like '%expired%' then 'PASS' else 'FAIL' end,
    coalesce(v_raised, 'no error raised'));

  ---------------------------------------------------------------- case 8
  -- Fresh medication + request pair so denial isn't testing an already-
  -- decided row from the cases above.
  insert into public.medications (
    organisation_id, patient_id, drug_name, dose, frequency, source, is_active, repeats_allowed
  ) values (
    v_org, v_pat, 'Repeat Probe Drug (denial)', '5mg', 'daily', 'clinician', true, 1
  ) returning id into v_med;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  insert into public.medication_repeat_requests (organisation_id, patient_id, medication_id)
    values (v_org, v_pat, v_med) returning id into v_req;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);

  v_raised := null;
  begin
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_clin, 'role', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);
    update public.medication_repeat_requests set status = 'denied' where id = v_req;
  exception when others then
    v_raised := sqlerrm;
  end;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_clin, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  update public.medication_repeat_requests
    set status = 'denied', denial_reason = 'Needs a review visit first' where id = v_req;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);

  insert into test_result values (8, 'Deny without reason BLOCKED, deny with reason ALLOWED',
    case when v_raised like '%reason is required%'
      and (select status from public.medication_repeat_requests where id = v_req) = 'denied'
      then 'PASS' else 'FAIL' end, coalesce(v_raised, 'no error on first attempt'));
end $$;

select
  'CASE ' || case_num || ' [' || outcome || '] ' || label ||
    case when detail = '' then '' else ' -- ' || detail end as line
from test_result
order by case_num;

rollback;
