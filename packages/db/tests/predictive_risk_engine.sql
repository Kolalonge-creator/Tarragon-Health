-- Tarragon Health — Predictive Risk & Early Warning Engine verification
--
-- Proves: (1) threshold/band-definition CHECKs reject malformed model
-- registration (spec §39.5, §39.10), (2) private.risk_band bands correctly
-- at each boundary, (3) governance forge-proofing — a non-director cannot
-- activate, an active Clinical Director can, exactly one model stays active
-- per (org, domain), rollback restores the prior validated model and is
-- terminal, (4) a shadow prediction never reaches patient_risk_scores while
-- an active one does (spec §39.13 "shadow models run silently before
-- influencing care"), (5) the missed_follow_up scoring function is
-- monotonic and produces contributors.
--
-- Run inside a transaction that is always rolled back — nothing here
-- should ever be committed.

begin;

-- ---------------------------------------------------------------------------
-- Part 1: threshold + band-definition CHECK constraints.
-- ---------------------------------------------------------------------------
do $$
declare
  v_org uuid;
  v_failed boolean;
begin
  select id into v_org from public.organisations limit 1;

  -- Unordered thresholds rejected.
  v_failed := false;
  begin
    insert into public.risk_models
      (organisation_id, domain, code, version, display_name, horizon_days, thresholds, band_definitions)
    values
      (v_org, 'care_disengagement', 'prt_bad_thresholds', 999001, 'bad', 90,
       jsonb_build_object('moderate', 0.6, 'high', 0.5, 'very_high', 0.9),
       jsonb_build_object('low', 'placeholder placeholder', 'moderate', 'placeholder placeholder',
                           'high', 'placeholder placeholder', 'very_high', 'placeholder placeholder'));
    v_failed := true;
  exception when others then null;
  end;
  if v_failed then raise exception 'FAIL: unordered thresholds were accepted'; end if;

  -- Missing band_definitions key rejected.
  v_failed := false;
  begin
    insert into public.risk_models
      (organisation_id, domain, code, version, display_name, horizon_days, thresholds, band_definitions)
    values
      (v_org, 'care_disengagement', 'prt_bad_defs', 999001, 'bad', 90,
       jsonb_build_object('moderate', 0.3, 'high', 0.6, 'very_high', 0.9),
       jsonb_build_object('low', 'placeholder placeholder', 'moderate', 'placeholder placeholder',
                           'high', 'placeholder placeholder'));
    v_failed := true;
  exception when others then null;
  end;
  if v_failed then raise exception 'FAIL: band_definitions missing very_high was accepted'; end if;

  -- Placeholder-length band definition rejected (spec §39.5 "must have defined meaning").
  v_failed := false;
  begin
    insert into public.risk_models
      (organisation_id, domain, code, version, display_name, horizon_days, thresholds, band_definitions)
    values
      (v_org, 'care_disengagement', 'prt_short_def', 999001, 'bad', 90,
       jsonb_build_object('moderate', 0.3, 'high', 0.6, 'very_high', 0.9),
       jsonb_build_object('low', 'ok', 'moderate', 'placeholder placeholder',
                           'high', 'placeholder placeholder', 'very_high', 'placeholder placeholder'));
    v_failed := true;
  exception when others then null;
  end;
  if v_failed then raise exception 'FAIL: a one-word band definition was accepted'; end if;

  -- A valid registration succeeds and defaults to draft.
  insert into public.risk_models
    (organisation_id, domain, code, version, display_name, horizon_days, thresholds, band_definitions)
  values
    (v_org, 'care_disengagement', 'prt_valid_model', 999001, 'Valid test model', 90,
     jsonb_build_object('moderate', 0.3, 'high', 0.6, 'very_high', 0.9),
     jsonb_build_object('low', 'nothing notable observed', 'moderate', 'worth a light check-in',
                         'high', 'open a coordinator task', 'very_high', 'proactive contact warranted'));
  if not exists (
    select 1 from public.risk_models
    where organisation_id = v_org and code = 'prt_valid_model' and version = 999001 and status = 'draft'
  ) then
    raise exception 'FAIL: valid model registration did not land as draft';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Part 2: private.risk_band boundary correctness.
-- ---------------------------------------------------------------------------
do $$
declare
  v_thresholds jsonb := jsonb_build_object('moderate', 0.3, 'high', 0.6, 'very_high', 0.9);
begin
  if private.risk_band(v_thresholds, 0.1) <> 'low' then raise exception 'FAIL: 0.1 should band low'; end if;
  if private.risk_band(v_thresholds, 0.3) <> 'moderate' then raise exception 'FAIL: 0.3 should band moderate (boundary is inclusive)'; end if;
  if private.risk_band(v_thresholds, 0.599) <> 'moderate' then raise exception 'FAIL: 0.599 should still band moderate'; end if;
  if private.risk_band(v_thresholds, 0.6) <> 'high' then raise exception 'FAIL: 0.6 should band high (boundary is inclusive)'; end if;
  if private.risk_band(v_thresholds, 0.9) <> 'very_high' then raise exception 'FAIL: 0.9 should band very_high'; end if;
  if private.risk_band(v_thresholds, null) <> 'unknown' then raise exception 'FAIL: null probability should band unknown, never low'; end if;
end $$;

-- ---------------------------------------------------------------------------
-- Part 3: governance forge-proofing + one-active-per-domain + rollback.
-- ---------------------------------------------------------------------------
do $$
declare
  v_org uuid;
  v_verifier uuid;
  v_nondirector_profile uuid := gen_random_uuid();
  v_director_profile uuid := gen_random_uuid();
  v_director_staff uuid;
  v_model_v1 uuid;
  v_model_v2 uuid;
  v_result uuid;
  v_failed boolean;
begin
  select id into v_org from public.organisations limit 1;
  select id into v_verifier from public.profiles where organisation_id = v_org and role = 'admin' limit 1;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values
    (v_nondirector_profile, 'prt-nondirector@example.invalid', 'x', now(), '{}', '{}'),
    (v_director_profile, 'prt-director@example.invalid', 'x', now(), '{}', '{}');

  update public.profiles set organisation_id = v_org, role = 'clinician', full_name = 'PRT Test Nondirector'
    where id = v_nondirector_profile;
  update public.profiles set organisation_id = v_org, role = 'clinician', full_name = 'PRT Test Director'
    where id = v_director_profile;

  insert into public.clinical_staff (profile_id, organisation_id, full_name, doctor_tier, is_clinical_director, active, credential_type, credential_number, indemnity_exempt, indemnity_exempt_by, verified_by, license_verified_at)
  values (v_nondirector_profile, v_org, 'PRT Test Nondirector', 'tier_1', false, true, 'MDCN', 'PRTTEST-001', true, v_verifier, v_verifier, now());

  insert into public.clinical_staff (profile_id, organisation_id, full_name, doctor_tier, is_clinical_director, active, credential_type, credential_number, indemnity_exempt, indemnity_exempt_by, verified_by, license_verified_at)
  values (v_director_profile, v_org, 'PRT Test Director', 'tier_4_senior_registrar', true, true, 'MDCN', 'PRTTEST-002', true, v_verifier, v_verifier, now())
  returning id into v_director_staff;

  insert into public.risk_models
    (organisation_id, domain, code, version, display_name, horizon_days, thresholds, band_definitions)
  values
    (v_org, 'hospitalisation', 'prt_gov_model', 999001, 'Governance test model v1', 90,
     jsonb_build_object('moderate', 0.3, 'high', 0.6, 'very_high', 0.9),
     jsonb_build_object('low', 'nothing notable observed', 'moderate', 'worth a light check-in',
                         'high', 'open a coordinator task', 'very_high', 'proactive contact warranted'))
  returning id into v_model_v1;

  -- 1) Non-director cannot activate.
  v_failed := false;
  perform set_config('request.jwt.claims', json_build_object('sub', v_nondirector_profile, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.activate_risk_model(v_model_v1);
    v_failed := true;
  exception when others then null;
  end;
  reset role;
  if v_failed then raise exception 'FAIL: non-director was able to activate a risk model'; end if;

  -- 2) Active Clinical Director CAN activate.
  perform set_config('request.jwt.claims', json_build_object('sub', v_director_profile, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select public.activate_risk_model(v_model_v1) into v_result;
  reset role;
  if v_result is distinct from v_model_v1 then raise exception 'FAIL: activate_risk_model did not return the model id'; end if;
  if not exists (
    select 1 from public.risk_models
    where id = v_model_v1 and status = 'active' and approved_by = v_director_staff and approved_at is not null
  ) then
    raise exception 'FAIL: model not correctly activated/attributed';
  end if;

  -- 3) A v2 in the SAME domain, once activated, retires v1 — exactly one active per (org, domain).
  insert into public.risk_models
    (organisation_id, domain, code, version, display_name, horizon_days, thresholds, band_definitions, supersedes_id)
  values
    (v_org, 'hospitalisation', 'prt_gov_model', 999002, 'Governance test model v2', 90,
     jsonb_build_object('moderate', 0.25, 'high', 0.55, 'very_high', 0.85),
     jsonb_build_object('low', 'nothing notable observed', 'moderate', 'worth a light check-in',
                         'high', 'open a coordinator task', 'very_high', 'proactive contact warranted'),
     v_model_v1)
  returning id into v_model_v2;

  perform set_config('request.jwt.claims', json_build_object('sub', v_director_profile, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.activate_risk_model(v_model_v2);
  reset role;

  if (select status from public.risk_models where id = v_model_v1) <> 'retired' then
    raise exception 'FAIL: activating v2 did not retire v1';
  end if;
  if (select status from public.risk_models where id = v_model_v2) <> 'active' then
    raise exception 'FAIL: v2 was not activated';
  end if;
  if (select count(*) from public.risk_models where organisation_id = v_org and domain = 'hospitalisation' and status = 'active') <> 1 then
    raise exception 'FAIL: more than one active model in the same (org, domain)';
  end if;

  -- 4) Rollback of v2, with v1 (its supersedes_id) retired and eligible,
  -- restores v1 to active — "the previous validated model" (spec §39.14).
  perform public.rollback_risk_model(v_model_v2, 'synthetic test: simulated performance deterioration');

  if (select status from public.risk_models where id = v_model_v2) <> 'rolled_back' then
    raise exception 'FAIL: v2 was not marked rolled_back';
  end if;
  if (select rollback_reason from public.risk_models where id = v_model_v2) is null then
    raise exception 'FAIL: rollback_reason was not recorded';
  end if;
  if (select status from public.risk_models where id = v_model_v1) <> 'active' then
    raise exception 'FAIL: rollback did not restore the prior validated model (v1) to active';
  end if;

  -- 5) rollback is terminal: a rolled-back model can never be reactivated.
  v_failed := false;
  perform set_config('request.jwt.claims', json_build_object('sub', v_director_profile, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.activate_risk_model(v_model_v2);
    v_failed := true;
  exception when others then null;
  end;
  reset role;
  if v_failed then raise exception 'FAIL: a rolled_back model was reactivated'; end if;

  -- 6) rollback without a reason is rejected.
  v_failed := false;
  begin
    perform public.rollback_risk_model(v_model_v1, '');
    v_failed := true;
  exception when others then null;
  end;
  if v_failed then raise exception 'FAIL: rollback with an empty reason was accepted'; end if;
end $$;

-- ---------------------------------------------------------------------------
-- Part 4: shadow vs active — private.record_risk_prediction / spec §39.13.
-- ---------------------------------------------------------------------------
do $$
declare
  v_org uuid;
  v_patient uuid := gen_random_uuid();
  v_shadow_model uuid;
  v_active_model uuid;
  v_shadow_pred uuid;
  v_active_pred uuid;
begin
  select id into v_org from public.organisations limit 1;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v_patient, 'prt-shadow-patient@example.invalid', 'x', now(), '{}', '{}');
  update public.profiles set organisation_id = v_org, role = 'patient', full_name = 'PRT Shadow Test Patient'
    where id = v_patient;

  insert into public.risk_models
    (organisation_id, domain, code, version, status, display_name, horizon_days, thresholds, band_definitions)
  values
    (v_org, 'chronic_deterioration', 'prt_shadow_model', 999001, 'shadow', 'Shadow test model', 90,
     jsonb_build_object('moderate', 0.3, 'high', 0.6, 'very_high', 0.9),
     jsonb_build_object('low', 'nothing notable observed', 'moderate', 'worth a light check-in',
                         'high', 'open a coordinator task', 'very_high', 'proactive contact warranted'))
  returning id into v_shadow_model;

  -- A draft model must refuse to score at all.
  declare
    v_draft_model uuid;
    v_failed boolean := false;
  begin
    insert into public.risk_models
      (organisation_id, domain, code, version, status, display_name, horizon_days, thresholds, band_definitions)
    values
      (v_org, 'chronic_deterioration', 'prt_draft_model', 999001, 'draft', 'Draft test model', 90,
       jsonb_build_object('moderate', 0.3, 'high', 0.6, 'very_high', 0.9),
       jsonb_build_object('low', 'placeholder placeholder', 'moderate', 'placeholder placeholder', 'high', 'placeholder placeholder', 'very_high', 'placeholder placeholder'))
    returning id into v_draft_model;

    begin
      perform private.record_risk_prediction(v_draft_model, v_patient, 0.8,
        jsonb_build_array(jsonb_build_object('feature', 'x', 'value', 1)), '{}'::jsonb);
      v_failed := true;
    exception when others then null;
    end;
    if v_failed then raise exception 'FAIL: a draft model was allowed to write a prediction'; end if;
  end;

  -- Shadow prediction: written to risk_predictions, but NEVER mirrored to patient_risk_scores.
  select private.record_risk_prediction(v_shadow_model, v_patient, 0.95,
    jsonb_build_array(jsonb_build_object('feature', 'x', 'value', 1, 'direction', 'increases_risk', 'magnitude', 1, 'description', 'test')),
    jsonb_build_object('x', 1))
  into v_shadow_pred;

  if not exists (select 1 from public.risk_predictions where id = v_shadow_pred and risk_level = 'very_high' and influenced_care = false) then
    raise exception 'FAIL: shadow prediction not recorded correctly (expected very_high, influenced_care=false)';
  end if;
  if exists (select 1 from public.patient_risk_scores where patient_id = v_patient and score_type = 'predictive_chronic_deterioration') then
    raise exception 'FAIL: a SHADOW model prediction reached patient_risk_scores — spec §39.13 violated';
  end if;

  -- A fresh, directly-inserted ACTIVE model in the same domain — confirm its prediction DOES mirror.
  insert into public.risk_models
    (organisation_id, domain, code, version, status, display_name, horizon_days, thresholds, band_definitions, approved_by, approved_at)
  values
    (v_org, 'chronic_deterioration', 'prt_active_model', 999001, 'active', 'Active test model', 90,
     jsonb_build_object('moderate', 0.3, 'high', 0.6, 'very_high', 0.9),
     jsonb_build_object('low', 'nothing notable observed', 'moderate', 'worth a light check-in',
                         'high', 'open a coordinator task', 'very_high', 'proactive contact warranted'),
     (select id from public.clinical_staff where organisation_id = v_org and is_clinical_director and active limit 1),
     now())
  returning id into v_active_model;

  select private.record_risk_prediction(v_active_model, v_patient, 0.95,
    jsonb_build_array(jsonb_build_object('feature', 'x', 'value', 1, 'direction', 'increases_risk', 'magnitude', 1, 'description', 'test')),
    jsonb_build_object('x', 1))
  into v_active_pred;

  if not exists (select 1 from public.risk_predictions where id = v_active_pred and influenced_care = true) then
    raise exception 'FAIL: active prediction not stamped influenced_care=true';
  end if;
  if not exists (
    select 1 from public.patient_risk_scores
    where patient_id = v_patient and score_type = 'predictive_chronic_deterioration' and risk_level = 'very_high'
  ) then
    raise exception 'FAIL: an ACTIVE model prediction did not mirror onto patient_risk_scores — spec §39.9 wiring broken';
  end if;

  -- A non-low prediction must always carry at least one contributor.
  declare
    v_failed boolean := false;
  begin
    begin
      perform private.record_risk_prediction(v_active_model, v_patient, 0.95, '[]'::jsonb, '{}'::jsonb);
      v_failed := true;
    exception when others then null;
    end;
    if v_failed then raise exception 'FAIL: a very_high prediction with zero contributors was accepted (opaque score, spec §39.7)'; end if;
  end;
end $$;

-- ---------------------------------------------------------------------------
-- Part 5: missed_follow_up scoring — monotonic, always returns contributors.
-- ---------------------------------------------------------------------------
do $$
declare
  v_low jsonb;
  v_high jsonb;
begin
  -- No history at all vs. an appointment record, nothing booked, active care plan.
  v_low := private.score_missed_follow_up(0, 5, 10, true, true);
  v_high := private.score_missed_follow_up(4, 1, 200, false, false);

  if (v_low ->> 'probability')::numeric >= (v_high ->> 'probability')::numeric then
    raise exception 'FAIL: missed_follow_up scoring is not monotonic (good pattern scored >= bad pattern: % vs %)',
      v_low ->> 'probability', v_high ->> 'probability';
  end if;
  if jsonb_array_length(v_low -> 'contributors') <> 4 then
    raise exception 'FAIL: expected 4 contributors, got %', jsonb_array_length(v_low -> 'contributors');
  end if;
  if (v_high ->> 'probability')::numeric < 0.6 then
    raise exception 'FAIL: a patient with 4/5 no-shows, 200 days silent, nothing booked and no care plan should score high, got %',
      v_high ->> 'probability';
  end if;
end $$;

rollback;
