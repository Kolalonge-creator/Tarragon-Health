-- Tarragon Health — escalation_slas verification
--
-- v3 port: escalation SLA table (data, not code) — v3 build spec §9.4.
-- Proves (1) the config lookup resolves every (pathway, tier) the 8 live
-- trigger/cron functions depend on to exactly the as-transcribed value
-- (zero behaviour change from the pre-port hardcoded literals), (2) real
-- trigger paths land sla_due_at at the right offset end to end, (3) an
-- unknown (pathway, tier) fails loud rather than silently returning null,
-- and (4) the sign_escalation_slas forge-proof gate mirrors
-- sign_vaccination_schedule/sign_cv_risk_config exactly (non-director
-- blocked, active Clinical Director signs, one-active-at-a-time).
--
-- Run inside a transaction that is always rolled back — nothing here
-- should ever be committed.

begin;

-- ---------------------------------------------------------------------------
-- Part 1: config lookup resolves to the exact as-transcribed values.
-- ---------------------------------------------------------------------------
do $$
declare
  v_val integer;
begin
  v_val := private.escalation_sla_minutes('screening_abnormal_result', 'emergency');
  if v_val <> 120 then raise exception 'FAIL: screening_abnormal_result/emergency = % (expected 120)', v_val; end if;

  v_val := private.escalation_sla_minutes('screening_abnormal_result', 'urgent_escalation');
  if v_val <> 1440 then raise exception 'FAIL: screening_abnormal_result/urgent_escalation = % (expected 1440)', v_val; end if;

  v_val := private.escalation_sla_minutes('bp_vitals_red_flag', 'urgent_escalation');
  if v_val <> 60 then raise exception 'FAIL: bp_vitals_red_flag/urgent_escalation = % (expected 60)', v_val; end if;

  v_val := private.escalation_sla_minutes('bp_vitals_red_flag', 'clinician_review');
  if v_val <> 4320 then raise exception 'FAIL: bp_vitals_red_flag/clinician_review = % (expected 4320)', v_val; end if;

  v_val := private.escalation_sla_minutes('emergency_event', 'emergency');
  if v_val <> 120 then raise exception 'FAIL: emergency_event/emergency = % (expected 120)', v_val; end if;

  v_val := private.escalation_sla_minutes('diabetic_foot_check', 'urgent_escalation');
  if v_val <> 240 then raise exception 'FAIL: diabetic_foot_check/urgent_escalation = % (expected 240)', v_val; end if;

  v_val := private.escalation_sla_minutes('lpe_red_flag', 'emergency');
  if v_val <> 15 then raise exception 'FAIL: lpe_red_flag/emergency = % (expected 15)', v_val; end if;

  v_val := private.escalation_sla_minutes('lpe_red_flag', 'urgent_escalation');
  if v_val <> 60 then raise exception 'FAIL: lpe_red_flag/urgent_escalation = % (expected 60)', v_val; end if;

  v_val := private.escalation_sla_minutes('lpe_red_flag', 'clinician_review');
  if v_val <> 4320 then raise exception 'FAIL: lpe_red_flag/clinician_review = % (expected 4320)', v_val; end if;

  v_val := private.escalation_sla_minutes('obesity_ed_screen', 'emergency');
  if v_val <> 15 then raise exception 'FAIL: obesity_ed_screen/emergency = % (expected 15)', v_val; end if;

  v_val := private.escalation_sla_minutes('obesity_ed_screen', 'urgent_escalation');
  if v_val <> 60 then raise exception 'FAIL: obesity_ed_screen/urgent_escalation = % (expected 60)', v_val; end if;

  v_val := private.escalation_sla_minutes('chronic_monitoring_silence', 'clinician_review');
  if v_val <> 4320 then raise exception 'FAIL: chronic_monitoring_silence/clinician_review = % (expected 4320)', v_val; end if;

  v_val := private.escalation_sla_minutes('general', 'routine');
  if v_val <> 10080 then raise exception 'FAIL: general/routine = % (expected 10080)', v_val; end if;

  raise notice 'PASS 1: all 12 escalation_slas entries resolve to their expected as-transcribed values';
end $$;

-- ---------------------------------------------------------------------------
-- Part 2: real trigger paths land sla_due_at at the right offset, and an
-- unknown (pathway, tier) fails loud instead of silently returning null.
-- Reuses an existing patient row (profiles.id has an auth.users FK) — safe,
-- the whole block rolls back.
-- ---------------------------------------------------------------------------
do $$
declare
  v_org uuid;
  v_patient uuid;
  v_reading_id uuid;
  v_alert record;
  v_expected_min numeric;
  v_actual_min numeric;
begin
  select organisation_id, id into v_org, v_patient
  from public.profiles where role = 'patient' and organisation_id is not null limit 1;

  -- bp_vitals_red_flag / urgent_escalation (red BP) — expect 60 min (1h)
  insert into public.vitals_readings (id, organisation_id, patient_id, vital_type, systolic, diastolic, taken_at, source)
  values (gen_random_uuid(), v_org, v_patient, 'blood_pressure', 175, 100, now(), 'manual')
  returning id into v_reading_id;

  select level, sla_due_at, created_at into v_alert
  from public.clinician_alerts
  where vital_reading_id = v_reading_id
  order by created_at desc limit 1;

  if v_alert.level is null then
    raise exception 'FAIL: no clinician_alert raised for red BP reading';
  end if;
  v_expected_min := 60;
  v_actual_min := round(extract(epoch from (v_alert.sla_due_at - v_alert.created_at)) / 60);
  if v_alert.level <> 'urgent_escalation' or abs(v_actual_min - v_expected_min) > 1 then
    raise exception 'FAIL: bp red flag level=% sla_minutes=% (expected urgent_escalation/60)', v_alert.level, v_actual_min;
  end if;
  raise notice 'PASS 2a: bp_vitals_red_flag/urgent_escalation fired at % minutes', v_actual_min;

  -- emergency_event / emergency — expect 120 min (2h)
  insert into public.emergency_events (id, organisation_id, patient_id, source, trigger_detail, status)
  values (gen_random_uuid(), v_org, v_patient, 'danger_symptom_checklist', 'SLA verification test event', 'active');

  select ca.level, ca.sla_due_at, ca.created_at into v_alert
  from public.clinician_alerts ca
  where ca.patient_id = v_patient and ca.title = 'Priority 1: emergency reported'
  order by ca.created_at desc limit 1;

  if v_alert.level is null then
    raise exception 'FAIL: no clinician_alert raised for emergency_event';
  end if;
  v_expected_min := 120;
  v_actual_min := round(extract(epoch from (v_alert.sla_due_at - v_alert.created_at)) / 60);
  if v_alert.level <> 'emergency' or abs(v_actual_min - v_expected_min) > 1 then
    raise exception 'FAIL: emergency_event level=% sla_minutes=% (expected emergency/120)', v_alert.level, v_actual_min;
  end if;
  raise notice 'PASS 2b: emergency_event/emergency fired at % minutes', v_actual_min;

  -- Negative case: unknown pathway/tier raises loudly, never a silent null.
  begin
    perform private.escalation_sla_minutes('nonexistent_pathway', 'routine');
    raise exception 'FAIL: escalation_sla_minutes should have raised for an unknown pathway';
  exception
    when others then
      if sqlerrm not like 'No active escalation SLA configured%' then
        raise exception 'FAIL: wrong error for unknown pathway: %', sqlerrm;
      end if;
      raise notice 'PASS 2c: unknown (pathway, tier) raises loudly, not silent null';
  end;
end $$;

-- ---------------------------------------------------------------------------
-- Part 3: sign_escalation_slas forge-proof gate, mirrors
-- vaccination_schedule_signoff.sql's proven shape exactly.
-- ---------------------------------------------------------------------------
do $$
declare
  v_org uuid;
  v_verifier uuid;
  v_nondirector_profile uuid := gen_random_uuid();
  v_director_profile uuid := gen_random_uuid();
  v_nondirector_staff uuid;
  v_director_staff uuid;
  v_draft_id uuid;
  v_draft2_id uuid;
  v_result uuid;
  v_failed boolean := false;
begin
  select id into v_org from public.organisations limit 1;
  select id into v_verifier from public.profiles where organisation_id = v_org and role = 'admin' limit 1;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values
    (v_nondirector_profile, 'esc-sla-test-nondirector@example.invalid', 'x', now(), '{}', '{}'),
    (v_director_profile, 'esc-sla-test-director@example.invalid', 'x', now(), '{}', '{}');

  update public.profiles set organisation_id = v_org, role = 'clinician', full_name = 'Esc SLA Test Nondirector'
    where id = v_nondirector_profile;
  update public.profiles set organisation_id = v_org, role = 'doctor', full_name = 'Esc SLA Test Director'
    where id = v_director_profile;

  insert into public.clinical_staff (profile_id, organisation_id, full_name, doctor_tier, is_clinical_director, active, credential_type, credential_number, indemnity_exempt, indemnity_exempt_by, verified_by, license_verified_at)
  values (v_nondirector_profile, v_org, 'Esc SLA Test Nondirector', 'tier_1', false, true, 'MDCN', 'ESLATEST-001', true, v_verifier, v_verifier, now())
  returning id into v_nondirector_staff;

  insert into public.clinical_staff (profile_id, organisation_id, full_name, doctor_tier, is_clinical_director, active, credential_type, credential_number, indemnity_exempt, indemnity_exempt_by, verified_by, license_verified_at)
  values (v_director_profile, v_org, 'Esc SLA Test Director', 'tier_4_senior_registrar', true, true, 'MDCN', 'ESLATEST-002', true, v_verifier, v_verifier, now())
  returning id into v_director_staff;

  insert into public.escalation_slas (version, config, notes)
  values (999001, '[{"pathway": "test", "tier": "routine", "sla_minutes": 1}]'::jsonb, 'rolled-back verification draft')
  returning id into v_draft_id;

  -- 1) Non-director cannot sign.
  perform set_config('request.jwt.claims', json_build_object('sub', v_nondirector_profile, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.sign_escalation_slas(v_draft_id);
    v_failed := true;
  exception when others then
    null;
  end;
  reset role;
  if v_failed then
    raise exception 'FAIL: non-director was able to sign escalation_slas';
  end if;

  -- 2) Real active Clinical Director CAN sign.
  perform set_config('request.jwt.claims', json_build_object('sub', v_director_profile, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select public.sign_escalation_slas(v_draft_id) into v_result;
  reset role;
  if v_result is distinct from v_draft_id then
    raise exception 'FAIL: sign did not return the escalation_slas draft id';
  end if;

  if not exists (
    select 1 from public.escalation_slas
    where id = v_draft_id and is_active and approved_by = v_director_staff and approved_at is not null
  ) then
    raise exception 'FAIL: escalation_slas draft not correctly activated/attributed';
  end if;

  -- 3) One-active-at-a-time: a second signed version retires the first.
  insert into public.escalation_slas (version, config, notes)
  values (999002, '[{"pathway": "test", "tier": "routine", "sla_minutes": 2}]'::jsonb, 'second rolled-back verification draft')
  returning id into v_draft2_id;

  perform set_config('request.jwt.claims', json_build_object('sub', v_director_profile, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.sign_escalation_slas(v_draft2_id);
  reset role;

  if exists (select 1 from public.escalation_slas where id = v_draft_id and is_active) then
    raise exception 'FAIL: first escalation_slas version still active after a second was signed';
  end if;
  if not exists (select 1 from public.escalation_slas where id = v_draft2_id and is_active) then
    raise exception 'FAIL: second escalation_slas version not active';
  end if;

  raise notice 'PASS 3: sign_escalation_slas gate (non-director blocked, director signs, one-active-at-a-time) holds';
  raise notice 'ALL ESCALATION_SLAS CHECKS PASSED';
end $$;

rollback;
