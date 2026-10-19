-- S19f proof: the CONFIRMED retirement of the legacy "notify every clinician" broadcast for blood pressure and glucose, and the Care Circle
-- notice for a unified red-event page (migration *_s19f_legacy_notice_retirement_and_circle_page_notice.sql; needs S12, S16, S18, S19, S19c, S19d,
-- S29 and the two-tier Free path). One rolled-back transaction. now() is frozen inside it, so deadlines and ages are moved by hand.
--
--   1. Shape: four versions ship inactive and unsigned, everything reads OFF, grants are tight, a version cannot be live unsigned or edited.
--   2. FLAG OFF (the default, also when the config is unreadable): BP red, BP emergency and glucose emergency behave exactly as before: the broadcast
--      goes out at once, no hold row exists, and the notification shape is the reference for the "released" comparison below.
--   3. Who can sign (CMO only, with the test pack, a retiring version only after a parallel run) and who can switch off (CMO or admin).
--   4. PARALLEL RUN (version 1): both fire as today; every event is measured; the measurement fills in when the page arrives; amber and Free are not measured.
--   5. HOLD (version 2): a reachable primary and a page of THAT event suppress the broadcast; no page, a page for another event, an unreachable
--      primary, no cover, a quiet event bus, an unapproved rule set, a Free patient all leave the broadcast to fire (at once or at the deadline) with the
--      same notification shape; emergencies keep their broadcast under version 2; switching off releases a held notice at once; both sweep drivers work;
--      an overdue hold opens an incident.
--   6. Version 3 retires the emergency broadcast too (BP crisis and glucose emergency), and other emergency sources are untouched.
--   7. Care Circle: a unified page tells the circle only when version 4 is live, only for a member holding red_alerts, never for a symptom event of a
--      patient with a pregnancy footprint or for a reproductive symptom type, never for a Free patient; the supporter's open-requests list and
--      acknowledgement follow the same predicate; a blood pressure engine page behaves as it always did.
--   8. SABOTAGE: each guard replaced by a no-op must flip the matching check.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;

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
  values (v, 'ln-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test, language)
  values (v, p_org, p_role::public.user_role, 'LN ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true, 'en')
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone;
  return v;
end $f$;
create function pg_temp.mkdoc(p_org uuid, p_admin uuid, p_label text, p_tier text) returns uuid
language plpgsql as $f$
declare v uuid := pg_temp.mkuser(p_org, p_label, 'clinician'); v_staff uuid;
begin
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
  values (p_org, v, 'LN ' || p_label, 'MDCN', 'LN-' || p_label || '-' || substr(v::text, 1, 8), true, 'active', now(), p_admin,
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
  values (p_org, v, 'granted', 'active', p_admin, 'legacy notice retirement proof: a Member', true);
  return v;
end $f$;
create function pg_temp.bp(p_patient uuid, p_sys integer, p_dia integer) returns uuid language plpgsql as
$f$ declare v uuid;
begin
  insert into public.vitals_readings (id, organisation_id, patient_id, vital_type, systolic, diastolic, taken_at, source)
  select gen_random_uuid(), organisation_id, p_patient, 'blood_pressure', p_sys, p_dia, now(), 'manual' from public.profiles where id = p_patient returning id into v;
  return v;
end $f$;
-- a blood pressure CRISIS that is an emergency record on the legacy path with the rule set approved: in pregnancy (otherwise 200/130 without a
-- red-flag symptom is a Priority 1 alert only)
create function pg_temp.bp_em(p_patient uuid) returns uuid language plpgsql as
$f$ begin
  update public.profiles set is_pregnant = true where id = p_patient;
  return pg_temp.bp(p_patient, 165, 95);
end $f$;
create function pg_temp.glu(p_patient uuid, p_mmol numeric) returns uuid language plpgsql as
$f$ declare v uuid;
begin
  insert into public.vitals_readings (id, organisation_id, patient_id, vital_type, glucose_mmol_l, taken_at, source)
  select gen_random_uuid(), organisation_id, p_patient, 'glucose', p_mmol, now(), 'manual' from public.profiles where id = p_patient returning id into v;
  return v;
end $f$;
create function pg_temp.spo2(p_patient uuid, p_pct integer) returns uuid language plpgsql as
$f$ declare v uuid;
begin
  insert into public.vitals_readings (id, organisation_id, patient_id, vital_type, spo2_pct, taken_at, source)
  select gen_random_uuid(), organisation_id, p_patient, 'spo2', p_pct, now(), 'manual' from public.profiles where id = p_patient returning id into v;
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
-- the triage engine's side of a BP / glucose event: an approved red grade of the reading, then its page
create function pg_temp.eng(p_patient uuid, p_reading uuid, p_code text) returns uuid language plpgsql as
$f$ declare v_te uuid; v_rs record;
begin
  select id, version into v_rs from public.triage_rule_sets where code = p_code and status = 'approved';
  insert into public.triage_events (organisation_id, patient_id, trigger_type, trigger_id, grade, rule_id, rule_set_id, rule_set_code,
      rule_set_version, rule_set_status, actions, shadow, is_test, basis)
  select pr.organisation_id, p_patient, 'observation', p_reading, 'red', 'R1', v_rs.id, p_code, v_rs.version, 'approved',
         '[{"kind":"page_on_call"}]'::jsonb, false, true, gen_random_uuid()::text
    from public.profiles pr where pr.id = p_patient
  returning id into v_te;
  return public.create_red_page(v_te);
end $f$;
create function pg_temp.legacy_n(p_patient uuid) returns integer language sql as
$f$ select count(*)::integer from public.notifications n
     where n.source_table = 'clinician_alerts'
       and n.source_id in (select id from public.clinician_alerts where patient_id = p_patient)
       and n.template in ('vitals_red_flag_clinician_alert', 'emergency_event_clinician_alert') $f$;
create function pg_temp.shape(p_patient uuid) returns text language sql as
$f$ select coalesce(string_agg(distinct n.template || '|' || (n.payload - 'patient_name')::text || '|' || n.channel::text || '|' || n.priority::text || '|' || n.source_table, ';'), 'none')
      from public.notifications n
     where n.source_table = 'clinician_alerts'
       and n.source_id in (select id from public.clinician_alerts where patient_id = p_patient)
       and n.template in ('vitals_red_flag_clinician_alert', 'emergency_event_clinician_alert') $f$;
create function pg_temp.alerts(p_patient uuid) returns integer language sql as
$f$ select count(*)::integer from public.clinician_alerts where patient_id = p_patient $f$;
create function pg_temp.holds(p_patient uuid) returns integer language sql as
$f$ select count(*)::integer from public.legacy_notice_holds where patient_id = p_patient $f$;
create function pg_temp.hstat(p_patient uuid) returns text language sql as
$f$ select coalesce((select status || '/' || kind || '/' || coalesce(reason, '-') from public.legacy_notice_holds where patient_id = p_patient order by created_at desc, id limit 1), 'none') $f$;
create function pg_temp.roots(p_patient uuid) returns integer language sql as
$f$ select count(*)::integer from public.pages where patient_id = p_patient and parent_page_id is null $f$;
create function pg_temp.circle_n(p_supporter uuid) returns integer language sql as
$f$ select count(distinct source_id)::integer from public.notifications where recipient_id = p_supporter and template = 'circle_check_in' $f$;
-- the message of the error a statement raises
create function pg_temp.msg(p_sql text) returns text language plpgsql as
$f$ begin execute p_sql; return 'ok'; exception when others then return sqlerrm; end $f$;
-- the event bus heartbeat, p_secs seconds old
create function pg_temp.hb(p_secs integer) returns void language plpgsql as
$f$ begin
  perform set_config('tarragon.paging_write', 'on', true);
  update public.paging_heartbeats set last_seen_at = now() - make_interval(secs => p_secs) where component = 'process_events';
  perform set_config('tarragon.paging_write', 'off', true);
end $f$;
-- a unified red page made directly (as unified_red_page_covers would), with a given source label and origin; returns the page
create function pg_temp.uni(p_patient uuid, p_basis text, p_origin text) returns uuid language plpgsql as
$f$ declare v_te uuid;
begin
  insert into public.triage_events (organisation_id, patient_id, trigger_type, trigger_id, grade, rule_id, rule_set_id, rule_set_code,
      rule_set_version, rule_set_status, explanation_key, actions, matched_rule_ids, task_key, basis, shadow, is_test, context)
  select pr.organisation_id, p_patient, 'unified_red', gen_random_uuid(), 'red', 'UNIFIED-X', null, 'unified_red_paging', 1, 'approved', null,
         '[{"kind":"page_on_call"}]'::jsonb, '{}', null, p_basis, false, true,
         jsonb_build_object('source', p_basis, 'ref_table', 'x', 'ref_id', gen_random_uuid(), 'origin', p_origin)
    from public.profiles pr where pr.id = p_patient returning id into v_te;
  return public.create_red_page(v_te);
end $f$;
-- make a held notice due now (now() is frozen inside the transaction)
create function pg_temp.due(p_patient uuid) returns void language sql as
$f$ update public.legacy_notice_holds set deadline_at = now() - interval '1 second' where patient_id = p_patient and status = 'held' $f$;

do $$
declare
  v_org uuid; v_admin uuid; v_cmo uuid; v_p uuid; v_b uuid; v_other uuid;
  v_n_clin integer; v_rota jsonb; v_r text; v_x uuid; v_pg uuid; v_rd uuid; v_rd2 uuid;
  o1 uuid; o2 uuid; o3 uuid; o4 uuid;                              -- the OFF reference runs
  a1 uuid; a2 uuid; a3 uuid; a4 uuid; a5 uuid; a6 uuid;            -- parallel run
  h1 uuid; h2 uuid; h3 uuid; h4 uuid; h5 uuid; h6 uuid; h7 uuid; h8 uuid; h9 uuid; h10 uuid; h11 uuid; h12 uuid; h13 uuid; h14 uuid;   -- hold
  e0 uuid; e1 uuid; e2 uuid; e3 uuid; e4 uuid; e5 uuid; e6 uuid; e7 uuid;   -- emergencies under version 3
  c_ok uuid; c_noperm uuid; c_preg uuid; c_free uuid; c_bp uuid; c_paused uuid; c_gen uuid; c_tes uuid;   -- circle patients
  s_ok uuid; s_noperm uuid; s_preg uuid; s_bp uuid; s_gen uuid; s_tes uuid; s_paused uuid;               -- their supporters
  v_orig text; v_orig2 text; v_cfg uuid; v_json jsonb; v_open jsonb; v_shape_off_bp text; v_shape_off_em text; v_shape_off_gl text;
  v_hold uuid; v_cnt integer;
  h11b uuid; v_pgs uuid[]; x1 uuid; x2 uuid; x3 uuid; x4 uuid; x5 uuid; x6 uuid; x7 uuid; x8 uuid; v_h text;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  update public.clinical_staff set active = false where is_test is not true;
  v_cmo := pg_temp.mkdoc(v_org, v_admin, 'cmo', 'chief_medical_officer');
  v_p := pg_temp.mkdoc(v_org, v_admin, 'primary', 'senior_medical_officer');
  v_b := pg_temp.mkdoc(v_org, v_admin, 'backup', 'senior_medical_officer');
  v_other := pg_temp.mkdoc(v_org, v_admin, 'other', 'senior_medical_officer');
  select count(*)::integer into v_n_clin from public.profiles where organisation_id = v_org and role = 'clinician';
  perform pg_temp.act(v_cmo);
  v_rota := public.set_on_call_rota(now() - interval '1 minute', now() + interval '10 hours', v_p, v_b, null);
  perform pg_temp.back();
  -- the pathway rule sets are approved (as live) so a page of the pathway is possible; the event bus is alive
  if not exists (select 1 from public.triage_rule_sets where code = 'bp_care_triage' and status = 'approved') then
    update public.triage_rule_sets set status = 'approved', approved_by = v_cmo, approved_at = now()
     where id = (select id from public.triage_rule_sets where code = 'bp_care_triage' and status = 'draft' order by version desc limit 1);
  end if;
  perform pg_temp.rec('fixture: the BP rule set is approved', '1', (select count(*)::text from public.triage_rule_sets where code = 'bp_care_triage' and status = 'approved'));
  perform private.paging_heartbeat('process_events');

  -- 1. Shape -----------------------------------------------------------------------------------------------------------
  perform pg_temp.rec('four versions ship inactive and unsigned', '4,0,0', (select count(*)::text || ',' || count(*) filter (where is_active) || ',' || count(*) filter (where approved_at is not null) from public.legacy_notice_retirement_config));
  perform pg_temp.rec('every kind reads OFF with nothing signed', 'off,off,off,off', private.legacy_notice_mode('bp_red') || ',' || private.legacy_notice_mode('bp_emergency') || ',' || private.legacy_notice_mode('glucose_emergency') || ',' || private.legacy_notice_mode('nonsense'));
  perform pg_temp.rec('the circle key reads OFF (null) with nothing signed', 'null', coalesce(private.legacy_retire_rule('circle_notice_unified_page')::text, 'null'));
  select id into v_cfg from public.legacy_notice_retirement_config where version = 1;
  perform pg_temp.rec('a version cannot be live without a signature', '23514', pg_temp.try(format('update public.legacy_notice_retirement_config set is_active = true where id = %L', v_cfg)));
  perform pg_temp.rec('the rules of a version cannot be edited', '55000', pg_temp.try(format($q$update public.legacy_notice_retirement_config set rules = rules || '{"observe":0}'::jsonb where id = %L$q$, v_cfg)));
  perform pg_temp.rec('a version cannot be deleted', '55000', pg_temp.try(format('delete from public.legacy_notice_retirement_config where id = %L', v_cfg)));
  perform pg_temp.rec('a malformed version is refused (missing key, bad value, hold out of range)', '23514,23514,23514',
    pg_temp.try($q$insert into public.legacy_notice_retirement_config (version, effective_from, rules) values (90, current_date, '{"observe":1}')$q$) || ',' ||
    pg_temp.try($q$insert into public.legacy_notice_retirement_config (version, effective_from, rules) values (91, current_date, '{"observe":2,"suppress_legacy_bp_notice":0,"suppress_legacy_glucose_notice":0,"suppress_legacy_emergency_notice":0,"circle_notice_unified_page":0,"hold_seconds":60}')$q$) || ',' ||
    pg_temp.try($q$insert into public.legacy_notice_retirement_config (version, effective_from, rules) values (92, current_date, '{"observe":1,"suppress_legacy_bp_notice":0,"suppress_legacy_glucose_notice":0,"suppress_legacy_emergency_notice":0,"circle_notice_unified_page":0,"hold_seconds":5}')$q$));
  perform pg_temp.rec('anon holds nothing on the tables or the entry points; authenticated cannot write the tables', 'false,false,false,false,0',
    has_table_privilege('anon', 'public.legacy_notice_holds', 'SELECT')::text || ',' ||
    has_function_privilege('anon', 'public.sign_legacy_notice_retirement_config(integer,boolean)', 'EXECUTE')::text || ',' ||
    has_function_privilege('authenticated', 'private.legacy_notice_deferred(text,uuid,uuid,uuid,text,uuid,text,text,text,jsonb)', 'EXECUTE')::text || ',' ||
    has_function_privilege('authenticated', 'private.sweep_legacy_notice_holds(boolean)', 'EXECUTE')::text || ',' ||
    (select count(*)::text from information_schema.role_table_grants where table_schema = 'public' and table_name in ('legacy_notice_holds', 'legacy_notice_retirement_config') and grantee = 'authenticated' and privilege_type <> 'SELECT'));
  perform pg_temp.rec('the patched functions carry the hooks', '1,1,1,1,1,1,1,1',
    (position('legacy_notice_deferred' in pg_get_functiondef('private.handle_bp_reading_red_flag()'::regprocedure)) > 0)::int || ',' ||
    (position('legacy_notice_deferred' in pg_get_functiondef('private.handle_emergency_event()'::regprocedure)) > 0)::int || ',' ||
    (position('page_circle_may_know' in pg_get_functiondef('private.notify_circle_red_alert()'::regprocedure)) > 0)::int || ',' ||
    (position('page_circle_may_know' in pg_get_functiondef('public.circle_open_alerts()'::regprocedure)) > 0)::int || ',' ||
    (position('page_circle_may_know' in pg_get_functiondef('public.circle_ack_alert(uuid)'::regprocedure)) > 0)::int || ',' ||
    (position('sweep_legacy_notice_holds' in pg_get_functiondef('private.sweep_pages()'::regprocedure)) > 0)::int || ',' ||
    (position('legacy_notice_health' in pg_get_functiondef('private.sweep_paging_health()'::regprocedure)) > 0)::int || ',' ||
    (position('unified_red_page_covers' in pg_get_functiondef('private.handle_emergency_event()'::regprocedure)) > 0)::int);
  perform pg_temp.rec('the new hook is NOT in the abnormal screening pipeline or any other handler', '0',
    (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('private', 'public') and p.prokind = 'f' and pg_get_functiondef(p.oid) like '%legacy_notice_deferred%'
        and p.proname not in ('handle_bp_reading_red_flag', 'handle_emergency_event', 'legacy_notice_deferred')));

  -- 2. FLAG OFF: the old behaviour, and the reference notification shape --------------------------------------------------------
  o1 := pg_temp.member(v_org, v_admin, 'off-bp-red'); o2 := pg_temp.member(v_org, v_admin, 'off-bp-em'); o3 := pg_temp.member(v_org, v_admin, 'off-glucose'); o4 := pg_temp.member(v_org, v_admin, 'off-amber');
  perform pg_temp.bp(o1, 170, 95);
  perform pg_temp.bp_em(o2);
  perform pg_temp.glu(o3, 2.5);
  perform pg_temp.bp(o4, 150, 90);
  perform pg_temp.rec('OFF: BP red notifies every clinician profile, opens the alert, writes no hold row', v_n_clin || '|1|0', pg_temp.legacy_n(o1) || '|' || pg_temp.alerts(o1) || '|' || pg_temp.holds(o1));
  perform pg_temp.rec('OFF: BP emergency notifies every clinician profile through the emergency event, no hold row', v_n_clin || '|0', pg_temp.legacy_n(o2) || '|' || pg_temp.holds(o2));
  perform pg_temp.rec('OFF: glucose emergency notifies every clinician profile through the emergency event, no hold row', v_n_clin || '|0', pg_temp.legacy_n(o3) || '|' || pg_temp.holds(o3));
  perform pg_temp.rec('OFF: BP amber keeps its review notice', v_n_clin || '|0', pg_temp.legacy_n(o4) || '|' || pg_temp.holds(o4));
  v_shape_off_bp := pg_temp.shape(o1); v_shape_off_em := pg_temp.shape(o2); v_shape_off_gl := pg_temp.shape(o3);
  perform pg_temp.rec('OFF: the reference shapes are the known templates and payload keys', 'true',
    ((v_shape_off_bp like 'vitals_red_flag_clinician_alert|%level_label%vital_label%' and v_shape_off_em like 'emergency_event_clinician_alert|%source_label%'))::text);
  -- an unreadable config table reads OFF and never stops the reading
  alter table public.legacy_notice_retirement_config rename to legacy_notice_retirement_config_x;
  v_r := pg_temp.try(format('select pg_temp.bp(%L, 170, 95)', pg_temp.member(v_org, v_admin, 'off-unreadable')));
  alter table public.legacy_notice_retirement_config_x rename to legacy_notice_retirement_config;
  perform pg_temp.rec('OFF: an unreadable config does not stop the reading', 'ok', v_r);

  -- 3. Who can sign and switch off --------------------------------------------------------------------------------------
  perform pg_temp.act(v_p);
  perform pg_temp.rec('an ordinary doctor cannot sign or switch off', '42501,42501', pg_temp.try('select public.sign_legacy_notice_retirement_config(1, true)') || ',' || pg_temp.try('select public.switch_off_legacy_notice_retirement()'));
  perform pg_temp.rec('an ordinary doctor cannot read the measurement', '42501', pg_temp.try('select public.legacy_notice_measurement(14, true)'));
  perform pg_temp.back();
  perform pg_temp.act(v_admin);
  perform pg_temp.rec('an admin cannot sign', '42501', pg_temp.try('select public.sign_legacy_notice_retirement_config(1, true)'));
  perform pg_temp.back();
  perform pg_temp.act(v_cmo);
  perform pg_temp.rec('the CMO cannot sign without the test pack, nor an unknown version', '22023,P0002', pg_temp.try('select public.sign_legacy_notice_retirement_config(1, false)') || ',' || pg_temp.try('select public.sign_legacy_notice_retirement_config(99, true)'));
  perform pg_temp.rec('a version that retires a broadcast is refused before any parallel run', '23514', pg_temp.try('select public.sign_legacy_notice_retirement_config(2, true)'));
  perform pg_temp.back();
  perform pg_temp.rec('...and nothing was switched on by the refused attempts', 'off,null', private.legacy_notice_mode('bp_red') || ',' || coalesce(private.legacy_retire_rule('circle_notice_unified_page')::text, 'null'));
  perform pg_temp.act(v_cmo);
  perform pg_temp.rec('the CMO signs version 1 (the parallel run)', 'ok', pg_temp.try('select public.sign_legacy_notice_retirement_config(1, true)'));
  perform pg_temp.back();
  perform pg_temp.rec('version 1 is live, signed, stamped', 'true,true,true', (select is_active::text || ',' || (approved_by = v_cmo)::text || ',' || (test_pack_confirmed_at is not null)::text from public.legacy_notice_retirement_config where version = 1));
  perform pg_temp.rec('the switch-on is audited', '1', (select count(*)::text from public.audit_log where action = 'legacy_notice_retirement.switched_on' and actor_id = v_cmo and (event ->> 'version')::int = 1));

  -- 4. PARALLEL RUN (version 1) ------------------------------------------------------------------------------------------
  perform pg_temp.rec('parallel run: every kind reads observe', 'observe,observe,observe', private.legacy_notice_mode('bp_red') || ',' || private.legacy_notice_mode('bp_emergency') || ',' || private.legacy_notice_mode('glucose_emergency'));
  a1 := pg_temp.member(v_org, v_admin, 'obs-bp-red'); a2 := pg_temp.member(v_org, v_admin, 'obs-bp-nopage'); a3 := pg_temp.member(v_org, v_admin, 'obs-bp-em'); a4 := pg_temp.member(v_org, v_admin, 'obs-glucose');
  a5 := pg_temp.member(v_org, v_admin, 'obs-amber');
  v_rd := pg_temp.bp(a1, 170, 95);
  perform pg_temp.bp(a2, 170, 95);
  perform pg_temp.bp_em(a3);
  perform pg_temp.glu(a4, 2.5);
  perform pg_temp.bp(a5, 150, 90);
  perform pg_temp.rec('parallel run: BP red still notifies every clinician, with the SAME notification shape as OFF, and is recorded as observed', v_n_clin || '|true|observed/bp_red/parallel_run',
    pg_temp.legacy_n(a1) || '|' || (pg_temp.shape(a1) = v_shape_off_bp)::text || '|' || pg_temp.hstat(a1));
  perform pg_temp.rec('parallel run: BP emergency and glucose emergency still notify every clinician, same shape, recorded', v_n_clin || '|' || v_n_clin || '|true|true|observed/bp_emergency/parallel_run|observed/glucose_emergency/parallel_run',
    pg_temp.legacy_n(a3) || '|' || pg_temp.legacy_n(a4) || '|' || (pg_temp.shape(a3) = v_shape_off_em)::text || '|' || (pg_temp.shape(a4) = v_shape_off_gl)::text || '|' || pg_temp.hstat(a3) || '|' || pg_temp.hstat(a4));
  perform pg_temp.rec('parallel run: amber is not recorded and keeps its notice', v_n_clin || '|0', pg_temp.legacy_n(a5) || '|' || pg_temp.holds(a5));
  -- the engine page arrives after the older message: the sweep fills in the measurement
  v_pg := pg_temp.eng(a1, v_rd, 'bp_care_triage');
  perform private.sweep_legacy_notice_holds();
  perform pg_temp.rec('parallel run: the measurement records the page of THAT event, its lag and that the primary can be reached', 'true|true|true',
    (select (page_id = v_pg)::text || '|' || (page_lag_seconds >= 0)::text || '|' || coalesce(primary_reachable, false)::text from public.legacy_notice_holds where patient_id = a1));
  -- a hold with no page after the look window is finalised as "no page seen"
  update public.legacy_notice_holds set created_at = now() - interval '20 minutes' where patient_id = a2;
  perform private.sweep_legacy_notice_holds();
  perform pg_temp.rec('parallel run: an event whose page never came is finalised as no_page_seen (not silently left open)', 'no_page_seen|null',
    (select coalesce(reason, 'x') || '|' || coalesce(page_id::text, 'null') from public.legacy_notice_holds where patient_id = a2));
  perform pg_temp.act(v_cmo);
  v_json := public.legacy_notice_measurement(14, true);
  perform pg_temp.back();
  perform pg_temp.rec('the CMO sees the evidence: BP red 2 events, 1 with its page; page first/within-hold counted', '2|1',
    (select (e ->> 'events') || '|' || (e ->> 'page_seen') from jsonb_array_elements(v_json) e where e ->> 'kind' = 'bp_red'));
  perform pg_temp.act(v_cmo);
  v_open := public.legacy_notice_measurement(14, false);
  perform pg_temp.back();
  perform pg_temp.rec('the evidence excludes test patients unless asked', '[]', v_open::text);
  -- a Free patient: no alert, no broadcast, nothing measured
  a6 := pg_temp.mkuser(v_org, 'obs-free', 'patient');
  perform pg_temp.bp(a6, 170, 95);
  perform pg_temp.rec('parallel run: a Free patient has no alert, no broadcast, no measurement row', '0|0|0', pg_temp.alerts(a6) || '|' || pg_temp.legacy_n(a6) || '|' || pg_temp.holds(a6));

  -- 5. HOLD (version 2) --------------------------------------------------------------------------------------------------
  perform pg_temp.act(v_cmo);
  perform public.switch_off_legacy_notice_retirement();
  -- a retiring version needs the parallel run to have been on for min_parallel_days AND to have measured min_parallel_events real events, with a clear reason
  perform pg_temp.back();
  perform pg_temp.act(v_cmo);
  v_h := pg_temp.msg('select public.sign_legacy_notice_retirement_config(2, true)');
  perform pg_temp.back();
  perform pg_temp.rec('version 2 is refused with no evidence, and the CMO is told why (days and events)', 'true', (v_h like '%on for 0.0 of the 7 days%' and v_h like '%measured 0 of the 20 real events%')::text);
  update public.legacy_notice_retirement_config set activated_at = now() - interval '8 days' where version = 1;
  perform pg_temp.act(v_cmo);
  v_h := pg_temp.msg('select public.sign_legacy_notice_retirement_config(2, true)');
  perform pg_temp.back();
  perform pg_temp.rec('version 2 is still refused with enough days but too few real events (test patients do not count)', 'true', (v_h like '%on for 8.0 of the 7 days%' and v_h like '%measured 0 of the 20%')::text);
  insert into public.legacy_notice_holds (organisation_id, patient_id, kind, status, reading_id, rule_set_code, source_table, template, pathway, alert_level, is_test, decided_at, fired_at, reason, measured_at)
    select v_org, a1, 'bp_red', 'observed', gen_random_uuid(), 'bp_care_triage', 'clinician_alerts', 'vitals_red_flag_clinician_alert', 'bp_vitals_red_flag', 'urgent_escalation', false, now(), now(), 'proof_evidence', now()
      from generate_series(1, 19);
  perform pg_temp.act(v_cmo);
  perform pg_temp.rec('version 2 is refused with 19 of 20 real events', '23514', pg_temp.try('select public.sign_legacy_notice_retirement_config(2, true)'));
  perform pg_temp.back();
  insert into public.legacy_notice_holds (organisation_id, patient_id, kind, status, reading_id, rule_set_code, source_table, template, pathway, alert_level, is_test, decided_at, fired_at, reason, measured_at)
    values (v_org, a1, 'bp_red', 'observed', gen_random_uuid(), 'bp_care_triage', 'clinician_alerts', 'vitals_red_flag_clinician_alert', 'bp_vitals_red_flag', 'urgent_escalation', false, now(), now(), 'proof_evidence', now());
  perform pg_temp.act(v_cmo);
  perform pg_temp.rec('version 2 can now be signed (a parallel run has been live long enough and measured enough real events)', 'ok', pg_temp.try('select public.sign_legacy_notice_retirement_config(2, true)'));
  perform pg_temp.back();
  perform pg_temp.rec('version 2: BP red holds, glucose emergency and BP emergency only observe (separate emergency key is 0)', 'hold,observe,observe',
    private.legacy_notice_mode('bp_red') || ',' || private.legacy_notice_mode('bp_emergency') || ',' || private.legacy_notice_mode('glucose_emergency'));

  -- 5a. a reachable primary and the page of the same event: the broadcast is suppressed
  h1 := pg_temp.member(v_org, v_admin, 'hold-confirmed');
  v_rd := pg_temp.bp(h1, 170, 95);
  perform pg_temp.rec('HOLD: BP red is held, not sent; the alert still opens', '0|1|held/bp_red/-', pg_temp.legacy_n(h1) || '|' || pg_temp.alerts(h1) || '|' || pg_temp.hstat(h1));
  perform private.sweep_legacy_notice_holds();
  perform pg_temp.rec('HOLD: with no page yet the sweep leaves it held before its deadline', 'held/bp_red/-', pg_temp.hstat(h1));
  v_pg := pg_temp.eng(h1, v_rd, 'bp_care_triage');
  perform private.sweep_legacy_notice_holds();
  perform pg_temp.rec('HOLD: the page of that event, primary reachable: the broadcast is SUPPRESSED for good', '0|suppressed/bp_red/page_confirmed|true',
    pg_temp.legacy_n(h1) || '|' || pg_temp.hstat(h1) || '|' || (select (page_id = v_pg)::text from public.legacy_notice_holds where patient_id = h1));
  perform pg_temp.due(h1);
  perform private.sweep_legacy_notice_holds();
  perform pg_temp.rec('HOLD: a decided hold is never reopened or sent later', '0|suppressed/bp_red/page_confirmed', pg_temp.legacy_n(h1) || '|' || pg_temp.hstat(h1));

  -- 5b. no page by the deadline: released, with the same shape as OFF
  h2 := pg_temp.member(v_org, v_admin, 'hold-nopage');
  perform pg_temp.bp(h2, 170, 95);
  perform pg_temp.due(h2);
  perform private.sweep_legacy_notice_holds();
  perform pg_temp.rec('HOLD: no page by the deadline: the broadcast is RELEASED to every clinician, the same shape as the OFF run', v_n_clin || '|true|released/bp_red/no_page_in_time',
    pg_temp.legacy_n(h2) || '|' || (pg_temp.shape(h2) = v_shape_off_bp)::text || '|' || pg_temp.hstat(h2));
  perform pg_temp.rec('HOLD: the release is audited', '1', (select count(*)::text from public.audit_log where action = 'legacy_notice.released' and (event ->> 'reason') = 'no_page_in_time'));

  -- 5c. a page for a DIFFERENT event does not confirm this one
  h3 := pg_temp.member(v_org, v_admin, 'hold-other-event');
  v_rd2 := pg_temp.bp(h3, 170, 95);
  perform pg_temp.due(h3);
  update public.legacy_notice_holds set deadline_at = now() + interval '1 minute' where patient_id = h3;
  v_pg := pg_temp.eng(h3, gen_random_uuid(), 'bp_care_triage');
  perform private.sweep_legacy_notice_holds();
  perform pg_temp.rec('HOLD: a page for another reading does NOT confirm this event', '0|held/bp_red/-', pg_temp.legacy_n(h3) || '|' || pg_temp.hstat(h3));

  -- 5d. the primary cannot be reached
  update public.push_subscriptions set disabled_at = now() where profile_id = v_p;
  update auth.users set email_confirmed_at = null where id = v_p;
  h4 := pg_temp.member(v_org, v_admin, 'hold-unreachable-at-fire');
  perform pg_temp.bp(h4, 170, 95);
  perform pg_temp.rec('HOLD: a primary with no push route and no verified email: the broadcast fires AT ONCE, not held', v_n_clin || '|fired/bp_red/primary_unreachable', pg_temp.legacy_n(h4) || '|' || pg_temp.hstat(h4));
  update public.push_subscriptions set disabled_at = null where profile_id = v_p;
  update auth.users set email_confirmed_at = now() where id = v_p;
  -- ...reachable at fire time, unreachable by the time the page exists: the sweep releases
  h5 := pg_temp.member(v_org, v_admin, 'hold-unreachable-at-sweep');
  v_rd := pg_temp.bp(h5, 170, 95);
  v_pg := pg_temp.eng(h5, v_rd, 'bp_care_triage');
  update public.push_subscriptions set disabled_at = now() where profile_id = v_p;
  update auth.users set email_confirmed_at = null where id = v_p;
  perform private.sweep_legacy_notice_holds();
  perform pg_temp.rec('HOLD: a page exists but its primary can no longer be reached: the broadcast is RELEASED', v_n_clin || '|released/bp_red/primary_unreachable', pg_temp.legacy_n(h5) || '|' || pg_temp.hstat(h5));
  update public.push_subscriptions set disabled_at = null where profile_id = v_p;
  update auth.users set email_confirmed_at = now() where id = v_p;

  -- 5e. no cover
  update public.clinical_staff set active = false where profile_id in (v_p, v_b, v_other);
  h6 := pg_temp.member(v_org, v_admin, 'hold-no-cover');
  perform pg_temp.bp(h6, 170, 95);
  perform pg_temp.rec('HOLD: nobody on cover: the broadcast fires at once', v_n_clin || '|fired/bp_red/no_cover', pg_temp.legacy_n(h6) || '|' || pg_temp.hstat(h6));
  update public.clinical_staff set active = true where profile_id in (v_p, v_b, v_other);
  -- deactivating a clinician takes them off the rota: put the cover back
  perform pg_temp.act(v_cmo);
  v_rota := public.set_on_call_rota(now() - interval '1 minute', now() + interval '10 hours', v_p, v_b, null);
  perform pg_temp.back();

  -- 5f. the event bus is quiet
  perform set_config('tarragon.paging_write', 'on', true);
  update public.paging_heartbeats set last_seen_at = now() - interval '1 hour' where component = 'process_events';
  perform set_config('tarragon.paging_write', 'off', true);
  h7 := pg_temp.member(v_org, v_admin, 'hold-engine-stale');
  perform pg_temp.bp(h7, 170, 95);
  perform pg_temp.rec('HOLD: no recent event-bus heartbeat: the broadcast fires at once', v_n_clin || '|fired/bp_red/engine_stale', pg_temp.legacy_n(h7) || '|' || pg_temp.hstat(h7));
  perform private.paging_heartbeat('process_events');

  -- 5h. emergencies keep their broadcast under version 2; glucose has no approved rule set so it could not hold anyway
  h9 := pg_temp.member(v_org, v_admin, 'hold-bp-emergency'); h10 := pg_temp.member(v_org, v_admin, 'hold-glucose');
  perform pg_temp.bp_em(h9);
  perform pg_temp.glu(h10, 2.5);
  perform pg_temp.rec('version 2: a BP crisis and a glucose emergency keep their broadcast (the emergency key is separate and 0)', v_n_clin || '|' || v_n_clin || '|observed/bp_emergency/parallel_run|observed/glucose_emergency/parallel_run',
    pg_temp.legacy_n(h9) || '|' || pg_temp.legacy_n(h10) || '|' || pg_temp.hstat(h9) || '|' || pg_temp.hstat(h10));

  -- 5i. a Free patient and a non-Member emergency
  a6 := pg_temp.mkuser(v_org, 'hold-free', 'patient');
  perform pg_temp.bp(a6, 170, 95);
  perform pg_temp.rec('HOLD: a Free patient has no alert, no broadcast, nothing held', '0|0|0', pg_temp.alerts(a6) || '|' || pg_temp.legacy_n(a6) || '|' || pg_temp.holds(a6));
  perform pg_temp.rec('HOLD: calling the hook directly for a Free patient says send and records why', 'false|fired/bp_red/free_patient',
    private.legacy_notice_deferred('bp_red', v_org, a6, gen_random_uuid(), 'clinician_alerts', gen_random_uuid(), 'vitals_red_flag_clinician_alert', 'bp_vitals_red_flag', 'urgent_escalation', '{}'::jsonb)::text || '|' || pg_temp.hstat(a6));

  -- 5j. an open family is not proof for THIS reading: its own red triage event has to exist (or merge) first
  h11 := pg_temp.member(v_org, v_admin, 'hold-family');
  v_rd := gen_random_uuid();
  perform pg_temp.eng(h11, v_rd, 'bp_care_triage');
  perform pg_temp.rec('HOLD: this reading''s own red event exists inside an open family already ringing a reachable primary: suppressed at once', 'true|suppressed/bp_red/family_already_paged',
    private.legacy_notice_deferred('bp_red', v_org, h11, v_rd, 'clinician_alerts', gen_random_uuid(), 'vitals_red_flag_clinician_alert', 'bp_vitals_red_flag', 'urgent_escalation', jsonb_build_object('vital_label', 'blood pressure', 'level_label', 'Priority 1'))::text || '|' || pg_temp.hstat(h11));
  h11b := pg_temp.member(v_org, v_admin, 'hold-family-other-reading');
  perform pg_temp.eng(h11b, gen_random_uuid(), 'bp_care_triage');
  v_rd2 := gen_random_uuid();
  perform pg_temp.rec('HOLD: an open family alone does NOT suppress a reading with no event of its own: it is held', 'true|held/bp_red/-',
    private.legacy_notice_deferred('bp_red', v_org, h11b, v_rd2, 'clinician_alerts', gen_random_uuid(), 'vitals_red_flag_clinician_alert', 'bp_vitals_red_flag', 'urgent_escalation', jsonb_build_object('vital_label', 'blood pressure', 'level_label', 'Priority 1'))::text || '|' || pg_temp.hstat(h11b));
  perform pg_temp.eng(h11b, v_rd2, 'bp_care_triage');
  perform private.sweep_legacy_notice_holds();
  perform pg_temp.rec('HOLD: once that reading''s event merges into the family the sweep confirms it', 'suppressed/bp_red/page_confirmed', pg_temp.hstat(h11b));

  -- 5k. switching off while a notice is held releases it at once
  h12 := pg_temp.member(v_org, v_admin, 'hold-switch-off');
  perform pg_temp.bp(h12, 170, 95);
  perform pg_temp.rec('HOLD: held before the switch-off', '0|held/bp_red/-', pg_temp.legacy_n(h12) || '|' || pg_temp.hstat(h12));
  perform pg_temp.act(v_admin);
  perform pg_temp.rec('an admin can switch it off', '1', public.switch_off_legacy_notice_retirement()::text);
  perform pg_temp.back();
  perform pg_temp.rec('switch-off: every held notice with no confirmed page is sent at once; the config reads OFF; it is audited',
    v_n_clin || '|released/bp_red/switched_off|off|1',
    pg_temp.legacy_n(h12) || '|' || pg_temp.hstat(h12) || '|' || private.legacy_notice_mode('bp_red') || '|' || (select count(*)::text from public.audit_log where action = 'legacy_notice_retirement.switched_off' and actor_id = v_admin));
  perform pg_temp.rec('switch-off leaves a confirmed page and a decided hold alone', '0', pg_temp.legacy_n(h1)::text);
  h13 := pg_temp.member(v_org, v_admin, 'after-off');
  perform pg_temp.bp(h13, 170, 95);
  perform pg_temp.rec('after the switch-off BP red is the old path again: sent at once, no hold row', v_n_clin || '|0', pg_temp.legacy_n(h13) || '|' || pg_temp.holds(h13));

  -- 5l. both drivers of the sweep, and the overdue incident
  perform pg_temp.act(v_cmo);
  perform public.sign_legacy_notice_retirement_config(2, true);
  perform pg_temp.back();
  h13 := pg_temp.member(v_org, v_admin, 'driver-sweep'); h14 := pg_temp.member(v_org, v_admin, 'driver-health');
  perform pg_temp.bp(h13, 170, 95); perform pg_temp.bp(h14, 170, 95);
  perform pg_temp.due(h13);
  perform private.sweep_pages();
  perform pg_temp.rec('driver 1: the 15 second paging sweep releases a due hold', v_n_clin || '|released/bp_red/no_page_in_time|0', pg_temp.legacy_n(h13) || '|' || pg_temp.hstat(h13) || '|' || pg_temp.legacy_n(h14));
  perform pg_temp.due(h14);
  perform private.sweep_paging_health();
  perform pg_temp.rec('driver 2: the per-minute health job releases the other, independently', v_n_clin || '|released/bp_red/no_page_in_time', pg_temp.legacy_n(h14) || '|' || pg_temp.hstat(h14));
  -- a sweep that cannot run leaves the notice held: the health job must say so loudly
  v_orig := pg_get_functiondef('private.sweep_legacy_notice_holds(boolean)'::regprocedure);
  create or replace function private.sweep_legacy_notice_holds(p_release_unconfirmed boolean default false) returns integer language plpgsql security definer set search_path = ''
    as $f$ begin raise exception 'simulated sweep failure'; end $f$;
  v_x := pg_temp.member(v_org, v_admin, 'overdue');
  perform pg_temp.bp(v_x, 170, 95);
  update public.legacy_notice_holds set deadline_at = now() - interval '10 minutes' where patient_id = v_x;
  perform private.sweep_paging_health();
  perform pg_temp.rec('an overdue hold (sweep failing) opens an ops incident and the page job keeps running', '1',
    (select count(*)::text from public.ops_incidents where external_reference = 'legacy_notice_hold_overdue' and status not in ('resolved', 'closed')));
  execute v_orig;
  perform private.sweep_legacy_notice_holds();
  perform pg_temp.rec('...and once the sweep is back the overdue notice is released', v_n_clin::text, pg_temp.legacy_n(v_x)::text);
  -- a release that FAILS for a row past its deadline raises the incident from the sweep itself, at once (not +120 s later)
  v_orig := pg_get_functiondef('private.release_legacy_notice(uuid)'::regprocedure);
  create or replace function private.release_legacy_notice(p_hold uuid) returns integer language plpgsql security definer set search_path = '' as $f$ begin raise exception 'simulated release failure'; end $f$;
  x1 := pg_temp.member(v_org, v_admin, 'release-fails');
  perform pg_temp.bp(x1, 170, 95);
  perform pg_temp.due(x1);
  perform private.sweep_legacy_notice_holds();
  perform pg_temp.rec('a failing release past the deadline opens an incident from the sweep at once, the notice stays held and the failure is audited', '1|held/bp_red/-|1',
    (select count(*)::text from public.ops_incidents where external_reference = 'legacy_notice_release_failed:' || (select id from public.legacy_notice_holds where patient_id = x1) and status not in ('resolved', 'closed')) || '|' || pg_temp.hstat(x1) || '|' ||
    (select count(*)::text from public.audit_log where action = 'legacy_notice.sweep_error' and entity_id = (select id from public.legacy_notice_holds where patient_id = x1)));
  execute v_orig;
  perform private.sweep_legacy_notice_holds();
  perform pg_temp.rec('...and the next pass releases it', v_n_clin || '|released/bp_red/no_page_in_time', pg_temp.legacy_n(x1) || '|' || pg_temp.hstat(x1));
  -- the parallel-run measurement loop does not fail silently either
  v_orig := pg_get_functiondef('private.legacy_hold_page(uuid)'::regprocedure);
  create or replace function private.legacy_hold_page(p_hold uuid, out o_page uuid, out o_page_at timestamptz, out o_to uuid, out o_no_cover boolean, out o_ack boolean) returns record
    language plpgsql stable security definer set search_path = '' as $f$ begin raise exception 'simulated lookup failure'; end $f$;
  perform private.sweep_legacy_notice_holds();
  perform pg_temp.rec('a failing measurement lookup is audited (phase measurement), not swallowed', 'true',
    (exists (select 1 from public.audit_log where action = 'legacy_notice.sweep_error' and event ->> 'phase' = 'measurement'))::text);
  execute v_orig;

  -- 6. Version 3: the emergency broadcast is retired too -----------------------------------------------------------------
  perform pg_temp.act(v_cmo);
  perform public.sign_legacy_notice_retirement_config(3, true);
  perform pg_temp.back();
  perform pg_temp.rec('version 3: every kind holds', 'hold,hold,hold', private.legacy_notice_mode('bp_red') || ',' || private.legacy_notice_mode('bp_emergency') || ',' || private.legacy_notice_mode('glucose_emergency'));
  e0 := pg_temp.member(v_org, v_admin, 'v3-glucose-no-ruleset');
  perform pg_temp.glu(e0, 2.5);
  perform pg_temp.rec('version 3: no approved glucose rule set means no page is expected: the glucose broadcast fires at once', v_n_clin || '|fired/glucose_emergency/rule_set_not_approved', pg_temp.legacy_n(e0) || '|' || pg_temp.hstat(e0));
  update public.triage_rule_sets set status = 'approved', approved_by = v_cmo, approved_at = now()
   where id = (select id from public.triage_rule_sets where code = 'glucose_care_triage' and status = 'draft' order by version desc limit 1);
  e1 := pg_temp.member(v_org, v_admin, 'v3-bp-emergency');
  v_rd := pg_temp.bp_em(e1);
  perform pg_temp.rec('version 3: a BP crisis is held (the emergency event and its alert still exist)', '0|1|held/bp_emergency/-', pg_temp.legacy_n(e1) || '|' || pg_temp.alerts(e1) || '|' || pg_temp.hstat(e1));
  perform pg_temp.rec('version 3: the patient-side emergency record is untouched', '1', (select count(*)::text from public.emergency_events where patient_id = e1 and source = 'bp_reading'));
  v_pg := pg_temp.eng(e1, v_rd, 'bp_care_triage');
  perform private.sweep_legacy_notice_holds();
  perform pg_temp.rec('version 3: the BP crisis broadcast is suppressed once its page is confirmed', '0|suppressed/bp_emergency/page_confirmed', pg_temp.legacy_n(e1) || '|' || pg_temp.hstat(e1));
  e2 := pg_temp.member(v_org, v_admin, 'v3-glucose');
  v_rd := pg_temp.glu(e2, 2.5);
  perform pg_temp.rec('version 3: a glucose emergency is held', '0|1|held/glucose_emergency/-', pg_temp.legacy_n(e2) || '|' || pg_temp.alerts(e2) || '|' || pg_temp.hstat(e2));
  v_pg := pg_temp.eng(e2, v_rd, 'glucose_care_triage');
  perform private.sweep_legacy_notice_holds();
  perform pg_temp.rec('version 3: the glucose emergency broadcast is suppressed once the glucose page is confirmed', '0|suppressed/glucose_emergency/page_confirmed', pg_temp.legacy_n(e2) || '|' || pg_temp.hstat(e2));
  e3 := pg_temp.member(v_org, v_admin, 'v3-glucose-nopage');
  perform pg_temp.glu(e3, 2.5);
  perform pg_temp.due(e3);
  perform private.sweep_legacy_notice_holds();
  perform pg_temp.rec('version 3: a glucose emergency with no page by the deadline is released with the OFF shape', v_n_clin || '|true|released/glucose_emergency/no_page_in_time',
    pg_temp.legacy_n(e3) || '|' || (pg_temp.shape(e3) = v_shape_off_gl)::text || '|' || pg_temp.hstat(e3));
  e4 := pg_temp.member(v_org, v_admin, 'v3-other-emergencies');
  perform pg_temp.ee(e4, 'ai_coach');
  perform pg_temp.rec('version 3: other emergency sources are untouched (sent at once, nothing held)', v_n_clin || '|0', pg_temp.legacy_n(e4) || '|' || pg_temp.holds(e4));
  -- the EMERGENCY window is much shorter than the red-level one, and an emergency is only held while the event bus is clearly alive
  perform pg_temp.rec('version 3: an emergency hold waits 15 seconds, a red-level hold 60', '15|60',
    (select extract(epoch from deadline_at - created_at)::integer::text from public.legacy_notice_holds where patient_id = e1) || '|' ||
    (select extract(epoch from deadline_at - created_at)::integer::text from public.legacy_notice_holds where patient_id = h1));
  perform pg_temp.hb(60);
  x2 := pg_temp.member(v_org, v_admin, 'v3-em-stale-bus'); x3 := pg_temp.member(v_org, v_admin, 'v3-red-stale-bus');
  perform pg_temp.bp_em(x2);
  perform pg_temp.bp(x3, 170, 95);
  perform pg_temp.rec('version 3: with the event bus 60 seconds quiet an emergency fires at once while a red-level notice is still held', v_n_clin || '|fired/bp_emergency/engine_stale|0|held/bp_red/-',
    pg_temp.legacy_n(x2) || '|' || pg_temp.hstat(x2) || '|' || pg_temp.legacy_n(x3) || '|' || pg_temp.hstat(x3));
  perform pg_temp.hb(0);
  x4 := pg_temp.member(v_org, v_admin, 'v3-em-bus-dies');
  perform pg_temp.bp_em(x4);
  perform pg_temp.rec('version 3: an emergency is held while the bus is fresh', '0|held/bp_emergency/-', pg_temp.legacy_n(x4) || '|' || pg_temp.hstat(x4));
  perform pg_temp.hb(60);
  perform private.sweep_legacy_notice_holds();
  perform pg_temp.rec('version 3: the bus goes quiet before any page: the sweep cannot confirm and sends the emergency notice now (before its 15 second deadline)', v_n_clin || '|released/bp_emergency/engine_stale',
    pg_temp.legacy_n(x4) || '|' || pg_temp.hstat(x4));
  perform pg_temp.hb(0);
  perform pg_temp.due(x3);
  perform private.sweep_legacy_notice_holds();
  e5 := pg_temp.mkuser(v_org, 'v3-free', 'patient');
  perform pg_temp.glu(e5, 2.5);
  perform pg_temp.rec('version 3: a Free patient glucose emergency keeps the emergency event, no alert, no broadcast, nothing held', '1|0|0|0',
    (select count(*)::text from public.emergency_events where patient_id = e5 and source = 'glucose_red_flag') || '|' || pg_temp.alerts(e5) || '|' || pg_temp.legacy_n(e5) || '|' || pg_temp.holds(e5));
  perform pg_temp.act(v_cmo);
  perform public.switch_off_legacy_notice_retirement();
  perform pg_temp.back();

  -- 7. Care Circle --------------------------------------------------------------------------------------------------------
  -- unified paging is signed (the S19d flag), and version 4 is NOT yet live: a unified page tells the circle nothing, and the supporter's list does not show it
  perform pg_temp.act(v_cmo);
  perform public.sign_unified_red_paging_config(1, true);
  perform pg_temp.back();
  c_ok := pg_temp.member(v_org, v_admin, 'circle-ok'); s_ok := pg_temp.mkuser(v_org, 'sup-ok', 'patient');
  insert into public.care_circle_members (organisation_id, patient_id, supporter_id, relationship, permissions, expires_at) values (v_org, c_ok, s_ok, 'Sister', array['red_alerts'], now() + interval '300 days');
  c_noperm := pg_temp.member(v_org, v_admin, 'circle-noperm'); s_noperm := pg_temp.mkuser(v_org, 'sup-noperm', 'patient');
  insert into public.care_circle_members (organisation_id, patient_id, supporter_id, relationship, permissions, expires_at) values (v_org, c_noperm, s_noperm, 'Brother', array['pay_for_care'], now() + interval '300 days');
  perform pg_temp.spo2(c_ok, 91);
  perform pg_temp.spo2(c_noperm, 91);
  perform pg_temp.rec('circle, version 4 not live: a unified SpO2 page exists but the circle is told nothing', '1|0', pg_temp.roots(c_ok) || '|' || pg_temp.circle_n(s_ok));
  perform pg_temp.act(s_ok);
  v_open := public.circle_open_alerts();
  perform pg_temp.back();
  perform pg_temp.rec('circle, version 4 not live: the supporter''s open-requests list does not show the unified page either', '0', jsonb_array_length(v_open)::text);
  -- a blood pressure engine page behaves as it always did, with or without the new config
  c_bp := pg_temp.member(v_org, v_admin, 'circle-bp'); s_bp := pg_temp.mkuser(v_org, 'sup-bp', 'patient');
  insert into public.care_circle_members (organisation_id, patient_id, supporter_id, relationship, permissions, expires_at) values (v_org, c_bp, s_bp, 'Wife', array['red_alerts'], now() + interval '300 days');
  perform pg_temp.eng(c_bp, gen_random_uuid(), 'bp_care_triage');
  perform pg_temp.rec('a blood pressure engine page tells the circle exactly as before (control, config untouched)', '1', pg_temp.circle_n(s_bp)::text);

  perform pg_temp.act(v_cmo);
  perform public.sign_legacy_notice_retirement_config(4, true);
  perform pg_temp.back();
  perform pg_temp.rec('version 4 is live: the circle key reads 1, nothing is retired', '1,observe', coalesce(private.legacy_retire_rule('circle_notice_unified_page')::text, 'null') || ',' || private.legacy_notice_mode('bp_red'));
  -- the predicate itself, on pages made directly: an emergency source is allowed only from an allow-list
  x5 := pg_temp.member(v_org, v_admin, 'allow-1'); x6 := pg_temp.member(v_org, v_admin, 'allow-2'); x7 := pg_temp.member(v_org, v_admin, 'allow-3');
  x8 := pg_temp.member(v_org, v_admin, 'allow-preg');
  update public.profiles set is_pregnant = true where id = x8;
  -- (the pages are made first, in their own statement: a STABLE function in the same statement would not see the rows a volatile one just wrote)
  v_pgs := array[pg_temp.uni(x5, 'emergency_event', 'exposure_report'), pg_temp.uni(x6, 'emergency_event', 'ai_coach'), pg_temp.uni(x7, 'emergency_event', null),
                 pg_temp.uni(pg_temp.member(v_org, v_admin, 'allow-4'), 'emergency_event', 'spo2_red_flag'),
                 pg_temp.uni(pg_temp.member(v_org, v_admin, 'allow-5'), 'emergency_event', 'symptom_log'),
                 pg_temp.uni(x8, 'emergency_event', 'symptom_log'),
                 pg_temp.uni(pg_temp.member(v_org, v_admin, 'allow-6'), 'symptom_red_flag', 'symptom:chest_pain')];
  perform pg_temp.rec('circle: an emergency from an exposure report, an AI coach chat or an unknown origin is withheld; vitals and symptom sources are allowed (symptoms footprint-gated)',
    'false,false,false,true,true,false,true',
    private.page_circle_may_know(v_pgs[1])::text || ',' || private.page_circle_may_know(v_pgs[2])::text || ',' || private.page_circle_may_know(v_pgs[3])::text || ',' ||
    private.page_circle_may_know(v_pgs[4])::text || ',' || private.page_circle_may_know(v_pgs[5])::text || ',' || private.page_circle_may_know(v_pgs[6])::text || ',' ||
    private.page_circle_may_know(v_pgs[7])::text);
  c_gen := pg_temp.member(v_org, v_admin, 'circle-vitals-2'); s_gen := pg_temp.mkuser(v_org, 'sup-vitals-2', 'patient');
  insert into public.care_circle_members (organisation_id, patient_id, supporter_id, relationship, permissions, expires_at) values (v_org, c_gen, s_gen, 'Friend', array['red_alerts'], now() + interval '300 days');
  perform pg_temp.spo2(c_gen, 91);
  perform pg_temp.rec('circle, version 4 live: a unified vitals page tells the member who holds red_alerts, with the neutral content-free notice', '1|1|non_clinical|{}',
    pg_temp.roots(c_gen) || '|' || pg_temp.circle_n(s_gen) || '|' || (select n.content_class::text from public.notifications n where n.recipient_id = s_gen and n.template = 'circle_check_in' limit 1) || '|' ||
    (select n.payload::text from public.notifications n where n.recipient_id = s_gen and n.template = 'circle_check_in' limit 1));
  perform pg_temp.rec('circle, version 4 live: a member WITHOUT red_alerts is told nothing', '0', pg_temp.circle_n(s_noperm)::text);
  perform pg_temp.act(s_gen);
  v_open := public.circle_open_alerts();
  perform pg_temp.rec('circle, version 4 live: the supporter sees the open request', '1', jsonb_array_length(v_open)::text);
  perform pg_temp.rec('circle, version 4 live: acknowledging marks it', 'true', public.circle_ack_alert(c_gen)::text);
  perform pg_temp.back();
  -- an emergency-sourced vitals page
  c_tes := pg_temp.member(v_org, v_admin, 'circle-em'); s_tes := pg_temp.mkuser(v_org, 'sup-em', 'patient');
  insert into public.care_circle_members (organisation_id, patient_id, supporter_id, relationship, permissions, expires_at) values (v_org, c_tes, s_tes, 'Friend', array['red_alerts'], now() + interval '300 days');
  perform pg_temp.spo2(c_tes, 85);
  perform pg_temp.rec('circle, version 4 live: a vitals emergency page tells the member too', '1', pg_temp.circle_n(s_tes)::text);
  -- reproductive guard: a symptom event for a patient with a pregnancy footprint is withheld; her vitals events are not symptom events
  c_preg := pg_temp.member(v_org, v_admin, 'circle-pregnant'); s_preg := pg_temp.mkuser(v_org, 'sup-pregnant', 'patient');
  insert into public.care_circle_members (organisation_id, patient_id, supporter_id, relationship, permissions, expires_at) values (v_org, c_preg, s_preg, 'Mother', array['red_alerts'], now() + interval '300 days');
  update public.profiles set is_pregnant = true where id = c_preg;
  perform pg_temp.symptom(c_preg, 'chest_pain', 8);
  perform pg_temp.ee(c_preg, 'danger_symptom_checklist');
  perform pg_temp.rec('circle: a symptom red flag and a danger-symptom emergency for a pregnant patient page the clinician but the circle is told NOTHING', '>=1|0', case when pg_temp.roots(c_preg) >= 1 then '>=1' else '0' end || '|' || pg_temp.circle_n(s_preg));
  perform pg_temp.act(s_preg);
  v_open := public.circle_open_alerts();
  perform pg_temp.rec('circle: ...and the supporter''s list shows nothing for her', '0', jsonb_array_length(v_open)::text);
  perform pg_temp.back();
  update public.profiles set is_pregnant = false where id = c_preg;
  insert into public.reproductive_health_profiles (organisation_id, patient_id, life_stage) values (v_org, c_preg, 'pregnant');
  perform pg_temp.symptom(c_preg, 'chest_pain', 8);
  perform pg_temp.rec('circle: a reproductive-health profile is a footprint too: still nothing', '0', pg_temp.circle_n(s_preg)::text);
  delete from public.reproductive_health_profiles where patient_id = c_preg;
  -- the same kind of symptom event for a patient with NO footprint does tell the circle (so the guard is not a blanket block)
  c_paused := pg_temp.member(v_org, v_admin, 'circle-symptom'); s_paused := pg_temp.mkuser(v_org, 'sup-symptom', 'patient');
  insert into public.care_circle_members (organisation_id, patient_id, supporter_id, relationship, permissions, expires_at) values (v_org, c_paused, s_paused, 'Mother', array['red_alerts'], now() + interval '300 days');
  perform pg_temp.symptom(c_paused, 'chest_pain', 8);
  perform pg_temp.rec('circle: a red-flag symptom for a patient with no reproductive footprint tells the circle', '1', pg_temp.circle_n(s_paused)::text);
  -- reproductive symptom type
  declare c_rep uuid := pg_temp.member(v_org, v_admin, 'circle-testicular'); s_rep uuid := pg_temp.mkuser(v_org, 'sup-testicular', 'patient');
  begin
    insert into public.care_circle_members (organisation_id, patient_id, supporter_id, relationship, permissions, expires_at) values (v_org, c_rep, s_rep, 'Wife', array['red_alerts'], now() + interval '300 days');
    perform pg_temp.symptom(c_rep, 'testicular_pain', 9);
    perform pg_temp.rec('circle: a reproductive symptom type is withheld even with no profile footprint', '0', pg_temp.circle_n(s_rep)::text);
  end;
  -- a pregnant patient's VITALS page is not a symptom event: the neutral notice carries nothing about pregnancy (OQ-S19F-02)
  declare c_pv uuid := pg_temp.member(v_org, v_admin, 'circle-pregnant-vitals'); s_pv uuid := pg_temp.mkuser(v_org, 'sup-pregnant-vitals', 'patient');
  begin
    insert into public.care_circle_members (organisation_id, patient_id, supporter_id, relationship, permissions, expires_at) values (v_org, c_pv, s_pv, 'Mother', array['red_alerts'], now() + interval '300 days');
    update public.profiles set is_pregnant = true where id = c_pv;
    perform pg_temp.spo2(c_pv, 91);
    perform pg_temp.rec('circle: a pregnant patient''s vitals page tells her circle (the notice is content-free and the event is not reproductive)', '1', pg_temp.circle_n(s_pv)::text);
  end;
  -- a patient pause of check-in requests, an expired member, a Free patient
  declare c_pz uuid := pg_temp.member(v_org, v_admin, 'circle-paused'); s_pz uuid := pg_temp.mkuser(v_org, 'sup-paused', 'patient');
          c_fr uuid := pg_temp.mkuser(v_org, 'circle-free', 'patient'); s_fr uuid := pg_temp.mkuser(v_org, 'sup-free', 'patient');
  begin
    insert into public.care_circle_members (organisation_id, patient_id, supporter_id, relationship, permissions, expires_at) values (v_org, c_pz, s_pz, 'Friend', array['red_alerts'], now() + interval '300 days');
    insert into public.care_circle_pauses (organisation_id, patient_id, paused_from, paused_until, pause_alerts) values (v_org, c_pz, now() - interval '1 hour', now() + interval '1 day', true);
    perform pg_temp.spo2(c_pz, 91);
    perform pg_temp.rec('circle: the patient''s own pause of check-in requests still wins (existing S29 rule, reused)', '1|0', pg_temp.roots(c_pz) || '|' || pg_temp.circle_n(s_pz));
    insert into public.care_circle_members (organisation_id, patient_id, supporter_id, relationship, permissions, expires_at) values (v_org, c_fr, s_fr, 'Friend', array['red_alerts'], now() + interval '300 days');
    perform pg_temp.spo2(c_fr, 91);
    perform pg_temp.spo2(c_fr, 85);
    perform pg_temp.rec('circle: a Free patient has no page at all, so the circle is told nothing', '0|0', pg_temp.roots(c_fr) || '|' || pg_temp.circle_n(s_fr));
  end;
  perform pg_temp.act(v_cmo);
  perform public.switch_off_legacy_notice_retirement();
  perform pg_temp.back();
  declare c_off uuid := pg_temp.member(v_org, v_admin, 'circle-off'); s_off uuid := pg_temp.mkuser(v_org, 'sup-off', 'patient');
  begin
    insert into public.care_circle_members (organisation_id, patient_id, supporter_id, relationship, permissions, expires_at) values (v_org, c_off, s_off, 'Friend', array['red_alerts'], now() + interval '300 days');
    perform pg_temp.spo2(c_off, 91);
    perform pg_temp.rec('circle: switched back off, a unified page tells the circle nothing again', '1|0', pg_temp.roots(c_off) || '|' || pg_temp.circle_n(s_off));
  end;

  -- 8. SABOTAGE: each guard replaced by a no-op must flip its check -------------------------------------------------------------
  perform pg_temp.act(v_cmo);
  perform public.sign_legacy_notice_retirement_config(2, true);
  perform pg_temp.back();

  -- S1: the sweep-level reachability check blinded: an unreachable primary would wrongly suppress
  v_orig := pg_get_functiondef('private.legacy_primary_reachable(uuid)'::regprocedure);
  create or replace function private.legacy_primary_reachable(p_profile uuid) returns boolean language sql stable security definer set search_path = '' as $f$ select true $f$;
  h1 := pg_temp.member(v_org, v_admin, 'sab-reach');
  v_rd := pg_temp.bp(h1, 170, 95);
  v_pg := pg_temp.eng(h1, v_rd, 'bp_care_triage');
  update public.push_subscriptions set disabled_at = now() where profile_id = v_p;
  update auth.users set email_confirmed_at = null where id = v_p;
  perform private.sweep_legacy_notice_holds();
  perform pg_temp.sab('HOLD: a page exists but its primary can no longer be reached: the broadcast is RELEASED', v_n_clin::text, pg_temp.legacy_n(h1)::text);
  execute v_orig;
  update public.push_subscriptions set disabled_at = null where profile_id = v_p;
  update auth.users set email_confirmed_at = now() where id = v_p;

  -- S2: the page lookup blinded: a confirmed page would never suppress
  v_orig := pg_get_functiondef('private.legacy_hold_page(uuid)'::regprocedure);
  create or replace function private.legacy_hold_page(p_hold uuid, out o_page uuid, out o_page_at timestamptz, out o_to uuid, out o_no_cover boolean, out o_ack boolean) returns record
    language plpgsql stable security definer set search_path = '' as $f$ begin return; end $f$;
  h2 := pg_temp.member(v_org, v_admin, 'sab-lookup');
  v_rd := pg_temp.bp(h2, 170, 95);
  v_pg := pg_temp.eng(h2, v_rd, 'bp_care_triage');
  perform private.sweep_legacy_notice_holds();
  perform pg_temp.sab('HOLD: the page of that event, primary reachable: the broadcast is SUPPRESSED for good', 'suppressed/bp_red/page_confirmed', pg_temp.hstat(h2));
  execute v_orig;

  -- S3: the page matched by patient only (not by the event): a page for another reading would wrongly confirm this one
  create or replace function private.legacy_hold_page(p_hold uuid, out o_page uuid, out o_page_at timestamptz, out o_to uuid, out o_no_cover boolean, out o_ack boolean) returns record
    language plpgsql stable security definer set search_path = '' as $f$
    declare h public.legacy_notice_holds%rowtype; v_root public.pages%rowtype;
    begin
      select * into h from public.legacy_notice_holds where id = p_hold;
      select * into v_root from public.pages where patient_id = h.patient_id and parent_page_id is null order by sent_at limit 1;
      if not found then return; end if;
      o_page := v_root.id; o_page_at := v_root.sent_at; o_to := v_root.to_clinician_id; o_no_cover := v_root.no_cover; o_ack := false;
    end $f$;
  h3 := pg_temp.member(v_org, v_admin, 'sab-other-event');
  perform pg_temp.bp(h3, 170, 95);
  perform pg_temp.eng(h3, gen_random_uuid(), 'bp_care_triage');
  perform private.sweep_legacy_notice_holds();
  perform pg_temp.sab('HOLD: a page for another reading does NOT confirm this event', 'held/bp_red/-', pg_temp.hstat(h3));
  execute v_orig;

  -- S4: the deadline ignored: a notice with no page would stay held for ever
  v_orig := pg_get_functiondef('private.sweep_legacy_notice_holds(boolean)'::regprocedure);
  if replace(v_orig, 'h.deadline_at <= now() or', 'false and') = v_orig then raise exception 'VACUOUS TEST: deadline text not found'; end if;
  execute replace(v_orig, 'h.deadline_at <= now() or', 'false and');
  h4 := pg_temp.member(v_org, v_admin, 'sab-deadline');
  perform pg_temp.bp(h4, 170, 95);
  perform pg_temp.due(h4);
  perform private.sweep_legacy_notice_holds();
  perform pg_temp.sab('HOLD: no page by the deadline: the broadcast is RELEASED to every clinician', v_n_clin::text, pg_temp.legacy_n(h4)::text);
  execute v_orig;

  -- S5: the release itself a no-op: a due notice would be marked released without anyone being told
  v_orig := pg_get_functiondef('private.release_legacy_notice(uuid)'::regprocedure);
  create or replace function private.release_legacy_notice(p_hold uuid) returns integer language plpgsql security definer set search_path = '' as $f$ begin return 0; end $f$;
  h5 := pg_temp.member(v_org, v_admin, 'sab-release');
  perform pg_temp.bp(h5, 170, 95);
  perform pg_temp.due(h5);
  perform private.sweep_legacy_notice_holds();
  perform pg_temp.sab('HOLD: no page by the deadline: the broadcast is RELEASED to every clinician (release)', v_n_clin::text, pg_temp.legacy_n(h5)::text);
  execute v_orig;

  -- S6: the mode function ignores the separate emergency key: a BP crisis would be held under version 2
  v_orig := pg_get_functiondef('private.legacy_notice_mode(text)'::regprocedure);
  if replace(v_orig, 'case when p_kind like ''%\_emergency'' then private.legacy_retire_rule(''suppress_legacy_emergency_notice'') else 1 end', '1') = v_orig then raise exception 'VACUOUS TEST: emergency key text not found'; end if;
  execute replace(v_orig, 'case when p_kind like ''%\_emergency'' then private.legacy_retire_rule(''suppress_legacy_emergency_notice'') else 1 end', '1');
  h6 := pg_temp.member(v_org, v_admin, 'sab-emergency-key');
  perform pg_temp.bp_em(h6);
  perform pg_temp.sab('version 2: a BP crisis keeps its broadcast (the emergency key is separate and 0)', v_n_clin::text, pg_temp.legacy_n(h6)::text);
  execute v_orig;

  -- S7: the pre-check for an unreachable primary removed: the broadcast would be held for a page nobody can receive
  v_orig := pg_get_functiondef('private.legacy_notice_deferred(text,uuid,uuid,uuid,text,uuid,text,text,text,jsonb)'::regprocedure);
  if replace(v_orig, 'elsif not private.legacy_primary_reachable(v_to) then v_why', 'elsif false then v_why') = v_orig then raise exception 'VACUOUS TEST: reachable pre-check text not found'; end if;
  execute replace(v_orig, 'elsif not private.legacy_primary_reachable(v_to) then v_why', 'elsif false then v_why');
  update public.push_subscriptions set disabled_at = now() where profile_id = v_p;
  update auth.users set email_confirmed_at = null where id = v_p;
  h7 := pg_temp.member(v_org, v_admin, 'sab-prereach');
  perform pg_temp.bp(h7, 170, 95);
  perform pg_temp.sab('HOLD: a primary with no push route and no verified email: the broadcast fires AT ONCE, not held', v_n_clin::text, pg_temp.legacy_n(h7)::text);
  execute v_orig;
  update public.push_subscriptions set disabled_at = null where profile_id = v_p;
  update auth.users set email_confirmed_at = now() where id = v_p;

  -- S8: the engine-health pre-check removed: a quiet event bus would still hold the broadcast
  if replace(v_orig, 'elsif not exists (select 1 from public.paging_heartbeats b', 'elsif false and exists (select 1 from public.paging_heartbeats b') = v_orig then raise exception 'VACUOUS TEST: heartbeat pre-check text not found'; end if;
  execute replace(v_orig, 'elsif not exists (select 1 from public.paging_heartbeats b', 'elsif false and exists (select 1 from public.paging_heartbeats b');
  perform set_config('tarragon.paging_write', 'on', true);
  update public.paging_heartbeats set last_seen_at = now() - interval '1 hour' where component = 'process_events';
  perform set_config('tarragon.paging_write', 'off', true);
  h8 := pg_temp.member(v_org, v_admin, 'sab-engine');
  perform pg_temp.bp(h8, 170, 95);
  perform pg_temp.sab('HOLD: no recent event-bus heartbeat: the broadcast fires at once', v_n_clin::text, pg_temp.legacy_n(h8)::text);
  execute v_orig;
  perform private.paging_heartbeat('process_events');

  -- S9: the OFF state forced to hold: flag off must be byte-identical to the old behaviour
  v_orig := pg_get_functiondef('private.legacy_notice_mode(text)'::regprocedure);
  perform pg_temp.act(v_cmo);
  perform public.switch_off_legacy_notice_retirement();
  perform pg_temp.back();
  create or replace function private.legacy_notice_mode(p_kind text) returns text language sql stable security definer set search_path = '' as $f$ select 'hold'::text $f$;
  h9 := pg_temp.member(v_org, v_admin, 'sab-off');
  perform pg_temp.bp(h9, 170, 95);
  perform pg_temp.sab('OFF: BP red notifies every clinician profile at once (flag off is the old behaviour)', v_n_clin::text, pg_temp.legacy_n(h9)::text);
  execute v_orig;

  -- S10: the Care Circle predicate always true: a pregnant patient's symptom page would reach the circle, and version 4 would not be needed
  perform pg_temp.act(v_cmo);
  perform public.sign_legacy_notice_retirement_config(4, true);
  perform pg_temp.back();
  v_orig := pg_get_functiondef('private.page_circle_may_know(uuid)'::regprocedure);
  create or replace function private.page_circle_may_know(p_page uuid) returns boolean language sql stable security definer set search_path = '' as $f$ select true $f$;
  c_preg := pg_temp.member(v_org, v_admin, 'sab-circle-pregnant'); s_preg := pg_temp.mkuser(v_org, 'sab-sup-pregnant', 'patient');
  insert into public.care_circle_members (organisation_id, patient_id, supporter_id, relationship, permissions, expires_at) values (v_org, c_preg, s_preg, 'Mother', array['red_alerts'], now() + interval '300 days');
  update public.profiles set is_pregnant = true where id = c_preg;
  perform pg_temp.symptom(c_preg, 'chest_pain', 8);
  perform pg_temp.sab('circle: a symptom red flag for a pregnant patient: the circle is told NOTHING', '0', pg_temp.circle_n(s_preg)::text);
  execute v_orig;
  -- S11: the permission clause of the existing notifier removed would be the existing S29 proof's job; here the reproductive branch itself is removed
  v_orig := pg_get_functiondef('private.page_circle_may_know(uuid)'::regprocedure);
  if replace(v_orig, 'if coalesce((select p.is_pregnant from public.profiles p where p.id = v_patient), false)', 'if false and coalesce((select p.is_pregnant from public.profiles p where p.id = v_patient), false)') = v_orig then raise exception 'VACUOUS TEST: pregnancy branch text not found'; end if;
  execute replace(v_orig, 'if coalesce((select p.is_pregnant from public.profiles p where p.id = v_patient), false)', 'if false and coalesce((select p.is_pregnant from public.profiles p where p.id = v_patient), false)');
  c_preg := pg_temp.member(v_org, v_admin, 'sab-circle-pregnant-2'); s_preg := pg_temp.mkuser(v_org, 'sab-sup-pregnant-2', 'patient');
  insert into public.care_circle_members (organisation_id, patient_id, supporter_id, relationship, permissions, expires_at) values (v_org, c_preg, s_preg, 'Mother', array['red_alerts'], now() + interval '300 days');
  update public.profiles set is_pregnant = true where id = c_preg;
  perform pg_temp.symptom(c_preg, 'chest_pain', 8);
  perform pg_temp.sab('circle: a symptom red flag for a pregnant patient: the circle is told NOTHING (footprint branch)', '0', pg_temp.circle_n(s_preg)::text);
  execute v_orig;
  -- S16: the emergency allow-list removed: an exposure-report emergency must then wrongly reach the circle
  v_orig := pg_get_functiondef('private.page_circle_may_know(uuid)'::regprocedure);
  if replace(v_orig, 'if v_basis = ''emergency_event'' and not coalesce(', 'if false and v_basis = ''emergency_event'' and not coalesce(') = v_orig then raise exception 'VACUOUS TEST: allow-list text not found'; end if;
  execute replace(v_orig, 'if v_basis = ''emergency_event'' and not coalesce(', 'if false and v_basis = ''emergency_event'' and not coalesce(');
  x5 := pg_temp.member(v_org, v_admin, 'sab-allow');
  v_pgs := array[pg_temp.uni(x5, 'emergency_event', 'exposure_report')];
  perform pg_temp.sab('circle: an emergency from an exposure report is withheld', 'false', private.page_circle_may_know(v_pgs[1])::text);
  execute v_orig;

  -- the remaining sabotages run on version 2 / 3
  perform pg_temp.act(v_cmo);
  perform public.sign_legacy_notice_retirement_config(2, true);
  perform pg_temp.back();

  -- S15: the "this reading's own event exists" requirement removed: an open family alone would wrongly suppress
  v_orig := pg_get_functiondef('private.legacy_notice_deferred(text,uuid,uuid,uuid,text,uuid,text,text,text,jsonb)'::regprocedure);
  if replace(v_orig, 'and private.legacy_reading_has_red_event(', 'and true or private.legacy_reading_has_red_event(') = v_orig then raise exception 'VACUOUS TEST: family requirement text not found'; end if;
  execute replace(v_orig, 'and private.legacy_reading_has_red_event(', 'and true or private.legacy_reading_has_red_event(');
  x6 := pg_temp.member(v_org, v_admin, 'sab-family');
  perform pg_temp.eng(x6, gen_random_uuid(), 'bp_care_triage');
  perform pg_temp.sab('HOLD: an open family alone does NOT suppress a reading with no event of its own: it is held', 'true|held/bp_red/-',
    private.legacy_notice_deferred('bp_red', v_org, x6, gen_random_uuid(), 'clinician_alerts', gen_random_uuid(), 'vitals_red_flag_clinician_alert', 'bp_vitals_red_flag', 'urgent_escalation', '{}'::jsonb)::text || '|' || pg_temp.hstat(x6));
  execute v_orig;

  -- S17: the immediate incident for a failing release renamed away
  v_orig := pg_get_functiondef('private.sweep_legacy_notice_holds(boolean)'::regprocedure);
  if replace(v_orig, '''legacy_notice_release_failed:'' || h.id', '''legacy_notice_release_failed_x:'' || h.id') = v_orig then raise exception 'VACUOUS TEST: incident text not found'; end if;
  execute replace(v_orig, '''legacy_notice_release_failed:'' || h.id', '''legacy_notice_release_failed_x:'' || h.id');
  v_orig2 := pg_get_functiondef('private.release_legacy_notice(uuid)'::regprocedure);
  create or replace function private.release_legacy_notice(p_hold uuid) returns integer language plpgsql security definer set search_path = '' as $f$ begin raise exception 'simulated release failure'; end $f$;
  x7 := pg_temp.member(v_org, v_admin, 'sab-release-fail');
  perform pg_temp.bp(x7, 170, 95);
  perform pg_temp.due(x7);
  perform private.sweep_legacy_notice_holds();
  perform pg_temp.sab('a failing release past the deadline opens an incident from the sweep at once', '1',
    (select count(*)::text from public.ops_incidents where external_reference = 'legacy_notice_release_failed:' || (select id from public.legacy_notice_holds where patient_id = x7)));
  execute v_orig2;
  execute v_orig;
  perform private.sweep_legacy_notice_holds();

  -- S18: the measurement failure no longer logged
  if replace(v_orig, '''phase'', ''measurement''', '''phase'', ''x''') = v_orig then raise exception 'VACUOUS TEST: measurement log text not found'; end if;
  execute replace(v_orig, '''phase'', ''measurement''', '''phase'', ''x''');
  v_orig2 := pg_get_functiondef('private.legacy_hold_page(uuid)'::regprocedure);
  create or replace function private.legacy_hold_page(p_hold uuid, out o_page uuid, out o_page_at timestamptz, out o_to uuid, out o_no_cover boolean, out o_ack boolean) returns record
    language plpgsql stable security definer set search_path = '' as $f$ begin raise exception 'simulated lookup failure'; end $f$;
  x8 := pg_temp.member(v_org, v_admin, 'sab-measure');
  perform pg_temp.bp_em(x8);
  perform private.sweep_legacy_notice_holds();
  perform pg_temp.sab('a failing measurement lookup is audited (phase measurement), not swallowed', 'true',
    (exists (select 1 from public.audit_log where action = 'legacy_notice.sweep_error' and event ->> 'phase' = 'measurement'
                and entity_id = (select id from public.legacy_notice_holds where patient_id = x8)))::text);
  execute v_orig2;
  execute v_orig;

  -- S13 and S14 need version 3 and a quiet event bus
  perform pg_temp.act(v_cmo);
  perform public.sign_legacy_notice_retirement_config(3, true);
  perform pg_temp.back();
  perform pg_temp.hb(0);
  -- S13: the emergency pre-check uses the long red-level heartbeat window: a BP crisis with a 60 second quiet bus would wrongly be held
  v_orig := pg_get_functiondef('private.legacy_notice_deferred(text,uuid,uuid,uuid,text,uuid,text,text,text,jsonb)'::regprocedure);
  if replace(v_orig, 'coalesce(private.legacy_retire_rule(''emergency_engine_fresh_seconds''), 30)', '120') = v_orig then raise exception 'VACUOUS TEST: emergency freshness text not found'; end if;
  execute replace(v_orig, 'coalesce(private.legacy_retire_rule(''emergency_engine_fresh_seconds''), 30)', '120');
  perform pg_temp.hb(60);
  x1 := pg_temp.member(v_org, v_admin, 'sab-em-fresh');
  perform pg_temp.bp_em(x1);
  perform pg_temp.sab('version 3: with the event bus 60 seconds quiet an emergency fires at once', v_n_clin::text, pg_temp.legacy_n(x1)::text);
  execute v_orig;
  perform pg_temp.hb(0);
  -- S14: the sweep no longer sends an emergency notice when the bus goes quiet
  v_orig := pg_get_functiondef('private.sweep_legacy_notice_holds(boolean)'::regprocedure);
  if replace(v_orig, 'or (v_emerg and not v_engine_ok) then', 'then') = v_orig then raise exception 'VACUOUS TEST: sweep emergency text not found'; end if;
  execute replace(v_orig, 'or (v_emerg and not v_engine_ok) then', 'then');
  x2 := pg_temp.member(v_org, v_admin, 'sab-em-bus-dies');
  perform pg_temp.bp_em(x2);
  perform pg_temp.hb(60);
  perform private.sweep_legacy_notice_holds();
  perform pg_temp.sab('version 3: the bus goes quiet before any page: the sweep sends the emergency notice now', v_n_clin::text, pg_temp.legacy_n(x2)::text);
  execute v_orig;
  perform pg_temp.hb(0);

  perform pg_temp.act(v_cmo);
  perform public.switch_off_legacy_notice_retirement();
  perform pg_temp.back();

  -- S12: the parallel-run evidence gate removed: with no evidence a retiring version would wrongly be signed
  update public.legacy_notice_retirement_config set activated_at = now() where version = 1;
  delete from public.legacy_notice_holds where reason = 'proof_evidence';
  v_orig := pg_get_functiondef('public.sign_legacy_notice_retirement_config(integer,boolean)'::regprocedure);
  if replace(v_orig, 'if v_days < v_need_days or v_events < v_need_events then', 'if false then') = v_orig then raise exception 'VACUOUS TEST: evidence gate text not found'; end if;
  perform pg_temp.act(v_cmo);
  perform pg_temp.rec('with no evidence version 2 is refused again', '23514', pg_temp.try('select public.sign_legacy_notice_retirement_config(2, true)'));
  perform pg_temp.back();
  execute replace(v_orig, 'if v_days < v_need_days or v_events < v_need_events then', 'if false then');
  perform pg_temp.act(v_cmo);
  perform pg_temp.sab('with no evidence version 2 is refused again', '23514', pg_temp.try('select public.sign_legacy_notice_retirement_config(2, true)'));
  perform public.switch_off_legacy_notice_retirement();
  perform pg_temp.back();
  execute v_orig;
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'Legacy notice retirement proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ')
         from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 18 then
    raise exception 'VACUOUS TEST: only % of 18 sabotage steps changed the matching check: %', v_caught,
      (select string_agg(check_name, '; ') from results where phase = 'sabotaged' and expected = actual);
  end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;
-- Sabotaged rows are asserted to differ inside the DO block above and are deliberately not printed: the runner treats
-- any FAIL verdict in the output as a failed proof.

rollback;
