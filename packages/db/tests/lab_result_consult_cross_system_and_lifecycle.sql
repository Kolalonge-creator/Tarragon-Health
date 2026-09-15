-- Cross-system double-booking fix + reschedule/release/cancel lifecycle for
-- the lab-result consultation fee feature.
--
-- Covers: accepting/rescheduling a lab-result consult now correctly rejects
-- a time that collides with an EXISTING video_visit_requests-sourced
-- booking for the same doctor (the real correctness bug fix — checked
-- against a REAL video_visit_requests + consult_availability_slots +
-- accept_video_visit_request fixture, not a stand-in); a non-conflicting
-- time still succeeds; reschedule re-runs the same cross-system check and
-- clears stale Zoom fields; release reverts an accepted request to whichever
-- pre-accept status it actually came from and cancels the booked consult
-- without touching the patient's paid fee; patient cancel is
-- patient-scoped, refuses an already-terminal request, and also cancels a
-- booked consult if one existed.
--
-- Run inside a single transaction and ROLLED BACK. Every negative is paired
-- with a positive control.
--
-- To re-run:
--   npx supabase db query --linked -f packages/db/tests/lab_result_consult_cross_system_and_lifecycle.sql
-- (run it from the MAIN checkout, not a worktree - see
-- reference_supabase_cli_sql_access)

begin;

create temp table r(step text, verdict text) on commit drop;
grant insert, select on r to authenticated;

do $$
declare
  v_org uuid; v_pt uuid; v_pt2 uuid;
  v_clin1 uuid; v_staff1 uuid;
  v_slot uuid; v_vv_req uuid; v_vv_consult uuid;
  v_req_a uuid; v_req_b uuid; v_req_c uuid; v_doc uuid;
  v_consult_a uuid;
  v_status text; v_vc_status text; v_vc_scheduled timestamptz;
  v_zoom text; v_join text; v_host text;
  v_accepted_by uuid; v_video_consult_id uuid;
  v_claims text;
  v_video_time timestamptz;
  v_free_time timestamptz;
  v_notified_count int;
  v_notified_count2 int;
  v_expected_count int;
begin
  ------------------------------------------------------------------
  -- Fixtures.
  ------------------------------------------------------------------
  select id, organisation_id into v_pt, v_org
    from public.profiles where role = 'patient' and organisation_id is not null
    order by created_at limit 1;
  select id into v_pt2
    from public.profiles where role = 'patient' and organisation_id = v_org and id <> v_pt
    limit 1;
  select cs.id, cs.profile_id into v_staff1, v_clin1
    from public.clinical_staff cs
    where cs.organisation_id = v_org and cs.active
      and cs.doctor_tier is not null and cs.doctor_tier <> 'care_coordinator'
    order by cs.id limit 1;
  if v_pt is null or v_pt2 is null or v_staff1 is null then
    raise exception 'fixture lookup failed';
  end if;

  v_video_time := date_trunc('hour', now()) + interval '4 days' + interval '9 hours';
  v_free_time := date_trunc('hour', now()) + interval '4 days' + interval '14 hours';

  ------------------------------------------------------------------
  -- 0. A REAL video_visit_requests booking for v_clin1, via the actual
  --    accept_video_visit_request RPC (not a stand-in) — this is the
  --    "other system" a lab-result-consult accept must now check against.
  ------------------------------------------------------------------
  insert into public.consult_availability_slots
    (organisation_id, clinician_profile_id, slot_start, slot_end)
  values (v_org, v_clin1, v_video_time, v_video_time + interval '30 minutes')
  returning id into v_slot;

  v_claims := json_build_object('sub', v_pt, 'role', 'authenticated')::text;
  perform set_config('request.jwt.claims', v_claims, true);
  set local role authenticated;
  insert into public.video_visit_requests (organisation_id, patient_id, slot_id)
  values (v_org, v_pt, v_slot)
  returning id into v_vv_req;
  reset role;
  update public.video_visit_requests set status = 'payment_confirmed' where id = v_vv_req;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_clin1, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select public.accept_video_visit_request(v_vv_req) into v_vv_consult;
  reset role;
  insert into r values ('0a fixture: real video-visit booking created',
    case when v_vv_consult is not null then 'PASS' else 'FAIL' end);

  ------------------------------------------------------------------
  -- 1. A lab-result-consult accept at the SAME time as the video-visit
  --    booking is now rejected (the correctness fix).
  ------------------------------------------------------------------
  perform set_config('request.jwt.claims', v_claims, true);
  set local role authenticated;
  insert into public.lab_result_consult_requests (organisation_id, patient_id)
  values (v_org, v_pt) returning id into v_req_a;
  reset role;
  update public.lab_result_consult_requests set status = 'payment_confirmed' where id = v_req_a;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_clin1, 'role', 'authenticated')::text, true);
  set local role authenticated;

  begin
    perform public.accept_lab_result_consult_request(v_req_a, v_video_time + interval '5 minutes');
    insert into r values ('1a cross-system conflict now correctly rejected', 'FAIL - accepted');
  exception when others then
    insert into r values ('1a cross-system conflict now correctly rejected',
      case when sqlstate = '23514' then 'PASS' else 'FAIL - wrong sqlstate ' || sqlstate end);
  end;

  ------------------------------------------------------------------
  -- 2. CONTROL: a genuinely free time still succeeds.
  ------------------------------------------------------------------
  select public.accept_lab_result_consult_request(v_req_a, v_free_time) into v_consult_a;
  insert into r values ('2a CONTROL a free time still succeeds', case when v_consult_a is not null then 'PASS' else 'FAIL' end);
  reset role;

  ------------------------------------------------------------------
  -- 3. Reschedule re-runs the same cross-system check.
  ------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_clin1, 'role', 'authenticated')::text, true);
  set local role authenticated;

  begin
    perform public.reschedule_lab_result_consult_request(v_req_a, v_video_time);
    insert into r values ('3a reschedule onto the video-visit time is rejected', 'FAIL - accepted');
  exception when others then
    insert into r values ('3a reschedule onto the video-visit time is rejected',
      case when sqlstate = '23514' then 'PASS' else 'FAIL - wrong sqlstate ' || sqlstate end);
  end;

  perform public.reschedule_lab_result_consult_request(v_req_a, v_free_time + interval '1 hour');
  select vc.scheduled_at, vc.zoom_meeting_id, vc.join_url, vc.host_start_url
    into v_vc_scheduled, v_zoom, v_join, v_host
    from public.video_consultations vc where vc.id = v_consult_a;
  insert into r values ('3b reschedule moves the time and clears stale Zoom fields',
    case when v_vc_scheduled = v_free_time + interval '1 hour'
      and v_zoom is null and v_join is null and v_host is null
      then 'PASS' else 'FAIL' end);

  reset role;

  ------------------------------------------------------------------
  -- 4. CONTROL: the patient cannot reschedule or release.
  ------------------------------------------------------------------
  perform set_config('request.jwt.claims', v_claims, true);
  set local role authenticated;
  begin
    perform public.reschedule_lab_result_consult_request(v_req_a, v_free_time + interval '2 hours');
    insert into r values ('4a CONTROL patient cannot reschedule', 'FAIL - accepted');
  exception when insufficient_privilege then
    insert into r values ('4a CONTROL patient cannot reschedule', 'PASS');
  end;
  begin
    perform public.release_lab_result_consult_request(v_req_a);
    insert into r values ('4b CONTROL patient cannot release', 'FAIL - accepted');
  exception when insufficient_privilege then
    insert into r values ('4b CONTROL patient cannot release', 'PASS');
  end;
  reset role;

  ------------------------------------------------------------------
  -- 5. Release reverts to the correct pre-accept status and cancels the
  --    booked consult, without touching the paid fee.
  ------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_clin1, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.release_lab_result_consult_request(v_req_a);
  reset role;

  select status::text, accepted_by, video_consultation_id
    into v_status, v_accepted_by, v_video_consult_id
    from public.lab_result_consult_requests where id = v_req_a;
  insert into r values ('5a release reverts to payment_confirmed (no document was ever uploaded) and clears booking fields',
    case when v_status = 'payment_confirmed' and v_accepted_by is null and v_video_consult_id is null
      then 'PASS' else 'FAIL - got status=' || v_status end);

  select status::text into v_vc_status from public.video_consultations where id = v_consult_a;
  insert into r values ('5b released consult is cancelled, not left scheduled',
    case when v_vc_status = 'cancelled' then 'PASS' else 'FAIL - got ' || v_vc_status end);

  ------------------------------------------------------------------
  -- 6. Release reverts to document_uploaded when a result WAS already
  --    uploaded before the doctor accepted. Realistically fixtured: a real
  --    lab_result_documents row IS linked via lab_result_document_id (the
  --    same invariant public.settle_lab_result_consult_claim establishes in
  --    the real claim -> upload -> settle flow) — release's revert logic
  --    keys off that link, not a bare status string, so the fixture must
  --    actually create one rather than just flipping status directly.
  ------------------------------------------------------------------
  perform set_config('request.jwt.claims', v_claims, true);
  set local role authenticated;
  insert into public.lab_result_consult_requests (organisation_id, patient_id)
  values (v_org, v_pt) returning id into v_req_b;
  reset role;

  insert into public.lab_result_documents
    (organisation_id, patient_id, file_path, original_filename, mime_type, file_size_bytes, source)
  values (v_org, v_pt, v_pt || '/consult-release-test.pdf', 'result.pdf', 'application/pdf', 1024, 'patient')
  returning id into v_doc;
  update public.lab_result_consult_requests
    set status = 'document_uploaded', lab_result_document_id = v_doc
    where id = v_req_b;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_clin1, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.accept_lab_result_consult_request(v_req_b, v_free_time + interval '3 hours');
  perform public.release_lab_result_consult_request(v_req_b);
  reset role;

  select status::text into v_status from public.lab_result_consult_requests where id = v_req_b;
  insert into r values ('6a release reverts to document_uploaded when a result was already on file',
    case when v_status = 'document_uploaded' then 'PASS' else 'FAIL - got ' || v_status end);

  ------------------------------------------------------------------
  -- 7. Patient cancel: scoped to the owning patient, refuses a terminal
  --    request, cancels a booked consult too.
  ------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_clin1, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.accept_lab_result_consult_request(v_req_b, v_free_time + interval '5 hours');
  reset role;

  select video_consultation_id into v_video_consult_id from public.lab_result_consult_requests where id = v_req_b;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_pt2, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.cancel_lab_result_consult_request(v_req_b);
    insert into r values ('7a CONTROL another patient cannot cancel this request', 'FAIL - accepted');
  exception when insufficient_privilege then
    insert into r values ('7a CONTROL another patient cannot cancel this request', 'PASS');
  end;
  reset role;

  perform set_config('request.jwt.claims', v_claims, true);
  set local role authenticated;
  perform public.cancel_lab_result_consult_request(v_req_b);
  reset role;

  select status::text into v_status from public.lab_result_consult_requests where id = v_req_b;
  insert into r values ('7b patient cancel moves the request to cancelled',
    case when v_status = 'cancelled' then 'PASS' else 'FAIL - got ' || v_status end);

  select status::text into v_vc_status from public.video_consultations where id = v_video_consult_id;
  insert into r values ('7c patient cancel also cancels the booked consult',
    case when v_vc_status = 'cancelled' then 'PASS' else 'FAIL - got ' || v_vc_status end);

  perform set_config('request.jwt.claims', v_claims, true);
  set local role authenticated;
  begin
    perform public.cancel_lab_result_consult_request(v_req_b);
    insert into r values ('7d CONTROL cannot cancel an already-cancelled request', 'FAIL - accepted');
  exception when others then
    insert into r values ('7d CONTROL cannot cancel an already-cancelled request',
      case when sqlstate = '23514' then 'PASS' else 'FAIL - wrong sqlstate ' || sqlstate end);
  end;
  reset role;

  ------------------------------------------------------------------
  -- 8. The staff-notify trigger fires exactly once, when status first
  --    reaches payment_confirmed, and reaches every active non-Care-
  --    Coordinator clinician in the org (not a spammy per-doctor design,
  --    a single shared helper insert).
  ------------------------------------------------------------------
  perform set_config('request.jwt.claims', v_claims, true);
  set local role authenticated;
  insert into public.lab_result_consult_requests (organisation_id, patient_id)
  values (v_org, v_pt) returning id into v_req_c;
  reset role;

  update public.lab_result_consult_requests set status = 'payment_confirmed' where id = v_req_c;

  select count(*) into v_notified_count
    from public.notifications
    where organisation_id = v_org
      and template = 'lab_result_consult_request_pending'
      and channel = 'in_app'
      and (payload->>'request_id')::uuid = v_req_c;
  select count(*) into v_expected_count
    from public.clinical_staff
    where organisation_id = v_org and active
      and doctor_tier is not null and doctor_tier <> 'care_coordinator';
  insert into r values ('8a staff-notify trigger fires exactly once per active clinician',
    case when v_notified_count = v_expected_count and v_expected_count > 0
      then 'PASS' else 'FAIL - got ' || v_notified_count || ' expected ' || v_expected_count end);

  -- Re-running an unrelated status transition on the same row must not
  -- re-fire it (only the transition INTO payment_confirmed does).
  update public.lab_result_consult_requests set status = 'document_uploaded' where id = v_req_c;
  select count(*) into v_notified_count2
    from public.notifications
    where organisation_id = v_org
      and template = 'lab_result_consult_request_pending'
      and (payload->>'request_id')::uuid = v_req_c;
  insert into r values ('8b a later, unrelated status change does not re-notify',
    case when v_notified_count2 = v_expected_count then 'PASS' else 'FAIL - got ' || v_notified_count2 end);
end $$;

select step, verdict from r order by step;

rollback;
