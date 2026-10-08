-- S47 proof: report settings v2 (comorbidity-aware blood pressure target, minimum 12 readings over 3 days, no borderline margin) at the database level
-- (migration *_s47_report_settings_v2_comorbidity_min_readings.sql). One rolled-back transaction.
-- Proves:
--   1. Settings v2 exists, is UNSIGNED and inactive, has no 5 mmHg / 5 percent margin key, carries the 12 / 3 minimum, the 130/80 higher-risk target,
--      the high-normal band and the product-rule list, and the statement is not marked CMO-approved. v1 is untouched.
--   2. The collector counts distinct reading DAYS and flags the higher-risk group from the problem list (diabetes, kidney disease, cardiovascular
--      disease, by ICD-10 prefix or by name; a resolved condition does not count) as booleans only, with a control patient who gets all false. No
--      condition name or sensitive word appears in what it returns (INV-04).
--   3. The honesty guard refuses a blood pressure verdict resting on fewer than the stated minimum readings or days, and lets one through at the minimum
--      (control); it does not touch non-blood-pressure items.
--   4. SABOTAGE: the minimum removed from the guard, the higher-risk detector forced false, and a margin key added to v2; the matching checks must flip.
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


-- Fixtures: a patient helper that adds BP readings across N distinct days ---------------------------------------------------------
create function pg_temp.bp_days(p_pat uuid, p_readings integer, p_days integer) returns void language plpgsql as
$f$ declare i integer; v uuid;
begin
  for i in 1..p_readings loop
    -- spread across p_days distinct local days (device readings keep the time they carry)
    insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, source, taken_at)
    values (pg_temp.f('org'), p_pat, 'blood_pressure', 122, 78, 'device',
            make_timestamptz(extract(year from now())::integer - 1, 6, 1 + (i % p_days), 10, 0, 0, 'Africa/Lagos'));
  end loop;
end $f$;
create function pg_temp.cond(p_pat uuid, p_name text, p_icd text, p_status text) returns void language sql as
$$ insert into public.patient_conditions (organisation_id, patient_id, condition_name, icd10_code, status)
   values (pg_temp.f('org'), p_pat, p_name, p_icd, p_status::public.condition_clinical_status) $$;
create function pg_temp.hr(p_pat uuid) returns jsonb language sql as
$$ select (private.health_report_collect(p_pat, extract(year from now())::integer)) -> 'bpHigherRisk' $$;
create function pg_temp.flags(j jsonb) returns text language sql as
$$ select (j ->> 'diabetes') || ',' || (j ->> 'ckd') || ',' || (j ->> 'cvd') || ',' || (j ->> 'elevatedRisk') $$;
create function pg_temp.honest(p_composed text) returns text language sql as
$$ select pg_temp.try_sql(format('select private.health_report_assert_honest(%L::jsonb, %L::jsonb, %L::jsonb)', '{}', p_composed, '[]')) $$;

-- 1. Settings v2 ---------------------------------------------------------------------------------------------------------------------
do $$
begin
  perform pg_temp.ck('v2 exists and is unsigned and inactive', 'true',
    (select (approved_by is null and approved_at is null and not is_active)::text from public.health_report_config_versions where version = 2));
  perform pg_temp.ck('v2 has no 5 mmHg or 5 percent borderline margin', 'false',
    (select (config ? 'bpBorderlineMarginMmHg' or config ? 'labBorderlineMarginPct')::text from public.health_report_config_versions where version = 2));
  perform pg_temp.ck('v2 asks for 12 readings on 3 days', '12,3',
    (select (config ->> 'minBpReadings') || ',' || (config ->> 'minBpDays') from public.health_report_config_versions where version = 2));
  perform pg_temp.ck('v2 target 140/90, higher-risk 130/80, band 130-139 / 80-89', '140/90,130/80,130-140/80-90',
    (select (config #>> '{bpTarget,systolicBelow}') || '/' || (config #>> '{bpTarget,diastolicBelow}') || ',' ||
            (config #>> '{bpTargetHigherRisk,systolicBelow}') || '/' || (config #>> '{bpTargetHigherRisk,diastolicBelow}') || ',' ||
            (config #>> '{bpHighNormalBand,systolicFrom}') || '-' || (config #>> '{bpHighNormalBand,systolicBelow}') || '/' ||
            (config #>> '{bpHighNormalBand,diastolicFrom}') || '-' || (config #>> '{bpHighNormalBand,diastolicBelow}')
       from public.health_report_config_versions where version = 2));
  perform pg_temp.ck('v2 lists the product rules and keeps the statement unapproved', 'maxPriorities,changeTolerancePct,recheckWeeks,priorityWindows,trendMinPoints,trendYears|false',
    (select (select string_agg(x, ',' order by ord) from jsonb_array_elements_text(config -> 'productRules') with ordinality t(x, ord)) || '|' || (config ->> 'statementApprovedByCmo')
       from public.health_report_config_versions where version = 2));
  perform pg_temp.ck('v1 is untouched: still unsigned and still carries its placeholder margins', 'true',
    (select (approved_by is null and config ? 'bpBorderlineMarginMmHg')::text from public.health_report_config_versions where version = 1));
end $$;

-- 2. The collector --------------------------------------------------------------------------------------------------------------------
do $$
declare a uuid := pg_temp.mkpatient('plain'); b uuid := pg_temp.mkpatient('diab'); c uuid := pg_temp.mkpatient('ckd'); d uuid := pg_temp.mkpatient('cvd');
        e uuid := pg_temp.mkpatient('resolved'); f uuid := pg_temp.mkpatient('byname'); g uuid := pg_temp.mkpatient('days');
        x1 uuid := pg_temp.mkpatient('prediab'); x2 uuid := pg_temp.mkpatient('famhx'); x3 uuid := pg_temp.mkpatient('heat'); x4 uuid := pg_temp.mkpatient('gest'); x5 uuid := pg_temp.mkpatient('stage');
        j jsonb;
begin
  perform pg_temp.cond(b, 'Type 2 diabetes mellitus', 'E11.9', 'active');
  perform pg_temp.cond(c, 'Chronic kidney disease stage 3', 'N18.3', 'controlled');
  perform pg_temp.cond(d, 'Ischaemic heart disease', 'I25.1', 'active');
  perform pg_temp.cond(e, 'Type 2 diabetes mellitus', 'E11.9', 'resolved');
  perform pg_temp.cond(f, 'Type 2 diabetes mellitus', null, 'uncontrolled');
  -- S47 review fix: not a substring match any more
  perform pg_temp.cond(x1, 'Pre-diabetes', null, 'active');
  perform pg_temp.cond(x2, 'Family history of diabetes', null, 'active');
  perform pg_temp.cond(x3, 'Heatstroke', null, 'active');
  perform pg_temp.cond(x4, 'Gestational diabetes', null, 'active');
  perform pg_temp.cond(x5, 'Chronic kidney disease stage 3b', null, 'active');
  perform pg_temp.ck('control: a patient with no condition is in no higher-risk group', 'false,false,false,false', pg_temp.flags(pg_temp.hr(a)));
  perform pg_temp.ck('diabetes by ICD-10 prefix', 'true,false,false,false', pg_temp.flags(pg_temp.hr(b)));
  perform pg_temp.ck('kidney disease by ICD-10 prefix', 'false,true,false,false', pg_temp.flags(pg_temp.hr(c)));
  perform pg_temp.ck('cardiovascular disease by ICD-10 prefix', 'false,false,true,false', pg_temp.flags(pg_temp.hr(d)));
  perform pg_temp.ck('a resolved condition does not count', 'false,false,false,false', pg_temp.flags(pg_temp.hr(e)));
  perform pg_temp.ck('diabetes by name when no code is recorded', 'true,false,false,false', pg_temp.flags(pg_temp.hr(f)));
  perform pg_temp.ck('pre-diabetes is not diabetes', 'false,false,false,false', pg_temp.flags(pg_temp.hr(x1)));
  perform pg_temp.ck('family history of diabetes is not diabetes', 'false,false,false,false', pg_temp.flags(pg_temp.hr(x2)));
  perform pg_temp.ck('heatstroke is not a stroke', 'false,false,false,false', pg_temp.flags(pg_temp.hr(x3)));
  perform pg_temp.ck('gestational diabetes is not on the list', 'false,false,false,false', pg_temp.flags(pg_temp.hr(x4)));
  perform pg_temp.ck('a staged kidney disease name still matches (anchored, not bare)', 'false,true,false,false', pg_temp.flags(pg_temp.hr(x5)));
  perform pg_temp.ck('rejected blood pressure readings are excluded from the collector (current year and prior year)', '2',
    (select (array_length(string_to_array(pg_get_functiondef('private.health_report_collect(uuid,integer)'::regprocedure), '<> ' || chr(39) || 'rejected' || chr(39)), 1) - 1)::text));
  perform pg_temp.ck('the exclusion patterns are in the unsigned settings the CMO can see', 'true',
    (select (config #> '{higherRiskCriteria,excludePatterns}' ? 'family history')::text from public.health_report_config_versions where version = 2));
  perform pg_temp.ck('INV-04: the flags carry no condition name or sensitive word', 'false',
    (pg_temp.hr(b)::text ~* 'type 2|mellitus|hiv|hbsag|hcv|hbv|hepatitis|hep_b|hep_c')::text);
  perform pg_temp.bp_days(g, 14, 5);
  j := private.health_report_collect(g, extract(year from now())::integer - 1);
  perform pg_temp.ck('the collector counts readings and distinct days (14 readings on 5 days)', '14,5', (j -> 'bp' ->> 'count') || ',' || (j -> 'bp' ->> 'days'));
  perform pg_temp.setf('flagged_diab', b);
end $$;

-- 3. The honesty guard ----------------------------------------------------------------------------------------------------------------
do $$
begin
  perform pg_temp.ck('a BP verdict on 5 readings is refused when 12 are required', '23514',
    pg_temp.honest('{"minBpReadings":12,"minBpDays":3,"items":[{"id":"bp","state":"on_target","value":122,"readingCount":5,"readingDays":4}]}'));
  perform pg_temp.ck('a BP verdict on 30 readings but only 2 days is refused when 3 days are required', '23514',
    pg_temp.honest('{"minBpReadings":12,"minBpDays":3,"items":[{"id":"bp","state":"needs_attention","value":150,"readingCount":30,"readingDays":2}]}'));
  perform pg_temp.ck('a BP verdict with no day count at all is refused', '23514',
    pg_temp.honest('{"minBpReadings":12,"minBpDays":3,"items":[{"id":"bp","state":"needs_attention","value":150,"readingCount":30}]}'));
  perform pg_temp.ck('control: 12 readings on 3 days passes', 'ok',
    pg_temp.honest('{"minBpReadings":12,"minBpDays":3,"items":[{"id":"bp","state":"on_target","value":122,"readingCount":12,"readingDays":3}]}'));
  perform pg_temp.ck('control: a too-few-readings item (not measured) is allowed', 'ok',
    pg_temp.honest('{"minBpReadings":12,"minBpDays":3,"items":[{"id":"bp","state":"not_measured","readingCount":5,"readingDays":2,"tooFewReadings":true}]}'));
  perform pg_temp.ck('control: the rule is about blood pressure only, a lab item is not held to it', 'ok',
    pg_temp.honest('{"minBpReadings":12,"minBpDays":3,"items":[{"id":"lab:alt","state":"on_target","value":40,"readingCount":1}]}'));
end $$;

-- 4. Sabotage -------------------------------------------------------------------------------------------------------------------------
-- A: the minimum removed from the guard. Five readings must then be accepted (the real check flips).
do $$
declare v_def text;
begin
  v_def := pg_get_functiondef('private.health_report_assert_honest(jsonb,jsonb,jsonb)'::regprocedure);
  v_def := replace(v_def, 'coalesce((v_item ->> ''readingCount'')::integer, 0) < (p_composed ->> ''minBpReadings'')::integer', 'false');
  v_def := replace(v_def, 'or coalesce((v_item ->> ''readingDays'')::integer, 0) < coalesce((p_composed ->> ''minBpDays'')::integer, 1)', 'or false');
  execute v_def;
  insert into results values ('sabotaged', 'a BP verdict on 5 readings is refused when 12 are required', '23514',
    pg_temp.honest('{"minBpReadings":12,"minBpDays":3,"items":[{"id":"bp","state":"on_target","value":122,"readingCount":5,"readingDays":4}]}'));
  insert into results values ('sabotaged', 'a BP verdict on 30 readings but only 2 days is refused when 3 days are required', '23514',
    pg_temp.honest('{"minBpReadings":12,"minBpDays":3,"items":[{"id":"bp","state":"needs_attention","value":150,"readingCount":30,"readingDays":2}]}'));
end $$;
-- B: the higher-risk detector forced false. The diabetes patient must then come back false.
do $$
begin
  create or replace function private.hr_has_condition(p_patient uuid, p_prefixes jsonb, p_names jsonb, p_exclude jsonb default '[]'::jsonb) returns boolean
    language sql stable security definer set search_path = '' as $f$ select false $f$;
  insert into results values ('sabotaged', 'diabetes by ICD-10 prefix', 'true,false,false,false', pg_temp.flags(pg_temp.hr(pg_temp.f('flagged_diab'))));
end $$;
-- D: the rejected-reading filter removed from the collector. The "rejected readings are excluded" check must flip.
do $$
declare v_def text;
begin
  v_def := replace(pg_get_functiondef('private.health_report_collect(uuid,integer)'::regprocedure), 'and coalesce(validation_status::text, ' || chr(39) || chr(39) || ') <> ' || chr(39) || 'rejected' || chr(39), '');
  execute v_def;
  insert into results values ('sabotaged', 'rejected blood pressure readings are excluded from the collector (current year and prior year)', '2',
    (select (array_length(string_to_array(pg_get_functiondef('private.health_report_collect(uuid,integer)'::regprocedure), '<> ' || chr(39) || 'rejected' || chr(39)), 1) - 1)::text));
end $$;
-- C: a margin key put back into v2. The "no margin" check must then flip.
do $$
begin
  update public.health_report_config_versions set config = config || '{"bpBorderlineMarginMmHg":5}'::jsonb where version = 2;
  insert into results values ('sabotaged', 'v2 has no 5 mmHg or 5 percent borderline margin', 'false',
    (select (config ? 'bpBorderlineMarginMmHg' or config ? 'labBorderlineMarginPct')::text from public.health_report_config_versions where version = 2));
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S47 proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ')
         from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 4 then raise exception 'VACUOUS TEST: the sabotage flipped % of 4 checks', v_caught; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;

rollback;
