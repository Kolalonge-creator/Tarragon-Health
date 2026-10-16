-- Proof: a wearable (cuffless) blood pressure estimate is never a diagnostic number
-- (migration *_bp_cuffless_estimates_never_diagnostic.sql; design docs/design/BP-wearable-estimates.md).
--
-- Proves in one rolled-back transaction:
--   1. Shape: the module is OFF, the rule is true for 'wearable' only, the diagnostic view is not readable by a client role.
--   2. The diagnostic view drops a wearable BP row and nothing else: a wearable pulse and weight, a manual, device, photo and fhir_import BP row all stay,
--      and the display view (vitals_readings_current) still shows the wearable BP (it stays visible).
--   3. Every listed diagnostic reader reads the diagnostic view, not the display view.
--   4. The governed triage engine never sees an estimate (no observation.recorded event), and always sees a cuff reading.
--   5. Module OFF: a wearable red reading alerts exactly as a manual one does (audit bp_red_flag.raised), nothing is patient-only.
--   6. Module ON: a wearable red reading gives the patient the recheck notice, raises NO bp_red_flag.raised, no clinician alert; a manual red reading is unchanged;
--      a wearable estimate with an emergency symptom still opens the BP handler's own emergency record (source bp_reading, linked to the reading);
--      a PREGNANT person's estimate keeps paging (the obstetric red route); an estimate does not close the open "missing readings" alert, a cuff reading does.
--   7. SABOTAGE: the rule forced to false, the view filter dropped, the patient-only branch widened to the emergency level, the pregnancy guard removed, the
--      missing-readings guard removed. Each matching check must flip.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create function pg_temp.rec(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('real', p_name, p_expected, p_actual) $$;
create function pg_temp.try(p_sql text) returns text language plpgsql as
$f$ begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $f$;
create function pg_temp.act(p_uid uuid) returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
end $f$;
create function pg_temp.back() returns void language plpgsql as
$f$ begin
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.role', '', true);
end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'bpest-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test, language)
  values (v, p_org, p_role::public.user_role, 'BPEST ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true, 'en')
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone, date_of_birth = excluded.date_of_birth, full_name = excluded.full_name;
  return v;
end $f$;
create function pg_temp.vit(p_patient uuid, p_org uuid, p_type text, p_source text, p_mins_ago numeric, p_sys int default null, p_dia int default null,
                            p_wt numeric default null, p_pulse int default null) returns uuid
language plpgsql as $f$
declare v uuid;
begin
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, source, taken_at, systolic, diastolic, weight_kg, pulse_bpm)
  values (p_org, p_patient, p_type::public.vital_type, p_source::public.vital_source, now() - make_interval(secs => (p_mins_ago * 60)::double precision), p_sys, p_dia, p_wt, p_pulse)
  returning id into v;
  return v;
end $f$;
-- a Member's red event reaches a doctor (patient_has_feature_access('vitals_red_flag_doctor_escalation')); the same fixture the S11g proof uses
create function pg_temp.member(p_org uuid, p_patient uuid) returns void language plpgsql as $f$
declare v_product uuid; v_price bigint;
begin
  select id, price_kobo into v_product, v_price from public.service_products where 'vitals_red_flag_doctor_escalation' = any(features) order by code limit 1;
  insert into public.service_purchases (organisation_id, patient_id, purchaser_profile_id, service_product_id, status, amount_kobo, currency, purchased_at, expires_at)
    values (p_org, p_patient, p_patient, v_product, 'active', v_price, 'NGN', now(), now() + interval '84 days');
end $f$;
create function pg_temp.n_audit(p_patient uuid, p_action text) returns text language sql as
$$ select count(*)::text from public.audit_log where actor_id = p_patient and action = p_action $$;
create function pg_temp.n_obs(p_patient uuid) returns text language sql as
$$ select count(*)::text from public.domain_events where event_type = 'observation.recorded' and patient_id = p_patient $$;
create function pg_temp.module(p_key text, p_on boolean, p_by uuid) returns void language sql as
$$ update public.platform_modules set is_enabled = p_on, enabled_at = case when p_on then now() end, enabled_by = case when p_on then p_by end where key = p_key $$;

-- The checks that the sabotage steps are meant to flip, written once and run twice (real, then sabotaged).
create function pg_temp.core_checks(p_phase text, p_org uuid, p_admin uuid) returns void language plpgsql as
$f$
declare
  v_a uuid; v_b uuid; v_c uuid; v_d uuid; v_e uuid; v_f uuid; v_g uuid; v_n_cur integer; v_n_dia integer;
begin
  v_a := pg_temp.mkuser(p_org, p_phase || '-a', 'patient');   -- view + triage
  v_b := pg_temp.mkuser(p_org, p_phase || '-b', 'patient');   -- module off
  v_c := pg_temp.mkuser(p_org, p_phase || '-c', 'patient');   -- module on, wearable
  v_d := pg_temp.mkuser(p_org, p_phase || '-d', 'patient');   -- module on, manual control
  v_e := pg_temp.mkuser(p_org, p_phase || '-e', 'patient');   -- module on, wearable with an emergency symptom
  v_f := pg_temp.mkuser(p_org, p_phase || '-f', 'patient');   -- module on, wearable, pregnant
  v_g := pg_temp.mkuser(p_org, p_phase || '-g', 'patient');   -- the open "missing readings" alert
  perform pg_temp.member(p_org, v_b); perform pg_temp.member(p_org, v_c); perform pg_temp.member(p_org, v_d); perform pg_temp.member(p_org, v_e); perform pg_temp.member(p_org, v_f);

  -- 2/4. the view and the triage emitter
  perform pg_temp.vit(v_a, p_org, 'blood_pressure', 'wearable', 50, 150, 95);
  perform pg_temp.vit(v_a, p_org, 'pulse', 'wearable', 49, null, null, null, 72);
  perform pg_temp.vit(v_a, p_org, 'weight', 'wearable', 48, null, null, 70.5);
  perform pg_temp.vit(v_a, p_org, 'blood_pressure', 'manual', 40, 128, 82);
  perform pg_temp.vit(v_a, p_org, 'blood_pressure', 'device', 30, 131, 83);
  perform pg_temp.vit(v_a, p_org, 'blood_pressure', 'photo_confirmed', 20, 126, 80);
  perform pg_temp.vit(v_a, p_org, 'blood_pressure', 'fhir_import', 10, 133, 85);
  select count(*) into v_n_cur from private.vitals_readings_current where patient_id = v_a;
  select count(*) into v_n_dia from private.vitals_readings_diagnostic where patient_id = v_a;
  insert into results values (p_phase, 'display view still holds all 7 rows', '7', v_n_cur::text);
  insert into results values (p_phase, 'diagnostic view drops only the wearable BP row', '6', v_n_dia::text);
  insert into results values (p_phase, 'diagnostic view keeps the wearable pulse and weight and every cuff source',
    '2/4', (select count(*) filter (where vital_type <> 'blood_pressure')::text || '/' || count(*) filter (where vital_type = 'blood_pressure')::text from private.vitals_readings_diagnostic where patient_id = v_a));
  insert into results values (p_phase, 'a wearable BP emits no observation.recorded; the four cuff-source readings emit one each', '4', pg_temp.n_obs(v_a));

  -- 5. module off: a wearable red reading alerts as a manual one does
  perform pg_temp.module('device_cuffless_bp_informational', false, p_admin);
  perform pg_temp.vit(v_b, p_org, 'blood_pressure', 'wearable', 5, 166, 104);
  insert into results values (p_phase, 'module off: a wearable red estimate is handled as today (raised)', '1/0', pg_temp.n_audit(v_b, 'bp_red_flag.raised') || '/' || pg_temp.n_audit(v_b, 'bp_red_flag.estimate_patient_only'));

  -- 6. module on
  perform pg_temp.module('device_cuffless_bp_informational', true, p_admin);
  perform pg_temp.vit(v_c, p_org, 'blood_pressure', 'wearable', 5, 166, 104);
  insert into results values (p_phase, 'module on: a wearable red estimate is patient-only (no raise, one patient-only record)', '0/1', pg_temp.n_audit(v_c, 'bp_red_flag.raised') || '/' || pg_temp.n_audit(v_c, 'bp_red_flag.estimate_patient_only'));
  insert into results values (p_phase, 'module on: the person still gets the recheck notice', '1',
    (select count(*)::text from public.notifications where recipient_id = v_c and template = 'free_tier_reading_self_care_suggestion'));
  insert into results values (p_phase, 'module on: a Member gets no clinician alert for the estimate', '0', (select count(*)::text from public.clinician_alerts where patient_id = v_c));
  perform pg_temp.vit(v_d, p_org, 'blood_pressure', 'manual', 5, 166, 104);
  insert into results values (p_phase, 'module on: a manual red reading is untouched (raised)', '1/0', pg_temp.n_audit(v_d, 'bp_red_flag.raised') || '/' || pg_temp.n_audit(v_d, 'bp_red_flag.estimate_patient_only'));
  insert into results values (p_phase, 'module on: a Member''s manual red reading still opens the Priority 1 alert', '1', (select count(*)::text from public.clinician_alerts where patient_id = v_d and level = 'urgent_escalation'));
  insert into public.symptoms (organisation_id, patient_id, symptom_type, severity) values (p_org, v_e, 'chest_pain', 8);
  perform pg_temp.vit(v_e, p_org, 'blood_pressure', 'wearable', 1, 230, 130);
  insert into results values (p_phase, 'module on: a wearable estimate with chest pain still opens the BP handler''s own emergency record', 'true',
    (exists (select 1 from public.emergency_events where patient_id = v_e and source = 'bp_reading' and vital_reading_id is not null))::text);
  update public.profiles set is_pregnant = true where id = v_f;
  perform pg_temp.vit(v_f, p_org, 'blood_pressure', 'wearable', 1, 150, 95);
  insert into results values (p_phase, 'module on: a pregnant person''s wearable estimate keeps paging (raised, not patient-only)', '1/0', pg_temp.n_audit(v_f, 'bp_red_flag.raised') || '/' || pg_temp.n_audit(v_f, 'bp_red_flag.estimate_patient_only'));

  -- an estimate is not a reading for the gap detector, so it must not close the open "missing readings" alert; a cuff reading does
  insert into public.clinician_alerts (organisation_id, patient_id, level, status, title, detail, sla_due_at, escalation_level)
    values (p_org, v_g, 'clinician_review', 'open', 'Missing expected blood-pressure readings', 'proof', now() + interval '1 day', 2);
  perform pg_temp.vit(v_g, p_org, 'blood_pressure', 'wearable', 3, 120, 80);
  insert into results values (p_phase, 'a wearable estimate does not close the missing-readings alert', '1',
    (select count(*)::text from public.clinician_alerts where patient_id = v_g and status = 'open' and title = 'Missing expected blood-pressure readings'));
  perform pg_temp.vit(v_g, p_org, 'blood_pressure', 'manual', 2, 120, 80);
  insert into results values (p_phase, 'a cuff reading does close it', '0',
    (select count(*)::text from public.clinician_alerts where patient_id = v_g and status = 'open' and title = 'Missing expected blood-pressure readings'));
end $f$;

do $$
declare
  v_org uuid; v_admin uuid; v_n integer; v_f text; v_def text;
  v_readers text[] := array['bp_window_stats', 'hbpm_average', 'home_bp_assess', 'outcome_compute_snapshot', 'risk_compute', 'patient_monitoring_core',
    'triage_context_for_observation', 'triage_context_for_coverage', 'triage_coverage_candidates', 'triage_reading_snapshot', 'triage_divergence_rows',
    'sweep_triage_rechecks', 'emit_symptom_regrade', 'hqm_latest_bp_rows', 'analytics_clinical_outcomes', 'analytics_programme_funnel', 'compute_board_measure',
    'generate_clinical_summary_draft', 'consultation_prep_bundle', 'evaluate_vitals_monitoring_gaps', 'flag_overdue_vitals', 'queue_vitals_reminders',
    'patient_vitals_adherence', 'generate_monthly_reports'];
begin
  select organisation_id into v_org from public.profiles where organisation_id is not null group by organisation_id order by count(*) desc limit 1;
  if v_org is null then raise exception 'need an organisation to run this proof'; end if;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');

  -- 1. Shape
  perform pg_temp.rec('the module exists and is off', 'false', (select is_enabled::text from public.platform_modules where key = 'device_cuffless_bp_informational'));
  perform pg_temp.rec('the rule: wearable is an estimate', 'true', private.bp_reading_is_estimate('wearable')::text);
  perform pg_temp.rec('the rule: a missing source is not an estimate (a cuff reading is never hidden)', 'false', private.bp_reading_is_estimate(null)::text);
  perform pg_temp.rec('the rule: manual, device, photo_confirmed, fhir_import, cgm are not', 'false/false/false/false/false',
    private.bp_reading_is_estimate('manual')::text || '/' || private.bp_reading_is_estimate('device')::text || '/' || private.bp_reading_is_estimate('photo_confirmed')::text || '/' || private.bp_reading_is_estimate('fhir_import')::text || '/' || private.bp_reading_is_estimate('cgm')::text);
  -- the view is `select c.*`, which freezes its columns at creation: if the display view ever gains a column, a reader of the diagnostic view must not silently lose it
  perform pg_temp.rec('the diagnostic view has exactly the columns of the display view, in order', 'true',
    ((select array_agg(attname::text order by attnum) from pg_attribute where attrelid = 'private.vitals_readings_diagnostic'::regclass and attnum > 0 and not attisdropped)
     = (select array_agg(attname::text order by attnum) from pg_attribute where attrelid = 'private.vitals_readings_current'::regclass and attnum > 0 and not attisdropped))::text);
  perform pg_temp.act(v_admin);
  perform pg_temp.rec('a signed-in client cannot read the diagnostic view', '42501', pg_temp.try('select * from private.vitals_readings_diagnostic'));
  perform pg_temp.back();

  -- 3. Wiring: every listed reader reads the diagnostic view
  for v_f in select unnest(v_readers) loop
    select count(*) into v_n from pg_proc p where p.proname = v_f and p.pronamespace in ('public'::regnamespace, 'private'::regnamespace)
      and p.prosrc like '%private.vitals_readings_diagnostic%' and p.prosrc not like '%private.vitals_readings_current%';
    perform pg_temp.rec('reader ' || v_f || ' reads the diagnostic view', 'true', (v_n >= 1)::text);
  end loop;
  perform pg_temp.rec('the pathway baseline takes its blood pressure from the diagnostic view', 'true',
    (select bool_and(prosrc like '%taken_at) from private.vitals_readings_diagnostic%') from pg_proc where proname = 'capture_pathway_baseline')::text);
  perform pg_temp.rec('the health report takes its blood pressure from the diagnostic view', 'true',
    (select bool_and(prosrc like '%into v_bp from private.vitals_readings_diagnostic%' and prosrc like '%into v_prior from private.vitals_readings_diagnostic%') from pg_proc where proname = 'health_report_collect')::text);
  -- display readers are deliberately untouched
  perform pg_temp.rec('the audited record read still reads everything', 'true',
    (select bool_and(prosrc like '%vitals_readings_current%' and prosrc not like '%vitals_readings_diagnostic%') from pg_proc where proname = 'read_patient_vitals_audited' and pronamespace = 'public'::regnamespace)::text);

  -- 2, 4, 5, 6: behaviour, real
  perform pg_temp.core_checks('real', v_org, v_admin);
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- SABOTAGE: each step must flip the matching checks
-- ---------------------------------------------------------------------------------------------------------------------------------
-- (1) the rule forced to false: the estimate is no longer an estimate anywhere
create or replace function private.bp_reading_is_estimate(p_source text) returns boolean language sql immutable set search_path = '' as $$ select false $$;
do $$ declare v_org uuid; v_admin uuid; begin
  select organisation_id into v_org from public.profiles where organisation_id is not null group by organisation_id order by count(*) desc limit 1;
  select id into v_admin from public.profiles where full_name = 'BPEST admin' limit 1;
  perform pg_temp.core_checks('sab_rule', v_org, v_admin);
end $$;
create or replace function private.bp_reading_is_estimate(p_source text) returns boolean language sql immutable set search_path = '' as $$ select coalesce(p_source = 'wearable', false) $$;

-- (2) the view filter dropped
create or replace view private.vitals_readings_diagnostic with (security_invoker = false) as select c.* from private.vitals_readings_current c;
do $$ declare v_org uuid; v_admin uuid; begin
  select organisation_id into v_org from public.profiles where organisation_id is not null group by organisation_id order by count(*) desc limit 1;
  select id into v_admin from public.profiles where full_name = 'BPEST admin' limit 1;
  perform pg_temp.core_checks('sab_view', v_org, v_admin);
end $$;
create or replace view private.vitals_readings_diagnostic with (security_invoker = false) as
  select c.* from private.vitals_readings_current c where not (c.vital_type = 'blood_pressure'::public.vital_type and private.bp_reading_is_estimate(c.source::text));

-- (3) to (5) the handler changed three ways, one at a time, each from the real definition
create temp table real_handler as select pg_get_functiondef('private.handle_bp_reading_red_flag()'::regprocedure) as def;
create function pg_temp.sab_handler(p_from text, p_to text) returns void language plpgsql as
$f$ declare v_def text; v_new text;
begin
  select def into v_def from real_handler;
  v_new := replace(v_def, p_from, p_to);
  if v_new = v_def then raise exception 'sabotage changed nothing: %', p_from; end if;
  execute v_new;
end $f$;
create function pg_temp.restore_handler() returns void language plpgsql as
$f$ declare v_def text; begin select def into v_def from real_handler; execute v_def; end $f$;

-- (3) the patient-only branch widened to the emergency level: the BP handler's own emergency record is swallowed
select pg_temp.sab_handler('v_level in (''red'', ''amber'') and private.module_enabled', 'v_level in (''red'', ''amber'', ''emergency'') and private.module_enabled');
do $$ declare v_org uuid; v_admin uuid; begin
  select organisation_id into v_org from public.profiles where organisation_id is not null group by organisation_id order by count(*) desc limit 1;
  select id into v_admin from public.profiles where full_name = 'BPEST admin' limit 1;
  perform pg_temp.core_checks('sab_emergency', v_org, v_admin);
end $$;
select pg_temp.restore_handler();

-- (4) the pregnancy and postpartum guard removed
select pg_temp.sab_handler('and not coalesce(v_pregnant, false) and not private.bp_is_postpartum(new.patient_id, new.created_at, v_params) then', 'then');
do $$ declare v_org uuid; v_admin uuid; begin
  select organisation_id into v_org from public.profiles where organisation_id is not null group by organisation_id order by count(*) desc limit 1;
  select id into v_admin from public.profiles where full_name = 'BPEST admin' limit 1;
  perform pg_temp.core_checks('sab_pregnant', v_org, v_admin);
end $$;
select pg_temp.restore_handler();

-- (5) the missing-readings guard removed
select pg_temp.sab_handler('and not private.bp_reading_is_estimate(new.source::text);', ';');
do $$ declare v_org uuid; v_admin uuid; begin
  select organisation_id into v_org from public.profiles where organisation_id is not null group by organisation_id order by count(*) desc limit 1;
  select id into v_admin from public.profiles where full_name = 'BPEST admin' limit 1;
  perform pg_temp.core_checks('sab_missing', v_org, v_admin);
end $$;
select pg_temp.restore_handler();

do $$
declare v_bad integer; v_flip integer; v_ph text; v_need integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'BP estimate proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  for v_ph, v_need in select * from (values ('sab_rule', 5), ('sab_view', 2), ('sab_emergency', 1), ('sab_pregnant', 1), ('sab_missing', 1)) as t(ph, need) loop
    select count(*) into v_flip from results where phase = v_ph and expected is distinct from actual;
    if v_flip < v_need then raise exception 'VACUOUS TEST: sabotage % flipped only % checks (need %)', v_ph, v_flip, v_need; end if;
  end loop;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;

rollback;
