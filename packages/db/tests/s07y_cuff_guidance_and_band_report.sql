-- S07y proof: cuff size guidance, the patient's cuff record, the validated-device read, and the OQ-67 band comparison report
-- (migration *_s07y_cuff_guidance_and_bp_band_report.sql).
-- One rolled-back transaction. Proves:
--  * the cuff guidance ships unsigned and inactive; while unsigned the patient gets nothing back and cannot record a cuff; only the Chief Medical Officer can sign;
--  * the size lookup agrees with the TypeScript twin on every case in the parity block (packages/clinical/src/cuff-size.test.ts runs the same block);
--  * a recorded cuff keeps the S12b cuff_type vocabulary, is append-only, is readable by its patient and a tied clinician and by nobody else;
--  * the validated-device answer is "list_empty" when no reviewed device exists (never "not validated"), and "listed" / "not_listed" once one does;
--  * the OQ-67 report is closed to patients and coordinators, lists pregnancy as the reason a raised-in-pregnancy reading is placed higher, and changes no threshold.
-- SABOTAGE: (1) the size lookup stops rounding to a whole centimetre; (2) the pregnancy step is removed from the report. Both must flip.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;
create function pg_temp.setf(p text, p_v uuid) returns void language sql as $$ insert into fx values (p, p_v) on conflict (k) do update set v = excluded.v $$;
create function pg_temp.f(p text) returns uuid language sql as $$ select v from fx where k = p $$;
create function pg_temp.ck(p_phase text, p_name text, p_expected text, p_actual text) returns void language sql as $$ insert into results values (p_phase, p_name, p_expected, p_actual) $$;

create function pg_temp.mkuser(p_org uuid, p_label text, p_role text, p_test boolean default true) returns uuid language plpgsql as
$f$ declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's07y-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'S07y ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '35 years')::date, p_test)
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, is_test = excluded.is_test, is_active = true;
  return v;
end $f$;
create function pg_temp.mkdoc(p_org uuid, p_label text, p_tier text, p_admin uuid) returns uuid language plpgsql as
$f$ declare v uuid;
begin
  v := pg_temp.mkuser(p_org, p_label, 'clinician');
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
  values (p_org, v, 'S07y ' || p_label, 'MDCN', 'S07Y-' || p_label || '-' || substr(v::text, 1, 8), true, 'active', now(), p_admin,
      p_tier::public.doctor_tier, 'contracted'::public.staff_employment_type,
      case when p_tier in ('senior_medical_officer', 'chief_medical_officer') then 2 else 1 end, true, p_admin, true);
  return v;
end $f$;

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
create function pg_temp.as_anon(p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
  begin execute p_sql into r; exception when others then r := 'ERR ' || sqlstate; end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return r;
end $f$;

-- The size parity block (the same cases are in packages/clinical/src/cuff-size.test.ts)
create temp table parity(cm numeric, expect text) on commit drop;
grant all on parity to public;
-- parity-begin
insert into parity values (14, 'below_range'), (21.4, 'below_range'), (21.5, 'small_adult'), (22, 'small_adult'), (26.4, 'small_adult'), (26.5, 'adult'),
  (34, 'adult'), (34.4, 'adult'), (34.5, 'large_adult'), (44.4, 'large_adult'), (44.5, 'extra_large'), (52.4, 'extra_large'), (52.5, 'above_range'), (60, 'above_range');
-- parity-end

do $$
declare
  v_org uuid; v_admin uuid; v_cmo uuid; v_tied uuid; v_untied uuid; v_co uuid; v_p uuid; v_q uuid; v_real uuid; v_id uuid; v_pr uuid;
  v_cfg jsonb; r record; v_bad text; v_n bigint;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  v_cmo := pg_temp.mkdoc(v_org, 'cmo', 'chief_medical_officer', v_admin); perform pg_temp.setf('cmo', v_cmo);
  v_tied := pg_temp.mkdoc(v_org, 'tied', 'senior_medical_officer', v_admin);
  v_untied := pg_temp.mkdoc(v_org, 'untied', 'senior_medical_officer', v_admin);
  v_co := pg_temp.mkuser(v_org, 'coordinator', 'care_coordinator');
  v_p := pg_temp.mkuser(v_org, 'patient', 'patient'); v_q := pg_temp.mkuser(v_org, 'other patient', 'patient');
  v_real := pg_temp.mkuser(v_org, 'real patient', 'patient', false);
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id, care_coordinator_id, assigned_at) values (v_org, v_p, v_tied, v_co, now());
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id, care_coordinator_id, assigned_at) values (v_org, v_real, v_tied, v_co, now());
  select id into v_id from public.bp_cuff_guidance_signoffs where version = 1;

  -- A. unsigned and hidden
  perform pg_temp.ck('real', 'A1 ships unsigned and inactive', 'true', (select (not is_active and approved_by is null)::text from public.bp_cuff_guidance_signoffs where version = 1));
  perform pg_temp.ck('real', 'A2 the patient gets nothing back while unsigned', 'null', coalesce(pg_temp.as_user(v_p, 'select public.my_bp_cuff_guidance()::text'), 'null'));
  perform pg_temp.ck('real', 'A3 recording a cuff is refused while unsigned (55000)', 'ERR 55000', pg_temp.as_user(v_p, $q$select public.record_my_bp_cuff('upper_arm', 'Test cuff', 30)::text$q$));
  perform pg_temp.ck('real', 'A4 a clinician who is not the CMO cannot sign (ERR)', 'true', (pg_temp.as_user(v_tied, format('select public.sign_bp_cuff_guidance(%L)::text', v_id)) ~ '^ERR')::text);
  perform pg_temp.ck('real', 'A5 anon cannot call the guidance or the report', 'true',
    ((pg_temp.as_anon('select public.my_bp_cuff_guidance()::text') ~ '^ERR') and (pg_temp.as_anon('select count(*)::text from public.bp_band_divergence_report(30)') ~ '^ERR'))::text);
  perform pg_temp.ck('real', 'A6 the CMO signs', 'ok', (select case when o ~ '^ERR' then o else 'ok' end from (select pg_temp.as_user(v_cmo, format('select public.sign_bp_cuff_guidance(%L)::text', v_id)) o) z));
  perform pg_temp.ck('real', 'A7 the guidance is returned once signed, with no cuff yet', 'true|null',
    (select ((j ->> 'version') = '1')::text || '|' || coalesce(j -> 'cuff', 'null'::jsonb)::text from (select pg_temp.as_user(v_p, 'select public.my_bp_cuff_guidance()::text')::jsonb j) z));

  -- A8. a malformed draft cannot be signed, however it got there (the structure is checked in the database, not only in the screen)
  insert into public.bp_cuff_guidance_signoffs (version, config) values
    (90, jsonb_build_object('sizes', jsonb_build_array(jsonb_build_object('key', 'a', 'minCm', 22, 'maxCm', 30), jsonb_build_object('key', 'b', 'minCm', 28, 'maxCm', 40)), 'measureMinCm', 15, 'measureMaxCm', 60, 'wordingSha256', repeat('a', 64))),
    (91, jsonb_build_object('sizes', jsonb_build_array(jsonb_build_object('key', 'a', 'minCm', 'x', 'maxCm', 30)), 'measureMinCm', 15, 'measureMaxCm', 60, 'wordingSha256', repeat('a', 64))),
    (92, jsonb_build_object('sizes', jsonb_build_array(jsonb_build_object('key', 'a', 'minCm', 22, 'maxCm', 30)), 'measureMinCm', 15, 'measureMaxCm', 60));
  perform pg_temp.ck('real', 'A8 overlapping sizes, a non-numeric bound and a missing wording pin are each refused at signing', 'ERR|ERR|ERR',
    (select string_agg(case when pg_temp.as_user(v_cmo, format('select public.sign_bp_cuff_guidance(%L)::text', id)) ~ '^ERR' then 'ERR' else 'signed' end, '|' order by version)
       from public.bp_cuff_guidance_signoffs where version in (90, 91, 92)));
  perform pg_temp.ck('real', 'A9 the signed version is still version 1 after those refusals', '1',
    (select version::text from public.bp_cuff_guidance_signoffs where is_active and approved_by is not null));

  -- B. size parity against the stored configuration
  v_cfg := (select config from public.bp_cuff_guidance_signoffs where version = 1);
  select string_agg(cm || ' expected ' || expect || ' got ' || coalesce(private.bp_cuff_size_key(cm, v_cfg), 'null'), '; ') into v_bad from parity where private.bp_cuff_size_key(cm, v_cfg) is distinct from expect;
  perform pg_temp.ck('real', 'B1 every size parity case agrees', 'none', coalesce(v_bad, 'none'));

  -- C. recording
  perform pg_temp.ck('real', 'C1 a cuff is recorded with its size and the device list is empty (never "not validated")', 'adult|list_empty',
    (select (j ->> 'size_key') || '|' || (j ->> 'device_list') from (select pg_temp.as_user(v_p, $q$select public.record_my_bp_cuff('upper_arm', 'Omron M2', 30)::text$q$)::jsonb j) z));
  perform pg_temp.ck('real', 'C2 an unknown cuff type is refused (22023)', 'ERR 22023', pg_temp.as_user(v_p, $q$select public.record_my_bp_cuff('finger', null, null)::text$q$));
  perform pg_temp.ck('real', 'C3 an implausible arm measurement is refused (22023)', 'ERR 22023', pg_temp.as_user(v_p, $q$select public.record_my_bp_cuff('upper_arm', null, 75)::text$q$));
  perform pg_temp.ck('real', 'C4 a model with no arm measurement is allowed and has no size', 'null', (select coalesce((j ->> 'size_key'), 'null') from (select pg_temp.as_user(v_p, $q$select public.record_my_bp_cuff('wrist', 'Wrist cuff X', null)::text$q$)::jsonb j) z));
  perform pg_temp.ck('real', 'C5 the newest record is the current one', 'wrist|Wrist cuff X', (select (j -> 'cuff' ->> 'cuff_type') || '|' || (j -> 'cuff' ->> 'model') from (select pg_temp.as_user(v_p, 'select public.my_bp_cuff_guidance()::text')::jsonb j) z));
  perform pg_temp.ck('real', 'C6 the cuff table is append-only', 'ERR 42501', 'pending');
  begin
    update public.patient_bp_cuffs set model_text = 'changed' where patient_id = v_p;
    update results set actual = 'updated' where check_name like 'C6%';
  exception when others then update results set actual = 'ERR ' || sqlstate where check_name like 'C6%';
  end;
  perform pg_temp.ck('real', 'C7 the patient reads her own cuff rows; another patient reads none', '2|0',
    (select count(*) from public.patient_bp_cuffs where patient_id = v_p)::text || '|' || pg_temp.as_user(v_q, format('select count(*)::text from public.patient_bp_cuffs where patient_id = %L', v_p)));
  perform pg_temp.ck('real', 'C8 a tied clinician reads them; an untied clinician and a patient writer cannot insert directly', '2|0|true',
    pg_temp.as_user(v_tied, format('select count(*)::text from public.patient_bp_cuffs where patient_id = %L', v_p)) || '|' ||
    pg_temp.as_user(v_untied, format('select count(*)::text from public.patient_bp_cuffs where patient_id = %L', v_p)) || '|' ||
    (pg_temp.as_user(v_p, format($q$insert into public.patient_bp_cuffs (organisation_id, patient_id, cuff_type, guidance_version) values (%L, %L, 'upper_arm', 1)$q$, v_org, v_p)) ~ '^ERR')::text);
  perform pg_temp.ck('real', 'C9 cuff_type values equal the S12b vitals_readings values', 'true',
    ((select array_agg(m[1] order by m[1]) from regexp_matches((select pg_get_constraintdef(oid) from pg_constraint where conname = 'patient_bp_cuffs_cuff_type_check'), '''([a-z_]+)''', 'g') m)
     = (select array_agg(m[1] order by m[1]) from regexp_matches((select pg_get_constraintdef(oid) from pg_constraint where conname = 'vitals_readings_cuff_type_check'), '''([a-z_]+)''', 'g') m))::text);

  -- D. the validated-device read, once a reviewed device exists
  update public.platform_modules set is_enabled = true, enabled_at = now(), enabled_by = v_admin where key = 'device_recommended_list';
  perform set_config('tarragon.device_catalog_review', 'on', true);
  insert into public.device_catalog (device_name, category, fulfillment_type, pairing_path, active, clinically_reviewed, validated_source_url, validation_basis, nafdac_number, reviewed_by, reviewed_at)
  values ('Proofcuff Z100', 'blood_pressure', 'recommend_only', 'manual_only', true, true, 'https://example.invalid/validation/z100', 'validatebp', 'A0-0000', v_cmo, now());
  perform set_config('tarragon.device_catalog_review', 'off', true);
  perform pg_temp.ck('real', 'D1 the exact reviewed model is listed (spaces and punctuation ignored); a variant, a longer description and another cuff are not_listed', 'listed|not_listed|not_listed|not_listed',
    private.bp_cuff_model_listing('Proofcuff Z-100') || '|' || private.bp_cuff_model_listing('Proofcuff Z-100 Basic') || '|' || private.bp_cuff_model_listing('my old Proofcuff Z100 wrist') || '|' || private.bp_cuff_model_listing('Some other cuff'));
  insert into public.device_catalog (device_name, category, fulfillment_type, pairing_path, active) values ('Draftcuff Q200', 'blood_pressure', 'recommend_only', 'manual_only', true);
  perform pg_temp.ck('real', 'D2 an unreviewed row never lists a model', 'not_listed', private.bp_cuff_model_listing('Draftcuff Q200'));
  update public.device_catalog set clinically_reviewed = false, reviewed_by = null, reviewed_at = null where device_name = 'Proofcuff Z100';
  perform pg_temp.ck('real', 'D3 with no reviewed row left the answer is list_empty', 'list_empty', private.bp_cuff_model_listing('Draftcuff Q200'));

  -- E. the OQ-67 report
  perform pg_temp.ck('real', 'E1 a patient and a coordinator are refused the report (42501)', 'ERR 42501|ERR 42501',
    pg_temp.as_user(v_p, 'select count(*)::text from public.bp_band_divergence_report(30)') || '|' || pg_temp.as_user(v_co, 'select count(*)::text from public.bp_band_divergence_report(30)'));
  update public.profiles set is_pregnant = true where id = v_real;
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, taken_at, source, position, arm)
  values (v_org, v_real, 'blood_pressure', 145, 92, now() - interval '1 hour', 'manual', 'seated', 'left');
  perform pg_temp.ck('real', 'E2 admin sees an amber app band placed at red in pregnancy, reason pregnancy', 'true',
    (pg_temp.as_user(v_admin, $q$select (count(*) filter (where app_band = 'amber' and pipeline_level = 'red' and cause = 'pregnancy') >= 1)::text from public.bp_band_divergence_report(30)$q$)));
  -- a corrected reading is excluded: mark the pregnancy reading as corrected and the pregnancy row for it must disappear
  select count(*) into v_n from public.bp_band_divergence_report(30) where false;
  perform pg_temp.ck('real', 'E2b pregnancy-reason count before marking the reading corrected is at least 1', 'true',
    pg_temp.as_user(v_admin, $q$select (coalesce(sum(readings), 0) >= 1)::text from public.bp_band_divergence_report(30) where cause = 'pregnancy'$q$));
  update public.vitals_readings set correction_status = 'entered_in_error' where patient_id = v_real;
  perform pg_temp.ck('real', 'E2c a corrected reading is excluded from the report', 'true',
    pg_temp.as_user(v_admin, $q$select (coalesce(sum(readings), 0) = 0)::text from public.bp_band_divergence_report(30) where cause = 'pregnancy' and app_band = 'amber' and pipeline_level = 'red'$q$));
  perform pg_temp.ck('real', 'E3 the Chief Medical Officer can read the report too', 'true',
    (pg_temp.as_user(v_cmo, $q$select (count(*) >= 1)::text from public.bp_band_divergence_report(30)$q$)));
  perform pg_temp.ck('real', 'E4 the report names no patient (fixed aggregate columns)', 'TABLE(app_band text, pipeline_level text, cause text, readings bigint, rule_set_approved boolean)',
    pg_get_function_result('public.bp_band_divergence_report(integer)'::regprocedure));
  perform pg_temp.ck('real', 'E5 the app thresholds are unchanged (parity grid)', 'green|amber|amber|red|red|emergency|emergency',
    private.classify_bp_level(134, 84) || '|' || private.classify_bp_level(135, 70) || '|' || private.classify_bp_level(120, 85) || '|' || private.classify_bp_level(160, 80) || '|' ||
    private.classify_bp_level(130, 100) || '|' || private.classify_bp_level(200, 80) || '|' || private.classify_bp_level(110, 120));
end $$;

-- SABOTAGE 1: the lookup stops rounding. 26.5 must no longer be 'adult'.
do $$
declare v_def text; v_out text; v_cfg jsonb := (select config from public.bp_cuff_guidance_signoffs where version = 1);
begin
  select pg_get_functiondef('private.bp_cuff_size_key(numeric, jsonb)'::regprocedure) into v_def;
  v_def := replace(v_def, 'round(p_cm)', 'p_cm');
  execute v_def;
  v_out := private.bp_cuff_size_key(26.5, v_cfg);
  insert into results values ('sabotaged', 'SABOTAGE: an unrounded lookup still reads 26.5 cm as adult', 'adult', v_out);
end $$;
-- SABOTAGE 2: the pregnancy step removed from the report. The pregnancy reason must disappear.
do $$
declare v_def text; v_out text;
begin
  select pg_get_functiondef('public.bp_band_divergence_report(integer)'::regprocedure) into v_def;
  v_def := replace(v_def, 'when l1.preg and (l1.s >= 140 or l1.d >= 90) and l1.lvl1 not in (''emergency'', ''red'') then ''red''', 'when false then ''red''');
  execute v_def;
  perform set_config('request.jwt.claims', json_build_object('sub', (select profile_id from public.clinical_staff where doctor_tier = 'chief_medical_officer' and credential_number like 'S07Y-cmo-%' limit 1), 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', (select profile_id from public.clinical_staff where doctor_tier = 'chief_medical_officer' and credential_number like 'S07Y-cmo-%' limit 1)::text, true);
  select (count(*) filter (where app_band = 'amber' and pipeline_level = 'red' and cause = 'pregnancy') >= 1)::text into v_out from public.bp_band_divergence_report(30);
  perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.sub', '', true);
  insert into results values ('sabotaged', 'SABOTAGE: report without the pregnancy step still shows the pregnancy reason', 'true', v_out);
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S07y proof FAILED: %', (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and check_name like 'SABOTAGE%' and expected <> actual;
  if v_caught < 2 then raise exception 'VACUOUS TEST: a sabotage did not flip (% of 2)', v_caught; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result from results where phase = 'real' order by check_name;
rollback;
