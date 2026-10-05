-- S11g proof: the older server alert path follows the CMO's 200/130 decision once the rule set is approved
-- (migration *_s11g_legacy_bp_alert_follows_approved_200_130_rule.sql).
--  1. Before approval nothing changes: 205/100 with no symptom opens the emergency record.
--  2. After approval: 205/100 and 150/125 with no symptom open NO emergency record but still raise the Priority 1 alert.
--  3. A red-flag symptom within 10 minutes either side keeps it an emergency (symptom first, or reading first and the
--     symptom answered after, which opens the record then, once); a symptom 30 minutes old does not; a symptom with a
--     reading below the severe line opens nothing.
--  4. Pregnancy and the weeks after a birth are untouched (still an emergency). The 160/100 band is unchanged.
--  5. SABOTAGE: with the new block switched off, the no-symptom case opens an emergency record again, which proves 2 can fail.
begin;
create temp table results(phase text, check_name text, expected text, actual text) on commit drop;

create or replace function pg_temp.mkpatient(p_org uuid, p_label text, p_product uuid, p_price bigint) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's11g-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, date_of_birth, is_test)
  values (v, p_org, 'patient', 'S11g ' || p_label, (current_date - interval '45 years')::date, true)
  on conflict (id) do update set is_test = true;
  insert into public.service_purchases (organisation_id, patient_id, purchaser_profile_id, service_product_id, status, amount_kobo, currency, purchased_at, expires_at)
    values (p_org, v, v, p_product, 'active', p_price, 'NGN', now(), now() + interval '84 days');
  return v;
end $f$;
create or replace function pg_temp.res(p_check text, p_expected text, p_actual text) returns void
language sql as $f$ insert into results values ('real', p_check, p_expected, p_actual) $f$;
create or replace function pg_temp.emerg(p uuid) returns text language sql as $f$ select count(*)::text from public.emergency_events where patient_id = p and source = 'bp_reading' $f$;
create or replace function pg_temp.p1(p uuid) returns text language sql as $f$ select count(*)::text from public.clinician_alerts where patient_id = p and level = 'urgent_escalation' $f$;
create or replace function pg_temp.bp(p_org uuid, p uuid, s int, d int) returns uuid language plpgsql as $f$
declare v uuid;
begin
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, source, taken_at)
    values (p_org, p, 'blood_pressure', s, d, 'manual', now()) returning id into v;
  return v;
end $f$;

do $$
declare
  v_org uuid; v_cmo uuid := gen_random_uuid(); v_product uuid; v_price bigint; v_v2 uuid; v_src text;
  a uuid; b uuid; c uuid; d uuid; e uuid; f uuid; g uuid; h uuid; i uuid; j uuid; k uuid; r uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  select id, price_kobo into v_product, v_price from public.service_products where 'vitals_red_flag_doctor_escalation' = any(features) order by code limit 1;
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data) values (v_cmo, 's11g-cmo@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, date_of_birth, is_test) values (v_cmo, v_org, 'clinician', 'S11g CMO', (current_date - interval '45 years')::date, true) on conflict (id) do update set is_test = true;
  insert into public.clinical_staff (profile_id, organisation_id, full_name, doctor_tier, active, license_verified_at, employment_type)
    values (v_cmo, v_org, 'S11g CMO', 'chief_medical_officer', true, now(), 'employed') on conflict do nothing;
  select id into v_v2 from public.triage_rule_sets where code = 'bp_care_triage' and version = 2;
  if v_v2 is null then raise exception 'rule set v2 is missing'; end if;

  -- 1. before approval
  a := pg_temp.mkpatient(v_org, 'a', v_product, v_price);
  r := pg_temp.bp(v_org, a, 205, 100);
  perform pg_temp.res('before approval: 205/100 is an emergency record (unchanged)', '1', pg_temp.emerg(a));

  update public.triage_rule_sets set status = 'approved', approved_by = v_cmo, approved_at = now() where id = v_v2;

  -- 2. approved, no symptom
  b := pg_temp.mkpatient(v_org, 'b', v_product, v_price);
  r := pg_temp.bp(v_org, b, 205, 100);
  perform pg_temp.res('approved: 205/100 with no symptom opens no emergency record', '0', pg_temp.emerg(b));
  perform pg_temp.res('approved: ... but still raises the Priority 1 alert', '1', pg_temp.p1(b));
  j := pg_temp.mkpatient(v_org, 'j', v_product, v_price);
  r := pg_temp.bp(v_org, j, 150, 125);
  perform pg_temp.res('approved: 150/125 with no symptom: no emergency record, Priority 1 alert', '0|1', pg_temp.emerg(j) || '|' || pg_temp.p1(j));

  -- 3. symptoms
  c := pg_temp.mkpatient(v_org, 'c', v_product, v_price);
  insert into public.symptoms (organisation_id, patient_id, symptom_type, severity, description) values (v_org, c, 'chest_pain', 6, 'before');
  r := pg_temp.bp(v_org, c, 205, 100);
  perform pg_temp.res('approved: a symptom logged first keeps it an emergency', '1', pg_temp.emerg(c));
  d := pg_temp.mkpatient(v_org, 'd', v_product, v_price);
  r := pg_temp.bp(v_org, d, 205, 100);
  insert into public.symptoms (organisation_id, patient_id, symptom_type, severity, description) values (v_org, d, 'weakness_or_numbness', 6, 'answered after');
  perform pg_temp.res('approved: the answer after the reading opens the emergency record', '1', pg_temp.emerg(d));
  insert into public.symptoms (organisation_id, patient_id, symptom_type, severity, description) values (v_org, d, 'difficulty_speaking', 6, 'second');
  perform pg_temp.res('... once, not per symptom', '1', pg_temp.emerg(d));
  e := pg_temp.mkpatient(v_org, 'e', v_product, v_price);
  insert into public.symptoms (organisation_id, patient_id, symptom_type, severity, description, created_at) values (v_org, e, 'chest_pain', 6, 'old', now() - interval '30 minutes');
  r := pg_temp.bp(v_org, e, 205, 100);
  perform pg_temp.res('approved: a symptom 30 minutes old does not keep it an emergency', '0', pg_temp.emerg(e));
  f := pg_temp.mkpatient(v_org, 'f', v_product, v_price);
  r := pg_temp.bp(v_org, f, 150, 90);
  insert into public.symptoms (organisation_id, patient_id, symptom_type, severity, description) values (v_org, f, 'chest_pain', 6, 'normal reading');
  perform pg_temp.res('approved: a symptom beside a reading under the severe line opens no emergency record', '0', pg_temp.emerg(f));

  -- 4. obstetric and the unchanged band
  g := pg_temp.mkpatient(v_org, 'g', v_product, v_price);
  update public.profiles set is_pregnant = true where id = g;
  r := pg_temp.bp(v_org, g, 205, 100);
  perform pg_temp.res('approved: pregnancy is untouched, still an emergency', '1', pg_temp.emerg(g));
  h := pg_temp.mkpatient(v_org, 'h', v_product, v_price);
  insert into public.postnatal_profiles (organisation_id, patient_id, delivery_date) values (v_org, h, (now() at time zone 'Africa/Lagos')::date - 10);
  r := pg_temp.bp(v_org, h, 205, 100);
  perform pg_temp.res('approved: the weeks after a birth are untouched, still an emergency', '1', pg_temp.emerg(h));
  i := pg_temp.mkpatient(v_org, 'i', v_product, v_price);
  r := pg_temp.bp(v_org, i, 165, 105);
  perform pg_temp.res('approved: the 160/100 band is unchanged (Priority 1, no emergency record)', '0|1', pg_temp.emerg(i) || '|' || pg_temp.p1(i));

  -- 5. SABOTAGE
  select pg_get_functiondef('private.handle_bp_reading_red_flag()'::regprocedure) into v_src;
  v_src := replace(v_src, 'if v_params is not null and v_level', 'if false and v_level');
  if v_src = pg_get_functiondef('private.handle_bp_reading_red_flag()'::regprocedure) then raise exception 'sabotage changed nothing'; end if;
  execute v_src;
  k := pg_temp.mkpatient(v_org, 'k', v_product, v_price);
  r := pg_temp.bp(v_org, k, 205, 100);
  insert into results values ('sabotaged', 'approved: 205/100 with no symptom opens no emergency record', '0', pg_temp.emerg(k));
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S11g proof FAILED: %', (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ')
      from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught = 0 then raise exception 'VACUOUS TEST: switching the block off did not bring the emergency record back'; end if;
end $$;
select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result from results where phase = 'real' order by check_name;
rollback;
