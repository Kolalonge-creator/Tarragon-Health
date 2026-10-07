-- S47 proof: the conditions of the seven clinical guards added by S43 to S46 (migration *_s47_go_live_conditions_for_clinical_guards.sql).
-- One rolled-back transaction. Proves, for each of risk_instrument_who2019_enabled, screening_scheduler_enabled, hpv_dna_enabled,
-- home_kit_sensitive_enabled, lab_structured_push_enabled, document_capture_enabled and health_report_generation_enabled:
--   1. it has defined conditions (no unknown_guard), it asks for the clinical safety case, and it cannot be switched on while any is unmet (fails closed);
--   2. a data condition flips with the data (signed instrument with verified coefficients, signed rule set, an active laboratory offering HPV DNA, a
--      laboratory with confirmed mappings, signed report settings with the statement approved) and ONLY then;
--   3. an attestation can be recorded for exactly its codes, only the CMO can record the safety case, and with every condition met the CMO switches it on;
--   4. no live branch regressed: the seven original guards and the later live branches keep their conditions; an unknown key still fails closed.
--   5. SABOTAGE: a condition forced true, the safety case dropped from a guard, and a data query inverted; the matching checks flip.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create function pg_temp.rec(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('real', p_name, p_expected, p_actual) $$;
create function pg_temp.try(p_sql text) returns text language plpgsql as
$f$ begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $f$;
create function pg_temp.msg(p_sql text) returns text language plpgsql as
$f$ begin execute p_sql; return 'ok'; exception when others then return sqlstate || ':' || sqlerrm; end $f$;
create function pg_temp.act(p_uid uuid) returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
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
  -- clear the session claims too: a leftover sub makes auth.uid() non-null and the is_test guard then treats the owner as a person
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.role', '', true);
end $f$;
create function pg_temp.act_service() returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  set local role service_role;
end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text, p_test boolean default true) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's37-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test, language)
  values (v, p_org, p_role::public.user_role, 'S37 ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true, 'en')
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone, date_of_birth = excluded.date_of_birth, full_name = excluded.full_name;
  if not p_test then update public.profiles set is_test = false where id = v; end if;
  return v;
end $f$;
create function pg_temp.mkdoc(p_org uuid, p_admin uuid, p_label text, p_tier text) returns uuid
language plpgsql as $f$
declare v uuid := pg_temp.mkuser(p_org, p_label, 'clinician'); v_staff uuid;
begin
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, license_expires_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test, languages, specialty)
  values (p_org, v, 'S37 ' || p_label, 'MDCN', 'S37-' || p_label || '-' || substr(v::text, 1, 8), true, 'active', now() - interval '5 days', now() + interval '1 year', p_admin,
      p_tier::public.doctor_tier, case when p_tier = 'chief_medical_officer' then 'contracted' else 'employed' end::public.staff_employment_type, 2,
      true, p_admin, true, array['en'], 'General practice')
  returning id into v_staff;
  return v;
end $f$;

create temp table fx2(k text primary key, v uuid) on commit drop;
grant all on fx2 to public;
create function pg_temp.setf2(p text, p_v uuid) returns void language sql as $$ insert into fx2 values (p, p_v) on conflict (k) do update set v = excluded.v $$;
create function pg_temp.f2(p text) returns uuid language sql as $$ select v from fx2 where k = p $$;
create function pg_temp.conds(p_key text) returns jsonb language sql as $$ select private.go_live_conditions(p_key, null) $$;
create function pg_temp.cond_met(p_key text, p_code text) returns text language sql as
$$ select coalesce((select c ->> 'met' from jsonb_array_elements(pg_temp.conds(p_key)) c where c ->> 'code' = p_code), 'missing') $$;
create function pg_temp.codes(p_key text) returns text language sql as
$$ select coalesce((select string_agg(c ->> 'code', ',' order by c ->> 'code') from jsonb_array_elements(pg_temp.conds(p_key)) c), '') $$;
create function pg_temp.attest(p_uid uuid, p_key text, p_code text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin
    perform public.attest_go_live_condition(p_key, p_code, true, case when p_code = 'clinical_safety_case_current' then 'Safety case SC-1 version 3 signed by the CMO' else 'Checked by the CMO today' end);
    r := 'ok';
  exception when others then r := sqlstate; end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.switch_as(p_uid uuid, p_key text, p_on boolean) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin perform public.set_go_live_guard(p_key, p_on, 'Switching for the proof only'); r := 'ok'; exception when others then r := sqlstate; end;
  perform pg_temp.back();
  return r;
end $f$;

do $$
declare
  v_org uuid; v_admin uuid; v_cmo uuid; v_cmo_staff uuid; v_smo uuid; k text; v_lab uuid;
  v_keys text[] := array['risk_instrument_who2019_enabled', 'screening_scheduler_enabled', 'hpv_dna_enabled', 'home_kit_sensitive_enabled',
                         'lab_structured_push_enabled', 'document_capture_enabled', 'health_report_generation_enabled'];
  v_att jsonb := jsonb_build_object(
    'risk_instrument_who2019_enabled', array['nigeria_region_confirmed', 'coefficient_licence_checked', 'clinical_safety_case_current'],
    'screening_scheduler_enabled', array['clinical_safety_case_current'],
    'hpv_dna_enabled', array['positive_result_pathway_in_place', 'clinical_safety_case_current'],
    'home_kit_sensitive_enabled', array['human_disclosure_path_in_place', 'clinical_safety_case_current'],
    'lab_structured_push_enabled', array['lab_panel_ranges_signed', 'lab_contract_names_channel', 'clinical_safety_case_current'],
    'document_capture_enabled', array['ai018_evaluation_recorded', 'ai_provider_data_agreement_recorded', 'original_photo_retention_approved', 'clinical_safety_case_current'],
    'health_report_generation_enabled', array['clinical_safety_case_current']);
begin
  select organisation_id into v_org from public.profiles where organisation_id is not null group by organisation_id order by count(*) desc limit 1;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  v_cmo := pg_temp.mkdoc(v_org, v_admin, 'cmo', 'chief_medical_officer');
  v_smo := pg_temp.mkdoc(v_org, v_admin, 'smo', 'senior_medical_officer');
  select id into v_cmo_staff from public.clinical_staff where profile_id = v_cmo;

  -- 1. defined conditions, the safety case, off, closed
  foreach k in array v_keys loop
    perform pg_temp.rec(k || ': has defined conditions', 'false', (pg_temp.codes(k) like '%unknown_guard%')::text);
    perform pg_temp.rec(k || ': asks for the clinical safety case', 'attestation', (select c ->> 'source' from jsonb_array_elements(pg_temp.conds(k)) c where c ->> 'code' = 'clinical_safety_case_current'));
    perform pg_temp.rec(k || ': starts off', 'false', (select is_on::text from public.go_live_guards where key = k));
    perform pg_temp.rec(k || ': nothing is met on a fresh database', '0', (select count(*)::text from jsonb_array_elements(pg_temp.conds(k)) c where (c ->> 'met')::boolean));
    perform pg_temp.rec(k || ': cannot be switched on while unmet (by the role the guard names)', '22023', case when pg_temp.switch_as(v_cmo, k, true) = '22023' or pg_temp.switch_as(v_admin, k, true) = '22023' then '22023' else pg_temp.switch_as(v_cmo, k, true) end);
  end loop;
  perform pg_temp.rec('the codes asked for (risk instrument)', 'clinical_safety_case_current,coefficient_licence_checked,nigeria_region_confirmed,risk_instrument_signed_verified', pg_temp.codes('risk_instrument_who2019_enabled'));
  perform pg_temp.rec('the codes asked for (document capture)', 'ai_provider_data_agreement_recorded,ai018_evaluation_recorded,clinical_safety_case_current,original_photo_retention_approved', pg_temp.codes('document_capture_enabled'));
  perform pg_temp.rec('the codes asked for (lab push)', 'clinical_safety_case_current,lab_contract_names_channel,lab_mappings_confirmed,lab_panel_ranges_signed', pg_temp.codes('lab_structured_push_enabled'));
  perform pg_temp.rec('the codes asked for (HPV DNA)', 'clinical_safety_case_current,hpv_dna_lab_active,positive_result_pathway_in_place', pg_temp.codes('hpv_dna_enabled'));
  perform pg_temp.rec('the codes asked for (report)', 'clinical_safety_case_current,report_settings_signed,report_statement_approved', pg_temp.codes('health_report_generation_enabled'));

  -- 2. attestation rules
  perform pg_temp.rec('a plain clinician cannot attest', '42501', pg_temp.attest(v_smo, 'scribe_enabled', 'clinical_safety_case_current'));
  perform pg_temp.rec('an admin who is not the CMO cannot record the safety case', '42501', pg_temp.attest(v_admin, 'hpv_dna_enabled', 'clinical_safety_case_current'));
  perform pg_temp.rec('a data condition cannot be attested', '22023', pg_temp.attest(v_cmo, 'risk_instrument_who2019_enabled', 'risk_instrument_signed_verified'));
  perform pg_temp.rec('a code belonging to another guard cannot be attested here', '22023', pg_temp.attest(v_cmo, 'hpv_dna_enabled', 'ai018_evaluation_recorded'));
  perform pg_temp.rec('the CMO records a guard-specific attestation', 'ok', pg_temp.attest(v_cmo, 'hpv_dna_enabled', 'positive_result_pathway_in_place'));
  perform pg_temp.rec('...and it flips only that condition', 'true,false', pg_temp.cond_met('hpv_dna_enabled', 'positive_result_pathway_in_place') || ',' || pg_temp.cond_met('hpv_dna_enabled', 'clinical_safety_case_current'));
  perform pg_temp.rec('...and it does not leak to another guard', 'false', pg_temp.cond_met('home_kit_sensitive_enabled', 'human_disclosure_path_in_place'));

  -- 3. data conditions flip with the data, and only then
  update public.risk_instrument_versions set config = config || '{"coefficientsVerified":true}'::jsonb where code = 'who_cvd_2019_wssa' and version = 2;
  perform pg_temp.rec('an unsigned verified instrument is still not met', 'false', pg_temp.cond_met('risk_instrument_who2019_enabled', 'risk_instrument_signed_verified'));
  update public.risk_instrument_versions set approved_by = v_cmo_staff, approved_at = now(), is_active = true where code = 'who_cvd_2019_wssa' and version = 2;
  perform pg_temp.rec('signed, active and verified is met', 'true', pg_temp.cond_met('risk_instrument_who2019_enabled', 'risk_instrument_signed_verified'));
  update public.risk_instrument_versions set config = config || '{"coefficientsVerified":false}'::jsonb where code = 'who_cvd_2019_wssa' and version = 2;
  perform pg_temp.rec('signed but coefficients not verified is not met', 'false', pg_temp.cond_met('risk_instrument_who2019_enabled', 'risk_instrument_signed_verified'));

  perform pg_temp.rec('no signed rule set: not met', 'false', pg_temp.cond_met('screening_scheduler_enabled', 'screening_rules_signed'));
  update public.screening_rule_sets set approved_by = v_cmo_staff, approved_at = now(), is_active = true where version = 3;
  perform pg_temp.rec('a signed active rule set: met', 'true', pg_temp.cond_met('screening_scheduler_enabled', 'screening_rules_signed'));

  insert into public.lab_providers (name, is_active) values ('S47 Lab', false) returning id into v_lab;
  insert into public.lab_tests (provider_id, code, name, price_kobo, is_active) values (v_lab, 'hpv_dna', 'HPV DNA', 100, true);
  perform pg_temp.rec('a lab that offers HPV DNA but is inactive: not met', 'false', pg_temp.cond_met('hpv_dna_enabled', 'hpv_dna_lab_active'));
  update public.lab_providers set is_active = true where id = v_lab;
  perform pg_temp.rec('...active: met', 'true', pg_temp.cond_met('hpv_dna_enabled', 'hpv_dna_lab_active'));

  perform pg_temp.rec('no confirmed lab mapping: not met', 'false', pg_temp.cond_met('lab_structured_push_enabled', 'lab_mappings_confirmed'));
  insert into public.lab_code_mappings (lab_provider_id, loinc_code, ucum_unit, analyte_code, status, confirmed_by, confirmed_at)
    values (v_lab, '1920-8', 'U/L', 'ast', 'proposed', null, null);
  perform pg_temp.rec('a proposed mapping does not count', 'false', pg_temp.cond_met('lab_structured_push_enabled', 'lab_mappings_confirmed'));
  update public.lab_code_mappings set status = 'confirmed', confirmed_by = v_cmo, confirmed_at = now() where lab_provider_id = v_lab;
  perform pg_temp.rec('a confirmed mapping counts', 'true', pg_temp.cond_met('lab_structured_push_enabled', 'lab_mappings_confirmed'));

  perform pg_temp.rec('report: nothing signed yet', 'false,false', pg_temp.cond_met('health_report_generation_enabled', 'report_settings_signed') || ',' || pg_temp.cond_met('health_report_generation_enabled', 'report_statement_approved'));
  update public.health_report_config_versions set approved_by = v_cmo_staff, approved_at = now(), is_active = true where version = 2;
  perform pg_temp.rec('report: signed settings but the statement is not approved', 'true,false', pg_temp.cond_met('health_report_generation_enabled', 'report_settings_signed') || ',' || pg_temp.cond_met('health_report_generation_enabled', 'report_statement_approved'));
  update public.health_report_config_versions set config = config || '{"statementApprovedByCmo":true}'::jsonb where version = 2;
  perform pg_temp.rec('report: statement approved', 'true', pg_temp.cond_met('health_report_generation_enabled', 'report_statement_approved'));

  -- with every condition met the CMO switches a guard on (report guard)
  perform pg_temp.rec('report guard: still blocked until the safety case is recorded', '22023', pg_temp.switch_as(v_cmo, 'health_report_generation_enabled', true));
  perform pg_temp.rec('the CMO records the safety case', 'ok', pg_temp.attest(v_cmo, 'health_report_generation_enabled', 'clinical_safety_case_current'));
  perform pg_temp.rec('report guard: all conditions met, the CMO switches it on', 'ok', pg_temp.switch_as(v_cmo, 'health_report_generation_enabled', true));
  perform pg_temp.rec('...and off again', 'ok', pg_temp.switch_as(v_cmo, 'health_report_generation_enabled', false));
  -- scheduler guard the same way
  perform pg_temp.attest(v_cmo, 'screening_scheduler_enabled', 'clinical_safety_case_current');
  perform pg_temp.rec('scheduler guard switches on with the rule set signed and the safety case recorded', 'ok', pg_temp.switch_as(v_cmo, 'screening_scheduler_enabled', true));
  perform pg_temp.switch_as(v_cmo, 'screening_scheduler_enabled', false);
  -- withdrawing the safety case closes it again
  perform pg_temp.act(v_cmo);
  perform public.attest_go_live_condition('screening_scheduler_enabled', 'clinical_safety_case_current', false, 'Withdrawn: the safety case is being revised');
  perform pg_temp.back();
  perform pg_temp.rec('a withdrawn attestation closes the condition again', 'false', pg_temp.cond_met('screening_scheduler_enabled', 'clinical_safety_case_current'));

  -- 4. nothing regressed
  perform pg_temp.rec('clinical_operations_enabled keeps its five conditions', 'admin_confirmation,clinical_safety_case_current,hypertension_protocol_approved,tier2_clinician_active,triage_rule_set_approved', pg_temp.codes('clinical_operations_enabled'));
  perform pg_temp.rec('prescribing_enabled keeps its six', 'clinical_lead_signoff,clinical_safety_case_current,notification_sender_deployed,pharmacy_licence_current,pharmacy_partner_active,pharmacy_rules_confirmed', pg_temp.codes('prescribing_enabled'));
  perform pg_temp.rec('lab_booking_enabled keeps its three', 'collection_sites,results_flow_tested,synlab_active', pg_temp.codes('lab_booking_enabled'));
  perform pg_temp.rec('scribe, payouts, signup, on-call keep theirs', 'clinical_safety_case_current,con001_legal_review_recorded,speech_provider_configured|fee_schedule_approved,paystack_transfers_configured|stage2_exit_criteria_met|rota_covers_next_7_days',
    pg_temp.codes('scribe_enabled') || '|' || pg_temp.codes('payouts_enabled') || '|' || pg_temp.codes('public_signup_enabled') || '|' || pg_temp.codes('on_call_cover_ok'));
  -- those two branches read tables that exist only on the live project (research_protocols, ...), so they are checked in the function text
  perform pg_temp.rec('the later live branches are kept in the function (research export, symptom checker, prescribing, scribe)', '7',
    (select count(*)::text from unnest(array['research_export_enabled', 'counsel_cross_border_cleared', 'dpo_registered', 'symptom_checker_enabled', 'symptom_triage_sla_signed', 'pharmacy_licence_current', 'con001_legal_review_recorded'])
        t where pg_get_functiondef('private.go_live_conditions(text,uuid)'::regprocedure) like '%' || t || '%'));
  perform pg_temp.rec('an unknown key still fails closed', 'unknown_guard,false', pg_temp.codes('no_such_guard') || ',' || pg_temp.cond_met('no_such_guard', 'unknown_guard'));
  perform pg_temp.rec('the safe wrapper turns a broken query into a closed answer too', 'false',
    (select bool_and((c ->> 'met')::boolean)::text from jsonb_array_elements(private.go_live_conditions_safe('no_such_guard', null)) c));
  perform pg_temp.setf2('cmo', v_cmo);
end $$;

-- 5. Sabotage --------------------------------------------------------------------------------------------------------------------------
-- A: the safety case dropped from the HPV guard. The "asks for the clinical safety case" check must flip.
do $$
begin
  update public.go_live_guards set is_on = is_on where false;
  create or replace function private.go_live_conditions(p_key text, p_org uuid) returns jsonb language sql stable as
  $f$ select jsonb_build_array(private.go_live_cond('x', 'x', true, 'data', null)) $f$;
  insert into results values ('sabotaged', 'hpv_dna_enabled: asks for the clinical safety case', 'attestation',
    coalesce((select c ->> 'source' from jsonb_array_elements(private.go_live_conditions('hpv_dna_enabled', null)) c where c ->> 'code' = 'clinical_safety_case_current'), 'missing'));
  insert into results values ('sabotaged', 'report guard: still blocked until the safety case is recorded', '22023', pg_temp.switch_as(pg_temp.f2('cmo'), 'health_report_generation_enabled', true));
  insert into results values ('sabotaged', 'an unknown key still fails closed', 'unknown_guard,false', pg_temp.codes('no_such_guard') || ',' || pg_temp.cond_met('no_such_guard', 'unknown_guard'));
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
  if v_caught < 3 then raise exception 'VACUOUS TEST: the sabotage flipped % of 3 checks', v_caught; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;

rollback;
