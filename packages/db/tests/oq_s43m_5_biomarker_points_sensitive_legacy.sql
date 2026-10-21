-- OQ-S43m-5 proof: private.biomarker_points excludes a sensitive_positive lab_analyte_readings row (legacy_report branch), as the
-- lab_result_items branch always did (INV-04). Read through public.patient_biomarker_trend / patient_biomarker_list.
-- One rolled-back transaction. Sections:
--   1. Fixture: an ordinary legacy HbA1c and a numeric anti-HCV result (the S51 trigger flags it sensitive_positive).
--   2. The patient and a caregiver holding labs_results: the HbA1c trend has its point, the anti-HCV trend has none, the list omits the screening code.
--   3. A caregiver without labs_results is refused; a result-items sensitive row is still excluded (the other branch is intact).
--   4. SABOTAGE: the legacy-branch filter is reverted; the anti-HCV point must appear for both readers (a test that cannot fail is not a test).
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
create function pg_temp.mkuser(p_org uuid, p_label text) returns uuid language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's43m5-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, 'patient'::public.user_role, 'S43m5 ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true)
  on conflict (id) do update set is_test = true, is_active = true, phone = excluded.phone;
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

do $$
declare v_org uuid; v_pat uuid; v_cg uuid; v_cg_none uuid; v_rel uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_pat := pg_temp.mkuser(v_org, 'pat');
  v_cg := pg_temp.mkuser(v_org, 'caregiver');
  v_cg_none := pg_temp.mkuser(v_org, 'caregiver-none');
  perform pg_temp.setf('pat', v_pat);
  perform pg_temp.setf('cg', v_cg);
  perform pg_temp.setf('cg_none', v_cg_none);
  perform pg_temp.grant_to(v_pat, v_cg, array['labs_results']);
  perform pg_temp.grant_to(v_pat, v_cg_none, array['vitals_readings']);

  insert into public.lab_analyte_readings (organisation_id, patient_id, code, value, value_text, unit) values
    (v_org, v_pat, 'hba1c', 6.1, null, '%'),
    (v_org, v_pat, 'anti_hcv_numeric', 3.2, null, 'S/CO');

  set local session_replication_role = replica;
  insert into public.lab_results (organisation_id, patient_id, source, submitted_by_kind, release_state, release_reason, released_at, is_test)
    values (v_org, v_pat, 'pdf_upload', 'tarragon_team', 'released', 'RES-001', now(), true) returning id into v_rel;
  insert into public.lab_result_items (lab_result_id, organisation_id, patient_id, analyte_code, value_numeric, value_text, unit, flag, sensitive_positive, is_test)
    values (v_rel, v_org, v_pat, 'hbsag_index', 8.2, null, '', 'positive', true, true);
  set local session_replication_role = origin;
end $$;

-- 1. Fixture ---------------------------------------------------------------------------------------------------------------
select pg_temp.ck('real', 'the S51 trigger flagged the legacy anti-HCV row', 'true',
  (select sensitive_positive::text from public.lab_analyte_readings where patient_id = pg_temp.f('pat') and code = 'anti_hcv_numeric'));
select pg_temp.ck('real', 'the legacy HbA1c row is not flagged', 'false',
  (select sensitive_positive::text from public.lab_analyte_readings where patient_id = pg_temp.f('pat') and code = 'hba1c'));

-- 2. Patient and caregiver --------------------------------------------------------------------------------------------------
select pg_temp.ck('real', 'patient: HbA1c trend has its point', '1',
  pg_temp.q_as(pg_temp.f('pat'), $q$select jsonb_array_length(public.patient_biomarker_trend('hba1c') -> 'points')::text$q$));
select pg_temp.ck('real', 'patient: numeric anti-HCV legacy row is not in the trend', '0',
  pg_temp.q_as(pg_temp.f('pat'), $q$select jsonb_array_length(public.patient_biomarker_trend('anti_hcv_numeric') -> 'points')::text$q$));
select pg_temp.ck('real', 'caregiver: HbA1c trend has its point', '1',
  pg_temp.q_as(pg_temp.f('cg'), format($q$select jsonb_array_length(public.patient_biomarker_trend('hba1c', %L) -> 'points')::text$q$, pg_temp.f('pat'))));
select pg_temp.ck('real', 'caregiver: numeric anti-HCV legacy row is not in the trend', '0',
  pg_temp.q_as(pg_temp.f('cg'), format($q$select jsonb_array_length(public.patient_biomarker_trend('anti_hcv_numeric', %L) -> 'points')::text$q$, pg_temp.f('pat'))));
select pg_temp.ck('real', 'patient: the list names HbA1c and neither screening code', 'hba1c',
  pg_temp.q_as(pg_temp.f('pat'), $q$select string_agg(e ->> 'code', ',') from jsonb_array_elements(public.patient_biomarker_list()) e$q$));

-- 3. Gate and the other branch ---------------------------------------------------------------------------------------------------
select pg_temp.ck('real', 'caregiver without labs_results is refused', 'ERR:42501',
  pg_temp.q_as(pg_temp.f('cg_none'), format($q$select public.patient_biomarker_trend('hba1c', %L)::text$q$, pg_temp.f('pat'))));
select pg_temp.ck('real', 'a sensitive result item is still excluded', '0',
  pg_temp.q_as(pg_temp.f('pat'), $q$select jsonb_array_length(public.patient_biomarker_trend('hbsag_index') -> 'points')::text$q$));

-- 4. SABOTAGE: revert the legacy-branch filter ------------------------------------------------------------------------------------
create or replace function private.biomarker_points(p_patient uuid, p_code text)
returns table (taken_at timestamptz, value numeric, unit text, ref_low numeric, ref_high numeric, ref_text text, flag text, source text, laboratory text)
language sql stable security definer set search_path = ''
as $$
  select r.released_at, i.value_numeric, i.unit, i.ref_low, i.ref_high, null::text, i.flag, 'lab_result'::text, null::text
    from public.lab_result_items i join public.lab_results r on r.id = i.lab_result_id
   where i.patient_id = p_patient and lower(i.analyte_code) = lower(p_code) and i.value_numeric is not null
     and r.release_state = 'released' and r.withdrawn_at is null and r.superseded_by is null and not i.sensitive_positive
  union all
  select l.taken_at, l.value, l.unit, l.reference_range_low, l.reference_range_high, l.reference_range_text, l.abnormal_flag::text, 'legacy_report'::text, l.laboratory
    from public.lab_analyte_readings l
   where l.patient_id = p_patient and lower(l.code) = lower(p_code) and l.value is not null
     and l.report_status in ('final', 'corrected', 'amended')
$$;
select pg_temp.ck('sabotaged', 'patient: numeric anti-HCV legacy row is not in the trend', '0',
  pg_temp.q_as(pg_temp.f('pat'), $q$select jsonb_array_length(public.patient_biomarker_trend('anti_hcv_numeric') -> 'points')::text$q$));
select pg_temp.ck('sabotaged', 'caregiver: numeric anti-HCV legacy row is not in the trend', '0',
  pg_temp.q_as(pg_temp.f('cg'), format($q$select jsonb_array_length(public.patient_biomarker_trend('anti_hcv_numeric', %L) -> 'points')::text$q$, pg_temp.f('pat'))));

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'OQ-S43m-5 proof FAILED: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected is distinct from actual;
  if v_caught < 2 then raise exception 'VACUOUS TEST: the sabotage flipped % of 2 checks', v_caught; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;

rollback;
