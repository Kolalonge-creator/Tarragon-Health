-- Vitals proof: one page for one dangerous vitals reading, whichever pipeline sees it first (migration *_build_red_page_dedupe_key.sql).
--
--   1. The engine's red result and a unified legacy event for the SAME reading are one page even after the first page was acknowledged (the case the
--      P6 family merge deliberately does not cover), recorded as merged with an audit row.
--   2. Everything else still pages: another reading of the same metric and level after an acknowledgement (INV-05), a worse level, another metric, a closed page,
--      a claim older than the window.
--   3. The emergency path is keyed the same way (emergency_events row against the engine's emergency result).
--   4. Nothing changes behind the unsigned state: a shadow vitals result pages nobody and claims nothing; a Free patient is not paged and claims nothing; a
--      blood pressure result carries no key.
--   5. Grants and write guard: the claim table is closed to staff writes.
--   6. SABOTAGE: with the key function returning nothing, and with the claims wiped, the acknowledged duplicate pages a second time.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;

create or replace function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'vp-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'VP ' || p_label, (current_date - interval '50 years')::date, true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, date_of_birth = excluded.date_of_birth;
  return v;
end $f$;

create or replace function pg_temp.res(p_phase text, p_check text, p_expected text, p_actual text) returns void
language sql as $f$ insert into results values (p_phase, p_check, p_expected, p_actual) $f$;

create or replace function pg_temp.result(p_grade text, p_rule text, p_key text) returns jsonb
language sql as $f$
  select jsonb_build_object('status', 'graded', 'grade', p_grade, 'ruleId', p_rule, 'explanationKey', p_key,
    'actions', case when p_grade = 'red' then jsonb_build_array(jsonb_build_object('kind', 'show_emergency_guidance', 'code', p_key), jsonb_build_object('kind', 'page_on_call'))
                    else jsonb_build_array(jsonb_build_object('kind', 'show_message', 'code', p_key)) end,
    'matchedRuleIds', jsonb_build_array(p_rule), 'taskKey', null, 'ruleSet', jsonb_build_object('code', 'vitals_care_triage', 'version', 1)) $f$;

-- a unified legacy event for a reading, the shape private.unified_red_page_covers writes
create or replace function pg_temp.unified(p_org uuid, p_patient uuid, p_ref uuid, p_basis text) returns uuid
language plpgsql as $f$
declare v uuid;
begin
  insert into public.triage_events (organisation_id, patient_id, trigger_type, trigger_id, grade, rule_id, rule_set_id, rule_set_code, rule_set_version, rule_set_status,
      explanation_key, actions, matched_rule_ids, task_key, basis, shadow, is_test, context)
  values (p_org, p_patient, 'unified_red', p_ref, 'red', 'UNIFIED-' || upper(p_basis), null, 'unified_red_paging', 1, 'approved', null,
      '[{"kind":"page_on_call"}]'::jsonb, '{}', null, p_basis, false, true, jsonb_build_object('source', p_basis, 'ref_id', p_ref))
  returning id into v;
  return v;
end $f$;

do $$
declare
  v_org uuid; v_p uuid; v_free uuid; v_cmo uuid; v_admin uuid; v_bp uuid;
  v_rs uuid; v_bp_rs uuid;
  v_r1 uuid; v_r2 uuid; v_r3 uuid; v_r4 uuid; v_r5 uuid; v_r6 uuid; v_r7 uuid; v_rshadow uuid; v_rfree uuid; v_rbp uuid;
  v_e uuid; v_u uuid; v_page uuid; v_page2 uuid; v_pg1 uuid; v_n integer; v_em uuid; v_err text; v_key text; v_k2 text;
  v_shadow_te uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_p := pg_temp.mkuser(v_org, 'patient', 'patient');
  v_free := pg_temp.mkuser(v_org, 'free', 'patient');
  v_bp := pg_temp.mkuser(v_org, 'bp', 'patient');
  v_cmo := pg_temp.mkuser(v_org, 'cmo', 'clinician');
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  insert into public.clinical_staff (profile_id, organisation_id, full_name, doctor_tier, active, license_verified_at, employment_type, indemnity_exempt, indemnity_exempt_by)
  values (v_cmo, v_org, 'VP CMO', 'chief_medical_officer', true, now(), 'employed', true, v_admin) on conflict do nothing;
  select id into v_rs from public.triage_rule_sets where code = 'vitals_care_triage' and version = 1;
  select id into v_bp_rs from public.triage_rule_sets where code = 'bp_care_triage' order by version desc limit 1;

  insert into public.vitals_readings (organisation_id, patient_id, vital_type, spo2_pct, source, taken_at) values (v_org, v_p, 'spo2', 91, 'manual', now() - interval '50 minutes') returning id into v_r1;
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, spo2_pct, source, taken_at) values (v_org, v_p, 'spo2', 92, 'manual', now() - interval '40 minutes') returning id into v_r2;
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, spo2_pct, source, taken_at) values (v_org, v_p, 'spo2', 86, 'manual', now() - interval '30 minutes') returning id into v_r3;
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, pulse_bpm, source, taken_at) values (v_org, v_p, 'pulse', 130, 'manual', now() - interval '20 minutes') returning id into v_r4;
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, temperature_c, source, taken_at) values (v_org, v_p, 'temperature', 39.4, 'manual', now() - interval '10 minutes') returning id into v_r5;
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, spo2_pct, source, taken_at) values (v_org, v_p, 'spo2', 87, 'manual', now() - interval '5 minutes') returning id into v_r6;
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, spo2_pct, source, taken_at) values (v_org, v_p, 'spo2', 90, 'manual', now() - interval '4 minutes') returning id into v_r7;
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, pulse_bpm, source, taken_at) values (v_org, v_free, 'pulse', 160, 'manual', now()) returning id into v_rfree;

  -- 4. (first, while the rule set is still a draft) a shadow result pages nobody and claims nothing
  v_shadow_te := (public.record_vitals_triage_result(v_r1, pg_temp.result('red', 'VT-OX2', 'VIT-E02'), v_rs) ->> 'triage_event_id')::uuid;
  perform pg_temp.res('real', 'a shadow vitals red pages nobody and claims nothing', 'null|0',
    coalesce(public.create_red_page(v_shadow_te)::text, 'null') || '|' || (select count(*)::text from public.red_page_dedupe_claims));
  perform pg_temp.res('real', 'but it already has a dedupe key (so the moment it is signed the key is there)', 'vitals:' || v_p || ':spo2:red',
    (select dedupe_key from private.red_page_dedupe_info(v_shadow_te)));

  -- Sign (inside this rolled-back transaction only) and make the patient a Member.
  update public.triage_rule_sets set status = 'approved', approved_by = v_cmo, approved_at = now() where id = v_rs;
  execute $e$create or replace function private.patient_may_page_doctor(p_patient uuid) returns boolean language sql stable security definer set search_path = '' as $f$ select p_patient <> '$e$ || v_free || $e$'::uuid $f$ $e$;

  -- 1. The engine pages once; the acknowledged duplicate from the unified legacy path folds in
  v_e := (public.record_vitals_triage_result(v_r2, pg_temp.result('red', 'VT-OX2', 'VIT-E02'), v_rs, null, 'approved') ->> 'triage_event_id')::uuid;
  v_pg1 := public.create_red_page(v_e);
  perform pg_temp.res('real', 'the engine''s red result pages once', 'true|1', (v_pg1 is not null)::text || '|' || (select count(*)::text from public.pages where patient_id = v_p and parent_page_id is null));
  perform pg_temp.res('real', 'and records its claim for the reading', v_pg1::text || '|' || v_r2::text,
    (select page_id::text || '|' || reading_id::text from public.red_page_dedupe_claims where dedupe_key = 'vitals:' || v_p || ':spo2:red' and reading_id = v_r2));
  perform set_config('tarragon.paging_write', 'on', true);
  update public.pages set acknowledged_at = now(), acknowledged_by = v_cmo, delivered_at = now() where id = v_pg1;
  perform set_config('tarragon.paging_write', 'off', true);
  v_u := pg_temp.unified(v_org, v_p, v_r2, 'spo2_red');
  v_page := public.create_red_page(v_u);
  perform pg_temp.res('real', 'the unified legacy event for the SAME reading folds into the acknowledged page: same page, no second page', 'true|1|1',
    (v_page = v_pg1)::text || '|' || (select count(*)::text from public.pages where patient_id = v_p and parent_page_id is null) || '|' || (select merged_count::text from public.pages where id = v_pg1));
  perform pg_temp.res('real', 'it is recorded as merged, with an audit row', '1|1',
    (select count(*)::text from public.page_merged_events where triage_event_id = v_u) || '|' || (select count(*)::text from public.audit_log where action = 'page.deduplicated' and entity_id = v_pg1));
  perform pg_temp.res('real', 'asking again changes nothing', 'true|1',
    (public.create_red_page(v_u) = v_pg1)::text || '|' || (select merged_count::text from public.pages where id = v_pg1));

  -- 2. Everything else still pages
  -- another reading of the same metric and level after an acknowledgement (INV-05: it must page)
  v_e := (public.record_vitals_triage_result(v_r1, pg_temp.result('red', 'VT-OX2', 'VIT-E02'), v_rs, null, 'approved') ->> 'triage_event_id')::uuid;
  v_page2 := public.create_red_page(v_e);
  perform pg_temp.res('real', 'another reading of the same metric and level after an acknowledgement pages again (INV-05)', 'true|2',
    (v_page2 is not null and v_page2 <> v_pg1)::text || '|' || (select count(*)::text from public.pages where patient_id = v_p and parent_page_id is null));
  -- interleaved readings: the engine's second event for reading 2 still folds into reading 2's page, although reading 1 has paged since
  v_n := (select count(*) from public.pages where patient_id = v_p and parent_page_id is null);
  v_e := (public.record_vitals_triage_result(v_r2, pg_temp.result('red', 'VT-OX2', 'VIT-E02'), v_rs, null, 'redelivered') ->> 'triage_event_id')::uuid;
  perform pg_temp.res('real', 'two readings of the same metric and level keep their own claims: a late event for the first still folds in', 'true|' || v_n,
    (public.create_red_page(v_e) = v_pg1)::text || '|' || (select count(*)::text from public.pages where patient_id = v_p and parent_page_id is null));
  -- a worse level of the same metric
  v_e := (public.record_vitals_triage_result(v_r3, pg_temp.result('red', 'VT-OX1', 'VIT-E01'), v_rs, null, 'approved') ->> 'triage_event_id')::uuid;
  v_n := (select count(*) from public.pages where patient_id = v_p and parent_page_id is null);
  perform public.create_red_page(v_e);
  perform pg_temp.res('real', 'a worse level of the same metric (emergency after red) is not a duplicate', (v_n + 1)::text, (select count(*)::text from public.pages where patient_id = v_p and parent_page_id is null));
  -- an engine EMERGENCY result never joins an open lower-severity family (INV-05): it makes its own page
  perform pg_temp.res('real', 'the emergency result of the previous step made its own page although a red page was open (INV-05)', '1',
    (select count(*)::text from public.pages where triage_event_id = v_e and parent_page_id is null));
  -- another metric
  perform set_config('tarragon.paging_write', 'on', true);
  update public.pages set acknowledged_at = now(), acknowledged_by = v_cmo, delivered_at = now() where patient_id = v_p and acknowledged_at is null;
  perform set_config('tarragon.paging_write', 'off', true);
  v_e := (public.record_vitals_triage_result(v_r4, pg_temp.result('red', 'VT-PU2', 'VIT-E02'), v_rs, null, 'approved') ->> 'triage_event_id')::uuid;
  v_n := (select count(*) from public.pages where patient_id = v_p and parent_page_id is null);
  perform public.create_red_page(v_e);
  perform pg_temp.res('real', 'another metric is not a duplicate', (v_n + 1)::text, (select count(*)::text from public.pages where patient_id = v_p and parent_page_id is null));
  -- a closed page
  v_e := (public.record_vitals_triage_result(v_r5, pg_temp.result('red', 'VT-TE2', 'VIT-E02'), v_rs, null, 'approved') ->> 'triage_event_id')::uuid;
  v_page := public.create_red_page(v_e);
  perform set_config('tarragon.paging_write', 'on', true);
  update public.pages set acknowledged_at = now(), acknowledged_by = v_cmo, delivered_at = now(), closed_at = now() where id = v_page;
  perform set_config('tarragon.paging_write', 'off', true);
  v_u := pg_temp.unified(v_org, v_p, v_r5, 'temperature_red');
  v_n := (select count(*) from public.pages where patient_id = v_p and parent_page_id is null);
  v_page2 := public.create_red_page(v_u);
  perform pg_temp.res('real', 'the same reading on a CLOSED page is not folded in: it pages again', 'true|' || (v_n + 1),
    (v_page2 <> v_page)::text || '|' || (select count(*)::text from public.pages where patient_id = v_p and parent_page_id is null));
  -- a claim older than the look-back: the pulse page of the "another metric" step is acknowledged, its claim is three hours old, and the legacy event for the same reading comes late
  select page_id into v_page from public.red_page_dedupe_claims where dedupe_key = 'vitals:' || v_p || ':pulse:red';
  perform set_config('tarragon.paging_write', 'on', true);
  update public.pages set acknowledged_at = now(), acknowledged_by = v_cmo, delivered_at = now() where id = v_page;
  update public.red_page_dedupe_claims set claimed_at = now() - interval '5 hours' where dedupe_key = 'vitals:' || v_p || ':pulse:red';
  perform set_config('tarragon.paging_write', 'off', true);
  v_u := pg_temp.unified(v_org, v_p, v_r4, 'pulse_red');
  v_n := (select count(*) from public.pages where patient_id = v_p and parent_page_id is null);
  perform public.create_red_page(v_u);
  perform pg_temp.res('real', 'a claim older than the look-back is not a duplicate: it pages', (v_n + 1)::text, (select count(*)::text from public.pages where patient_id = v_p and parent_page_id is null));
  v_u := pg_temp.unified(v_org, v_p, v_r5, 'temperature_red_late');
  perform pg_temp.res('real', 'an unknown unified basis carries no key at all', '0', (select count(*)::text from private.red_page_dedupe_info(v_u)));

  -- 3. The emergency path
  select id into v_em from public.emergency_events where vital_reading_id = v_r6 and source::text = 'spo2_red_flag' limit 1;
  if v_em is null then
    insert into public.emergency_events (organisation_id, patient_id, source, trigger_detail, status, vital_reading_id)
    values (v_org, v_p, 'spo2_red_flag', 'proof', 'active', v_r6) returning id into v_em;
  end if;
  v_u := pg_temp.unified(v_org, v_p, v_em, 'emergency_event');
  select dedupe_key into v_key from private.red_page_dedupe_info(v_u);
  v_e := (public.record_vitals_triage_result(v_r6, pg_temp.result('red', 'VT-OX1', 'VIT-E01'), v_rs, null, 'approved') ->> 'triage_event_id')::uuid;
  select dedupe_key into v_k2 from private.red_page_dedupe_info(v_e);
  perform pg_temp.res('real', 'the emergency event and the engine''s emergency result share one key', 'vitals:' || v_p || ':spo2:emergency|true',
    coalesce(v_key, 'null') || '|' || (v_key is not distinct from v_k2)::text);
  v_page := public.create_red_page(v_e);
  perform set_config('tarragon.paging_write', 'on', true);
  update public.pages set acknowledged_at = now(), acknowledged_by = v_cmo, delivered_at = now() where id = v_page;
  perform set_config('tarragon.paging_write', 'off', true);
  v_n := (select count(*) from public.pages where patient_id = v_p and parent_page_id is null);
  perform pg_temp.res('real', 'the emergency event of the same reading folds into the acknowledged page, no second page', 'true|' || v_n,
    (public.create_red_page(v_u) = v_page)::text || '|' || (select count(*)::text from public.pages where patient_id = v_p and parent_page_id is null));

  -- the patient-outreach watch: the engine's emergency result opens none (the emergency event has one), its red-level result opens one
  perform pg_temp.res('real', 'the engine''s VIT-E01 result opens no second red alert watch', '0',
    (select count(*)::text from public.red_alert_watch w join public.triage_events t on t.id = w.source_id where w.source_kind = 'triage_event' and t.rule_set_code = 'vitals_care_triage' and t.explanation_key = 'VIT-E01' and t.patient_id = v_p));

  -- 4. Free patient and other rule sets
  v_e := (public.record_vitals_triage_result(v_rfree, pg_temp.result('red', 'VT-PU1', 'VIT-E01'), v_rs, null, 'approved') ->> 'triage_event_id')::uuid;
  perform pg_temp.res('real', 'a Free patient''s red is not paged and claims nothing', 'null|0',
    coalesce(public.create_red_page(v_e)::text, 'null') || '|' || (select count(*)::text from public.red_page_dedupe_claims where dedupe_key like 'vitals:' || v_free || '%'));
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, source, taken_at) values (v_org, v_bp, 'blood_pressure', 190, 125, 'manual', now()) returning id into v_rbp;
  v_e := (public.record_triage_result(v_rbp, jsonb_build_object('status', 'graded', 'grade', 'red', 'ruleId', 'BP-R1', 'explanationKey', 'EMG-001',
      'actions', '[{"kind":"show_emergency_guidance","code":"EMG-001"},{"kind":"page_on_call"}]'::jsonb, 'matchedRuleIds', '["BP-R1"]'::jsonb, 'taskKey', null,
      'ruleSet', jsonb_build_object('code', 'bp_care_triage', 'version', (select version from public.triage_rule_sets where id = v_bp_rs))), v_bp_rs) ->> 'triage_event_id')::uuid;
  perform pg_temp.res('real', 'a blood pressure result carries no key', '0', (select count(*)::text from private.red_page_dedupe_info(v_e)));

  -- 5. Grants and the write guard
  perform pg_temp.res('real', 'create_red_page and the key function are service-role only', 'false',
    (has_function_privilege('anon', 'public.create_red_page(uuid)', 'execute') or has_function_privilege('authenticated', 'public.create_red_page(uuid)', 'execute')
     or has_function_privilege('anon', 'private.red_page_dedupe_info(uuid)', 'execute') or has_function_privilege('authenticated', 'private.red_page_dedupe_info(uuid)', 'execute'))::text);
  perform pg_temp.res('real', 'the claim table is read-only for staff and closed to anon', 'false|false',
    has_table_privilege('authenticated', 'public.red_page_dedupe_claims', 'INSERT')::text || '|' || has_table_privilege('anon', 'public.red_page_dedupe_claims', 'SELECT')::text);
  begin
    insert into public.red_page_dedupe_claims (dedupe_key, page_id) values ('x', v_pg1);
    v_err := 'accepted';
  exception when sqlstate '42501' then v_err := 'refused'; end;
  perform pg_temp.res('real', 'a write outside the paging functions is refused by the guard', 'refused', v_err);
  perform pg_temp.res('real', 'the S19d edit survives in create_red_page', 'true',
    (position('unified_red_paging' in pg_get_functiondef('public.create_red_page(uuid)'::regprocedure)) > 0)::text);

  -- 6. SABOTAGE (a): the key function returns nothing -> the acknowledged duplicate pages a second time
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, pulse_bpm, source, taken_at) values (v_org, v_p, 'pulse', 38, 'manual', now()) returning id into v_r7;
  v_e := (public.record_vitals_triage_result(v_r7, pg_temp.result('red', 'VT-PU2', 'VIT-E02'), v_rs, null, 'approved') ->> 'triage_event_id')::uuid;
  v_page := public.create_red_page(v_e);
  perform set_config('tarragon.paging_write', 'on', true);
  update public.pages set acknowledged_at = now(), acknowledged_by = v_cmo, delivered_at = now() where id = v_page;
  perform set_config('tarragon.paging_write', 'off', true);
  v_u := pg_temp.unified(v_org, v_p, v_r7, 'pulse_red');
  execute $e$create or replace function private.red_page_dedupe_info(p_triage_event uuid) returns table (dedupe_key text, reading_id uuid) language sql stable set search_path = '' as $f$ select null::text, null::uuid where false $f$ $e$;
  v_n := (select count(*) from public.pages where patient_id = v_p and parent_page_id is null);
  perform public.create_red_page(v_u);
  perform pg_temp.res('sabotaged', 'the unified legacy event for the SAME reading folds into the acknowledged page: same page, no second page', v_n::text,
    (select count(*)::text from public.pages where patient_id = v_p and parent_page_id is null));
  -- (b): the claims wiped -> the same
  perform set_config('tarragon.paging_write', 'on', true);
  delete from public.red_page_dedupe_claims;
  perform set_config('tarragon.paging_write', 'off', true);
  perform pg_temp.res('sabotaged', 'a claim is on record for the pulse page', '1', (select count(*)::text from public.red_page_dedupe_claims where dedupe_key = 'vitals:' || v_p || ':pulse:red'));
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'red page dedupe proof FAILED: %', (select string_agg(check_name || ' => expected [' || expected || '] got [' || coalesce(actual, 'null') || ']', '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected is distinct from actual;
  if v_caught < 1 then raise exception 'VACUOUS TEST: the sabotaged key function did not change the result'; end if;
end $$;

select phase, check_name, expected, actual,
       case when phase = 'sabotaged' then case when expected is distinct from actual then 'PASS (caught)' else 'FAIL' end
            else case when expected = actual then 'PASS' else 'FAIL' end end as result
  from results order by phase desc, check_name;
rollback;
