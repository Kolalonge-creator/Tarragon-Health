-- DUP-1 proof: the same lab value arriving twice (a structured/partner result and a clinician-filed paper report) is counted once and never silently picked.
-- Migration: 20261020214837_duplicate_lab_value_safety.sql. One rolled-back transaction. Proves:
--   1. an equal value on both routes is ONE trend point labelled with both sources, and ONE point in the Health Report series; both source rows are kept
--   2. a value inside the configured tolerance is still a duplicate; a reading outside the date window is not linked (two points)
--   3. a value that disagrees (or a unit that differs) is NOT collapsed: both points show, each marked as disagreeing, the Health Report leaves it out,
--      and the clinician note lists both values side by side
--   4. withdrawing or holding the structured result brings the paper value back (nothing is lost by collapsing)
--   5. a sensitive code is never linked (INV-04)
--   6. the note: self sees own, a tied clinician sees it with a reason and an audit row, an untied clinician is refused with an audit row, a stranger sees nothing
--   7. links are append-only, no client can write or read another person's link, anon has nothing
--   8. SABOTAGE: links removed, the trigger dropped, the visibility check bypassed; each must flip the matching check.
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
-- run a statement as a signed-in user; returns 'ok' or the error message
create function pg_temp.try_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql; r := 'ok'; exception when others then r := sqlerrm; end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.q_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlerrm; end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.q(p_sql text) returns text language plpgsql as
$f$ declare r text; begin execute p_sql into r; return r; end $f$;
create function pg_temp.try_service(p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  set local role service_role;
  begin execute p_sql into r; r := coalesce(r, 'ok'); exception when others then r := sqlerrm; end;
  reset role;
  return r;
end $f$;
create function pg_temp.try_sql_owner(p_sql text) returns text language plpgsql as
$f$ begin execute p_sql; return 'ok'; exception when others then return sqlerrm; end $f$;
create function pg_temp.q_anon(p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  set local role anon;
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlerrm; end;
  reset role;
  return r;
end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'dup1-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'DUP1 ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone, date_of_birth = excluded.date_of_birth;
  return v;
end $f$;
create function pg_temp.mkdoc(p_org uuid, p_label text, p_admin uuid) returns uuid
language plpgsql as $f$
declare v uuid; s uuid;
begin
  v := pg_temp.mkuser(p_org, p_label, 'clinician');
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
  values (p_org, v, 'DUP1 ' || p_label, 'MDCN', 'DUP1-' || p_label || '-' || substr(v::text, 1, 8), true, 'active', now(), p_admin,
      'senior_medical_officer'::public.doctor_tier, 'contracted'::public.staff_employment_type, 2, true, p_admin, true)
  returning id into s;
  return v;
end $f$;


do $$
declare
  v_org uuid; v_admin uuid; v_pat uuid; v_pat2 uuid; v_doc uuid; v_doc2 uuid;
  v_res uuid; v_res2 uuid; v_res3 uuid; v_res4 uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  v_pat := pg_temp.mkuser(v_org, 'pat', 'patient');   perform pg_temp.setf('pat', v_pat);
  v_pat2 := pg_temp.mkuser(v_org, 'pat2', 'patient'); perform pg_temp.setf('pat2', v_pat2);
  v_doc := pg_temp.mkdoc(v_org, 'tied', v_admin);     perform pg_temp.setf('doc', v_doc);
  v_doc2 := pg_temp.mkdoc(v_org, 'untied', v_admin);  perform pg_temp.setf('doc2', v_doc2);
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id, assigned_at) values (v_org, v_pat, v_doc, now());

  -- ===== 1. same HbA1c by both routes ============================================================================================
  insert into public.lab_results (id, organisation_id, patient_id, source, submitted_by_kind, release_state, received_at, is_test)
  values (gen_random_uuid(), v_org, v_pat, 'api', 'partner', 'awaiting_review', now(), true) returning id into v_res;
  insert into public.lab_result_items (lab_result_id, organisation_id, patient_id, analyte_code, value_numeric, unit, flag, ref_low, ref_high, sensitive_positive, is_test)
  values (v_res, v_org, v_pat, 'HbA1c', 6.9, '%', 'high', 4.0, 5.6, false, true);
  update public.lab_results set release_state = 'released', reviewed_by = v_doc, reviewed_at = now() where id = v_res;
  insert into public.lab_analyte_readings (organisation_id, patient_id, code, value, unit, taken_at, report_status, laboratory)
  values (v_org, v_pat, 'hba1c', 6.9, '%', now(), 'final', 'Paper Lab');
  perform pg_temp.ck('1a one duplicate link is written', '1:duplicate:same_value',
    (select count(*)::text || ':' || min(relation) || ':' || min(reason) from public.lab_value_links where patient_id = v_pat and lower(analyte_code) = 'hba1c'));
  perform pg_temp.ck('1b the trend shows the value ONCE, labelled with both sources', '1:lab_result:legacy_report:false',
    (select count(*)::text || ':' || min(source) || ':' || coalesce(min(also_from), 'none') || ':' || bool_or(disagrees)::text from private.biomarker_points(v_pat, 'hba1c')));
  perform pg_temp.ck('1c the Health Report series counts it once', '1', (select count(*)::text from private.hr_biomarker_points(v_pat, 'hba1c')));
  perform pg_temp.ck('1d both source rows are kept (linked, not deleted)', '1:1',
    (select count(*)::text from public.lab_result_items where patient_id = v_pat and lower(analyte_code) = 'hba1c') || ':' ||
    (select count(*)::text from public.lab_analyte_readings where patient_id = v_pat and code = 'hba1c'));
  perform pg_temp.ck('1e the person sees it once through the trend function', '1',
    pg_temp.q_as(v_pat, $q$select jsonb_array_length(public.patient_biomarker_trend('hba1c') -> 'points')::text$q$));

  -- ===== 2. tolerance and window =================================================================================================
  insert into public.lab_results (id, organisation_id, patient_id, source, submitted_by_kind, release_state, received_at, is_test)
  values (gen_random_uuid(), v_org, v_pat, 'api', 'partner', 'awaiting_review', now(), true) returning id into v_res2;
  insert into public.lab_result_items (lab_result_id, organisation_id, patient_id, analyte_code, value_numeric, unit, flag, sensitive_positive, is_test)
  values (v_res2, v_org, v_pat, 'cholesterol', 5.20, 'mmol/L', 'normal', false, true), (v_res2, v_org, v_pat, 'urea', 4.0, 'mmol/L', 'normal', false, true),
         (v_res2, v_org, v_pat, 'ldl', 3.1, 'mmol/L', 'normal', false, true), (v_res2, v_org, v_pat, 'creatinine', 90, 'umol/L', 'normal', false, true);
  update public.lab_results set release_state = 'released', reviewed_by = v_doc, reviewed_at = now() where id = v_res2;
  insert into public.lab_analyte_readings (organisation_id, patient_id, code, value, unit, taken_at, report_status)
  values (v_org, v_pat, 'cholesterol', 5.21, 'mmol/L', now() - interval '1 day', 'final'),
         (v_org, v_pat, 'urea', 4.0, 'mmol/L', now() - interval '10 days', 'final');
  perform pg_temp.ck('2a a value inside the tolerance and window is a duplicate', 'duplicate',
    (select relation from public.lab_value_links where patient_id = v_pat and analyte_code = 'cholesterol'));
  perform pg_temp.ck('2b a reading outside the window is not linked and both points show', '0:2',
    (select count(*)::text from public.lab_value_links where patient_id = v_pat and analyte_code = 'urea') || ':' || (select count(*)::text from private.biomarker_points(v_pat, 'urea')));

  -- ===== 3. disagreement: never collapsed, never picked ==========================================================================
  insert into public.lab_analyte_readings (organisation_id, patient_id, code, value, unit, taken_at, report_status)
  values (v_org, v_pat, 'ldl', 4.4, 'mmol/L', now(), 'final'), (v_org, v_pat, 'creatinine', 1.0, 'mg/dL', now(), 'final');
  perform pg_temp.ck('3a different values are a disagreement, not a duplicate', 'disagreement:value_differs',
    (select relation || ':' || reason from public.lab_value_links where patient_id = v_pat and analyte_code = 'ldl'));
  perform pg_temp.ck('3b a different unit is a disagreement (never converted)', 'disagreement:unit_differs',
    (select relation || ':' || reason from public.lab_value_links where patient_id = v_pat and analyte_code = 'creatinine'));
  perform pg_temp.ck('3c the trend shows BOTH values, each marked as disagreeing', '2:true',
    (select count(*)::text || ':' || bool_and(disagrees)::text from private.biomarker_points(v_pat, 'ldl')));
  perform pg_temp.ck('3d the trend function flags the series as disputed', 'true',
    pg_temp.q_as(v_pat, $q$select (public.patient_biomarker_trend('ldl') ->> 'disputed')$q$));
  perform pg_temp.ck('3e the Health Report series leaves a disputed analyte out rather than pick one', '0',
    (select count(*)::text from private.hr_biomarker_points(v_pat, 'ldl')));
  insert into public.lab_analyte_readings (organisation_id, patient_id, code, value, unit, taken_at, report_status)
  values (v_org, v_pat, 'ldl', 2.8, 'mmol/L', now() - interval '200 days', 'final');
  perform pg_temp.ck('3f an older undisputed reading is NOT promoted to latest while the analyte is disputed', '0',
    (select count(*)::text from private.hr_biomarker_points(v_pat, 'ldl')));
  perform pg_temp.ck('3g the trend still lists all three, so the person loses nothing', '3',
    (select count(*)::text from private.biomarker_points(v_pat, 'ldl')));

  -- ===== 3h. review fixes: a genuine repeat test is not a disagreement; unit spacing and case are not a disagreement ====================
  insert into public.lab_result_items (lab_result_id, organisation_id, patient_id, analyte_code, value_numeric, unit, flag, sensitive_positive, is_test)
  values (v_res2, v_org, v_pat, 'glucose', 5.0, 'mmol/L', 'normal', false, true);
  insert into public.lab_analyte_readings (organisation_id, patient_id, code, value, unit, taken_at, report_status)
  values (v_org, v_pat, 'glucose', 5.0, 'mmol/l ', now(), 'final');
  perform pg_temp.ck('3h unit case and spacing is not a disagreement', 'duplicate:same_value',
    (select relation || ':' || reason from public.lab_value_links where patient_id = v_pat and analyte_code = 'glucose'));
  insert into public.lab_analyte_readings (organisation_id, patient_id, code, value, unit, taken_at, report_status)
  values (v_org, v_pat, 'glucose', 7.9, 'mmol/L', now(), 'final');
  perform pg_temp.ck('3i a different reading the same day that already has a partner elsewhere is not called a disagreement', '1:duplicate',
    (select count(*)::text || ':' || min(relation) from public.lab_value_links where patient_id = v_pat and analyte_code = 'glucose'));
  perform pg_temp.ck('3j ...and the analyte is not disputed', 'false',
    (private.lab_code_disputed(v_pat, 'glucose'))::text);
  perform pg_temp.ck('3k the list does not show an arbitrary latest value for a disputed series (ldl) and does for others', 'true:false',
    pg_temp.q_as(v_pat, $q$select (select (e ->> 'latest_value') is null from jsonb_array_elements(public.patient_biomarker_list()) e where e ->> 'code' = 'ldl')::text
                         || ':' || (select (e ->> 'latest_value') is null from jsonb_array_elements(public.patient_biomarker_list()) e where e ->> 'code' = 'cholesterol')::text$q$));

  -- ===== 4. nothing is lost by collapsing ========================================================================================
  update public.lab_results set withdrawn_at = now(), withdrawn_by = v_admin, withdrawn_reason = 'DUP1 proof withdrawal' where id = v_res;
  perform pg_temp.ck('4a withdrawing the structured result brings the paper value back (one point, legacy source)', '1:legacy_report',
    (select count(*)::text || ':' || coalesce(min(source), 'nothing') from private.biomarker_points(v_pat, 'hba1c')));
  insert into public.lab_results (id, organisation_id, patient_id, source, submitted_by_kind, release_state, received_at, is_test)
  values (gen_random_uuid(), v_org, v_pat, 'api', 'partner', 'awaiting_review', now(), true) returning id into v_res3;
  insert into public.lab_result_items (lab_result_id, organisation_id, patient_id, analyte_code, value_numeric, unit, flag, sensitive_positive, is_test)
  values (v_res3, v_org, v_pat, 'ferritin', 55, 'ug/L', 'normal', false, true);
  insert into public.lab_analyte_readings (organisation_id, patient_id, code, value, unit, taken_at, report_status)
  values (v_org, v_pat, 'ferritin', 55, 'ug/L', now(), 'final');
  perform pg_temp.ck('4b a HELD structured result does not hide the paper value', '1:legacy_report',
    (select count(*)::text || ':' || coalesce(min(source), 'nothing') from private.biomarker_points(v_pat, 'ferritin')));

  -- ===== 5. sensitive codes are never linked =====================================================================================
  insert into public.lab_result_items (lab_result_id, organisation_id, patient_id, analyte_code, value_numeric, unit, flag, sensitive_positive, is_test)
  values (v_res3, v_org, v_pat, 'HBsAg', 1.2, 'IU/mL', 'normal', false, true);
  insert into public.lab_analyte_readings (organisation_id, patient_id, code, value, unit, taken_at, report_status)
  values (v_org, v_pat, 'hbsag', 1.2, 'IU/mL', now(), 'final');
  perform pg_temp.ck('5a a sensitive code produces no link', '0', (select count(*)::text from public.lab_value_links where lower(analyte_code) in ('hiv', 'hbsag')));

  -- ===== 6. the clinician-visible note ===========================================================================================
  perform pg_temp.ck('6a the person sees their own disagreements (ldl and creatinine)', '2',
    pg_temp.q_as(v_pat, $q$select jsonb_array_length(public.lab_value_disagreements() -> 'disagreements')::text$q$));
  perform pg_temp.ck('6b the note carries both values side by side', '3.1:4.4',
    pg_temp.q_as(v_pat, $q$select trim_scale((d -> 'structured' ->> 'value')::numeric)::text || ':' || trim_scale((d -> 'paper_report' ->> 'value')::numeric)::text from jsonb_array_elements(public.lab_value_disagreements() -> 'disagreements') d where d ->> 'code' = 'ldl'$q$));
  perform pg_temp.ck('6c a tied clinician with a reason reads it', '2',
    pg_temp.q_as(v_doc, format($q$select jsonb_array_length(public.lab_value_disagreements(%L, 'DUP1 proof: review disagreement') -> 'disagreements')::text$q$, v_pat)));
  perform pg_temp.ck('6d ...and that read is audited as success', '1',
    (select count(*)::text from public.audit_log where subject_patient_id = v_pat and reason like 'DUP1 proof: review%' and result = 'success' and actor_id = v_doc));
  perform pg_temp.ck('6e an untied clinician is refused', 'true',
    pg_temp.q_as(v_doc2, format($q$select (public.lab_value_disagreements(%L, 'DUP1 proof: no tie here') ->> 'denied')$q$, v_pat)));
  perform pg_temp.ck('6f ...and the refusal is audited', '1',
    (select count(*)::text from public.audit_log where subject_patient_id = v_pat and reason like 'DUP1 proof: no tie%' and result = 'denied' and actor_id = v_doc2));
  perform pg_temp.ck('6g staff need a reason', 'true',
    (pg_temp.try_as(v_doc, format($q$select public.lab_value_disagreements(%L, 'short')$q$, v_pat)) like '%reason of at least 10%')::text);
  perform pg_temp.ck('6h another patient cannot ask for someone else: refused before anything is written (no audit spam, no oracle)', 'true:0',
    (pg_temp.try_as(v_pat2, format($q$select public.lab_value_disagreements(%L, 'DUP1 proof: stranger read')$q$, v_pat)) like '%not authorised%')::text || ':' ||
    (select count(*)::text from public.audit_log where reason like 'DUP1 proof: stranger%'));
  perform pg_temp.ck('6h2 ...and a made-up patient id gives the same answer, not "unknown patient"', 'true',
    (pg_temp.try_as(v_pat2, $q$select public.lab_value_disagreements(gen_random_uuid(), 'DUP1 proof: stranger read')$q$) like '%not authorised%')::text);
  perform pg_temp.ck('6i a stranger patient sees none of their own (they have none)', '0',
    pg_temp.q_as(v_pat2, $q$select jsonb_array_length(public.lab_value_disagreements() -> 'disagreements')::text$q$));

  -- ===== 7. append-only, access ==================================================================================================
  perform pg_temp.ck('7a a link cannot be updated, even by the owner role', 'true',
    (pg_temp.try_sql_owner($q$update public.lab_value_links set relation = 'duplicate', reason = 'same_value'$q$) like '%append-only%')::text);
  perform pg_temp.ck('7b a client cannot insert a link', 'true',
    (pg_temp.try_as(v_pat, $q$insert into public.lab_value_links (organisation_id, patient_id, analyte_code, structured_item_id, legacy_reading_id, relation, reason, structured_value, legacy_value, config_version) select organisation_id, patient_id, analyte_code, structured_item_id, legacy_reading_id, 'duplicate', 'same_value', 1, 1, 1 from public.lab_value_links limit 1$q$) like '%permission denied%')::text);
  perform pg_temp.ck('7c another person cannot read links', 'true',
    (pg_temp.q_as(v_pat2, $q$select count(*)::text from public.lab_value_links$q$) like '%permission denied%')::text);
  perform pg_temp.ck('7d not even the person reads the links table directly (a link copies a value before release)', 'true',
    (pg_temp.q_as(v_pat, $q$select count(*)::text from public.lab_value_links$q$) like '%permission denied%')::text);
  perform pg_temp.ck('7e staff have no direct read on links', 'true',
    (pg_temp.q_as(v_doc, $q$select count(*)::text from public.lab_value_links$q$) like '%permission denied%')::text);
  perform pg_temp.ck('7f anon has nothing', 'true',
    (pg_temp.q_anon('select count(*) from public.lab_value_links') like '%permission denied%')::text);
  perform pg_temp.ck('7g the match config is unreadable by clients', 'true',
    (pg_temp.try_as(v_pat, 'select * from public.lab_value_match_config') like '%permission denied%')::text);
  perform pg_temp.ck('7h the proposed config v1 is unconfirmed and carries the registry values', 'proposed:2:0.5',
    (select status || ':' || (config ->> 'window_days') || ':' || (config ->> 'value_tolerance_pct') from public.lab_value_match_config where version = 1));
  perform pg_temp.ck('7i the new table is in the data registry and NOT in the export', '1:false',
    (select count(*)::text || ':' || min(in_export::text) from public.data_registry where table_name = 'lab_value_links'));
  -- a later draft nobody confirmed is inert; a confirmed one takes over
  insert into public.lab_value_match_config (version, config) values (2, '{"window_days": 30, "value_tolerance_pct": 50, "require_same_unit": false}'::jsonb);
  perform pg_temp.ck('7j an unconfirmed v2 draft does not take over (v1 stays in force)', '1', (private.lab_value_match_active()).version::text);
  update public.lab_value_match_config set status = 'confirmed', confirmed_by = v_admin, confirmed_at = now() where version = 2;
  perform pg_temp.ck('7k a confirmed v2 takes over', '2', (private.lab_value_match_active()).version::text);
  delete from public.lab_value_match_config where version = 2;
  perform pg_temp.ck('7l back to v1', '1', (private.lab_value_match_active()).version::text);

  -- ===== 7m. a failure to link never blocks a result from being stored =====================================================================
  create or replace function private.link_lab_value_pairs(p_patient uuid, p_code text) returns integer language plpgsql set search_path = '' as
    $f$ begin raise exception 'DUP1 proof: matcher broken on purpose'; end $f$;
  insert into public.lab_result_items (lab_result_id, organisation_id, patient_id, analyte_code, value_numeric, unit, flag, sensitive_positive, is_test)
  values (v_res3, v_org, v_pat, 'potassium', 6.9, 'mmol/L', 'high', false, true);
  perform pg_temp.ck('7m the result is stored even though the matcher failed, and the failure is recorded', '1:1',
    (select count(*)::text from public.lab_result_items where patient_id = v_pat and analyte_code = 'potassium') || ':' ||
    (select count(*)::text from public.lab_value_link_failures where error like '%matcher broken on purpose%'));
  perform pg_temp.ck('7n no client can read the failures table', 'true',
    (pg_temp.q_as(v_pat, 'select count(*) from public.lab_value_link_failures') like '%permission denied%')::text);

  -- ===== 8. sabotage ============================================================================================================
  -- A. the links removed (as if the matcher never ran): the hba1c duplicate must come back as two points
  alter table public.lab_value_links disable trigger lab_value_links_no_update;
  delete from public.lab_value_links where patient_id = v_pat and lower(analyte_code) = 'hba1c';
  insert into results values ('sabotaged', '1b the trend shows the value ONCE, labelled with both sources', '1:lab_result:legacy_report:false',
    (select count(*)::text || ':' || min(source) || ':' || coalesce(min(also_from), 'none') || ':' || bool_or(disagrees)::text from private.biomarker_points(v_pat, 'hba1c')));
  -- B. both triggers dropped: a new matching pair is no longer linked, so it counts twice
  drop trigger lab_value_link_after_legacy on public.lab_analyte_readings;
  drop trigger lab_value_link_after_item on public.lab_result_items;
  insert into public.lab_results (id, organisation_id, patient_id, source, submitted_by_kind, release_state, received_at, is_test)
  values (gen_random_uuid(), v_org, v_pat, 'api', 'partner', 'awaiting_review', now(), true) returning id into v_res4;
  insert into public.lab_result_items (lab_result_id, organisation_id, patient_id, analyte_code, value_numeric, unit, flag, sensitive_positive, is_test)
  values (v_res4, v_org, v_pat, 'sodium', 140, 'mmol/L', 'normal', false, true);
  update public.lab_results set release_state = 'released', reviewed_by = v_doc, reviewed_at = now() where id = v_res4;
  insert into public.lab_analyte_readings (organisation_id, patient_id, code, value, unit, taken_at, report_status) values (v_org, v_pat, 'sodium', 140, 'mmol/L', now(), 'final');
  insert into results values ('sabotaged', '1-like: a new duplicate is counted once', '1',
    (select count(*)::text from private.biomarker_points(v_pat, 'sodium')));
  -- C. the visibility check bypassed: a withdrawn structured result then still hides the paper value (4a must flip)
  create or replace function private.lab_item_visible(p_item uuid) returns boolean language sql stable security definer set search_path = '' as $f$ select true $f$;
  insert into public.lab_value_links (organisation_id, patient_id, analyte_code, structured_item_id, legacy_reading_id, relation, reason, structured_value, legacy_value, config_version)
  select i.organisation_id, i.patient_id, i.analyte_code, i.id, l.id, 'duplicate', 'same_value', 6.9, 6.9, 1
    from public.lab_result_items i, public.lab_analyte_readings l where i.patient_id = v_pat and lower(i.analyte_code) = 'hba1c' and l.patient_id = v_pat and l.code = 'hba1c';
  insert into results values ('sabotaged', '4a withdrawing the structured result brings the paper value back (one point, legacy source)', '1:legacy_report',
    (select count(*)::text || ':' || coalesce(min(source), 'nothing') from private.biomarker_points(v_pat, 'hba1c')));
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FLIPPED' end as result
from results where phase = 'sabotaged'
union all
select 'real', count(*)::text || ' checks', 'all pass', 'all pass', 'PASS' from results where phase = 'real';

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'DUP-1 proof FAILED: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), E'\n  ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 3 then raise exception 'VACUOUS TEST: the sabotage flipped % of 3 checks', v_caught; end if;
end $$;

rollback;
