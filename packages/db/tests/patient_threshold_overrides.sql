-- N-overrides proof: clinician-signed personal triage thresholds (migration *_n_patient_threshold_overrides.sql).
-- One rolled-back transaction. Proves:
--  * nothing can be proposed until the Chief Medical Officer signs the policy; only the CMO can sign or withdraw it, and withdrawing it stops every override at once;
--  * only a senior doctor (senior_medical_officer or chief_medical_officer) who is tied to the patient can propose, sign, revoke or review; an untied senior doctor, a
--    coordinator-tier clinician and the patient are refused; the CMO can revoke or review any override (oversight);
--  * the clamps hold in the database: an out-of-limits setting, an unknown key, a period over the policy maximum, a pregnant, postpartum or under 18 patient are refused;
--  * signing needs the typed word SIGN; an unsigned (draft) override is never served to the engine; a signed one is served only while in date, so EXPIRY RETURNS TO DEFAULT;
--  * a newly signed override supersedes the previous one; a review moves the review date but not the expiry;
--  * the provenance table stores which override changed a grade, refuses a relaxed red, an override of another patient and a grade it did not produce, and is append only;
--  * the daily sweep lapses expired overrides and raises ONE monthly review task per due date;
--  * reads: the tied doctor and the patient see the row; an untied doctor and another patient do not; the patient notice is a bare yes/no.
-- SABOTAGE (each must flip): (1) the tie and authority check removed; (2) the clamp function accepting anything; (3) the loader ignoring expiry; (4) the provenance
-- CHECK dropped so a relaxed red can be stored.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;
create function pg_temp.setf(p text, p_v uuid) returns void language sql as $$ insert into fx values (p, p_v) on conflict (k) do update set v = excluded.v $$;
create function pg_temp.f(p text) returns uuid language sql as $$ select v from fx where k = p $$;
create function pg_temp.ck(p_phase text, p_name text, p_expected text, p_actual text) returns void language sql as $$ insert into results values (p_phase, p_name, p_expected, p_actual) $$;
grant execute on function pg_temp.f(text) to public;

create function pg_temp.mkuser(p_org uuid, p_label text, p_role text, p_test boolean default true) returns uuid language plpgsql as
$f$ declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'nov-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'NOv ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, p_test)
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, is_test = excluded.is_test, is_active = true, date_of_birth = excluded.date_of_birth;
  return v;
end $f$;
create function pg_temp.mkdoc(p_org uuid, p_label text, p_tier text, p_admin uuid) returns uuid language plpgsql as
$f$ declare v uuid; s uuid;
begin
  v := pg_temp.mkuser(p_org, p_label, 'clinician');
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
  values (p_org, v, 'NOv ' || p_label, 'MDCN', 'NOV-' || p_label || '-' || substr(v::text, 1, 8), true, 'active', now(), p_admin,
      p_tier::public.doctor_tier, 'contracted'::public.staff_employment_type,
      case when p_tier in ('senior_medical_officer', 'chief_medical_officer') then 2 else 1 end, true, p_admin, true)
  returning id into s;
  return v;
end $f$;

-- run one statement as a user; the first column as text, or 'ERR <sqlstate>'
create function pg_temp.as_user(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
  begin execute p_sql into r; exception when others then r := 'ERR ' || sqlstate; end;
  reset role;
  perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.sub', '', true); perform set_config('request.jwt.claim.role', '', true);
  return r;
end $f$;
-- a propose that was refused returns the 'ERR <sqlstate>' text; a plain cast would hide which call it was
create function pg_temp.uid(p_t text) returns uuid language plpgsql as $f$ begin if p_t like 'ERR %' then raise exception 'fixture call refused: %', p_t; end if; return p_t::uuid; end $f$;
create function pg_temp.try(p_sql text) returns text language plpgsql as $f$ begin execute p_sql; return 'OK'; exception when others then return 'ERR ' || sqlstate; end $f$;

do $$
declare
  v_org uuid; v_admin uuid; v_cmo uuid; v_c1 uuid; v_c2 uuid; v_c3 uuid; v_p uuid; v_pa uuid; v_preg uuid; v_young uuid; v_pp uuid; v_policy uuid; v_ov uuid; v_ov2 uuid; v_obs uuid;
  v_t text; v_staff_c1 uuid; v_n int; v_rs uuid; v_ev uuid; v_sig timestamptz; v_exp timestamptz; v_due timestamptz; v_due2 timestamptz;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  v_cmo := pg_temp.mkdoc(v_org, 'cmo', 'chief_medical_officer', v_admin);
  v_c1 := pg_temp.mkdoc(v_org, 'tied smo', 'senior_medical_officer', v_admin);
  v_c2 := pg_temp.mkdoc(v_org, 'untied smo', 'senior_medical_officer', v_admin);
  v_c3 := pg_temp.mkdoc(v_org, 'tied coordinator tier', 'care_coordinator', v_admin);
  v_p := pg_temp.mkuser(v_org, 'adult patient', 'patient'); v_pa := pg_temp.mkuser(v_org, 'other patient', 'patient');
  v_preg := pg_temp.mkuser(v_org, 'pregnant patient', 'patient'); v_young := pg_temp.mkuser(v_org, 'young patient', 'patient'); v_pp := pg_temp.mkuser(v_org, 'postpartum patient', 'patient');
  -- the adults-only registration trigger would refuse a 15 year old profile; the proof needs one, so triggers are bypassed for this one update
  set local session_replication_role = replica;
  update public.profiles set date_of_birth = (current_date - interval '15 years')::date where id = v_young;
  set local session_replication_role = origin;
  insert into public.patient_pregnancy (patient_id, organisation_id, is_pregnant) values (v_preg, v_org, true);
  insert into public.postnatal_profiles (organisation_id, patient_id, delivery_date) values (v_org, v_pp, current_date - 10);
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id, assigned_at) values (v_org, v_p, v_c1, now()), (v_org, v_preg, v_c1, now()), (v_org, v_young, v_c1, now()), (v_org, v_pp, v_c1, now());
  select id into v_staff_c1 from public.clinical_staff where profile_id = v_c1;
  perform pg_temp.setf('cmo', v_cmo); perform pg_temp.setf('c1', v_c1); perform pg_temp.setf('c2', v_c2); perform pg_temp.setf('c3', v_c3); perform pg_temp.setf('p', v_p); perform pg_temp.setf('pa', v_pa);

  -- A. the policy ----------------------------------------------------------------------------------------------------------------------
  select id into v_policy from public.threshold_override_policies where version = 1;
  perform pg_temp.ck('real', 'A1 the policy is born unsigned and inactive', 'false|false', (select (is_active)::text || '|' || (approved_by is not null)::text from public.threshold_override_policies where id = v_policy));
  perform pg_temp.ck('real', 'A2 nothing can be proposed while the policy is unsigned', 'ERR 55000',
    pg_temp.as_user(v_c1, format($q$select public.propose_threshold_override(%L, 'bp', '{"target":{"systolic":150,"diastolic":95}}', 'Chronic baseline around 150 over 95 for two years', 60)::text$q$, v_p)));
  perform pg_temp.ck('real', 'A3 a senior doctor who is not the CMO cannot sign the policy', 'ERR 42501', pg_temp.as_user(v_c1, format($q$select public.sign_threshold_override_policy(%L, 'SIGN')::text$q$, v_policy)));
  perform pg_temp.ck('real', 'A4 the CMO must type SIGN', 'ERR 22023', pg_temp.as_user(v_cmo, format($q$select public.sign_threshold_override_policy(%L, 'yes')::text$q$, v_policy)));
  perform pg_temp.as_user(v_cmo, format($q$select public.sign_threshold_override_policy(%L, 'sign')::text$q$, v_policy));
  perform pg_temp.ck('real', 'A5 the CMO signs the policy', 'true', (select (is_active and approved_by is not null)::text from public.threshold_override_policies where id = v_policy));

  -- B. who may propose, and the clamps -----------------------------------------------------------------------------------------------
  perform pg_temp.ck('real', 'B1 an untied senior doctor is refused', 'ERR 42501',
    pg_temp.as_user(v_c2, format($q$select public.propose_threshold_override(%L, 'bp', '{"target":{"systolic":150,"diastolic":95}}', 'Chronic baseline around 150 over 95 for two years', 60)::text$q$, v_p)));
  perform pg_temp.ck('real', 'B2 a tied clinician below senior tier is refused', 'ERR 42501',
    pg_temp.as_user(v_c3, format($q$select public.propose_threshold_override(%L, 'bp', '{"target":{"systolic":150,"diastolic":95}}', 'Chronic baseline around 150 over 95 for two years', 60)::text$q$, v_p)));
  perform pg_temp.ck('real', 'B3 the patient cannot set their own threshold', 'ERR 42501',
    pg_temp.as_user(v_p, format($q$select public.propose_threshold_override(%L, 'bp', '{"target":{"systolic":150,"diastolic":95}}', 'Chronic baseline around 150 over 95 for two years', 60)::text$q$, v_p)));
  perform pg_temp.ck('real', 'B4 a BP target over the clamp is refused', 'ERR 22023',
    pg_temp.as_user(v_c1, format($q$select public.propose_threshold_override(%L, 'bp', '{"target":{"systolic":175,"diastolic":95}}', 'Chronic baseline around 150 over 95 for two years', 60)::text$q$, v_p)));
  perform pg_temp.ck('real', 'B5 an unknown key is refused', 'ERR 22023',
    pg_temp.as_user(v_c1, format($q$select public.propose_threshold_override(%L, 'bp', '{"redSystolic":200}', 'Chronic baseline around 150 over 95 for two years', 60)::text$q$, v_p)));
  perform pg_temp.ck('real', 'B6 a glucose red line below the default is refused (a red can only be tightened)', 'ERR 22023',
    pg_temp.as_user(v_c1, format($q$select public.propose_threshold_override(%L, 'glucose', '{"hypoSevereMmol":2.5}', 'Hypoglycaemia unawareness on insulin', 60)::text$q$, v_p)));
  perform pg_temp.ck('real', 'B7 a period over the policy maximum is refused', 'ERR 22023',
    pg_temp.as_user(v_c1, format($q$select public.propose_threshold_override(%L, 'bp', '{"target":{"systolic":150,"diastolic":95}}', 'Chronic baseline around 150 over 95 for two years', 91)::text$q$, v_p)));
  perform pg_temp.ck('real', 'B8 a reason is required', 'ERR 22023',
    pg_temp.as_user(v_c1, format($q$select public.propose_threshold_override(%L, 'bp', '{"target":{"systolic":150,"diastolic":95}}', 'short', 60)::text$q$, v_p)));
  perform pg_temp.ck('real', 'B9 a pregnant patient is refused', 'ERR 22023',
    pg_temp.as_user(v_c1, format($q$select public.propose_threshold_override(%L, 'bp', '{"target":{"systolic":150,"diastolic":95}}', 'Chronic baseline around 150 over 95 for two years', 60)::text$q$, v_preg)));
  perform pg_temp.ck('real', 'B10 an under 18 patient is refused', 'ERR 22023',
    pg_temp.as_user(v_c1, format($q$select public.propose_threshold_override(%L, 'bp', '{"target":{"systolic":150,"diastolic":95}}', 'Chronic baseline around 150 over 95 for two years', 60)::text$q$, v_young)));
  perform pg_temp.ck('real', 'B11 a postpartum patient is refused', 'ERR 22023',
    pg_temp.as_user(v_c1, format($q$select public.propose_threshold_override(%L, 'bp', '{"target":{"systolic":150,"diastolic":95}}', 'Chronic baseline around 150 over 95 for two years', 60)::text$q$, v_pp)));
  perform pg_temp.ck('real', 'B12 the table CHECK also refuses a setting over the clamp', 'ERR 23514',
    pg_temp.try(format($q$insert into public.patient_threshold_overrides (organisation_id, patient_id, domain, params, reason, proposed_by, valid_days) values (%L, %L, 'bp', '{"target":{"systolic":175,"diastolic":95}}', 'a long enough reason', (select id from public.clinical_staff where profile_id = %L), 30)$q$, v_org, v_p, v_c1)));

  -- C. propose, draft is never served, sign -----------------------------------------------------------------------------------------
  v_t := pg_temp.as_user(v_c1, format($q$select public.propose_threshold_override(%L, 'bp', '{"target":{"systolic":150,"diastolic":95}}', 'Chronic baseline around 150 over 95 for two years', 60)::text$q$, v_p));
  v_ov := pg_temp.uid(v_t);
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, taken_at, source, position, arm)
    values (v_org, v_p, 'blood_pressure', 150, 92, now() - interval '5 minutes', 'device', 'seated', 'left') returning id into v_obs;
  perform pg_temp.ck('real', 'C1 a proposed (unsigned) override is never served to the engine', 'null', coalesce(public.triage_active_override_for_observation(v_obs, 'bp')::text, 'null'));
  perform pg_temp.ck('real', 'C2 signing needs the typed word', 'ERR 22023', pg_temp.as_user(v_c1, format($q$select public.sign_threshold_override(%L, 'ok')::text$q$, v_ov)));
  perform pg_temp.ck('real', 'C3 an untied senior doctor cannot sign', 'ERR 42501', pg_temp.as_user(v_c2, format($q$select public.sign_threshold_override(%L, 'SIGN')::text$q$, v_ov)));
  perform pg_temp.as_user(v_c1, format($q$select public.sign_threshold_override(%L, 'sign')::text$q$, v_ov));
  select signed_at, expires_at, review_due_at into v_sig, v_exp, v_due from public.patient_threshold_overrides where id = v_ov;
  perform pg_temp.ck('real', 'C4 signed: active, expires after the period, first review after the review days', 'active|60|30',
    (select status from public.patient_threshold_overrides where id = v_ov) || '|' || round(extract(epoch from (v_exp - v_sig)) / 86400)::text || '|' || round(extract(epoch from (v_due - v_sig)) / 86400)::text);
  perform pg_temp.ck('real', 'C5 a signed in-date override is served', v_ov::text, public.triage_active_override_for_observation(v_obs, 'bp') ->> 'id');
  perform pg_temp.ck('real', 'C6 only for its own domain', 'null', coalesce(public.triage_active_override_for_observation(v_obs, 'glucose')::text, 'null'));

  -- D. expiry returns to default, the kill switch ----------------------------------------------------------------------------------
  update public.patient_threshold_overrides set signed_at = now() - interval '61 days', expires_at = now() - interval '1 day', review_due_at = now() - interval '31 days' where id = v_ov;
  perform pg_temp.ck('real', 'D1 EXPIRY RETURNS TO DEFAULT: an expired override is not served', 'null', coalesce(public.triage_active_override_for_observation(v_obs, 'bp')::text, 'null'));
  update public.patient_threshold_overrides set signed_at = now() - interval '2 days', expires_at = now() + interval '58 days', review_due_at = now() + interval '28 days' where id = v_ov;
  perform pg_temp.ck('real', 'D2 in date again: served', v_ov::text, public.triage_active_override_for_observation(v_obs, 'bp') ->> 'id');
  perform pg_temp.ck('real', 'D3 a non-CMO cannot withdraw the policy', 'ERR 42501', pg_temp.as_user(v_c1, $q$select public.withdraw_threshold_override_policy('not allowed')::text$q$));
  perform pg_temp.as_user(v_cmo, $q$select public.withdraw_threshold_override_policy('proof withdrawal')::text$q$);
  perform pg_temp.ck('real', 'D4 withdrawing the policy stops every override at once', 'null|false', coalesce(public.triage_active_override_for_observation(v_obs, 'bp')::text, 'null') || '|' || pg_temp.as_user(v_p, 'select public.my_threshold_override_notice()::text'));
  perform pg_temp.ck('real', 'D5a a withdrawn policy can be signed again (the kill switch is not one-way)', 'true', (pg_temp.as_user(v_cmo, format($q$select public.sign_threshold_override_policy(%L, 'SIGN')::text$q$, v_policy)) is not null)::text);
  perform pg_temp.ck('real', 'D5b a version that is already on cannot be signed again', 'ERR 22023', pg_temp.as_user(v_cmo, format($q$select public.sign_threshold_override_policy(%L, 'SIGN')::text$q$, v_policy)));
  perform pg_temp.ck('real', 'D5 and they return when a policy is signed again', v_ov::text, public.triage_active_override_for_observation(v_obs, 'bp') ->> 'id');

  -- E. supersede, review, revoke, reads --------------------------------------------------------------------------------------------------
  v_ov2 := pg_temp.uid(pg_temp.as_user(v_c1, format($q$select public.propose_threshold_override(%L, 'bp', '{"target":{"systolic":145,"diastolic":90},"lowAmberSystolic":85}', 'Revised after the clinic review this month', 30)::text$q$, v_p)));
  perform pg_temp.as_user(v_c1, format($q$select public.sign_threshold_override(%L, 'SIGN')::text$q$, v_ov2));
  perform pg_temp.ck('real', 'E1 a newly signed override supersedes the previous one', 'superseded|active|1',
    (select status from public.patient_threshold_overrides where id = v_ov) || '|' || (select status from public.patient_threshold_overrides where id = v_ov2) ||
    '|' || (select count(*)::text from public.patient_threshold_overrides where patient_id = v_p and domain = 'bp' and status = 'active'));
  select expires_at, review_due_at into v_exp, v_due from public.patient_threshold_overrides where id = v_ov2;
  update public.patient_threshold_overrides set review_due_at = now() - interval '1 hour' where id = v_ov2;
  perform pg_temp.ck('real', 'E2 a review needs a note and an outcome', 'ERR 22023', pg_temp.as_user(v_c1, format($q$select public.review_threshold_override(%L, 'continue', 'x')::text$q$, v_ov2)));
  perform pg_temp.ck('real', 'E3 an untied senior doctor cannot review', 'ERR 42501', pg_temp.as_user(v_c2, format($q$select public.review_threshold_override(%L, 'continue', 'looks fine to me')::text$q$, v_ov2)));
  perform pg_temp.ck('real', 'E3b the CMO can end an override without a tie but cannot keep one (keeping needs the care relationship)', 'ERR 42501', pg_temp.as_user(v_cmo, format($q$select public.review_threshold_override(%L, 'continue', 'Keeping it without a tie')::text$q$, v_ov2)));
  perform pg_temp.as_user(v_c1, format($q$select public.review_threshold_override(%L, 'continue', 'Readings still sit near the baseline')::text$q$, v_ov2));
  perform pg_temp.ck('real', 'E4 a review moves the review date and never the expiry', 'true|true',
    ((select review_due_at > now() + interval '20 days' from public.patient_threshold_overrides where id = v_ov2))::text || '|' || ((select expires_at = v_exp from public.patient_threshold_overrides where id = v_ov2))::text);
  perform pg_temp.ck('real', 'E5 the tied doctor reads the override', '1', pg_temp.as_user(v_c1, format($q$select count(*)::text from public.patient_threshold_overrides where patient_id = %L and status = 'active'$q$, v_p)));
  perform pg_temp.ck('real', 'E6 an untied doctor does not', '0', pg_temp.as_user(v_c2, format($q$select count(*)::text from public.patient_threshold_overrides where patient_id = %L$q$, v_p)));
  perform pg_temp.ck('real', 'E7 the patient gets no direct read of the table (numbers and reason stay clinician-side, INV-07)', '0', pg_temp.as_user(v_p, format($q$select count(*)::text from public.patient_threshold_overrides where patient_id = %L$q$, v_p)));
  perform pg_temp.ck('real', 'E8 another patient does not', '0', pg_temp.as_user(v_pa, format($q$select count(*)::text from public.patient_threshold_overrides where patient_id = %L$q$, v_p)));
  perform pg_temp.ck('real', 'E9 the patient notice is a bare yes, the other patient gets no', 'true|false', pg_temp.as_user(v_p, 'select public.my_threshold_override_notice()::text') || '|' || pg_temp.as_user(v_pa, 'select public.my_threshold_override_notice()::text'));
  perform pg_temp.ck('real', 'E10 nobody can write the table directly', 'ERR 42501', pg_temp.as_user(v_c1, format($q$update public.patient_threshold_overrides set status = 'revoked' where id = %L returning id::text$q$, v_ov2)));
  perform pg_temp.ck('real', 'E11 the CMO oversight list shows it; a senior doctor cannot call it', 'true|ERR 42501',
    (pg_temp.as_user(v_cmo, $q$select (jsonb_array_length(public.list_threshold_overrides_for_oversight()) >= 2)::text$q$)) || '|' || pg_temp.as_user(v_c1, $q$select public.list_threshold_overrides_for_oversight()::text$q$));

  -- F. provenance -----------------------------------------------------------------------------------------------------------------------
  select id into v_rs from public.triage_rule_sets where code = 'bp_care_triage' order by version desc limit 1;
  insert into public.triage_events (organisation_id, patient_id, trigger_type, trigger_id, grade, rule_id, rule_set_id, rule_set_code, rule_set_version, rule_set_status, shadow, basis, is_test)
    select v_org, v_p, 'observation', v_obs, 'green', 'BP-G2', r.id, r.code, r.version, r.status, r.status <> 'approved', 'nov-basis', true from public.triage_rule_sets r where r.id = v_rs;
  insert into public.triage_events (organisation_id, patient_id, trigger_type, trigger_id, grade, rule_id, rule_set_id, rule_set_code, rule_set_version, rule_set_status, shadow, basis, is_test)
    select v_org, v_p, 'observation', v_obs, 'green', 'BP-G2', r.id, r.code, r.version, r.status, r.status <> 'approved', 'nov-basis-2', true from public.triage_rule_sets r where r.id = v_rs;
  perform pg_temp.ck('real', 'F1 provenance is stored for a relaxed amber', 'true',
    (public.record_triage_override_application(v_obs, 'bp', jsonb_build_object('override', jsonb_build_object('overrideId', v_ov2, 'direction', 'relaxed', 'parameters', jsonb_build_array('target'), 'defaultGrade', 'amber', 'defaultRuleId', 'BP-A2', 'finalGrade', 'green', 'finalRuleId', 'BP-G2')), v_rs, 'nov-basis') ->> 'created'));
  perform pg_temp.ck('real', 'F2 recording again is idempotent', 'false',
    (public.record_triage_override_application(v_obs, 'bp', jsonb_build_object('override', jsonb_build_object('overrideId', v_ov2, 'direction', 'relaxed', 'parameters', jsonb_build_array('target'), 'defaultGrade', 'amber', 'defaultRuleId', 'BP-A2', 'finalGrade', 'green', 'finalRuleId', 'BP-G2')), v_rs, 'nov-basis') ->> 'created'));
  perform pg_temp.ck('real', 'F3 a grade the override did not produce is not recorded as its work', 'stored_grade_differs',
    (public.record_triage_override_application(v_obs, 'bp', jsonb_build_object('override', jsonb_build_object('overrideId', v_ov2, 'direction', 'tightened', 'parameters', jsonb_build_array('target'), 'defaultGrade', 'green', 'defaultRuleId', null, 'finalGrade', 'amber', 'finalRuleId', 'BP-A2')), v_rs, 'nov-basis') ->> 'reason'));
  perform pg_temp.ck('real', 'F4 an override of another patient is refused', 'ERR 22023',
    pg_temp.try(format($q$do $d$ declare o uuid; begin
      insert into public.patient_threshold_overrides (organisation_id, patient_id, domain, params, reason, proposed_by, valid_days, status, signed_by, signed_at, expires_at, review_due_at, policy_version)
        select %L, %L, 'bp', '{"lowAmberSystolic":85}', 'another patients override', proposed_by, 30, 'active', signed_by, now(), now() + interval '30 days', now() + interval '20 days', 1 from public.patient_threshold_overrides where id = %L returning id into o;
      perform public.record_triage_override_application(%L, 'bp', jsonb_build_object('override', jsonb_build_object('overrideId', o, 'direction', 'relaxed', 'parameters', jsonb_build_array('lowAmberSystolic'), 'defaultGrade', 'amber', 'finalGrade', 'green')), %L, 'nov-basis');
    end $d$ $q$, v_org, v_pa, v_ov2, v_obs, v_rs)));
  perform pg_temp.ck('real', 'F5 a relaxed red cannot be stored (CHECK)', 'ERR 23514',
    pg_temp.try(format($q$insert into public.triage_override_applications (triage_event_id, override_id, organisation_id, patient_id, domain, direction, parameters, default_grade, final_grade, shadow)
        values ((select id from public.triage_events where trigger_id = %L and basis = 'nov-basis-2'), %L, %L, %L, 'bp', 'relaxed', '{target}', 'red', 'green', true)$q$, v_obs, v_ov2, v_org, v_p)));
  perform pg_temp.ck('real', 'F6 provenance is append only', 'ERR 42501',
    pg_temp.try(format($q$update public.triage_override_applications set final_grade = 'amber' where override_id = %L$q$, v_ov2)));

  -- G. revoke and the sweep ----------------------------------------------------------------------------------------------------------
  perform pg_temp.ck('real', 'G1 an untied senior doctor cannot revoke', 'ERR 42501', pg_temp.as_user(v_c2, format($q$select public.revoke_threshold_override(%L, 'not my patient')::text$q$, v_ov2)));
  update public.patient_threshold_overrides set review_due_at = now() - interval '1 hour' where id = v_ov2;
  perform private.sweep_threshold_override_reviews();
  perform private.sweep_threshold_override_reviews();
  perform pg_temp.ck('real', 'G2 the sweep raises ONE monthly review task per due date, however often it runs', '1',
    (select count(*)::text from public.patient_threshold_override_events where override_id = v_ov2 and event = 'review_task_created'));
  update public.patient_threshold_overrides set signed_at = now() - interval '31 days', expires_at = now() - interval '1 hour' where id = v_ov2;
  perform private.sweep_threshold_override_reviews();
  perform pg_temp.ck('real', 'G3 the sweep lapses an expired override', 'lapsed', (select status from public.patient_threshold_overrides where id = v_ov2));
  v_ov := pg_temp.uid(pg_temp.as_user(v_c1, format($q$select public.propose_threshold_override(%L, 'glucose', '{"hypoAlertMmol":4.4,"hypoSevereMmol":3.3}', 'Hypoglycaemia unawareness on insulin', 30)::text$q$, v_p)));
  perform pg_temp.as_user(v_c1, format($q$select public.sign_threshold_override(%L, 'SIGN')::text$q$, v_ov));
  perform pg_temp.as_user(v_cmo, format($q$select public.revoke_threshold_override(%L, 'oversight revoke in proof')::text$q$, v_ov));
  perform pg_temp.ck('real', 'G4 the CMO can revoke any override without a tie', 'revoked', (select status from public.patient_threshold_overrides where id = v_ov));
  perform pg_temp.ck('real', 'G5 the monthly review task type is routine and never pushed', 'true|8|false',
    (select (creatable)::text || '|' || priority_class::text || '|' || pushable::text from public.task_types where code = 'threshold_override_review' and is_active));
  perform pg_temp.ck('real', 'G6 every new table is in both patient registries', '3|3',
    (select count(*)::text from public.staff_read_scope where table_name in ('patient_threshold_overrides', 'patient_threshold_override_events', 'triage_override_applications')) || '|' ||
    (select count(*)::text from public.data_registry where table_name in ('patient_threshold_overrides', 'patient_threshold_override_events', 'triage_override_applications')));
  perform pg_temp.setf('ov2', v_ov2); perform pg_temp.setf('obs', v_obs);
end $$;

-- SABOTAGE 1: the tie and authority check removed. An untied senior doctor must now be able to propose.
do $$
declare v_def text; v_p uuid := pg_temp.f('p'); v_c2 uuid := pg_temp.f('c2'); v_out text;
begin
  select pg_get_functiondef('private.threshold_override_actor(uuid)'::regprocedure) into v_def;
  v_def := replace(replace(v_def, 'if not private.has_prescribing_authority(v_org) then', 'if false then'), 'if not private.clinician_has_patient_access(p_patient) then', 'if false then');
  execute v_def;
  v_out := pg_temp.as_user(v_c2, format($q$select public.propose_threshold_override(%L, 'bp', '{"target":{"systolic":150,"diastolic":95}}', 'Chronic baseline around 150 over 95 for two years', 60) is not null$q$, v_p));
  insert into results values ('sabotaged', 'SABOTAGE 1: tie and authority removed, an untied doctor proposes', 'ERR 42501', v_out);
end $$;
-- SABOTAGE 2: the clamp function accepts anything. A glucose red line below the default must now be accepted.
do $$
declare v_def text; v_p uuid := pg_temp.f('p'); v_c1 uuid := pg_temp.f('c1'); v_out text;
begin
  select pg_get_functiondef('private.threshold_override_params_ok(text, jsonb)'::regprocedure) into v_def;
  v_def := replace(v_def, 'if p_params is null or jsonb_typeof(p_params) <> ''object'' or p_params = ''{}''::jsonb then return false; end if;', 'return true;');
  execute v_def;
  v_out := pg_temp.as_user(v_c1, format($q$select public.propose_threshold_override(%L, 'glucose', '{"hypoSevereMmol":2.5}', 'Hypoglycaemia unawareness on insulin', 60) is not null$q$, v_p));
  insert into results values ('sabotaged', 'SABOTAGE 2: clamp function accepts anything, a lowered red line is accepted', 'ERR 22023', v_out);
end $$;
-- SABOTAGE 3: the loader ignores expiry. An expired override must now be served.
do $$
declare v_def text; v_ov uuid; v_obs uuid := pg_temp.f('obs'); v_out text;
begin
  select id into v_ov from public.patient_threshold_overrides where patient_id = pg_temp.f('p') and domain = 'bp' and status = 'lapsed' limit 1;
  update public.patient_threshold_overrides set status = 'active', ended_at = null, end_reason = null, signed_at = now() - interval '40 days', expires_at = now() - interval '1 day', review_due_at = now() - interval '10 days' where id = v_ov;
  select pg_get_functiondef('public.triage_active_override_for_observation(uuid, text)'::regprocedure) into v_def;
  v_def := replace(v_def, 'and o.expires_at > now()', '');
  execute v_def;
  v_out := coalesce(public.triage_active_override_for_observation(v_obs, 'bp')::text, 'null');
  insert into results values ('sabotaged', 'SABOTAGE 3: loader ignores expiry, an expired override is served', 'null', v_out);
end $$;
-- SABOTAGE 4: the provenance CHECK dropped. A relaxed red must now be storable.
do $$
declare v_out text; v_ov uuid := pg_temp.f('ov2'); v_obs uuid := pg_temp.f('obs');
begin
  alter table public.triage_override_applications drop constraint triage_override_applications_check;
  alter table public.triage_override_applications drop constraint triage_override_applications_check1;
  v_out := pg_temp.try(format($q$insert into public.triage_override_applications (triage_event_id, override_id, organisation_id, patient_id, domain, direction, parameters, default_grade, final_grade, shadow)
      values ((select id from public.triage_events where trigger_id = %L and basis = 'nov-basis-2'), %L, (select organisation_id from public.profiles where id = %L), %L, 'bp', 'relaxed', '{target}', 'red', 'green', true)$q$, v_obs, v_ov, pg_temp.f('p'), pg_temp.f('p')));
  insert into results values ('sabotaged', 'SABOTAGE 4: provenance CHECK dropped, a relaxed red is stored', 'ERR 23514', v_out);
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'N-overrides proof FAILED: %', (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected is distinct from actual;
  if v_caught < 4 then raise exception 'VACUOUS TEST: only % of 4 sabotages flipped: %', v_caught, (select string_agg(check_name, '; ') from results where phase = 'sabotaged' and expected is not distinct from actual); end if;
end $$;

select phase, check_name, expected, actual, case when phase = 'real' and expected = actual then 'PASS' when phase = 'sabotaged' and expected is distinct from actual then 'PASS (caught)' else 'FAIL' end as result
from results order by phase desc, check_name;
rollback;
