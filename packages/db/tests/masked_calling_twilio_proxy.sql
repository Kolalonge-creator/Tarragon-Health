-- Tarragon Health
-- Live proof for 20260730153034_masked_calling_twilio_proxy.sql (M8 gap:
-- masked/proxy calling). Seven cases in one rolled-back transaction:
--   1. Patient requests a call to their own care coordinator -> session +
--      2 participant rows created with correct roles
--   2. An unrelated patient tries to request a call FOR someone else's
--      patient_id (not their own, not staff) -> BLOCKED (42501)
--   3. Org staff (clinician) requests a call on behalf of a patient -> SUCCEEDS
--   4. escalation_contact context with no escalation_id -> BLOCKED
--   5. RLS: the owning patient can select their own session; an unrelated
--      patient sees 0 rows for the same session id
--   6. close_masked_call by an unrelated caller -> BLOCKED (42501); by the
--      staff participant themselves -> SUCCEEDS, status flips to 'closed'
--   7. A direct authenticated INSERT into masked_call_sessions (bypassing
--      the RPC entirely) -> BLOCKED (no insert grant exists at all)
--
-- Run: npx supabase db query --linked -f packages/db/tests/masked_calling_twilio_proxy.sql
-- Nothing here persists -- the whole file runs inside begin/rollback.

begin;

create temporary table test_result (
  case_num int, label text, outcome text, detail text
) on commit drop;

-- Case 5 below inserts into test_result while `role` is still switched to
-- `authenticated` (the reset back to postgres happens after that insert) --
-- without this grant that insert fails with "permission denied for table
-- test_result", since a temp table created by the connecting superuser
-- grants no access to authenticated by default. Same pattern as
-- packages/db/tests/self_arranged_fulfilment.sql's `r` temp table.
grant insert, select on test_result to authenticated;

do $$
declare
  v_org           uuid := '00000000-0000-0000-0000-000000000001';
  v_pat_a         uuid;
  v_pat_b         uuid;
  v_coord         uuid;
  v_clin          uuid;
  v_session_id    uuid;
  v_session_id2   uuid;
  v_blocked       boolean;
  v_err           text;
  v_part_count    int;
begin
  select id into v_pat_a  from public.profiles where role='patient' and organisation_id=v_org order by id limit 1;
  select id into v_pat_b  from public.profiles where role='patient' and organisation_id=v_org order by id offset 1 limit 1;
  select id into v_coord  from public.profiles where role='care_coordinator' and organisation_id=v_org limit 1;
  select id into v_clin   from public.profiles where role='clinician' and organisation_id=v_org limit 1;

  -- ---------------------------------------------------------------------
  -- Case 1: patient requests a call to their own care coordinator
  -- ---------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat_a, 'role','authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  v_session_id := public.request_masked_call(v_pat_a, v_coord, 'care_coordination', null);
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);

  select count(*) into v_part_count from public.masked_call_participants where session_id = v_session_id;
  insert into test_result values (1, 'patient requests call to own care coordinator',
    (select status::text from public.masked_call_sessions where id = v_session_id) || ' / ' || v_part_count || ' participants',
    'expected: requested / 2 participants');

  -- ---------------------------------------------------------------------
  -- Case 2: patient A tries to request a call FOR patient B -> BLOCKED
  -- ---------------------------------------------------------------------
  v_blocked := false;
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat_a, 'role','authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    perform public.request_masked_call(v_pat_b, v_coord, 'care_coordination', null);
  exception when others then
    v_blocked := true;
    get stacked diagnostics v_err = message_text;
  end;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  insert into test_result values (2, 'patient A requests a call for patient B''s id',
    case when v_blocked then 'BLOCKED (correct)' else 'ALLOWED (BUG)' end, coalesce(v_err, ''));

  -- ---------------------------------------------------------------------
  -- Case 3: org staff requests a call on behalf of a patient -> SUCCEEDS
  -- ---------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_clin, 'role','authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  v_session_id2 := public.request_masked_call(v_pat_b, v_clin, 'clinical_follow_up', null);
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  insert into test_result values (3, 'clinician requests call on behalf of a patient',
    (select initiated_by::text = v_clin::text from public.masked_call_sessions where id = v_session_id2)::text,
    'expected: true (initiated_by is the clinician)');

  -- ---------------------------------------------------------------------
  -- Case 4: escalation_contact with no escalation_id -> BLOCKED
  -- ---------------------------------------------------------------------
  v_blocked := false;
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat_a, 'role','authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    perform public.request_masked_call(v_pat_a, v_clin, 'escalation_contact', null);
  exception when others then
    v_blocked := true;
  end;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  insert into test_result values (4, 'escalation_contact with no escalation_id',
    case when v_blocked then 'BLOCKED (correct)' else 'ALLOWED (BUG)' end, '');

  -- ---------------------------------------------------------------------
  -- Case 5: RLS select -- owner sees own session, stranger sees 0
  -- ---------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat_a, 'role','authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  insert into test_result values (5, 'RLS select (owner vs stranger)',
    (select count(*)::text from public.masked_call_sessions where id = v_session_id) || ' (owner) / ' ||
    (select count(*)::text from public.masked_call_sessions s where s.id = v_session_id and s.patient_id <> v_pat_a),
    'evaluated as patient A; expected: 1 (owner) / 0 (would-be-stranger-view impossible under RLS, proven separately below');
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);

  perform set_config('request.jwt.claims', json_build_object('sub', v_pat_b, 'role','authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  -- v_pat_b IS a participant of v_session_id2 (as the patient), but NOT of
  -- v_session_id (patient A's session) -- confirm the cross-session case is 0.
  v_part_count := (select count(*) from public.masked_call_sessions where id = v_session_id);
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  update test_result set detail = detail || ' | patient B sees ' || v_part_count::text || ' of patient A''s session'
    where case_num = 5;

  -- ---------------------------------------------------------------------
  -- Case 6: close_masked_call -- unrelated caller blocked, participant succeeds
  -- ---------------------------------------------------------------------
  v_blocked := false;
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat_b, 'role','authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    perform public.close_masked_call(v_session_id, 'unrelated attempt');
  exception when others then
    v_blocked := true;
  end;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  insert into test_result values (6, 'close_masked_call by an unrelated caller',
    case when v_blocked then 'BLOCKED (correct)' else 'ALLOWED (BUG)' end, '');

  perform set_config('request.jwt.claims', json_build_object('sub', v_coord, 'role','authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  perform public.close_masked_call(v_session_id, 'test cleanup');
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  insert into test_result values (7, 'close_masked_call by the staff participant',
    (select status::text from public.masked_call_sessions where id = v_session_id), 'expected: closed');

  -- ---------------------------------------------------------------------
  -- Case 8: direct authenticated INSERT bypassing the RPC -> BLOCKED
  -- ---------------------------------------------------------------------
  v_blocked := false;
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat_a, 'role','authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    insert into public.masked_call_sessions (organisation_id, patient_id, staff_profile_id, context, initiated_by)
    values (v_org, v_pat_a, v_coord, 'care_coordination', v_pat_a);
  exception when others then
    v_blocked := true;
    get stacked diagnostics v_err = message_text;
  end;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  insert into test_result values (8, 'direct table INSERT bypassing request_masked_call',
    case when v_blocked then 'BLOCKED (correct)' else 'ALLOWED (BUG)' end, coalesce(v_err, ''));
end $$;

select * from test_result order by case_num;

rollback;
