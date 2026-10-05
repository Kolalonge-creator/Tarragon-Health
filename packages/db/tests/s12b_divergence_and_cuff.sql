-- S12b proof: the shadow divergence report and the cuff type column.
--   1. The classes: both urgent, shadow-only urgent, live-only urgent, neither.
--   2. Test accounts and non-shadow events are excluded.
--   3. Access: admin and the active clinical director may call it; a patient, a plain clinician and anon may not.
--   4. The disagreement list shows the live-only rows first and carries no patient id.
--   5. cuff_type accepts upper_arm, wrist, not_sure and null; anything else is refused.
--   6. SABOTAGE: with the access check removed a patient could call it, proving check 3 can fail.
begin;
create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create or replace function pg_temp.res(p_check text, p_expected text, p_actual text) returns void language sql as $f$ insert into results values ('real', p_check, p_expected, p_actual) $f$;
create or replace function pg_temp.mkuser(p_org uuid, p_label text, p_role text, p_test boolean default true) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's12b-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'S12b ' || p_label, (current_date - interval '50 years')::date, p_test)
  on conflict (id) do update set role = excluded.role, is_test = p_test, is_active = true;
  return v;
end $f$;

do $$
declare
  v_org uuid; v_p uuid; v_real uuid; v_admin uuid; v_clin uuid; v_cmo uuid; v_draft uuid;
  v_r1 uuid; v_r2 uuid; v_r3 uuid; v_r4 uuid; v_r5 uuid; v_e uuid;
  v_n integer; v_err text; v_first text;
  v_actions_red jsonb := '[{"kind":"page_on_call"}]'::jsonb;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_p := pg_temp.mkuser(v_org, 'patient', 'patient', true);
  v_real := pg_temp.mkuser(v_org, 'real', 'patient', false);
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  v_clin := pg_temp.mkuser(v_org, 'clin', 'clinician');
  v_cmo := pg_temp.mkuser(v_org, 'cmo', 'clinician');
  insert into public.clinical_staff (profile_id, organisation_id, full_name, doctor_tier, active, license_verified_at, employment_type, indemnity_exempt, indemnity_exempt_by)
  values (v_cmo, v_org, 'S12b CMO', 'chief_medical_officer', true, now(), 'employed', true, v_admin) on conflict do nothing;
  select id into v_draft from public.triage_rule_sets where code = 'bp_care_triage' and version = 1;

  -- Readings: 205/100 (live emergency), 150/95 (live amber), 125/80 (live green), 175/105 (live red), 182/112 (live emergency)
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, source, taken_at) values (v_org, v_real, 'blood_pressure', 205, 100, 'manual', now()) returning id into v_r1;
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, source, taken_at) values (v_org, v_real, 'blood_pressure', 150, 95, 'manual', now()) returning id into v_r2;
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, source, taken_at) values (v_org, v_real, 'blood_pressure', 125, 80, 'manual', now()) returning id into v_r3;
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, source, taken_at) values (v_org, v_real, 'blood_pressure', 175, 105, 'manual', now()) returning id into v_r4;
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, source, taken_at) values (v_org, v_p, 'blood_pressure', 205, 100, 'manual', now()) returning id into v_r5;

  -- shadow results (draft rule set): r1 red (both urgent), r2 red (shadow only), r3 green (neither), r4 amber (live only), r5 test patient
  insert into public.triage_events (organisation_id, patient_id, trigger_type, trigger_id, grade, rule_id, rule_set_id, rule_set_code, rule_set_version, rule_set_status, actions, shadow, is_test)
  values (v_org, v_real, 'observation', v_r1, 'red', 'BP-R2', v_draft, 'bp_care_triage', 1, 'draft', v_actions_red, true, false),
         (v_org, v_real, 'observation', v_r2, 'red', 'BP-R1', v_draft, 'bp_care_triage', 1, 'draft', v_actions_red, true, false),
         (v_org, v_real, 'observation', v_r3, 'green', 'BP-G1', v_draft, 'bp_care_triage', 1, 'draft', '[]', true, false),
         (v_org, v_real, 'observation', v_r4, 'amber', 'BP-A1', v_draft, 'bp_care_triage', 1, 'draft', '[]', true, false),
         (v_org, v_p, 'observation', v_r5, 'red', 'BP-R2', v_draft, 'bp_care_triage', 1, 'draft', v_actions_red, true, true);

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
  perform pg_temp.res('both urgent', '1', (select coalesce(sum(readings), 0)::text from public.triage_shadow_divergence(30) where divergence = 'both_urgent'));
  perform pg_temp.res('shadow only urgent', '1', (select coalesce(sum(readings), 0)::text from public.triage_shadow_divergence(30) where divergence = 'shadow_only_urgent'));
  perform pg_temp.res('live only urgent', '1', (select coalesce(sum(readings), 0)::text from public.triage_shadow_divergence(30) where divergence = 'live_only_urgent'));
  perform pg_temp.res('neither urgent', '1', (select coalesce(sum(readings), 0)::text from public.triage_shadow_divergence(30) where divergence = 'neither_urgent'));
  perform pg_temp.res('a test account is excluded (INV-13)', '4', (select sum(readings)::text from public.triage_shadow_divergence(30)));
  select divergence into v_first from public.triage_shadow_disagreements(30, 10) limit 1;
  perform pg_temp.res('live-only urgent is listed first', 'live_only_urgent', v_first);
  perform pg_temp.res('the list holds only the two disagreements', '2', (select count(*)::text from public.triage_shadow_disagreements(30, 10)));
  perform pg_temp.res('the list has no patient column', '0', (select count(*)::text from information_schema.parameters where specific_schema = 'public' and parameter_mode = 'OUT' and parameter_name = 'patient_id' and specific_name like 'triage_shadow_disagreements%'));
  reset role;

  -- non-shadow events are excluded
  insert into public.triage_rule_sets (code, version, status, rules, approved_by, approved_at)
    values ('s12b_probe', 1, 'approved', jsonb_build_object('code', 's12b_probe', 'version', 1), v_cmo, now()) returning id into v_e;
  insert into public.triage_events (organisation_id, patient_id, trigger_type, trigger_id, grade, rule_id, rule_set_id, rule_set_code, rule_set_version, rule_set_status, actions, shadow, is_test)
  values (v_org, v_real, 'observation', v_r2, 'green', 'X', v_e, 's12b_probe', 1, 'approved', '[]', false, false);
  perform set_config('request.jwt.claims', json_build_object('sub', v_cmo, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform pg_temp.res('the clinical director may call it and approved events are not counted', '4', (select sum(readings)::text from public.triage_shadow_divergence(30)));
  reset role;

  -- access
  foreach v_err in array array[v_p::text, v_clin::text] loop
    perform set_config('request.jwt.claims', json_build_object('sub', v_err::uuid, 'role', 'authenticated')::text, true);
    set local role authenticated;
    begin
      perform * from public.triage_shadow_divergence(30);
      perform pg_temp.res('a patient or plain clinician is refused ' || left(v_err, 4), 'refused', 'allowed');
    exception when insufficient_privilege then
      perform pg_temp.res('a patient or plain clinician is refused ' || left(v_err, 4), 'refused', 'refused');
    end;
    reset role;
  end loop;
  perform set_config('request.jwt.claims', '', true);
  set local role anon;
  begin
    perform * from public.triage_shadow_divergence(30);
    v_err := 'allowed';
  exception when insufficient_privilege then v_err := 'refused'; end;
  perform pg_temp.res('anon is refused', 'refused', v_err);
  reset role;

  -- cuff type
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, source, taken_at, cuff_type) values (v_org, v_real, 'blood_pressure', 120, 80, 'manual', now(), 'upper_arm');
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, source, taken_at, cuff_type) values (v_org, v_real, 'blood_pressure', 120, 80, 'manual', now(), 'wrist');
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, source, taken_at, cuff_type) values (v_org, v_real, 'blood_pressure', 120, 80, 'manual', now(), 'not_sure');
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, source, taken_at) values (v_org, v_real, 'blood_pressure', 120, 80, 'manual', now());
  begin
    insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, source, taken_at, cuff_type) values (v_org, v_real, 'blood_pressure', 120, 80, 'manual', now(), 'finger');
    v_err := 'accepted';
  exception when check_violation then v_err := 'refused'; end;
  perform pg_temp.res('an unknown cuff type is refused', 'refused', v_err);

  perform pg_temp.res('valid cuff types and null are stored', '4', (select count(*)::text from public.vitals_readings where patient_id = v_real and systolic = 120));

  -- SABOTAGE: remove the access check and a patient gets in
  create or replace function public.triage_shadow_divergence(p_days integer default 30)
  returns table (divergence text, shadow_grade text, live_level text, readings bigint) language sql stable security definer set search_path = '' as
  $f$ select d.divergence, d.shadow_grade, d.live_level, count(*) from private.triage_divergence_rows(p_days) d group by 1, 2, 3 $f$;
  perform set_config('request.jwt.claims', json_build_object('sub', v_p, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform * from public.triage_shadow_divergence(30);
    v_err := 'allowed';
  exception when insufficient_privilege then v_err := 'refused'; end;
  reset role;
  insert into results values ('sabotaged', 'a patient is refused', 'refused', v_err);
end $$;

do $$
declare v_bad integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S12b proof FAILED: %', (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  if (select count(*) from results where phase = 'sabotaged' and expected <> actual) = 0 then
    raise exception 'VACUOUS TEST: the sabotage did not change the outcome';
  end if;
end $$;
select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result from results where phase = 'real' order by check_name;
rollback;
