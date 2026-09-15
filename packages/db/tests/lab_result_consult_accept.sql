-- Doctor-side accept flow for the lab-result consultation fee feature:
-- accept_lab_result_consult_request(p_request_id, p_scheduled_at) turns a
-- paid request into a booked video_consultations row.
--
-- Covers: only an active, non-care-coordinator clinical_staff member of the
-- SAME organisation can accept (not the patient, not a care coordinator, not
-- a different org's clinician); an already-accepted request can't be
-- accepted twice; a past scheduled time is rejected; overlapping-time
-- double-booking for the SAME doctor is rejected, but a DIFFERENT doctor can
-- take the exact same time; a non-overlapping time for the same doctor
-- succeeds.
--
-- Run inside a single transaction and ROLLED BACK. Every negative is paired
-- with a positive control.
--
-- To re-run:
--   npx supabase db query --linked -f packages/db/tests/lab_result_consult_accept.sql
-- (run it from the MAIN checkout, not a worktree - see
-- reference_supabase_cli_sql_access)

begin;

create temp table r(step text, verdict text) on commit drop;
grant insert, select on r to authenticated;

do $$
declare
  v_org uuid; v_pt uuid;
  v_clin1 uuid; v_staff1 uuid;
  v_clin2 uuid; v_staff2 uuid;
  v_clin_cc uuid; v_staff_cc uuid;
  v_temp_org uuid;
  v_req1 uuid; v_req2 uuid; v_req3 uuid;
  v_consult1 uuid; v_consult2 uuid; v_consult3 uuid;
  v_status text; v_accepted_by uuid; v_vc_id uuid;
  v_vc_context text; v_vc_status text; v_vc_patient uuid; v_vc_org uuid;
  v_claims text;
  v_t1 timestamptz;
begin
  ------------------------------------------------------------------
  -- Fixtures.
  ------------------------------------------------------------------
  select id, organisation_id into v_pt, v_org
    from public.profiles where role = 'patient' and organisation_id is not null
    order by created_at limit 1;
  if v_pt is null then
    raise exception 'fixture lookup failed - no patient found';
  end if;

  select cs.id, cs.profile_id into v_staff1, v_clin1
    from public.clinical_staff cs
    where cs.organisation_id = v_org and cs.active
      and cs.doctor_tier is not null and cs.doctor_tier <> 'care_coordinator'
    order by cs.id limit 1;
  select cs.id, cs.profile_id into v_staff2, v_clin2
    from public.clinical_staff cs
    where cs.organisation_id = v_org and cs.active
      and cs.doctor_tier is not null and cs.doctor_tier <> 'care_coordinator'
      and cs.id <> v_staff1
    order by cs.id limit 1;
  if v_staff1 is null or v_staff2 is null then
    raise exception 'fixture lookup failed - need two distinct active clinicians in the org';
  end if;

  -- A care coordinator's clinical_staff row in the same org — find one, or
  -- create one for an existing care_coordinator profile if none exists yet.
  select cs.id, cs.profile_id into v_staff_cc, v_clin_cc
    from public.clinical_staff cs
    where cs.organisation_id = v_org and cs.doctor_tier = 'care_coordinator'
    limit 1;
  if v_staff_cc is null then
    select id into v_clin_cc from public.profiles
      where role = 'care_coordinator' and organisation_id = v_org limit 1;
    if v_clin_cc is null then
      raise exception 'fixture lookup failed - no care_coordinator profile in the org';
    end if;
    insert into public.clinical_staff
      (organisation_id, profile_id, full_name, active, doctor_tier)
    values (v_org, v_clin_cc, 'Test Care Coordinator', true, 'care_coordinator')
    returning id into v_staff_cc;
  end if;

  v_t1 := date_trunc('hour', now()) + interval '3 days' + interval '10 hours';

  ------------------------------------------------------------------
  -- 1. Fixture request #1, paid.
  ------------------------------------------------------------------
  v_claims := json_build_object('sub', v_pt, 'role', 'authenticated')::text;
  perform set_config('request.jwt.claims', v_claims, true);
  set local role authenticated;
  insert into public.lab_result_consult_requests (organisation_id, patient_id)
  values (v_org, v_pt)
  returning id into v_req1;
  reset role;
  update public.lab_result_consult_requests set status = 'payment_confirmed' where id = v_req1;

  ------------------------------------------------------------------
  -- 2. CONTROL: the patient cannot accept their own request (no
  --    clinical_staff row at all).
  ------------------------------------------------------------------
  perform set_config('request.jwt.claims', v_claims, true);
  set local role authenticated;
  begin
    perform public.accept_lab_result_consult_request(v_req1, v_t1);
    insert into r values ('2a CONTROL patient cannot accept their own request', 'FAIL - accepted');
  exception when insufficient_privilege then
    insert into r values ('2a CONTROL patient cannot accept their own request', 'PASS');
  end;
  reset role;

  ------------------------------------------------------------------
  -- 3. CONTROL: a Care Coordinator (excluded by tier, not by a doctor-tier
  --    fence) cannot accept.
  ------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_clin_cc, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.accept_lab_result_consult_request(v_req1, v_t1);
    insert into r values ('3a CONTROL care coordinator cannot accept', 'FAIL - accepted');
  exception when insufficient_privilege then
    insert into r values ('3a CONTROL care coordinator cannot accept', 'PASS');
  end;
  reset role;

  ------------------------------------------------------------------
  -- 4. CONTROL: a different organisation's clinician cannot accept.
  --    Temporarily repoints v_staff2 to a fresh temp org (rolled back with
  --    everything else) rather than fabricating a new auth.users row.
  ------------------------------------------------------------------
  insert into public.organisations (name, type) values ('Test Other Org', 'clinic')
    returning id into v_temp_org;
  update public.clinical_staff set organisation_id = v_temp_org where id = v_staff2;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_clin2, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.accept_lab_result_consult_request(v_req1, v_t1);
    insert into r values ('4a CONTROL a different org''s clinician cannot accept', 'FAIL - accepted');
  exception when insufficient_privilege then
    insert into r values ('4a CONTROL a different org''s clinician cannot accept', 'PASS');
  end;
  reset role;

  -- Restore v_staff2 to the real org for the rest of the test.
  update public.clinical_staff set organisation_id = v_org where id = v_staff2;

  ------------------------------------------------------------------
  -- 5. The real doctor accepts — succeeds, books a video_consultations row.
  ------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_clin1, 'role', 'authenticated')::text, true);
  set local role authenticated;

  select public.accept_lab_result_consult_request(v_req1, v_t1) into v_consult1;
  insert into r values ('5a doctor accepts and gets a consult id back',
    case when v_consult1 is not null then 'PASS' else 'FAIL' end);

  select status::text, accepted_by, video_consultation_id
    into v_status, v_accepted_by, v_vc_id
    from public.lab_result_consult_requests where id = v_req1;
  insert into r values ('5b request flips to accepted with the right doctor stamped',
    case when v_status = 'accepted' and v_accepted_by = v_staff1 and v_vc_id = v_consult1
      then 'PASS' else 'FAIL' end);

  select context::text, status::text, patient_id, organisation_id
    into v_vc_context, v_vc_status, v_vc_patient, v_vc_org
    from public.video_consultations where id = v_consult1;
  insert into r values ('5c video_consultations row correctly shaped',
    case when v_vc_context = 'lab_result_consult' and v_vc_status = 'scheduled'
      and v_vc_patient = v_pt and v_vc_org = v_org
      then 'PASS' else 'FAIL' end);

  ------------------------------------------------------------------
  -- 6. An already-accepted request cannot be accepted twice.
  ------------------------------------------------------------------
  begin
    perform public.accept_lab_result_consult_request(v_req1, v_t1 + interval '1 hour');
    insert into r values ('6a an already-accepted request cannot be accepted twice', 'FAIL - accepted');
  exception when others then
    insert into r values ('6a an already-accepted request cannot be accepted twice',
      case when sqlstate = '23514' then 'PASS' else 'FAIL - wrong sqlstate ' || sqlstate end);
  end;

  reset role;

  ------------------------------------------------------------------
  -- 7. A second, fresh paid request; a past scheduled time is rejected.
  ------------------------------------------------------------------
  perform set_config('request.jwt.claims', v_claims, true);
  set local role authenticated;
  insert into public.lab_result_consult_requests (organisation_id, patient_id)
  values (v_org, v_pt)
  returning id into v_req2;
  reset role;
  update public.lab_result_consult_requests set status = 'payment_confirmed' where id = v_req2;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_clin1, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.accept_lab_result_consult_request(v_req2, now() - interval '1 hour');
    insert into r values ('7a a past scheduled time is rejected', 'FAIL - accepted');
  exception when others then
    insert into r values ('7a a past scheduled time is rejected',
      case when sqlstate = '23514' then 'PASS' else 'FAIL - wrong sqlstate ' || sqlstate end);
  end;

  ------------------------------------------------------------------
  -- 8. The SAME doctor cannot double-book an overlapping time.
  ------------------------------------------------------------------
  begin
    perform public.accept_lab_result_consult_request(v_req2, v_t1 + interval '5 minutes');
    insert into r values ('8a same doctor cannot double-book an overlapping time', 'FAIL - accepted');
  exception when others then
    insert into r values ('8a same doctor cannot double-book an overlapping time',
      case when sqlstate = '23514' then 'PASS' else 'FAIL - wrong sqlstate ' || sqlstate end);
  end;

  ------------------------------------------------------------------
  -- 9. CONTROL: the SAME doctor CAN book a genuinely free time.
  ------------------------------------------------------------------
  select public.accept_lab_result_consult_request(v_req2, v_t1 + interval '1 hour') into v_consult2;
  insert into r values ('9a CONTROL same doctor can book a non-overlapping time',
    case when v_consult2 is not null then 'PASS' else 'FAIL' end);

  reset role;

  ------------------------------------------------------------------
  -- 10. CONTROL: a DIFFERENT doctor is not blocked by doctor #1's booking —
  --     the exact same overlapping time succeeds for them.
  ------------------------------------------------------------------
  perform set_config('request.jwt.claims', v_claims, true);
  set local role authenticated;
  insert into public.lab_result_consult_requests (organisation_id, patient_id)
  values (v_org, v_pt)
  returning id into v_req3;
  reset role;
  update public.lab_result_consult_requests set status = 'payment_confirmed' where id = v_req3;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_clin2, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select public.accept_lab_result_consult_request(v_req3, v_t1) into v_consult3;
  insert into r values ('10a CONTROL a different doctor is not blocked by doctor #1''s booking',
    case when v_consult3 is not null then 'PASS' else 'FAIL' end);
  reset role;
end $$;

select step, verdict from r order by step;

rollback;
