-- S47d proof: the optional-per-use consents are enforced where data is WRITTEN (migration *_s47d_optional_consent_enforced_at_write.sql). One rolled-back transaction.
-- Proves, with simulated patient and service-role sessions and controls:
--   1. Without the person's yes, a NEW reproductive-health record (profile, cycle, daily log, pregnancy, postnatal profile and check-in, contraception plan),
--      a NEW mental-health screen (PHQ-9, GAD-7, EPDS) and a NEW device or wearable reading (wearable_readings, a vitals row with source wearable) is refused with the
--      stable message consent_required:<type>. With the yes it is saved; after withdrawal it is refused again.
--   2. Existing records stay readable by their owner after withdrawal (care is not reduced), and nothing here reads the matrix in a care-access function.
--   3. Required-for-care data is not gated (a manual blood pressure reading saves with no matrix event at all). Fixtures and migrations (database role none) are exempt.
--   4. One source of truth for device data: device_data_consent_in_force follows the matrix cell, only the service role can ask, and an old in-force wearable_device_data
--      consent is carried over into the matrix by the migration (0 expected on a fresh database).
--   5. SABOTAGE: the guard emptied, the wearable trigger dropped, and the reproductive trigger dropped; the matching checks flip.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;

create function pg_temp.f(p text) returns uuid language sql as $$ select v from fx where k = p $$;
create function pg_temp.setf(p text, p_v uuid) returns void language sql as
$$ insert into fx values (p, p_v) on conflict (k) do update set v = excluded.v $$;
create function pg_temp.ck(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('real', p_name, p_expected, p_actual) $$;
create function pg_temp.act(p_uid uuid) returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
end $f$;
create function pg_temp.back() returns void language plpgsql as
$f$ begin reset role; perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.role', '', true); end $f$;
create function pg_temp.q_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlerrm; end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.sqlstate_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql; r := 'ok'; exception when others then r := sqlstate; end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.as_service(p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  set local role service_role;
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlerrm; end;
  reset role;
  return r;
end $f$;
create function pg_temp.state_as_service(p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  set local role service_role;
  begin execute p_sql; r := 'ok'; exception when others then r := sqlstate; end;
  reset role;
  return r;
end $f$;
create function pg_temp.try_anon(p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
  begin execute p_sql; r := 'ok'; exception when others then r := sqlstate; end;
  reset role;
  return r;
end $f$;
create function pg_temp.try_sql(p_sql text) returns text language plpgsql as
$f$ begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text, p_sex text default 'female', p_age integer default 45) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's46-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, sex, is_test)
  values (v, p_org, p_role::public.user_role, 'S46 ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'),
          (current_date - make_interval(years => p_age, days => 30))::date, p_sex::public.sex, true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone,
     date_of_birth = excluded.date_of_birth, sex = excluded.sex;
  return v;
end $f$;
create function pg_temp.mkdoc(p_org uuid, p_label text, p_tier text, p_admin uuid) returns uuid
language plpgsql as $f$
declare v uuid; s uuid;
begin
  v := pg_temp.mkuser(p_org, p_label, 'clinician', 'male', 40);
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
  values (p_org, v, 'S46 ' || p_label, 'MDCN', 'S46-' || p_label || '-' || substr(v::text, 1, 8), true, 'active', now(), p_admin,
      p_tier::public.doctor_tier, 'contracted'::public.staff_employment_type,
      case when p_tier in ('senior_medical_officer', 'chief_medical_officer') then 2 else 1 end, true, p_admin, true)
  returning id into s;
  insert into public.clinician_competencies (organisation_id, clinical_staff_id, competency_code, granted_by, is_test)
  values (p_org, s, 'result_review', p_admin, true);
  return v;
end $f$;
create function pg_temp.go_real(p_uid uuid) returns void language sql as $$ update public.profiles set is_test = false where id = p_uid $$;
create function pg_temp.guards_on(p_keys text[]) returns void language plpgsql as
$f$ begin
  execute format($q$create or replace function private.go_live_guard_on(p_key text) returns boolean language sql stable security definer set search_path = ''
    as $b$select p_key = any (%L::text[])$b$$q$, p_keys);
end $f$;
create function pg_temp.mkpatient(p_label text, p_with_doc boolean default true) returns uuid language plpgsql as
$f$ declare v uuid;
begin
  v := pg_temp.mkuser(pg_temp.f('org'), p_label, 'patient', 'female', 45);
  if p_with_doc then
    insert into public.care_team_assignment (organisation_id, patient_id, clinician_id, clinical_director_id) values (pg_temp.f('org'), v, pg_temp.f('doc'), pg_temp.f('doc'));
  end if;
  return v;
end $f$;
create function pg_temp.sresult(p_pat uuid, p_code text, p_status text, p_age interval) returns void language sql as
$$ insert into public.screening_results (organisation_id, patient_id, screen_type_code, result_status, created_at)
   values (pg_temp.f('org'), p_pat, p_code, p_status::public.result_status, now() - p_age) $$;
create function pg_temp.scomp(p_pat uuid, p_code text, p_age interval) returns void language sql as
$$ insert into public.screening_completions (organisation_id, patient_id, screen_type_id, performed_date)
   values (pg_temp.f('org'), p_pat, (select id from public.screen_types where code = p_code), (now() - p_age)::date) $$;
create function pg_temp.excl(p_pat uuid, p_code text) returns text language sql as
$$ select coalesce((select e ->> 'reason' from jsonb_array_elements(private.compute_screening_order_exclusions(p_pat, pg_temp.f('org'), array[p_code])) e limit 1), 'none') $$;
-- one released lab result, items as jsonb [{code,num|text,unit,low,high,flag,sens}]
create function pg_temp.mkresult(p_pat uuid, p_released_at timestamptz, p_items jsonb) returns uuid language plpgsql as
$f$ declare v uuid; i jsonb; v_sens boolean;
begin
  v_sens := exists (select 1 from jsonb_array_elements(p_items) x where coalesce((x ->> 'sens')::boolean, false));
  insert into public.lab_results (organisation_id, patient_id, panel_code, panel_version_id, source, submitted_by_kind, release_state, received_at, is_test)
  values (pg_temp.f('org'), p_pat, 'membership_annual', (select id from public.lab_panel_versions where panel_code = 'membership_annual' and is_active),
          'portal_entry', 'partner', case when v_sens then 'clinician_disclosure_required' else 'awaiting_review' end, p_released_at - interval '1 day', true)
  returning id into v;
  for i in select * from jsonb_array_elements(p_items) loop
    insert into public.lab_result_items (lab_result_id, organisation_id, patient_id, analyte_code, value_numeric, value_text, unit, ref_low, ref_high, flag, sensitive_positive, is_test)
    values (v, pg_temp.f('org'), p_pat, i ->> 'code', (i ->> 'num')::numeric, i ->> 'text', coalesce(i ->> 'unit', 'mg/dL'),
            (i ->> 'low')::numeric, (i ->> 'high')::numeric, i ->> 'flag', coalesce((i ->> 'sens')::boolean, false), true);
  end loop;
  update public.lab_results set release_state = 'released', released_at = p_released_at, reviewed_by = pg_temp.f('doc'),
         disclosure_attested = v_sens, disclosure_method = case when v_sens then 'in_person' end
   where id = v;
  return v;
end $f$;

-- Fixtures ---------------------------------------------------------------------------------------------------------------------
do $$
declare v_org uuid; v_admin uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  perform pg_temp.setf('org', v_org);
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin', 'male', 40);
  perform pg_temp.setf('admin', v_admin);
  perform pg_temp.setf('cmo', pg_temp.mkdoc(v_org, 'cmo', 'chief_medical_officer', v_admin));
  perform pg_temp.setf('doc', pg_temp.mkdoc(v_org, 'doc', 'senior_medical_officer', v_admin));
  -- S46c: the sign-off task is offered to an employed named doctor first; a contracted one pulls from the pool with an availability block
  update public.clinical_staff set employment_type = 'employed', indemnity_exempt = false, indemnity_exempt_by = null where profile_id = pg_temp.f('doc');
  perform pg_temp.setf('stranger', pg_temp.mkdoc(v_org, 'stranger', 'senior_medical_officer', v_admin));
  perform pg_temp.setf('cc', pg_temp.mkdoc(v_org, 'cc', 'care_coordinator', v_admin));
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id, clinical_director_id, care_coordinator_id)
    select v_org, pg_temp.mkuser(v_org, 'ccpat', 'patient', 'female', 45), pg_temp.f('doc'), pg_temp.f('doc'), pg_temp.f('cc');
  perform pg_temp.setf('pat', pg_temp.mkpatient('pat'));
  perform pg_temp.setf('other', pg_temp.mkpatient('other'));
end $$;


create function pg_temp.attempt(p_role text, p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  if p_role = 'authenticated' then perform pg_temp.act(p_uid); else execute 'set local role ' || p_role; end if;
  begin execute p_sql; r := 'ok'; exception when others then r := sqlerrm; end;
  reset role; perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.role', '', true);
  return r;
end $f$;
create function pg_temp.set_cell(p_uid uuid, p_type text, p_on boolean) returns text language sql as
$$ select pg_temp.attempt('authenticated', p_uid, format('select public.set_consent_cell(%L, ''care'', %L)', p_type, p_on)) $$;

do $$
declare p uuid := pg_temp.mkpatient('consent_p'); q uuid := pg_temp.mkpatient('consent_q'); v_org uuid := pg_temp.f('org'); v_conn uuid; v_prof uuid; i integer; t text;
  v_tables text[] := array['reproductive_health_profiles', 'menstrual_cycles', 'menstrual_daily_logs', 'patient_pregnancy', 'postnatal_profiles', 'contraception_plans'];
  v_sql text[];
begin
  v_sql := array[
    format('insert into public.reproductive_health_profiles (organisation_id, patient_id) values (%L, %L)', v_org, p),
    format('insert into public.menstrual_cycles (organisation_id, patient_id, period_start_date) values (%L, %L, current_date)', v_org, p),
    format('insert into public.menstrual_daily_logs (organisation_id, patient_id, log_date) values (%L, %L, current_date)', v_org, p),
    format('insert into public.patient_pregnancy (organisation_id, patient_id) values (%L, %L)', v_org, p),
    format('insert into public.postnatal_profiles (organisation_id, patient_id, delivery_date) values (%L, %L, current_date)', v_org, p),
    format('insert into public.contraception_plans (organisation_id, patient_id, method_code) values (%L, %L, %L)', v_org, p, 'combined_pill')];

  -- 1a. reproductive: refused without the yes, for every table, as the patient
  for i in 1..array_length(v_tables, 1) loop
    perform pg_temp.ck('refused without consent: ' || v_tables[i], 'consent_required:reproductive', pg_temp.attempt('authenticated', p, v_sql[i]));
  end loop;
  perform pg_temp.ck('...and nothing was saved', '0', (select count(*)::text from public.menstrual_cycles where patient_id = p));
  perform pg_temp.ck('the person says yes on first use', 'ok', pg_temp.set_cell(p, 'reproductive', true));
  for i in 1..array_length(v_tables, 1) loop
    perform pg_temp.ck('saved with consent: ' || v_tables[i], 'ok', pg_temp.attempt('authenticated', p, v_sql[i]));
  end loop;
  perform pg_temp.ck('postnatal check-in too (needs the profile)', 'ok',
    pg_temp.attempt('authenticated', p, format('insert into public.postnatal_checkins (organisation_id, patient_id, postnatal_profile_id, checkin_window) values (%L, %L, %L, %L)', v_org, p, (select id from public.postnatal_profiles where patient_id = p), 'week_1')));
  perform pg_temp.ck('control: another person who has not said yes is still refused', 'consent_required:reproductive',
    pg_temp.attempt('authenticated', q, format('insert into public.menstrual_cycles (organisation_id, patient_id, period_start_date) values (%L, %L, current_date)', v_org, q)));
  perform pg_temp.ck('the person withdraws', 'ok', pg_temp.set_cell(p, 'reproductive', false));
  perform pg_temp.ck('after withdrawal a NEW record is refused again', 'consent_required:reproductive',
    pg_temp.attempt('authenticated', p, format('insert into public.menstrual_daily_logs (organisation_id, patient_id, log_date) values (%L, %L, current_date + 1)', v_org, p)));
  perform pg_temp.ck('...but the EXISTING records are still there and still readable for care', '1,1',
    pg_temp.q_as(p, 'select count(*)::text from public.menstrual_cycles') || ',' || pg_temp.q_as(p, 'select count(*)::text from public.reproductive_health_profiles'));
  perform pg_temp.ck('withdrawal stops that feature only: vitals (required for care) still save with no matrix event at all', 'ok',
    pg_temp.attempt('authenticated', p, format('insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, source) values (%L, %L, ''blood_pressure'', 120, 80, ''manual'')', v_org, p)));

  -- 1b. mental health
  perform pg_temp.ck('mental health screen refused without consent (PHQ-9)', 'consent_required:mental_health',
    pg_temp.attempt('service_role', null, format('insert into public.mental_health_screens (organisation_id, patient_id, instrument, total_score, severity_band) values (%L, %L, ''phq9'', 4, ''minimal'')', v_org, p)));
  perform pg_temp.ck('...and GAD-7', 'consent_required:mental_health',
    pg_temp.attempt('service_role', null, format('insert into public.mental_health_screens (organisation_id, patient_id, instrument, total_score, severity_band) values (%L, %L, ''gad7'', 4, ''minimal'')', v_org, p)));
  perform pg_temp.ck('yes, then it saves', 'ok,ok', pg_temp.set_cell(p, 'mental_health', true) || ',' ||
    pg_temp.attempt('service_role', null, format('insert into public.mental_health_screens (organisation_id, patient_id, instrument, total_score, severity_band) values (%L, %L, ''phq9'', 4, ''minimal'')', v_org, p)));
  perform pg_temp.ck('the reproductive "no" did not touch mental health, and vice versa (independent cells)', 'false,true',
    private.consent_in_force(p, 'reproductive', 'care')::text || ',' || private.consent_in_force(p, 'mental_health', 'care')::text);
  perform pg_temp.set_cell(p, 'mental_health', false);
  perform pg_temp.ck('after withdrawal a new screen is refused, the old one is still readable', 'consent_required:mental_health,1',
    pg_temp.attempt('service_role', null, format('insert into public.mental_health_screens (organisation_id, patient_id, instrument, total_score, severity_band) values (%L, %L, ''gad7'', 2, ''minimal'')', v_org, p)) || ',' ||
    pg_temp.q_as(p, 'select count(*)::text from public.mental_health_screens'));

  -- 1c. device data
  insert into public.wearable_connections (organisation_id, patient_id, provider) values (v_org, p, 'oura') returning id into v_conn;
  perform pg_temp.ck('cloud ingest (service role) refused without consent: wearable_readings', 'consent_required:device_data',
    pg_temp.attempt('service_role', null, format('insert into public.wearable_readings (organisation_id, connection_id, reading_type, value, recorded_at) values (%L, %L, ''steps'', 100, now())', v_org, v_conn)));
  perform pg_temp.ck('...and a vitals row from a wearable', 'consent_required:device_data',
    pg_temp.attempt('service_role', null, format('insert into public.vitals_readings (organisation_id, patient_id, vital_type, pulse_bpm, source) values (%L, %L, ''pulse'', 70, ''wearable'')', v_org, p)));
  perform pg_temp.ck('control: a clinical device reading (source device) is a vital and is not gated', 'ok',
    pg_temp.attempt('service_role', null, format('insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, source) values (%L, %L, ''blood_pressure'', 118, 76, ''device'')', v_org, p)));
  perform pg_temp.ck('device_data_consent_in_force follows the matrix: off', 'false', (select public.device_data_consent_in_force(p)::text));
  perform pg_temp.set_cell(p, 'device_data', true);
  perform pg_temp.ck('...on after the person says yes', 'true', (select public.device_data_consent_in_force(p)::text));
  perform pg_temp.ck('with the yes: wearable_readings saves', 'ok',
    pg_temp.attempt('service_role', null, format('insert into public.wearable_readings (organisation_id, connection_id, reading_type, value, recorded_at) values (%L, %L, ''steps'', 100, now())', v_org, v_conn)));
  perform pg_temp.ck('with the yes: a wearable vital saves', 'ok',
    pg_temp.attempt('service_role', null, format('insert into public.vitals_readings (organisation_id, patient_id, vital_type, pulse_bpm, source) values (%L, %L, ''pulse'', 70, ''wearable'')', v_org, p)));
  perform pg_temp.ck('only the service role can ask the single source of truth', 'false,false',
    has_function_privilege('authenticated', 'public.device_data_consent_in_force(uuid)', 'EXECUTE')::text || ',' || has_function_privilege('anon', 'public.device_data_consent_in_force(uuid)', 'EXECUTE')::text);
  perform pg_temp.ck('migrations and fixtures (no API role) are exempt', 'ok',
    pg_temp.try_sql(format('insert into public.menstrual_cycles (organisation_id, patient_id, period_start_date) values (%L, %L, current_date - 40)', v_org, q)));
  perform pg_temp.ck('the old wearable_device_data consent no longer decides anything: an accepted old row does not turn device_data on', 'false',
    (select (private.consent_in_force(q, 'device_data', 'care'))::text));
  perform pg_temp.setf('q', q); perform pg_temp.setf('p', p);
end $$;

-- Sabotage ------------------------------------------------------------------------------------------------------------------------------
do $$
declare p uuid := pg_temp.mkpatient('sabA'); v_org uuid := pg_temp.f('org');
begin
  create or replace function private.optional_feature_consent_guard() returns trigger language plpgsql as $f$ begin return new; end $f$;
  insert into results values ('sabotaged', 'refused without consent: menstrual_cycles', 'consent_required:reproductive',
    pg_temp.attempt('authenticated', p, format('insert into public.menstrual_cycles (organisation_id, patient_id, period_start_date) values (%L, %L, current_date)', v_org, p)));
  insert into results values ('sabotaged', 'mental health screen refused without consent (PHQ-9)', 'consent_required:mental_health',
    pg_temp.attempt('service_role', null, format('insert into public.mental_health_screens (organisation_id, patient_id, instrument, total_score, severity_band) values (%L, %L, ''phq9'', 4, ''minimal'')', v_org, p)));
end $$;
do $$
declare p uuid := pg_temp.mkpatient('sabB'); v_org uuid := pg_temp.f('org'); v_conn uuid;
begin
  insert into public.wearable_connections (organisation_id, patient_id, provider) values (v_org, p, 'fitbit') returning id into v_conn;
  drop trigger wearable_readings_consent on public.wearable_readings;
  insert into results values ('sabotaged', 'cloud ingest (service role) refused without consent: wearable_readings', 'consent_required:device_data',
    pg_temp.attempt('service_role', null, format('insert into public.wearable_readings (organisation_id, connection_id, reading_type, value, recorded_at) values (%L, %L, ''steps'', 100, now())', v_org, v_conn)));
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S47d proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ')
         from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 3 then raise exception 'VACUOUS TEST: the sabotage flipped % of 3 checks', v_caught; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;

rollback;
