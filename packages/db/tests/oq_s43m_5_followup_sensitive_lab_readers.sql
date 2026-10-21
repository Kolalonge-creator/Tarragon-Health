-- OQ-S43m-5 follow-up proof (migration *_oq_s43m_5_followup_sensitive_lab_readers.sql): every other reader of lab_analyte_readings respects
-- sensitive_positive (INV-04). One rolled-back transaction. Sections:
--   1. Fixture: patient, caregiver (labs_results), doctor on the care team, another patient; an ordinary HbA1c, a numeric anti-HCV (flagged by the
--      S51 trigger), an explicitly flagged innocuous-code marker, and corrected rows (one sensitive, one ordinary).
--   2. Direct table reads: patient, caregiver and the other patient never see a sensitive row; the care-team doctor sees all of them.
--   3. Definer readers: share link, health-report series, clinical_value_history and my_corrected_record_entries.
--   4. SABOTAGE: the policy is dropped and each function loses its filter; the matching checks must flip (a test that cannot fail is not a test).
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;
create function pg_temp.f(p text) returns uuid language sql as $$ select v from fx where k = p $$;
create function pg_temp.setf(p text, p_v uuid) returns void language sql as
$$ insert into fx values (p, p_v) on conflict (k) do update set v = excluded.v $$;
create function pg_temp.ck(p_phase text, p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values (p_phase, p_name, p_expected, p_actual) $$;
create function pg_temp.q_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlstate; end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.role', '', true);
  return r;
end $f$;
create function pg_temp.q_anon(p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlstate; end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return r;
end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's43m5f-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'S43m5f ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true)
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, is_test = true, is_active = true, phone = excluded.phone;
  return v;
end $f$;
create function pg_temp.grant_to(p_patient uuid, p_grantee uuid, p_cats text[]) returns void language plpgsql as
$f$ declare v uuid; c text;
begin
  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by)
  values (p_patient, p_grantee, 'view'::public.profile_access_level, p_patient) returning id into v;
  perform set_config('request.jwt.claims', json_build_object('sub', p_patient)::text, true);
  foreach c in array p_cats loop
    insert into public.profile_access_categories (profile_access_id, category) values (v, c::public.care_access_category);
  end loop;
  perform set_config('request.jwt.claims', '', true);
end $f$;
-- sabotage helper: remove one filter fragment from a live function body and re-create it
create function pg_temp.strip_filter(p_sig regprocedure, p_fragment text) returns void language plpgsql as
$f$ declare v_def text; v_new text;
begin
  v_def := pg_get_functiondef(p_sig);
  v_new := replace(v_def, p_fragment, '');
  if v_new = v_def then raise exception 'sabotage fragment not found in %', p_sig; end if;
  execute v_new;
end $f$;

do $$
declare v_org uuid; v_pat uuid; v_oth uuid; v_cg uuid; v_doc uuid; v_sens uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_pat := pg_temp.mkuser(v_org, 'pat', 'patient');   perform pg_temp.setf('pat', v_pat);
  v_oth := pg_temp.mkuser(v_org, 'other', 'patient'); perform pg_temp.setf('oth', v_oth);
  v_cg  := pg_temp.mkuser(v_org, 'cg', 'patient');    perform pg_temp.setf('cg', v_cg);
  v_doc := pg_temp.mkuser(v_org, 'doc', 'clinician'); perform pg_temp.setf('doc', v_doc);
  perform pg_temp.grant_to(v_pat, v_cg, array['labs_results']);
  insert into public.clinical_staff (organisation_id, profile_id, full_name, active, license_verified_at, doctor_tier)
    values (v_org, v_doc, 'S43m5f Doctor', true, now(), 'senior_medical_officer');
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id, assigned_at)
    values (v_org, v_pat, v_doc, now()) on conflict (patient_id) do update set clinician_id = v_doc;

  insert into public.lab_analyte_readings (organisation_id, patient_id, code, value, unit) values
    (v_org, v_pat, 'hba1c', 6.1, '%'),
    (v_org, v_pat, 'anti_hcv_numeric', 3.2, 'S/CO'),
    (v_org, v_oth, 'hba1c', 5.4, '%');
  insert into public.lab_analyte_readings (organisation_id, patient_id, code, value, unit, sensitive_positive)
    values (v_org, v_pat, 'xyz_marker', 9, 'u', true);
  select id into v_sens from public.lab_analyte_readings where patient_id = v_pat and code = 'anti_hcv_numeric';
  perform pg_temp.setf('sens', v_sens);

  -- corrected (superseded) rows, written with triggers off: the correction guard is not under test here
  set local session_replication_role = replica;
  insert into public.lab_analyte_readings (organisation_id, patient_id, code, value, unit, sensitive_positive, correction_status, correction_reason, corrected_at)
    values (v_org, v_pat, 'anti_hcv_numeric', 2.9, 'S/CO', true, 'corrected', 'entered the wrong value', now()),
           (v_org, v_pat, 'hba1c', 6.0, '%', false, 'corrected', 'entered the wrong value', now());
  set local session_replication_role = origin;
end $$;

-- 2. Direct table reads -----------------------------------------------------------------------------------------------------
select pg_temp.ck('real', 'the S51 trigger flagged the numeric anti-HCV row', 'true',
  (select sensitive_positive::text from public.lab_analyte_readings where id = pg_temp.f('sens')));
select pg_temp.ck('real', 'patient sees only the ordinary reading', 'hba1c',
  pg_temp.q_as(pg_temp.f('pat'), 'select string_agg(code, '','' order by code) from public.lab_analyte_readings'));
select pg_temp.ck('real', 'caregiver with labs_results sees only the ordinary reading', 'hba1c',
  pg_temp.q_as(pg_temp.f('cg'), format('select string_agg(code, '','' order by code) from public.lab_analyte_readings where patient_id = %L', pg_temp.f('pat'))));
select pg_temp.ck('real', 'the other patient sees only their own reading', 'hba1c',
  pg_temp.q_as(pg_temp.f('oth'), 'select string_agg(code, '','' order by code) from public.lab_analyte_readings'));
select pg_temp.ck('real', 'the care-team doctor sees the sensitive rows as well', 'anti_hcv_numeric,hba1c,xyz_marker',
  pg_temp.q_as(pg_temp.f('doc'), format('select string_agg(code, '','' order by code) from public.lab_analyte_readings where patient_id = %L', pg_temp.f('pat'))));

-- 3. Definer readers ---------------------------------------------------------------------------------------------------------
create function pg_temp.share_codes() returns text language plpgsql as $f$
declare s text; t text; r text;
begin
  s := pg_temp.q_as(pg_temp.f('pat'), $q$select public.create_record_share(array['lab_results']::text[], 24, false, false)::text$q$);
  if s like 'ERR:%' then return s; end if;
  t := s::jsonb ->> 'token';
  if t is null then return 'NO-TOKEN:' || coalesce(s, 'null'); end if;
  r := pg_temp.q_anon(format($q$select (select string_agg(e ->> 'code', ',' order by e ->> 'code') from jsonb_array_elements(public.record_share_by_token(%L, null, 'c1')::jsonb -> 'lab_results') e)$q$, t));
  return r;
end $f$;
select pg_temp.ck('real', 'a share link shows only the ordinary reading', 'hba1c', pg_temp.share_codes());
select pg_temp.ck('real', 'health-report series: a flagged reading under an innocuous code is excluded', '0',
  (select count(*)::text from private.hr_biomarker_points(pg_temp.f('pat'), 'xyz_marker')));
select pg_temp.ck('real', 'health-report series: the ordinary reading is still there', 'true',
  (select (count(*) > 0)::text from private.hr_biomarker_points(pg_temp.f('pat'), 'hba1c')));
select pg_temp.ck('real', 'clinical_value_history: patient gets nothing for a sensitive row', '0',
  pg_temp.q_as(pg_temp.f('pat'), format($q$select jsonb_array_length(public.clinical_value_history('lab_analyte_readings', %L))::text$q$, pg_temp.f('sens'))));
select pg_temp.ck('real', 'clinical_value_history: the doctor sees the sensitive row', '1',
  pg_temp.q_as(pg_temp.f('doc'), format($q$select jsonb_array_length(public.clinical_value_history('lab_analyte_readings', %L))::text$q$, pg_temp.f('sens'))));
select pg_temp.ck('real', 'my_corrected_record_entries: only the ordinary corrected reading', '1',
  pg_temp.q_as(pg_temp.f('pat'), $q$select jsonb_array_length(public.my_corrected_record_entries() -> 'lab_analyte_readings')::text$q$));

-- 4. SABOTAGE ---------------------------------------------------------------------------------------------------------------------
drop policy lab_analyte_readings_hide_sensitive on public.lab_analyte_readings;
select pg_temp.strip_filter('public.record_share_by_token(text,text,text)'::regprocedure,
  ' and not sensitive_positive');
select pg_temp.strip_filter('private.hr_biomarker_points(uuid,text)'::regprocedure, 'and not l.sensitive_positive');
select pg_temp.strip_filter('public.clinical_value_history(text,uuid)'::regprocedure,
  $q$and ($2 or coalesce(to_jsonb(t) ->> 'sensitive_positive', 'false') <> 'true')$q$);
select pg_temp.strip_filter('public.my_corrected_record_entries(uuid)'::regprocedure,
  $q$and coalesce(to_jsonb(x) ->> 'sensitive_positive', 'false') <> 'true'$q$);

select pg_temp.ck('sabotaged', 'patient sees only the ordinary reading', 'hba1c',
  pg_temp.q_as(pg_temp.f('pat'), 'select string_agg(code, '','' order by code) from public.lab_analyte_readings'));
select pg_temp.ck('sabotaged', 'caregiver with labs_results sees only the ordinary reading', 'hba1c',
  pg_temp.q_as(pg_temp.f('cg'), format('select string_agg(code, '','' order by code) from public.lab_analyte_readings where patient_id = %L', pg_temp.f('pat'))));
select pg_temp.ck('sabotaged', 'a share link shows only the ordinary reading', 'hba1c', pg_temp.share_codes());
select pg_temp.ck('sabotaged', 'health-report series: a flagged reading under an innocuous code is excluded', '0',
  (select count(*)::text from private.hr_biomarker_points(pg_temp.f('pat'), 'xyz_marker')));
select pg_temp.ck('sabotaged', 'clinical_value_history: patient gets nothing for a sensitive row', '0',
  pg_temp.q_as(pg_temp.f('pat'), format($q$select jsonb_array_length(public.clinical_value_history('lab_analyte_readings', %L))::text$q$, pg_temp.f('sens'))));
select pg_temp.ck('sabotaged', 'my_corrected_record_entries: only the ordinary corrected reading', '1',
  pg_temp.q_as(pg_temp.f('pat'), $q$select jsonb_array_length(public.my_corrected_record_entries() -> 'lab_analyte_readings')::text$q$));

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'OQ-S43m-5 follow-up proof FAILED: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected is distinct from actual;
  if v_caught < 6 then
    raise exception 'VACUOUS TEST: the sabotage flipped % of 6 checks (%)', v_caught,
      (select string_agg(check_name, '; ') from results where phase = 'sabotaged' and expected is not distinct from actual);
  end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;

rollback;
