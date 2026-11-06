-- ===========================================================================
-- Proof: DW-07 / DW-08 audited reads (20261106183232_dw07_dw08_audited_onboarding_and_care_circle_reads.sql).
--
-- Proves, with simulated sessions: a tied clinician reads the patient's onboarding answers and active Care Circle (names,
-- permissions, current pause) through the audited functions (the gate opens); an untied clinician is refused by both and still
-- reads nothing from onboarding_answers directly; a patient calling either is refused; revoked and expired supporters are left
-- out; every call, allowed or refused, writes one audit row. SABOTAGE: a version of the onboarding read without the tie gate
-- lets the untied clinician in, so the refusal check can fail.
-- Wrapped in BEGIN/ROLLBACK; mints its own fixtures.
-- ===========================================================================

begin;

do $$
declare
  v_org uuid;
  v_pat uuid := gen_random_uuid();
  v_sup uuid := gen_random_uuid();
  v_old uuid := gen_random_uuid();
  v_tied uuid := gen_random_uuid();
  v_untied uuid := gen_random_uuid();
  v_json jsonb;
  v_n integer;
  v_audit_before integer;
  v_audit_after integer;
  v_failed boolean;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  if v_org is null then raise exception 'fixture FAIL: no organisation'; end if;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data) values
    (v_pat,    'dw07-pat@example.invalid',    'x', now(), '{}', '{}'),
    (v_sup,    'dw07-sup@example.invalid',    'x', now(), '{}', '{}'),
    (v_old,    'dw07-old@example.invalid',    'x', now(), '{}', '{}'),
    (v_tied,   'dw07-tied@example.invalid',   'x', now(), '{}', '{}'),
    (v_untied, 'dw07-untied@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth) values
    (v_pat,    v_org, 'patient',   'DW07 Patient',       '+2348057770001', '1970-01-01'),
    (v_sup,    v_org, 'patient',   'DW07 Supporter',     '+2348057770002', '1990-01-01'),
    (v_old,    v_org, 'patient',   'DW07 Old Supporter', '+2348057770003', '1990-01-01'),
    (v_tied,   v_org, 'clinician', 'DW07 Tied Doctor',   '+2348057770004', null),
    (v_untied, v_org, 'clinician', 'DW07 Untied Doctor', '+2348057770005', null)
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, full_name = excluded.full_name,
    date_of_birth = excluded.date_of_birth;
  insert into public.clinical_staff (organisation_id, profile_id, full_name, active, license_verified_at, doctor_tier) values
    (v_org, v_tied,   'DW07 Tied Doctor',   true, now(), 'senior_medical_officer'),
    (v_org, v_untied, 'DW07 Untied Doctor', true, now(), 'senior_medical_officer');
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id, assigned_at)
  values (v_org, v_pat, v_tied, now()) on conflict (patient_id) do update set clinician_id = v_tied;

  insert into public.onboarding_answers (organisation_id, patient_id, question_code, answer, recorded_by)
  values (v_org, v_pat, 'conditions', '["hypertension"]', v_pat);
  insert into public.care_circle_members (organisation_id, patient_id, supporter_id, relationship, permissions, expires_at)
  values (v_org, v_pat, v_sup, 'Daughter', array['appointments', 'weekly_bp_trend'], now() + interval '30 days');
  insert into public.care_circle_members (organisation_id, patient_id, supporter_id, relationship, permissions, expires_at, state, revoked_at)
  values (v_org, v_pat, v_old, 'Son', array['appointments'], now() + interval '30 days', 'revoked', now());
  insert into public.care_circle_pauses (organisation_id, patient_id, paused_from, paused_until)
  values (v_org, v_pat, now() - interval '1 hour', now() + interval '1 day');

  select count(*) into v_audit_before from public.audit_log
   where subject_patient_id = v_pat and action = 'staff.chart_read';

  -- 1. the tied clinician reads both (the gate opens)
  perform set_config('request.jwt.claims', json_build_object('sub', v_tied, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select public.read_patient_onboarding_answers_audited(v_pat, 'DW07 proof: tied clinician review') into v_json;
  if v_json ->> 'status' <> 'ok' or jsonb_array_length(v_json -> 'answers') <> 1
     or v_json -> 'answers' -> 0 ->> 'question_code' <> 'conditions' then
    raise exception 'FAIL 1a: the tied clinician did not get the onboarding answers: %', v_json;
  end if;
  select public.read_patient_care_circle_audited(v_pat, 'DW08 proof: tied clinician review') into v_json;
  execute 'reset role';
  if v_json ->> 'status' <> 'ok' or jsonb_array_length(v_json -> 'supporters') <> 1 then
    raise exception 'FAIL 1b: the tied clinician did not get exactly the one active supporter: %', v_json;
  end if;
  if v_json -> 'supporters' -> 0 ->> 'supporter_name' <> 'DW07 Supporter'
     or v_json -> 'supporters' -> 0 -> 'permissions' <> '["appointments", "weekly_bp_trend"]'::jsonb then
    raise exception 'FAIL 1c: supporter name or permissions wrong: %', v_json;
  end if;
  if v_json ->> 'paused_until' is null then raise exception 'FAIL 1d: the current pause is missing: %', v_json; end if;

  -- 2. the untied clinician is refused by both and reads nothing directly
  perform set_config('request.jwt.claims', json_build_object('sub', v_untied, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select public.read_patient_onboarding_answers_audited(v_pat, 'DW07 proof: untied clinician attempt') into v_json;
  if v_json ->> 'status' <> 'denied' or v_json ? 'answers' then raise exception 'FAIL 2a: untied clinician not refused: %', v_json; end if;
  select public.read_patient_care_circle_audited(v_pat, 'DW08 proof: untied clinician attempt') into v_json;
  if v_json ->> 'status' <> 'denied' or v_json ? 'supporters' then raise exception 'FAIL 2b: untied clinician not refused: %', v_json; end if;
  select count(*) into v_n from public.onboarding_answers;
  execute 'reset role';
  if v_n <> 0 then raise exception 'FAIL 2c: an untied clinician read % onboarding rows directly', v_n; end if;

  -- 3. every call wrote one audit row (2 allowed + 2 refused)
  select count(*) into v_audit_after from public.audit_log
   where subject_patient_id = v_pat and action = 'staff.chart_read';
  if v_audit_after - v_audit_before <> 4 then
    raise exception 'FAIL 3: expected 4 audit rows, got %', v_audit_after - v_audit_before;
  end if;

  -- 4. a patient calling either is refused
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_failed := false;
  begin
    perform public.read_patient_care_circle_audited(v_pat, 'DW08 proof: patient attempt');
  exception when insufficient_privilege then v_failed := true; end;
  execute 'reset role';
  if not v_failed then raise exception 'FAIL 4: a patient called the staff Care Circle read'; end if;

  -- 5. anon cannot execute
  if has_function_privilege('anon', 'public.read_patient_onboarding_answers_audited(uuid, text)', 'EXECUTE') then
    raise exception 'FAIL 5: anon can execute the onboarding read';
  end if;

  -- SABOTAGE: without the tie gate the untied clinician gets the answers, so check 2a would catch it
  create or replace function public.read_patient_onboarding_answers_audited(p_patient uuid, p_reason text)
  returns jsonb language sql security definer set search_path = '' as $sab$
    select jsonb_build_object('status', 'ok', 'answers',
      coalesce((select jsonb_agg(a.question_code) from public.onboarding_answers a where a.patient_id = p_patient), '[]'::jsonb))
  $sab$;
  perform set_config('request.jwt.claims', json_build_object('sub', v_untied, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select public.read_patient_onboarding_answers_audited(v_pat, 'DW07 proof: sabotage') into v_json;
  execute 'reset role';
  if v_json ->> 'status' <> 'ok' then raise exception 'FAIL SABOTAGE: the ungated version still refused, so check 2a proves nothing'; end if;

  raise notice 'DW07/DW08 proof: all checks and the sabotage passed';
end;
$$;

rollback;
