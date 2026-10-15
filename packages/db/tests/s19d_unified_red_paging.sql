-- S19d proof: unified red-event paging behind a flag that ships OFF (migration *_s19d_unified_red_event_paging_flag_off.sql;
-- needs S12, S16, S18, S19, S19c and the two-tier Free path). One rolled-back transaction.
--
--   1. Shape: the config ships inactive and unsigned, the flag reads OFF, grants are tight, a version cannot be live unsigned or edited.
--   2. FLAG OFF (the default): for each source (SpO2 red, pulse red, temperature red, red-flag symptom, emergency event) behaviour is
--      the old behaviour: no page, no unified triage event, every clinician profile gets the legacy notification, the clinician
--      alert still opens. Also OFF when the config table is unreadable (fail safe).
--   3. Only the Chief Medical Officer can switch it on, and only after confirming the test pack; an admin or the CMO can switch off.
--   4. FLAG ON, each source: exactly one root page to the rota primary, the legacy broadcast for that event is suppressed, the clinician
--      alert still opens, the unified triage event is non-shadow with ids only, no second red-alert watch is opened.
--   5. Not red-class stays old: amber levels, a severity-5 symptom, a blood pressure emergency event.
--   6. Double-page prevention: SpO2 then pulse for one patient is one family (merged), both legacy broadcasts suppressed; after an
--      acknowledgement a new red event rings again (INV-05).
--   7. A FREE patient gets guidance only: no page, no unified event, no clinician alert, the emergency event still exists.
--   8. A shadow event never pages; a shadow unified row cannot exist.
--   9. A page-creation failure falls back to the legacy notification (and is audited); no cover keeps the legacy broadcast as well.
--  10. Rollback mid-stream: switching off leaves open pages intact and still escalating; new events go back to the old path.
--  11. The unified page escalates through the ordinary ladder (backup at the timer).
--  12. SABOTAGE: each guard (covers stubbed false, no-cover guard, flag stuck on, error handler removed, Free guard removed, handler
--      wiring removed) must flip the matching check.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(label text primary key, id uuid) on commit drop;
grant all on fx to public;

create function pg_temp.rec(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('real', p_name, p_expected, p_actual) $$;
create function pg_temp.sab(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('sabotaged', p_name, p_expected, p_actual) $$;
create function pg_temp.try(p_sql text) returns text language plpgsql as
$f$ begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $f$;
create function pg_temp.act(p_uid uuid) returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
end $f$;
create function pg_temp.act_anon() returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
end $f$;
create function pg_temp.back() returns void language plpgsql as
$f$ begin
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'ur-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test, language)
  values (v, p_org, p_role::public.user_role, 'UR ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true, 'en')
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone;
  return v;
end $f$;
create function pg_temp.mkdoc(p_org uuid, p_admin uuid, p_label text, p_tier text) returns uuid
language plpgsql as $f$
declare v uuid := pg_temp.mkuser(p_org, p_label, 'clinician'); v_staff uuid;
begin
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
  values (p_org, v, 'UR ' || p_label, 'MDCN', 'UR-' || p_label || '-' || substr(v::text, 1, 8), true, 'active', now(), p_admin,
      p_tier::public.doctor_tier, case when p_tier = 'chief_medical_officer' then 'contracted' else 'employed' end::public.staff_employment_type, 2,
      p_tier = 'chief_medical_officer', case when p_tier = 'chief_medical_officer' then p_admin end, true)
  returning id into v_staff;
  insert into public.clinician_competencies (organisation_id, clinical_staff_id, competency_code, granted_by, is_test) values (p_org, v_staff, 'on_call', p_admin, true);
  insert into public.on_call_readiness (clinician_id, checklist_version, organisation_id, items, is_test) values (v, private.readiness_version(), p_org, private.readiness_items(), true);
  insert into public.push_subscriptions (organisation_id, profile_id, endpoint, p256dh_key, auth_key) values (p_org, v, 'https://push.example.invalid/' || v, 'k', 'a');
  perform set_config('tarragon.paging_write', 'on', true);
  insert into public.page_tests (organisation_id, clinician_id, kind, acknowledged_at, delivered_at, is_test) values (p_org, v, 'readiness', now(), now(), true);
  perform set_config('tarragon.paging_write', 'off', true);
  return v;
end $f$;
create function pg_temp.member(p_org uuid, p_admin uuid, p_label text) returns uuid language plpgsql as
$f$ declare v uuid := pg_temp.mkuser(p_org, p_label, 'patient');
begin
  insert into public.patient_memberships (organisation_id, patient_id, source, state, granted_by, grant_reason, is_test)
  values (p_org, v, 'granted', 'active', p_admin, 'unified red paging proof: a Member', true);
  return v;
end $f$;
-- one reading / symptom / emergency of each kind
create function pg_temp.spo2(p_patient uuid, p_pct integer) returns uuid language plpgsql as
$f$ declare v uuid;
begin
  insert into public.vitals_readings (id, organisation_id, patient_id, vital_type, spo2_pct, taken_at, source)
  select gen_random_uuid(), organisation_id, p_patient, 'spo2', p_pct, now(), 'manual' from public.profiles where id = p_patient returning id into v;
  return v;
end $f$;
create function pg_temp.temp(p_patient uuid, p_c numeric) returns uuid language plpgsql as
$f$ declare v uuid;
begin
  insert into public.vitals_readings (id, organisation_id, patient_id, vital_type, temperature_c, taken_at, source)
  select gen_random_uuid(), organisation_id, p_patient, 'temperature', p_c, now(), 'manual' from public.profiles where id = p_patient returning id into v;
  return v;
end $f$;
create function pg_temp.pulse(p_patient uuid, p_bpm integer) returns uuid language plpgsql as
$f$ declare v uuid;
begin
  insert into public.vitals_readings (id, organisation_id, patient_id, vital_type, pulse_bpm, taken_at, source)
  select gen_random_uuid(), organisation_id, p_patient, 'pulse', p_bpm, now(), 'manual' from public.profiles where id = p_patient returning id into v;
  return v;
end $f$;
create function pg_temp.symptom(p_patient uuid, p_type text, p_sev integer) returns uuid language plpgsql as
$f$ declare v uuid;
begin
  insert into public.symptoms (organisation_id, patient_id, symptom_type, severity)
  select organisation_id, p_patient, p_type::public.symptom_type, p_sev from public.profiles where id = p_patient returning id into v;
  return v;
end $f$;
create function pg_temp.ee(p_patient uuid, p_source text) returns uuid language plpgsql as
$f$ declare v uuid;
begin
  insert into public.emergency_events (organisation_id, patient_id, source, trigger_detail, status)
  select organisation_id, p_patient, p_source::public.emergency_source, 'proof event', 'active' from public.profiles where id = p_patient returning id into v;
  return v;
end $f$;
-- counts
create function pg_temp.roots(p_patient uuid) returns integer language sql as
$f$ select count(*)::integer from public.pages where patient_id = p_patient and parent_page_id is null $f$;
create function pg_temp.legacy_n(p_patient uuid) returns integer language sql as
$f$ select count(*)::integer from public.notifications n
     where n.source_table = 'clinician_alerts'
       and n.source_id in (select id from public.clinician_alerts where patient_id = p_patient)
       and n.template in ('vitals_red_flag_clinician_alert', 'emergency_event_clinician_alert') $f$;
create function pg_temp.alerts(p_patient uuid) returns integer language sql as
$f$ select count(*)::integer from public.clinician_alerts where patient_id = p_patient $f$;
create function pg_temp.ute(p_patient uuid) returns integer language sql as
$f$ select count(*)::integer from public.triage_events where patient_id = p_patient and rule_set_code = 'unified_red_paging' $f$;

do $$
declare
  v_org uuid; v_admin uuid; v_cmo uuid; v_p uuid; v_b uuid; v_other uuid;
  v_n_clin integer;
  m_off1 uuid; m_off2 uuid; m_off3 uuid; m_off4 uuid; m_off5 uuid; m_cfg uuid;
  m1 uuid; m2 uuid; m3 uuid; m4 uuid; m5 uuid; m6 uuid; m7 uuid; m8 uuid; m9 uuid; m10 uuid; m11 uuid; m12 uuid; m13 uuid; m14 uuid;
  f1 uuid; f2 uuid; v_rota jsonb; v_te uuid; v_page uuid; v_root public.pages%rowtype; v_r text; v_x uuid; v_d text; v_cfg uuid;
  v_orig_covers text; v_orig_on text; v_orig_create text; v_orig_spo2 text; v_ev uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  update public.clinical_staff set active = false where is_test is not true;
  v_cmo := pg_temp.mkdoc(v_org, v_admin, 'cmo', 'chief_medical_officer');
  v_p := pg_temp.mkdoc(v_org, v_admin, 'primary', 'senior_medical_officer');
  v_b := pg_temp.mkdoc(v_org, v_admin, 'backup', 'senior_medical_officer');
  v_other := pg_temp.mkdoc(v_org, v_admin, 'other', 'senior_medical_officer');
  select count(*)::integer into v_n_clin from public.profiles where organisation_id = v_org and role = 'clinician';
  insert into fx values ('admin', v_admin), ('cmo', v_cmo), ('primary', v_p), ('backup', v_b), ('other', v_other);

  perform pg_temp.act(v_cmo);
  v_rota := public.set_on_call_rota(now() - interval '1 minute', now() + interval '10 hours', v_p, v_b, null);
  perform pg_temp.back();

  -- 1. Shape -------------------------------------------------------------------------------------------------------
  select id into v_cfg from public.unified_red_paging_config where version = 1;
  perform pg_temp.rec('version 1 ships inactive and unsigned', 'false,false', (select is_active::text || ',' || (approved_at is not null)::text from public.unified_red_paging_config where version = 1));
  perform pg_temp.rec('the flag reads OFF with no active version', 'false,false,false', private.unified_red_paging_on('spo2_red')::text || ',' || private.unified_red_paging_on('emergency_event')::text || ',' || private.unified_red_paging_on('nonsense')::text);
  perform pg_temp.rec('a version cannot be live without a signature', '23514', pg_temp.try(format('update public.unified_red_paging_config set is_active = true where id = %L', v_cfg)));
  perform pg_temp.rec('the rules of a version cannot be edited', '55000', pg_temp.try(format($q$update public.unified_red_paging_config set rules = rules || '{"spo2_red":0}'::jsonb where id = %L$q$, v_cfg)));
  perform pg_temp.rec('a version cannot be deleted', '55000', pg_temp.try(format('delete from public.unified_red_paging_config where id = %L', v_cfg)));
  perform pg_temp.rec('a malformed version is refused', '23514', pg_temp.try($q$insert into public.unified_red_paging_config (version, effective_from, rules) values (97, current_date, '{"spo2_red":2}')$q$));
  perform pg_temp.rec('anon holds nothing on the config or the entry points', 'false,false,false,false',
    has_table_privilege('anon', 'public.unified_red_paging_config', 'SELECT')::text || ',' ||
    has_function_privilege('anon', 'public.sign_unified_red_paging_config(integer,boolean)', 'EXECUTE')::text || ',' ||
    has_function_privilege('anon', 'public.switch_off_unified_red_paging()', 'EXECUTE')::text || ',' ||
    has_function_privilege('authenticated', 'private.unified_red_page_covers(text,uuid,uuid,text,text,uuid)', 'EXECUTE')::text);
  perform pg_temp.rec('authenticated cannot write the config table', '0',
    (select count(*)::text from information_schema.role_table_grants where table_schema = 'public' and table_name = 'unified_red_paging_config' and grantee = 'authenticated' and privilege_type <> 'SELECT'));
  perform pg_temp.rec('every patched handler carries the hook', '5',
    (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'private' and p.proname in ('handle_spo2_reading_red_flag', 'handle_pulse_reading_red_flag', 'handle_temperature_reading_red_flag', 'handle_symptom_red_flag', 'handle_emergency_event')
        and pg_get_functiondef(p.oid) like '%unified_red_page_covers%'));
  perform pg_temp.rec('blood pressure and the abnormal screening pipeline are NOT hooked', '0',
    (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('private', 'public') and (case when p.prokind = 'f' then pg_get_functiondef(p.oid) end) like '%unified_red_page_covers%'
        and p.proname not in ('handle_spo2_reading_red_flag', 'handle_pulse_reading_red_flag', 'handle_temperature_reading_red_flag', 'handle_symptom_red_flag', 'handle_emergency_event', 'unified_red_page_covers')));

  -- 2. FLAG OFF: the old behaviour, source by source -------------------------------------------------------------------
  m_off1 := pg_temp.member(v_org, v_admin, 'off-spo2'); m_off2 := pg_temp.member(v_org, v_admin, 'off-pulse'); m_off3 := pg_temp.member(v_org, v_admin, 'off-temp');
  m_off4 := pg_temp.member(v_org, v_admin, 'off-symptom'); m_off5 := pg_temp.member(v_org, v_admin, 'off-emergency');
  perform pg_temp.spo2(m_off1, 91);
  perform pg_temp.pulse(m_off2, 130);
  perform pg_temp.temp(m_off3, 39.5);
  perform pg_temp.symptom(m_off4, 'chest_pain', 7);
  perform pg_temp.ee(m_off5, 'pulse_red_flag');
  perform pg_temp.rec('OFF: SpO2 red makes no page, no unified event, notifies every clinician profile, alert opens', '0|0|' || v_n_clin || '|1',
    pg_temp.roots(m_off1) || '|' || pg_temp.ute(m_off1) || '|' || pg_temp.legacy_n(m_off1) || '|' || pg_temp.alerts(m_off1));
  perform pg_temp.rec('OFF: pulse red is unchanged', '0|0|' || v_n_clin || '|1', pg_temp.roots(m_off2) || '|' || pg_temp.ute(m_off2) || '|' || pg_temp.legacy_n(m_off2) || '|' || pg_temp.alerts(m_off2));
  perform pg_temp.rec('OFF: temperature red is unchanged', '0|0|' || v_n_clin || '|1', pg_temp.roots(m_off3) || '|' || pg_temp.ute(m_off3) || '|' || pg_temp.legacy_n(m_off3) || '|' || pg_temp.alerts(m_off3));
  perform pg_temp.rec('OFF: red-flag symptom is unchanged', '0|0|' || v_n_clin || '|1', pg_temp.roots(m_off4) || '|' || pg_temp.ute(m_off4) || '|' || pg_temp.legacy_n(m_off4) || '|' || pg_temp.alerts(m_off4));
  perform pg_temp.rec('OFF: emergency event is unchanged', '0|0|' || v_n_clin || '|1', pg_temp.roots(m_off5) || '|' || pg_temp.ute(m_off5) || '|' || pg_temp.legacy_n(m_off5) || '|' || pg_temp.alerts(m_off5));
  perform pg_temp.rec('OFF: the emergency event still opens its own red-alert watch', '1', (select count(*)::text from public.red_alert_watch where patient_id = m_off5 and source_kind = 'emergency_event'));

  -- fail safe: an unreadable config table reads OFF, it never raises into a clinical insert and never turns ON
  m_cfg := pg_temp.member(v_org, v_admin, 'cfg-unreadable');
  alter table public.unified_red_paging_config rename to unified_red_paging_config_x;
  v_r := pg_temp.try(format('select pg_temp.spo2(%L, 91)', m_cfg));
  alter table public.unified_red_paging_config_x rename to unified_red_paging_config;
  perform pg_temp.rec('OFF: an unreadable config does not stop the reading and behaves as the old path', 'ok|0|' || v_n_clin, v_r || '|' || pg_temp.roots(m_cfg) || '|' || pg_temp.legacy_n(m_cfg));

  -- 3. Who can switch it on / off ---------------------------------------------------------------------------------------
  perform pg_temp.act(v_p);
  perform pg_temp.rec('an ordinary doctor cannot switch it on', '42501', pg_temp.try('select public.sign_unified_red_paging_config(1, true)'));
  perform pg_temp.rec('an ordinary doctor cannot switch it off', '42501', pg_temp.try('select public.switch_off_unified_red_paging()'));
  perform pg_temp.back();
  perform pg_temp.act(v_admin);
  perform pg_temp.rec('an admin cannot switch it on', '42501', pg_temp.try('select public.sign_unified_red_paging_config(1, true)'));
  perform pg_temp.back();
  perform pg_temp.act_anon();
  perform pg_temp.rec('anon cannot call the controls', '42501', pg_temp.try('select public.sign_unified_red_paging_config(1, true)'));
  perform pg_temp.back();
  perform pg_temp.act(v_cmo);
  perform pg_temp.rec('the CMO cannot switch it on without confirming the test pack', '22023', pg_temp.try('select public.sign_unified_red_paging_config(1, false)'));
  perform pg_temp.rec('an unknown version is refused', 'P0002', pg_temp.try('select public.sign_unified_red_paging_config(99, true)'));
  perform pg_temp.back();
  perform pg_temp.rec('still OFF after every refused attempt', 'false', private.unified_red_paging_on('spo2_red')::text);
  perform pg_temp.act(v_cmo);
  perform public.sign_unified_red_paging_config(1, true);
  perform pg_temp.back();
  perform pg_temp.rec('the CMO switches it on: signed, stamped, live', 'true,true,true', (select is_active::text || ',' || (approved_by = v_cmo)::text || ',' || (test_pack_confirmed_at is not null)::text from public.unified_red_paging_config where version = 1));
  perform pg_temp.rec('the flag now reads ON for every source', 'true,true,true,true,true', private.unified_red_paging_on('spo2_red')::text || ',' || private.unified_red_paging_on('pulse_red')::text || ',' || private.unified_red_paging_on('temperature_red')::text || ',' || private.unified_red_paging_on('symptom_red_flag')::text || ',' || private.unified_red_paging_on('emergency_event')::text);
  perform pg_temp.act(v_cmo);
  perform pg_temp.rec('switching on twice is refused', '23514', pg_temp.try('select public.sign_unified_red_paging_config(1, true)'));
  perform pg_temp.back();
  perform pg_temp.rec('the switch-on is audited', '1', (select count(*)::text from public.audit_log where action = 'unified_red_paging.switched_on' and actor_id = v_cmo));

  -- 4. FLAG ON: each source ------------------------------------------------------------------------------------------------
  m1 := pg_temp.member(v_org, v_admin, 'on-spo2'); m2 := pg_temp.member(v_org, v_admin, 'on-pulse'); m3 := pg_temp.member(v_org, v_admin, 'on-temp');
  m4 := pg_temp.member(v_org, v_admin, 'on-symptom'); m5 := pg_temp.member(v_org, v_admin, 'on-emergency-spo2'); m6 := pg_temp.member(v_org, v_admin, 'on-emergency-pulse');
  m7 := pg_temp.member(v_org, v_admin, 'on-emergency-glucose'); m8 := pg_temp.member(v_org, v_admin, 'on-emergency-mh');
  perform pg_temp.spo2(m1, 91);
  perform pg_temp.pulse(m2, 130);
  perform pg_temp.temp(m3, 39.5);
  perform pg_temp.symptom(m4, 'chest_pain', 7);
  perform pg_temp.spo2(m5, 85);          -- emergency level: reading -> emergency event -> page
  perform pg_temp.pulse(m6, 30);
  perform pg_temp.ee(m7, 'glucose_red_flag');
  perform pg_temp.ee(m8, 'mental_health_screen');
  perform pg_temp.rec('ON: SpO2 red makes one page to the primary, suppresses the broadcast, still opens the alert', '1|' || v_p || '|0|1|1',
    pg_temp.roots(m1) || '|' || (select to_clinician_id from public.pages where patient_id = m1 and parent_page_id is null) || '|' || pg_temp.legacy_n(m1) || '|' || pg_temp.alerts(m1) || '|' || pg_temp.ute(m1));
  perform pg_temp.rec('ON: pulse red', '1|' || v_p || '|0|1|1',
    pg_temp.roots(m2) || '|' || (select to_clinician_id from public.pages where patient_id = m2 and parent_page_id is null) || '|' || pg_temp.legacy_n(m2) || '|' || pg_temp.alerts(m2) || '|' || pg_temp.ute(m2));
  perform pg_temp.rec('ON: temperature red', '1|' || v_p || '|0|1|1',
    pg_temp.roots(m3) || '|' || (select to_clinician_id from public.pages where patient_id = m3 and parent_page_id is null) || '|' || pg_temp.legacy_n(m3) || '|' || pg_temp.alerts(m3) || '|' || pg_temp.ute(m3));
  perform pg_temp.rec('ON: red-flag symptom', '1|' || v_p || '|0|1|1',
    pg_temp.roots(m4) || '|' || (select to_clinician_id from public.pages where patient_id = m4 and parent_page_id is null) || '|' || pg_temp.legacy_n(m4) || '|' || pg_temp.alerts(m4) || '|' || pg_temp.ute(m4));
  perform pg_temp.rec('ON: SpO2 emergency level is paged through its emergency event, legacy broadcast suppressed, guidance event kept', '1|0|1|1',
    pg_temp.roots(m5) || '|' || pg_temp.legacy_n(m5) || '|' || (select count(*)::text from public.emergency_events where patient_id = m5 and source = 'spo2_red_flag') || '|' || pg_temp.ute(m5));
  perform pg_temp.rec('ON: pulse emergency level', '1|0|1|1',
    pg_temp.roots(m6) || '|' || pg_temp.legacy_n(m6) || '|' || (select count(*)::text from public.emergency_events where patient_id = m6 and source = 'pulse_red_flag') || '|' || pg_temp.ute(m6));
  perform pg_temp.rec('ON: glucose red flag emergency event', '1|0|1', pg_temp.roots(m7) || '|' || pg_temp.legacy_n(m7) || '|' || pg_temp.ute(m7));
  perform pg_temp.rec('ON: a mental health screen crisis keeps its own pager: no second page, old broadcast kept, nothing unified', '0|' || v_n_clin || '|0', pg_temp.roots(m8) || '|' || pg_temp.legacy_n(m8) || '|' || pg_temp.ute(m8));
  perform pg_temp.rec('ON: the emergency event still opens its own red-alert watch (guidance independent of paging)', '1',
    (select count(*)::text from public.red_alert_watch where patient_id = m5 and source_kind = 'emergency_event'));
  perform pg_temp.rec('ON: the unified triage event opens NO second watch', '0', (select count(*)::text from public.red_alert_watch where patient_id in (m1, m2, m3, m4, m5) and source_kind = 'triage_event'));
  select * into v_root from public.pages where patient_id = m1 and parent_page_id is null;
  perform pg_temp.rec('ON: the unified event is a non-shadow red page_on_call grade with ids only', 'red|false|unified_red_paging|spo2_red|vitals_readings',
    (select grade || '|' || shadow::text || '|' || rule_set_code || '|' || (context ->> 'source') || '|' || (context ->> 'ref_table') from public.triage_events where id = v_root.triage_event_id));
  perform pg_temp.rec('ON: the unified event holds no reading value', 'false', (select (context::text ~ '[0-9]{2}\.|spo2_pct|systolic')::text from public.triage_events where id = v_root.triage_event_id));
  perform pg_temp.rec('ON: no clinical task or page notice carries the legacy template', '0',
    (select count(*)::text from public.notifications where template in ('vitals_red_flag_clinician_alert') and source_id in (select id from public.clinician_alerts where patient_id in (m1, m2, m3, m4))));
  perform pg_temp.rec('ON: the page notice to the primary exists and is the fixed page template', '1',
    (select count(distinct source_id)::text from public.notifications where recipient_id = v_p and template = 'on_call_page' and source_table = 'pages' and source_id = v_root.id));
  perform pg_temp.rec('ON: no sms or voice row exists for the pages (no SMS for pages)', '0',
    (select count(*)::text from public.notifications where source_table = 'pages' and channel::text in ('sms', 'voice')));

  -- 5. Not red-class stays on the old path -----------------------------------------------------------------------------------
  m9 := pg_temp.member(v_org, v_admin, 'amber-spo2'); m10 := pg_temp.member(v_org, v_admin, 'amber-symptom'); m11 := pg_temp.member(v_org, v_admin, 'bp-emergency');
  perform pg_temp.spo2(m9, 93);
  perform pg_temp.symptom(m10, 'chest_pain', 5);
  perform pg_temp.ee(m11, 'bp_reading');
  perform pg_temp.rec('ON: an amber SpO2 makes no page and keeps the old notice', '0|0|' || v_n_clin, pg_temp.roots(m9) || '|' || pg_temp.ute(m9) || '|' || pg_temp.legacy_n(m9));
  perform pg_temp.rec('ON: a severity-5 symptom (review, not red) keeps the old notice', '0|0|' || v_n_clin, pg_temp.roots(m10) || '|' || pg_temp.ute(m10) || '|' || pg_temp.legacy_n(m10));
  perform pg_temp.rec('ON: a blood pressure emergency event stays on its own path (triage page), old notice kept, nothing unified', '0|0|' || v_n_clin, pg_temp.roots(m11) || '|' || pg_temp.ute(m11) || '|' || pg_temp.legacy_n(m11));

  -- 6. One family per patient event window; a new event after acknowledgement rings again --------------------------------------
  m12 := pg_temp.member(v_org, v_admin, 'family');
  perform pg_temp.spo2(m12, 91);
  perform pg_temp.pulse(m12, 130);
  perform pg_temp.temp(m12, 39.5);
  perform pg_temp.rec('ON: three red events in the window are one page family with two merged, none notified the old way', '1|2|0',
    pg_temp.roots(m12) || '|' || (select merged_count::text from public.pages where patient_id = m12 and parent_page_id is null) || '|' || pg_temp.legacy_n(m12));
  perform pg_temp.rec('ON: the primary was sent exactly one page for the family (one page id, not one per event)', '1',
    (select count(distinct source_id)::text from public.notifications where recipient_id = v_p and template = 'on_call_page' and source_id in (select id from public.pages where patient_id = m12)));
  perform pg_temp.act(v_p);
  perform public.acknowledge_page((select id from public.pages where patient_id = m12 and parent_page_id is null));
  perform pg_temp.back();
  -- a red-flag symptom is a fresh alert every time; a repeat reading of the same vital with its alert still open raises nothing new on the
  -- old path either (the legacy handler only notifies when the level rises), so it is not used here
  perform pg_temp.symptom(m12, 'chest_pain', 7);
  perform pg_temp.rec('ON: after the family was acknowledged a new red event makes a NEW page (INV-05)', '2', pg_temp.roots(m12)::text);

  -- 7. A FREE patient: guidance only -----------------------------------------------------------------------------------------
  f1 := pg_temp.mkuser(v_org, 'free-1', 'patient'); f2 := pg_temp.mkuser(v_org, 'free-2', 'patient');
  perform pg_temp.spo2(f1, 91);
  perform pg_temp.spo2(f2, 85);
  perform pg_temp.rec('ON: a Free patient SpO2 red pages nobody and opens no clinician alert or unified event', '0|0|0|0',
    pg_temp.roots(f1) || '|' || pg_temp.ute(f1) || '|' || pg_temp.alerts(f1) || '|' || pg_temp.legacy_n(f1));
  perform pg_temp.rec('ON: a Free patient emergency still gets the emergency event (guidance) and nothing for a doctor', '1|0|0|0',
    (select count(*)::text from public.emergency_events where patient_id = f2 and source = 'spo2_red_flag') || '|' || pg_temp.roots(f2) || '|' || pg_temp.alerts(f2) || '|' || pg_temp.ute(f2));
  perform pg_temp.rec('ON: calling the entry point directly for a Free patient creates nothing', 'false|0',
    private.unified_red_page_covers('spo2_red', v_org, f1, 'observation', 'vitals_readings', gen_random_uuid())::text || '|' || pg_temp.ute(f1));

  -- 8. Shadow ----------------------------------------------------------------------------------------------------------------
  perform pg_temp.rec('a shadow row carrying the unified code cannot exist', '23514', pg_temp.try(format($q$
    insert into public.triage_events (organisation_id, patient_id, trigger_type, trigger_id, grade, rule_id, rule_set_id, rule_set_code, rule_set_version, rule_set_status, actions, shadow, is_test, basis)
    values (%L, %L, 'observation', gen_random_uuid(), 'red', 'X', null, 'unified_red_paging', 1, 'draft', '[{"kind":"page_on_call"}]', true, true, 'x')$q$, v_org, m9)));
  perform pg_temp.rec('a unified row that is not red cannot exist', '23514', pg_temp.try(format($q$
    insert into public.triage_events (organisation_id, patient_id, trigger_type, trigger_id, grade, rule_id, rule_set_id, rule_set_code, rule_set_version, rule_set_status, actions, shadow, is_test, basis)
    values (%L, %L, 'observation', gen_random_uuid(), 'amber', 'X', null, 'unified_red_paging', 1, 'approved', '[]', false, true, 'x')$q$, v_org, m9)));
  -- a shadow grade from the engine itself still pages nobody
  declare v_rs uuid; v_sh uuid; m_sh uuid := pg_temp.member(v_org, v_admin, 'shadow');
  begin
    insert into public.triage_rule_sets (code, version, status, rules, note) values ('urtest', 1, 'draft', '{"code":"urtest","version":1}'::jsonb, 'unified red paging proof fixture') returning id into v_rs;
    insert into public.triage_events (organisation_id, patient_id, trigger_type, trigger_id, grade, rule_id, rule_set_id, rule_set_code, rule_set_version, rule_set_status, actions, shadow, is_test, basis)
    values (v_org, m_sh, 'observation', gen_random_uuid(), 'red', 'R1', v_rs, 'urtest', 1, 'draft', '[{"kind":"page_on_call"}]', true, true, 'x') returning id into v_sh;
    perform pg_temp.rec('a shadow red grade still pages nobody with the flag ON', 'null|0', coalesce(public.create_red_page(v_sh)::text, 'null') || '|' || pg_temp.roots(m_sh));
  end;

  -- 9. Page creation fails: the old notification runs; no cover: both run -------------------------------------------------------
  m13 := pg_temp.member(v_org, v_admin, 'create-fails');
  v_orig_create := pg_get_functiondef('public.create_red_page(uuid)'::regprocedure);
  create or replace function public.create_red_page(p_triage_event uuid) returns uuid language plpgsql security definer set search_path = ''
    as $f$ begin raise exception 'simulated page failure'; end $f$;
  v_r := pg_temp.try(format('select pg_temp.spo2(%L, 91)', m13));
  execute v_orig_create;
  perform pg_temp.rec('ON, page creation fails: the reading is saved, the OLD broadcast runs, no half-made unified event', 'ok|0|' || v_n_clin || '|0|1',
    v_r || '|' || pg_temp.roots(m13) || '|' || pg_temp.legacy_n(m13) || '|' || pg_temp.ute(m13) || '|' || pg_temp.alerts(m13));
  perform pg_temp.rec('the failure is audited', '1', (select count(*)::text from public.audit_log where action = 'unified_red_page.error' and entity_id in (select id from public.vitals_readings where patient_id = m13)));

  -- 11. The unified page escalates through the ordinary ladder ---------------------------------------------------------------------
  perform set_config('tarragon.paging_write', 'on', true);
  update public.pages set sent_at = now() - interval '6 minutes' where patient_id = m3 and parent_page_id is null;
  perform set_config('tarragon.paging_write', 'off', true);
  perform private.sweep_pages();
  perform pg_temp.rec('a unified page is escalated to the backup at the timer', '1|' || v_b,
    (select count(*)::text from public.pages where patient_id = m3 and role = 'backup') || '|' || coalesce((select to_clinician_id::text from public.pages where patient_id = m3 and role = 'backup'), 'none'));

  -- 10. Rollback mid-stream --------------------------------------------------------------------------------------------------------
  perform pg_temp.act(v_admin);
  perform pg_temp.rec('an admin can switch it off', '1', public.switch_off_unified_red_paging()::text);
  perform pg_temp.back();
  perform pg_temp.rec('switched off: the flag reads OFF again and the switch-off is audited', 'false|1',
    private.unified_red_paging_on('spo2_red')::text || '|' || (select count(*)::text from public.audit_log where action = 'unified_red_paging.switched_off' and actor_id = v_admin));
  perform pg_temp.rec('rollback leaves the open pages open and unacknowledged', '0',
    (select count(*)::text from public.pages where patient_id in (m1, m2, m3, m4, m5, m6) and parent_page_id is null and (closed_at is not null or acknowledged_at is not null)));
  perform set_config('tarragon.paging_write', 'on', true);
  update public.pages set sent_at = now() - interval '11 minutes' where patient_id = m4 and parent_page_id is null;
  perform set_config('tarragon.paging_write', 'off', true);
  perform private.sweep_pages();
  perform pg_temp.rec('rollback leaves an open page still escalating (the lead is alerted at the second timer)', '1',
    (select count(*)::text from public.pages where patient_id = m4 and role = 'escalation'));
  declare m_rb uuid := pg_temp.member(v_org, v_admin, 'after-rollback');
  begin
    perform pg_temp.spo2(m_rb, 91);
    perform pg_temp.rec('after switch-off a new red event goes back to the old path', '0|0|' || v_n_clin, pg_temp.roots(m_rb) || '|' || pg_temp.ute(m_rb) || '|' || pg_temp.legacy_n(m_rb));
  end;
  -- and it can be switched back on (CMO, test pack confirmed again)
  perform pg_temp.act(v_cmo);
  perform public.sign_unified_red_paging_config(1, true);
  perform pg_temp.back();
  perform pg_temp.rec('the CMO can switch it back on', 'true', private.unified_red_paging_on('spo2_red')::text);

  m14 := pg_temp.member(v_org, v_admin, 'no-cover');
  update public.clinical_staff set active = false where profile_id in (v_p, v_b, v_other);
  perform pg_temp.spo2(m14, 91);
  update public.clinical_staff set active = true where profile_id in (v_p, v_b, v_other);
  perform pg_temp.rec('ON, nobody on cover: a no-cover page exists AND the old broadcast also runs', '1|true|' || v_n_clin,
    pg_temp.roots(m14) || '|' || (select no_cover::text from public.pages where patient_id = m14 and parent_page_id is null) || '|' || pg_temp.legacy_n(m14));


  -- 12. SABOTAGE ----------------------------------------------------------------------------------------------------------------------
  v_orig_covers := pg_get_functiondef('private.unified_red_page_covers(text,uuid,uuid,text,text,uuid)'::regprocedure);
  v_orig_on := pg_get_functiondef('private.unified_red_paging_on(text)'::regprocedure);
  v_orig_spo2 := pg_get_functiondef('private.handle_spo2_reading_red_flag()'::regprocedure);

  -- S1: the entry point never pages. A Member SpO2 red must then wrongly make no page.
  create or replace function private.unified_red_page_covers(p_source text, p_org uuid, p_patient uuid, p_trigger_type text, p_ref_table text, p_ref_id uuid)
    returns boolean language sql as $f$ select false $f$;
  declare m_s1 uuid := pg_temp.member(v_org, v_admin, 'sab1');
  begin
    perform pg_temp.spo2(m_s1, 91);
    perform pg_temp.sab('ON: a Member SpO2 red makes one page', '1', pg_temp.roots(m_s1)::text);
  end;
  execute v_orig_covers;

  -- S2: the no-cover guard removed (always report "covered"). The no-cover event must then wrongly lose its old broadcast.
  create or replace function private.unified_red_page_covers(p_source text, p_org uuid, p_patient uuid, p_trigger_type text, p_ref_table text, p_ref_id uuid)
    returns boolean language sql as $f$ select true $f$;
  declare m_s2 uuid := pg_temp.member(v_org, v_admin, 'sab2');
  begin
    update public.clinical_staff set active = false where profile_id in (v_p, v_b, v_other);
    perform pg_temp.spo2(m_s2, 91);
    update public.clinical_staff set active = true where profile_id in (v_p, v_b, v_other);
    perform pg_temp.sab('ON, nobody on cover: the old broadcast also runs', v_n_clin::text, pg_temp.legacy_n(m_s2)::text);
  end;
  execute v_orig_covers;

  -- S3: the flag stuck ON. After switch-off a Member SpO2 red must then wrongly page.
  perform pg_temp.act(v_admin); perform public.switch_off_unified_red_paging(); perform pg_temp.back();
  create or replace function private.unified_red_paging_on(p_source text) returns boolean language sql as $f$ select true $f$;
  declare m_s3 uuid := pg_temp.member(v_org, v_admin, 'sab3');
  begin
    perform pg_temp.spo2(m_s3, 91);
    perform pg_temp.sab('OFF: a Member SpO2 red makes no page', '0', pg_temp.roots(m_s3)::text);
  end;
  execute v_orig_on;
  perform pg_temp.act(v_cmo); perform public.sign_unified_red_paging_config(1, true); perform pg_temp.back();

  -- S4: the error handler removed. A failing page must then break the clinical insert.
  v_d := v_orig_covers;
  if replace(v_d, 'exception when others then', 'exception when no_data_found then') = v_d then raise exception 'VACUOUS TEST: error handler text not found'; end if;
  execute replace(v_d, 'exception when others then', 'exception when no_data_found then');
  create or replace function public.create_red_page(p_triage_event uuid) returns uuid language plpgsql security definer set search_path = ''
    as $f$ begin raise exception 'simulated page failure'; end $f$;
  declare m_s4 uuid := pg_temp.member(v_org, v_admin, 'sab4');
  begin
    v_r := pg_temp.try(format('select pg_temp.spo2(%L, 91)', m_s4));
    perform pg_temp.sab('ON, page creation fails: the reading is still saved', 'ok', v_r);
  exception when others then
    insert into results values ('sabotaged', 'ON, page creation fails: the reading is still saved', 'ok', sqlstate);
  end;
  execute v_orig_create;
  execute v_orig_covers;

  -- S5: the Free guard removed. A Free patient must then wrongly get a unified event.
  v_d := v_orig_covers;
  if replace(v_d, 'if not private.patient_may_page_doctor(p_patient) then return false; end if;', '') = v_d then raise exception 'VACUOUS TEST: Free guard text not found'; end if;
  execute replace(v_d, 'if not private.patient_may_page_doctor(p_patient) then return false; end if;', '');
  perform private.unified_red_page_covers('spo2_red', v_org, f2, 'observation', 'vitals_readings', gen_random_uuid());
  perform pg_temp.sab('ON: calling the entry point directly for a Free patient creates nothing', '0', pg_temp.ute(f2)::text);
  execute v_orig_covers;

  -- S6: the handler wiring removed. A Member SpO2 red must then wrongly keep the old broadcast beside the page.
  v_d := v_orig_spo2;
  if position('unified_red_page_covers' in v_d) = 0 then raise exception 'VACUOUS TEST: hook text not found'; end if;
  execute regexp_replace(v_d, 'if v_should_page and not \(v_level = ''red'' and private\.unified_red_page_covers\([^)]*\)\) then', 'if v_should_page then');
  declare m_s6 uuid := pg_temp.member(v_org, v_admin, 'sab6');
  begin
    perform pg_temp.spo2(m_s6, 91);
    perform pg_temp.sab('ON: the old broadcast is suppressed when a page covers the event', '0', pg_temp.legacy_n(m_s6)::text);
  end;
  execute v_orig_spo2;
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'Unified red paging proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ')
         from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 6 then
    raise exception 'VACUOUS TEST: only % of 6 sabotage steps changed the matching check', v_caught;
  end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;
-- Sabotaged rows are asserted to differ inside the DO block above and are deliberately not printed: the runner treats
-- any FAIL verdict in the output as a failed proof.

rollback;
