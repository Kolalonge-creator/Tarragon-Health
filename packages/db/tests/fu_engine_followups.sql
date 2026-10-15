-- Follow-up engine proof (migrations *_fu_bp_care_triage_v7_symptom_alone_draft.sql, *_fu_adherence_window_name_and_bp_a4_replaces_alert.sql,
-- *_fu_glucose_monitor_and_wearable_grading.sql, *_fu_glucose_fast_sugar_wording_signing_line.sql).
--
--   OQ-320  Glucose from a monitor or wearable: a fresh reading emits one observation.recorded, a stale one none, a bulk insert statement emits only the LATEST
--           reading of each patient, manual and Bluetooth readings still emit exactly once through their own trigger, the result writer stores nothing for the same
--           level (grade and rule) inside the dedupe window for a monitor reading but never dedupes a manual one, a different level or an old event; with the config
--           off nothing is emitted or deduped. Nothing pages (the glucose rule set is a draft, so every result is shadow).
--   OQ-354  The BP-A4 task replaces the older medication_adherence_low alert only for a Member with a blood pressure interest while the sweep is on and BP-A4 is in an
--           approved rule set; a Free patient and a Member with no blood pressure interest keep the alert; with the sweep off the alert stays for everyone.
--   OQ-356  The coverage context sends percentWindow and no longer percent7d.
--   OQ-355  bp_care_triage v7 is an unsigned draft with exactly three more rules than v6, all on the symptom trigger; one version stays approved.
--   OQ-326  The fast-sugar wording guard exists, is off, its attestation is unmet until the Chief Medical Officer records it; a patient cannot; the glucose rule set is
--           not signed by it.
--   SABOTAGE  (a) the monitor producer trigger dropped: the fresh-reading event check flips; (b) the BP-A4 cover forced false: the replaced alert comes back;
--             (c) the wording condition forced met: the unmet-before-signing check flips. Each must change a result.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;

-- Fixture (rolled back with the rest): a fresh database has bp_care_triage only as drafts, because a human approves it in production (v3 is approved there).
do $$
declare v_p uuid := gen_random_uuid(); v_adm uuid := gen_random_uuid(); v_org uuid;
begin
  if not exists (select 1 from public.triage_rule_sets where code = 'bp_care_triage' and status = 'approved') then
    select id into v_org from public.organisations order by created_at limit 1;
    insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
      values (v_p, 'fu-fixture-' || v_p::text || '@example.invalid', 'x', now(), '{}', '{}');
    insert into public.profiles (id, organisation_id, role, full_name, date_of_birth, is_test)
      values (v_p, v_org, 'clinician', 'FU fixture approver', (current_date - interval '45 years')::date, true) on conflict (id) do update set is_test = true;
    insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
      values (v_adm, 'fu-fixture-admin-' || v_adm::text || '@example.invalid', 'x', now(), '{}', '{}');
    insert into public.profiles (id, organisation_id, role, full_name, date_of_birth, is_test)
      values (v_adm, v_org, 'admin', 'FU fixture admin', (current_date - interval '45 years')::date, true) on conflict (id) do update set is_test = true;
    insert into public.clinical_staff (profile_id, organisation_id, full_name, doctor_tier, active, license_verified_at, employment_type, indemnity_exempt, indemnity_exempt_by, is_test)
      values (v_p, v_org, 'FU fixture approver', 'chief_medical_officer', true, now(), 'employed', true, v_adm, true);
    update public.triage_rule_sets set status = 'approved', approved_by = v_p, approved_at = now() where code = 'bp_care_triage' and version = 3;
  end if;
end $$;

create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;
create function pg_temp.f(p text) returns uuid language sql as $$ select v from fx where k = p $$;
create function pg_temp.setf(p text, p_v uuid) returns void language sql as $$ insert into fx values (p, p_v) on conflict (k) do update set v = excluded.v $$;
create function pg_temp.res(p_phase text, p_check text, p_expected text, p_actual text) returns void language sql as $$ insert into results values (p_phase, p_check, p_expected, p_actual) $$;
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
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlstate; end;
  perform pg_temp.back();
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
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'fu-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'FU ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '50 years')::date, true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone;
  return v;
end $f$;
-- A patient whose doses went untaken (adherence under the line). p_member: an active Member; p_bp: a hypertension care plan (a blood pressure interest).
create function pg_temp.mkadh(p_org uuid, p_label text, p_member boolean, p_bp boolean) returns uuid
language plpgsql as $f$
declare v uuid := pg_temp.mkuser(p_org, p_label, 'patient');
begin
  if p_member then
    insert into public.patient_memberships (organisation_id, patient_id, source, state, starts_at, is_test) values (p_org, v, 'purchase', 'active', now() - interval '30 days', true);
  end if;
  if p_bp then
    insert into public.care_plans (organisation_id, patient_id, condition, status) values (p_org, v, 'hypertension', 'active');
  end if;
  insert into public.medications (organisation_id, patient_id, drug_name, dose, frequency, schedule_times, source, is_active, created_at)
    values (p_org, v, 'FU Test Medicine', '1', 'daily', '["08:00"]', 'patient', true, now() - interval '10 days');
  return v;
end $f$;
create function pg_temp.alert_count(p_patient uuid) returns integer language sql as
$$ select count(*)::integer from public.clinical_rule_events where patient_id = p_patient and event_type = 'medication_adherence_low' $$;
create function pg_temp.glu_events(p_patient uuid) returns integer language sql as
$$ select count(*)::integer from public.domain_events where event_type = 'observation.recorded' and patient_id = p_patient and payload ->> 'kind' = 'glucose' $$;
create function pg_temp.ins_glu(p_org uuid, p_patient uuid, p_source text, p_mmol numeric, p_minutes_ago integer) returns uuid language plpgsql as
$f$ declare v uuid;
begin
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, glucose_mmol_l, glucose_context, source, taken_at)
  values (p_org, p_patient, 'glucose', p_mmol, 'random', p_source::public.vital_source, now() - make_interval(mins => p_minutes_ago)) returning id into v;
  return v;
end $f$;
create function pg_temp.graded(p_rule text, p_grade text) returns jsonb language sql as
$$ select jsonb_build_object('status', 'graded', 'grade', p_grade, 'ruleId', p_rule, 'explanationKey', 'GLU-T05',
     'actions', case when p_grade = 'red' then '[{"kind":"show_emergency_guidance","code":"GLU-E01"},{"kind":"page_on_call"}]'::jsonb else '[{"kind":"show_message","code":"GLU-T05"}]'::jsonb end,
     'matchedRuleIds', jsonb_build_array(p_rule), 'taskKey', null,
     'ruleSet', jsonb_build_object('code', 'glucose_care_triage', 'version', 1)) $$;

do $$
declare
  v_org uuid; v_g uuid; v_g2 uuid; v_cmo uuid; v_adm uuid; v_pat uuid; v_rs uuid;
  a uuid; b uuid; c uuid; d uuid; e uuid; v_out jsonb; v_n integer; v_ctx jsonb; v_first uuid; v_last uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_g := pg_temp.mkuser(v_org, 'glu', 'patient');
  v_g2 := pg_temp.mkuser(v_org, 'glu2', 'patient');
  v_adm := pg_temp.mkuser(v_org, 'adm', 'admin');
  v_cmo := pg_temp.mkuser(v_org, 'cmo', 'clinician');
  v_pat := pg_temp.mkuser(v_org, 'pat', 'patient');
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
    values (v_org, v_cmo, 'FU CMO', 'MDCN', 'FU-' || substr(v_cmo::text, 1, 8), true, 'active', now(), v_adm, 'chief_medical_officer', 'employed', 2, true, v_adm, true);
  select id into v_rs from public.triage_rule_sets where code = 'glucose_care_triage' and version = 1;

  -- OQ-320 config -----------------------------------------------------------------------------------------------------------
  perform pg_temp.res('real', 'the monitor config v1 is active with the proposed numbers', 'true|30|60',
    (select (rules ->> 'enabled') || '|' || (rules ->> 'freshMinutes') || '|' || (rules ->> 'dedupeMinutes') from public.triage_glucose_monitor_config where is_active and version = 1));
  perform pg_temp.res('real', 'the glucose rule set stays a draft (nothing here signs it)', 'draft', (select status from public.triage_rule_sets where id = v_rs));

  -- Producer: one fresh reading, one stale reading, wearable and cgm ------------------------------------------------------------
  a := pg_temp.ins_glu(v_org, v_g, 'cgm', 6.0, 2);
  perform pg_temp.res('real', 'a fresh cgm reading emits one observation.recorded (kind glucose, ids only)', '1|glucose',
    (select count(*)::text || '|' || min(payload ->> 'kind') from public.domain_events where idempotency_key = 'glu:' || a));
  b := pg_temp.ins_glu(v_org, v_g, 'cgm', 6.0, 120);
  perform pg_temp.res('real', 'a cgm reading older than 30 minutes emits nothing', '0', (select count(*)::text from public.domain_events where idempotency_key = 'glu:' || b));
  c := pg_temp.ins_glu(v_org, v_g, 'wearable', 6.2, 1);
  perform pg_temp.res('real', 'a fresh wearable reading emits one event', '1', (select count(*)::text from public.domain_events where idempotency_key = 'glu:' || c));
  a := pg_temp.ins_glu(v_org, v_g2, 'cgm', 6.0, 29);
  b := pg_temp.ins_glu(v_org, v_g2, 'cgm', 6.0, 31);
  perform pg_temp.res('real', 'a reading 29 minutes old is fresh, 31 minutes old is not', '1|0',
    (select count(*)::text from public.domain_events where idempotency_key = 'glu:' || a) || '|' ||
    (select count(*)::text from public.domain_events where idempotency_key = 'glu:' || b));
  a := (select (e.payload ->> 'observation_id')::uuid from public.domain_events e where e.patient_id = v_g and e.idempotency_key like 'glu:%' order by e.created_at limit 1);
  perform pg_temp.res('real', 'the event is marked is_test for a test patient and carries a delivery for the triage subscriber', 'true|1',
    (select e.is_test::text || '|' || (select count(*) from public.domain_event_deliveries d where d.event_id = e.id and d.subscriber_key = 'triage.grade_observation')::text
       from public.domain_events e where e.idempotency_key = 'glu:' || a));

  -- Manual and device still go through their own row trigger, exactly once -----------------------------------------------------
  d := pg_temp.ins_glu(v_org, v_g, 'manual', 5.5, 3);
  e := pg_temp.ins_glu(v_org, v_g, 'device', 5.6, 4);
  perform pg_temp.res('real', 'a manual and a device reading each emit exactly one event (no double emit)', '1|1',
    (select count(*)::text from public.domain_events where idempotency_key = 'glu:' || d) || '|' || (select count(*)::text from public.domain_events where idempotency_key = 'glu:' || e));

  -- Bulk: one statement, many readings, two patients -------------------------------------------------------------------------
  with ins as (
    insert into public.vitals_readings (organisation_id, patient_id, vital_type, glucose_mmol_l, glucose_context, source, taken_at)
    select v_org, p, 'glucose', 6.5, 'random', 'cgm'::public.vital_source, now() - make_interval(mins => m)
      from (values (v_g), (v_g2)) pt(p), generate_series(0, 20, 5) m
    returning id, patient_id, taken_at
  )
  select (select id from ins where patient_id = v_g order by taken_at desc limit 1),
         (select count(*) from ins) into v_last, v_n;
  perform pg_temp.res('real', 'the bulk statement inserted 10 readings (5 per patient)', '10', v_n::text);
  perform pg_temp.res('real', 'a bulk statement grades only the latest reading of each patient (one event each)', '1|1',
    (select count(*)::text from public.domain_events e where e.patient_id = v_g and e.idempotency_key = 'glu:' || v_last) || '|' ||
    (select count(*)::text from public.domain_events e join public.vitals_readings r on 'glu:' || r.id = e.idempotency_key where e.patient_id = v_g2 and r.taken_at > now() - interval '3 minutes'));
  perform pg_temp.res('real', 'and none of that batch''s older readings has an event (patient 1: 4 older readings, 0 events)', '0',
    (select count(*)::text from public.vitals_readings r where r.patient_id = v_g and r.source = 'cgm' and r.taken_at < now() - interval '3 minutes' and r.taken_at > now() - interval '25 minutes'
       and exists (select 1 from public.domain_events e where e.idempotency_key = 'glu:' || r.id)));
  -- a bulk sync whose latest reading is stale grades nothing
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, glucose_mmol_l, glucose_context, source, taken_at)
    select v_org, v_pat, 'glucose', 2.5, 'random', 'cgm'::public.vital_source, now() - make_interval(mins => 120 + m) from generate_series(0, 20, 5) m;
  perform pg_temp.res('real', 'a bulk sync of old readings (a stale low) emits no event at all', '0', pg_temp.glu_events(v_pat)::text);
  -- another vital type in the same statement is untouched
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, source, taken_at)
    values (v_org, v_pat, 'blood_pressure', 120, 78, 'device', now());
  perform pg_temp.res('real', 'a blood pressure reading emits no glucose event', '0', pg_temp.glu_events(v_pat)::text);

  -- Dedupe in the writer ------------------------------------------------------------------------------------------------------
  c := pg_temp.ins_glu(v_org, v_pat, 'cgm', 2.8, 1);
  v_out := public.record_glucose_triage_result(c, pg_temp.graded('GL-R1', 'red'), v_rs);
  perform pg_temp.res('real', 'the first cgm result of a level is stored (shadow, the rule set is a draft)', 'true|true', (v_out ->> 'created') || '|' || (v_out ->> 'shadow'));
  perform pg_temp.setf('first_event', (v_out ->> 'triage_event_id')::uuid);
  a := pg_temp.ins_glu(v_org, v_pat, 'cgm', 2.7, 0);
  v_out := public.record_glucose_triage_result(a, pg_temp.graded('GL-R1', 'red'), v_rs);
  perform pg_temp.res('real', 'the same level for the same patient inside 60 minutes stores nothing (deduped)', 'false|true', (v_out ->> 'created') || '|' || coalesce(v_out ->> 'deduped', 'null'));
  v_out := public.record_glucose_triage_result(a, pg_temp.graded('GL-R6', 'red'), v_rs, null, 'other');
  perform pg_temp.res('real', 'a different rule of the same grade is a different level and is stored', 'true', v_out ->> 'created');
  v_out := public.record_glucose_triage_result(a, pg_temp.graded('GL-A1', 'amber'), v_rs, null, 'amber');
  perform pg_temp.res('real', 'a different grade is stored', 'true', v_out ->> 'created');
  b := pg_temp.ins_glu(v_org, v_pat, 'manual', 2.6, 0);
  v_out := public.record_glucose_triage_result(b, pg_temp.graded('GL-R1', 'red'), v_rs);
  perform pg_temp.res('real', 'a manual reading of the same level is NEVER deduped', 'true', v_out ->> 'created');
  v_out := public.record_glucose_triage_result(c, pg_temp.graded('GL-R1', 'red'), v_rs);
  perform pg_temp.res('real', 'a redelivery of the very first reading stores nothing new', 'false', v_out ->> 'created');
  -- triage_events is append only; age the rows with triggers off, as a fixture (rolled back)
  set local session_replication_role = replica;
  update public.triage_events set created_at = now() - interval '2 hours' where patient_id = v_pat;
  set local session_replication_role = origin;
  d := pg_temp.ins_glu(v_org, v_pat, 'cgm', 2.4, 0);
  v_out := public.record_glucose_triage_result(d, pg_temp.graded('GL-R1', 'red'), v_rs);
  perform pg_temp.res('real', 'once the earlier result is older than 60 minutes the level is graded again', 'true', v_out ->> 'created');
  -- config off: no dedupe, no producer
  update public.triage_glucose_monitor_config set rules = jsonb_set(rules, '{enabled}', 'false') where is_active;
  e := pg_temp.ins_glu(v_org, v_pat, 'cgm', 2.3, 0);
  perform pg_temp.res('real', 'with the config off a fresh cgm reading emits no event', '0', (select count(*)::text from public.domain_events where idempotency_key = 'glu:' || e));
  v_out := public.record_glucose_triage_result(e, pg_temp.graded('GL-R1', 'red'), v_rs);
  perform pg_temp.res('real', 'with the config off the writer does not dedupe', 'true', v_out ->> 'created');
  update public.triage_glucose_monitor_config set rules = jsonb_set(rules, '{enabled}', 'true') where is_active;
  perform pg_temp.res('real', 'no page and no task came from any of it (every result is shadow)', '0|0',
    (select count(*)::text from public.triage_events where patient_id = v_pat and not shadow) || '|' ||
    (select count(*)::text from public.clinical_tasks where patient_id = v_pat));
  perform pg_temp.res('real', 'the sweep, the symptom regrade and the ketone regrade still ignore monitor readings (a swept reading would be stale)', '0',
    (select count(*)::text from public.domain_events where patient_id = v_g and idempotency_key like 'glu:%:sym:%'));

  -- Grants ------------------------------------------------------------------------------------------------------------------------
  perform pg_temp.res('real', 'the producer, the config reader and the writer are not callable by a client; the config table is not readable by anon', 'false|false|false|false',
    has_function_privilege('anon', 'private.emit_glucose_monitor_observations()', 'EXECUTE')::text || '|' ||
    has_function_privilege('authenticated', 'private.glucose_monitor_config()', 'EXECUTE')::text || '|' ||
    has_function_privilege('authenticated', 'public.record_glucose_triage_result(uuid, jsonb, uuid, uuid, text)', 'EXECUTE')::text || '|' ||
    has_table_privilege('anon', 'public.triage_glucose_monitor_config', 'SELECT')::text);
  perform pg_temp.res('real', 'a patient cannot read the config table (admin read policy)', '0', pg_temp.q_as(v_pat, 'select count(*)::text from public.triage_glucose_monitor_config'));

  -- OQ-355 ------------------------------------------------------------------------------------------------------------------------
  perform pg_temp.res('real', 'bp_care_triage v7 exists as an unsigned draft', 'draft|true',
    (select status || '|' || (approved_by is null and approved_at is null)::text from public.triage_rule_sets where code = 'bp_care_triage' and version = 7));
  perform pg_temp.res('real', 'v7 has exactly three more rules than v6, and they are the three on the symptom trigger', '3|BP-S1,BP-S2,BP-S3',
    (select (jsonb_array_length(n.rules -> 'rules') - jsonb_array_length(o.rules -> 'rules'))::text || '|' ||
            (select string_agg(r ->> 'id', ',' order by r ->> 'id') from jsonb_array_elements(n.rules -> 'rules') r where r -> 'triggers' ? 'symptom')
       from public.triage_rule_sets n, public.triage_rule_sets o where n.code = 'bp_care_triage' and n.version = 7 and o.code = 'bp_care_triage' and o.version = 6));
  perform pg_temp.res('real', 'v6 is untouched (a rule set is never edited) and exactly one bp_care_triage version is approved', 'draft|1',
    (select status from public.triage_rule_sets where code = 'bp_care_triage' and version = 6) || '|' || (select count(*)::text from public.triage_rule_sets where code = 'bp_care_triage' and status = 'approved'));

  -- OQ-326 ------------------------------------------------------------------------------------------------------------------------
  perform pg_temp.res('real', 'the fast-sugar wording guard exists and is off', 'true',
    (select (not is_on)::text from public.go_live_guards where key = 'glucose_fast_sugar_wording'));
  perform pg_temp.res('real', 'its wording attestation is unmet before anyone signs', 'false',
    (select (cond ->> 'met') from jsonb_array_elements(private.go_live_conditions('glucose_fast_sugar_wording', null)) cond where cond ->> 'code' = 'fast_sugar_wording_signed'));
  perform pg_temp.res('real', 'a patient cannot record the signature', 'ERR:42501',
    pg_temp.q_as(v_pat, $q$select public.attest_go_live_condition('glucose_fast_sugar_wording', 'fast_sugar_wording_signed', true, 'a patient tries to sign it')::text$q$));
  perform pg_temp.res('real', 'the Chief Medical Officer can record it', '{"ok": true}',
    pg_temp.q_as(v_cmo, $q$select public.attest_go_live_condition('glucose_fast_sugar_wording', 'fast_sugar_wording_signed', true, 'read both messages and the quantities')::text$q$));
  perform pg_temp.res('real', 'and then the condition is met', 'true',
    (select (cond ->> 'met') from jsonb_array_elements(private.go_live_conditions('glucose_fast_sugar_wording', null)) cond where cond ->> 'code' = 'fast_sugar_wording_signed'));
  perform pg_temp.res('real', 'signing the wording does not sign the glucose rules', 'draft', (select status from public.triage_rule_sets where id = v_rs));
  perform pg_temp.res('real', 'an existing attestation still works (the list was patched in place, not replaced)', '{"ok": true}',
    pg_temp.q_as(v_cmo, $q$select public.attest_go_live_condition('home_bp_programme', 'c4_cuff_wording_signed', false, 'unchanged behaviour of the older guard')::text$q$));
  perform pg_temp.res('real', 'an older guard still lists its own conditions', 'true',
    (jsonb_array_length(private.go_live_conditions('home_bp_programme', null)) >= 3)::text);
  perform pg_temp.res('real', 'the new guard is switched by the CMO and the guard is still off', 'cmo|true',
    (select switch_role || '|' || (not is_on)::text from public.go_live_guards where key = 'glucose_fast_sugar_wording'));
  perform pg_temp.res('real', 'the condition-list function is not callable by anon', 'false', has_function_privilege('anon', 'private.fast_sugar_go_live_conditions(text)', 'EXECUTE')::text);

  perform pg_temp.setf('org', v_org); perform pg_temp.setf('cmo', v_cmo);
end $$;

-- OQ-354 and OQ-356 ------------------------------------------------------------------------------------------------------------
do $$
declare
  v_org uuid := pg_temp.f('org'); m_off uuid; m_bp uuid; m_nobp uuid; f_free uuid; v_ctx jsonb; v_week text := to_char(now() at time zone 'Africa/Lagos', 'IYYY-"W"IW');
begin
  perform pg_temp.res('real', 'fixture: an approved bp_care_triage with rule BP-A4 exists', 'true',
    (exists (select 1 from public.triage_rule_sets rs where rs.code = 'bp_care_triage' and rs.status = 'approved'
              and exists (select 1 from jsonb_array_elements(rs.rules -> 'rules') r where r ->> 'id' = 'BP-A4')))::text);

  -- sweep OFF (the config is born off): the alert stays for a Member with a blood pressure interest
  update public.triage_coverage_config set rules = jsonb_set(rules, '{enabled}', 'false') where is_active;
  m_off := pg_temp.mkadh(v_org, 'm-off', true, true);
  perform private.emit_adherence_signals();
  perform pg_temp.res('real', 'sweep off: the Member with a BP interest still gets the older adherence alert', '1', pg_temp.alert_count(m_off)::text);

  -- sweep ON and BP-A4 approved
  update public.triage_coverage_config set rules = jsonb_set(rules, '{enabled}', 'true') where is_active;
  m_bp := pg_temp.mkadh(v_org, 'm-bp', true, true);
  m_nobp := pg_temp.mkadh(v_org, 'm-nobp', true, false);
  f_free := pg_temp.mkadh(v_org, 'f-free', false, true);
  perform pg_temp.setf('m_bp', m_bp); perform pg_temp.setf('m_nobp', m_nobp); perform pg_temp.setf('f_free', f_free);
  perform pg_temp.res('real', 'the cover helper: true for a Member with a BP interest, false for the other two', 'true|false|false',
    private.bp_a4_covers_adherence(m_bp)::text || '|' || private.bp_a4_covers_adherence(m_nobp)::text || '|' || private.bp_a4_covers_adherence(f_free)::text);
  perform private.emit_adherence_signals();
  perform pg_temp.res('real', 'sweep on: the BP-A4 task replaces the alert for a Member with a BP interest (no alert)', '0', pg_temp.alert_count(m_bp)::text);
  perform pg_temp.res('real', 'sweep on: a Member with no BP interest keeps the alert', '1', pg_temp.alert_count(m_nobp)::text);
  perform pg_temp.res('real', 'sweep on: a Free patient keeps the alert', '1', pg_temp.alert_count(f_free)::text);
  perform private.sweep_triage_coverage();
  perform pg_temp.res('real', 'and that event exists for the Member with a BP interest', '1',
    (select count(*)::text from public.domain_events where event_type = 'adherence.below_line' and patient_id = m_bp));

  -- OQ-356 context field
  v_ctx := public.triage_context_for_coverage(m_bp, 'adherence', (now() at time zone 'Africa/Lagos')::date);
  perform pg_temp.res('real', 'the coverage context sends percentWindow and not percent7d', 'true|false',
    ((v_ctx #>> '{input,trigger,percentWindow}') is not null)::text || '|' || ((v_ctx #>> '{input,trigger,percent7d}') is not null)::text);
  perform pg_temp.res('real', 'the window is the configured one (medicine_config.adherence_window_days)', 'true',
    ((private.weekly_adherence(m_bp) ->> 'window_end')::date - (private.weekly_adherence(m_bp) ->> 'window_start')::date + 1 = (select adherence_window_days from public.medicine_config where is_active))::text);
end $$;

-- Sabotage ----------------------------------------------------------------------------------------------------------------------
do $$
declare
  v_org uuid := pg_temp.f('org'); v_p uuid; v_cmo uuid := pg_temp.f('cmo'); s_bp uuid; g uuid; r uuid;
begin
  -- (a) the monitor producer dropped
  drop trigger vitals_readings_emit_glucose_monitor_observations on public.vitals_readings;
  v_p := pg_temp.mkuser(v_org, 'sab-glu', 'patient');
  g := pg_temp.ins_glu(v_org, v_p, 'cgm', 6.0, 1);
  perform pg_temp.res('sabotaged', 'a fresh cgm reading emits one observation.recorded', '1', (select count(*)::text from public.domain_events where idempotency_key = 'glu:' || g));

  -- (b) the BP-A4 cover forced false: the replaced alert comes back
  create or replace function private.bp_a4_covers_adherence(p_patient uuid, p_now timestamptz default now()) returns boolean language sql stable security definer set search_path = '' as $f$ select false $f$;
  s_bp := pg_temp.mkadh(v_org, 'sab-bp', true, true);
  perform private.emit_adherence_signals();
  perform pg_temp.res('sabotaged', 'sweep on: the BP-A4 task replaces the alert for a Member with a BP interest (no alert)', '0', pg_temp.alert_count(s_bp)::text);

  -- (c) the wording condition forced met
  create or replace function private.fast_sugar_go_live_conditions(p_key text) returns jsonb language sql stable security definer set search_path = '' as
    $f$ select jsonb_build_array(jsonb_build_object('code', 'fast_sugar_wording_signed', 'label', 'x', 'met', true, 'source', 'attestation')) $f$;
  perform pg_temp.res('sabotaged', 'its wording attestation is unmet before anyone signs', 'false',
    (select (cond ->> 'met') from jsonb_array_elements(private.go_live_conditions('glucose_fast_sugar_wording', null)) cond where cond ->> 'code' = 'fast_sugar_wording_signed'));
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'FU engine follow-ups proof FAILED: %', (select string_agg(check_name || ' => expected [' || expected || '] got [' || coalesce(actual, 'null') || ']', '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected is distinct from actual;
  if v_caught < 3 then raise exception 'VACUOUS TEST: only % of 3 sabotage steps changed a result', v_caught; end if;
end $$;

select phase, check_name, expected, actual,
       case when phase = 'sabotaged' then case when expected is distinct from actual then 'PASS (caught)' else 'FAIL' end
            when expected = actual then 'PASS' else 'FAIL' end as result
  from results order by phase desc, check_name;
rollback;
