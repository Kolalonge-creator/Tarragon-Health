-- S47 (decisions 7 and 8 of the go-live list; chat selections 2026-10-07, NOT signatures): conditions for the seven clinical guards added by S43 to S46.
--
-- A guard with no conditions reports "unknown guard" and can never be switched on (fail closed). S43 to S46 registered seven guards that way, all OFF.
-- This restates private.go_live_conditions FROM THE LIVE DEFINITION read read-only from koiplnmbgnqnbywhpjlf on 2026-10-07 (pg_get_functiondef), NOT from
-- the repo copy: the live function carries branches the repo copies lack (clinical_operations_enabled, on_call_cover_ok, lab_booking_enabled,
-- prescribing_enabled, research_export_enabled, scribe_enabled, payouts_enabled, public_signup_enabled, symptom_checker_enabled). Every one of them is
-- reproduced unchanged below; the only edits are the seven new branches inserted before the closing fall-through, which still returns the single unmet
-- 'unknown_guard' condition. No later migration on this branch redefines the function (checked: the S43 and S44 files only mention it in comments).
-- public.attest_go_live_condition is restated from its live definition the same way, with the new (guard, code) pairs added so the CMO can attest them.
--
-- Every clinical guard also requires the attestation clinical_safety_case_current (decision 9), which only the Chief Medical Officer can record.
-- Nothing is attested and nothing is switched on here.

create or replace function private.go_live_conditions(p_key text, p_org uuid)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to ''
as $function$
declare
  v_n integer;
  v_gaps integer;
begin
  if p_key = 'clinical_operations_enabled' then
    -- the approved hypertension protocol is a public.protocols row (S24) whose code starts htn or hypertension (the S24 placeholder is htn_hearts_ng)
    select count(*) into v_n from public.protocols where status = 'approved' and code ~ '^(htn|hypertension)';
    return jsonb_build_array(
      private.go_live_cond('hypertension_protocol_approved', 'An approved hypertension protocol', v_n > 0, 'data', v_n || ' approved'),
      private.go_live_cond('triage_rule_set_approved', 'An approved blood pressure triage rule set',
        exists (select 1 from public.triage_rule_sets where status = 'approved' and code = 'bp_care_triage'), 'data',
        (select count(*) from public.triage_rule_sets where status = 'approved' and code = 'bp_care_triage') || ' approved'),
      private.go_live_cond('tier2_clinician_active', 'At least one active tier 2 clinician',
        (select count(*) from public.clinical_staff where active and status = 'active' and credentialing_level >= 2 and is_test is not true) > 0, 'data',
        (select count(*) from public.clinical_staff where active and status = 'active' and credentialing_level >= 2 and is_test is not true) || ' active'),
      private.go_live_cond('clinical_safety_case_current', 'A current clinical safety case and hazard log, signed off', private.go_live_attested(p_key, 'clinical_safety_case_current'), 'attestation', null),
      private.go_live_cond('admin_confirmation', 'Admin confirmation', true, 'switch', 'Given by an admin pressing the switch'));
  elsif p_key = 'on_call_cover_ok' then
    select count(*) into v_gaps from private.rota_gaps(p_org, now(), now() + interval '7 days');
    return jsonb_build_array(
      private.go_live_cond('rota_covers_next_7_days', 'The rota covers the next 7 days with a primary and an eligible backup', v_gaps = 0, 'data', v_gaps || ' gaps'));
  elsif p_key = 'lab_booking_enabled' then
    return jsonb_build_array(
      private.go_live_cond('synlab_active', 'SYNLAB is an active laboratory partner',
        exists (select 1 from public.lab_providers where is_active and name ilike 'synlab%'), 'data', null),
      private.go_live_cond('collection_sites', 'SYNLAB has at least one active collection site',
        exists (select 1 from public.lab_provider_locations l join public.lab_providers p on p.id = l.lab_provider_id where l.is_active and p.is_active and p.name ilike 'synlab%'), 'data', null),
      private.go_live_cond('results_flow_tested', 'The results flow has been tested end to end', private.go_live_attested(p_key, 'results_flow_tested'), 'attestation', null));
  elsif p_key = 'prescribing_enabled' then
    select count(*) into v_n from public.pharmacy_partners where is_active and onboarding_status = 'activated';
    -- S28c: sending a prescription to a pharmacy also needs a pharmacy people can actually choose today (active, approved, licence verified and
    -- unexpired, with a verified location), the collection rules confirmed by their owner, and the notification sender deployed.
    return jsonb_build_array(
      private.go_live_cond('pharmacy_partner_active', 'At least one active pharmacy partner', v_n > 0, 'data', v_n || ' active'),
      private.go_live_cond('pharmacy_licence_current', 'At least one approved pharmacy with a current, verified licence and a verified location',
        exists (select 1 from public.pharmacy_partners pp join public.pharmacy_partner_locations l on l.pharmacy_partner_id = pp.id where private.pharmacy_location_choosable(pp.id, l.id)), 'data',
        (select count(distinct pp.id) from public.pharmacy_partners pp join public.pharmacy_partner_locations l on l.pharmacy_partner_id = pp.id where private.pharmacy_location_choosable(pp.id, l.id)) || ' can be chosen'),
      private.go_live_cond('pharmacy_rules_confirmed', 'The pharmacy collection rules are confirmed',
        coalesce((select s.decision = 'confirmed' from public.proposed_config_signoffs s
                   where s.config_key = 'pharmacy.collection_rules'
                     and s.config_version = (select c.version from public.pharmacy_config c where c.is_active)
                   order by s.id desc limit 1), false), 'data', null),
      private.go_live_cond('notification_sender_deployed', 'The notification sender with the pharmacy messages is deployed',
        private.go_live_attested(p_key, 'notification_sender_deployed'), 'attestation', null),
      private.go_live_cond('clinical_safety_case_current', 'A current clinical safety case and hazard log, signed off', private.go_live_attested(p_key, 'clinical_safety_case_current'), 'attestation', null),
      private.go_live_cond('clinical_lead_signoff', 'Clinical lead sign-off', true, 'switch', 'Given by the Chief Medical Officer pressing the switch'));
  elsif p_key = 'research_export_enabled' then
    select count(*) into v_n from public.research_protocols where status = 'approved';
    return jsonb_build_array(
      private.go_live_cond('approved_protocol_exists', 'At least one approved research protocol (ethics approval, data-sharing agreement, CMO and data protection officer approval)', v_n > 0, 'data', v_n || ' approved'),
      private.go_live_cond('counsel_cross_border_cleared', 'Counsel has cleared the legal basis for the recipient and any transfer abroad', private.go_live_attested(p_key, 'counsel_cross_border_cleared'), 'attestation', null),
      private.go_live_cond('dpo_registered', 'The data protection officer appointment is on record with NDPC', private.go_live_attested(p_key, 'dpo_registered'), 'attestation', null));
  elsif p_key = 'scribe_enabled' then
    return jsonb_build_array(
      private.go_live_cond('clinical_safety_case_current', 'A current clinical safety case and hazard log, signed off', private.go_live_attested(p_key, 'clinical_safety_case_current'), 'attestation', null),
      private.go_live_cond('con001_legal_review_recorded', 'Legal review of consent text CON-001 recorded', private.go_live_attested(p_key, 'con001_legal_review_recorded'), 'attestation', null),
      private.go_live_cond('speech_provider_configured', 'A speech-to-text provider is configured', private.go_live_attested(p_key, 'speech_provider_configured'), 'attestation', null));
  elsif p_key = 'payouts_enabled' then
    return jsonb_build_array(
      private.go_live_cond('fee_schedule_approved', 'A fee schedule is approved', private.go_live_attested(p_key, 'fee_schedule_approved'), 'attestation', null),
      private.go_live_cond('paystack_transfers_configured', 'Paystack transfers are configured', private.go_live_attested(p_key, 'paystack_transfers_configured'), 'attestation', null));
  elsif p_key = 'public_signup_enabled' then
    return jsonb_build_array(
      private.go_live_cond('stage2_exit_criteria_met', 'The Stage 2 exit criteria are met', private.go_live_attested(p_key, 'stage2_exit_criteria_met'), 'attestation', null));
  elsif p_key = 'symptom_checker_enabled' then
    return jsonb_build_array(
      private.go_live_cond('nafdac_position_recorded', 'A NAFDAC and counsel position on a symptom checker is recorded', private.go_live_attested(p_key, 'nafdac_position_recorded'), 'attestation', null),
      private.go_live_cond('engine_licence_or_validation_recorded', 'An engine licence or an internal validation is recorded', private.go_live_attested(p_key, 'engine_licence_or_validation_recorded'), 'attestation', null),
      private.go_live_cond('localisation_signoff_recorded', 'Localisation sign-off is recorded', private.go_live_attested(p_key, 'localisation_signoff_recorded'), 'attestation', null),
      private.go_live_cond('accuracy_baseline_recorded', 'An accuracy baseline is recorded', private.go_live_attested(p_key, 'accuracy_baseline_recorded'), 'attestation', null),
      private.go_live_cond('triage_protocol_signed', 'A triage protocol is signed and active',
        exists (select 1 from public.triage_protocols where is_active), 'data', null),
      private.go_live_cond('symptom_triage_sla_signed', 'The active escalation SLA carries symptom_triage for urgent and review',
        (select count(distinct e ->> 'tier') from public.escalation_slas s, jsonb_array_elements(s.config) e
          where s.is_active and e ->> 'pathway' = 'symptom_triage' and e ->> 'tier' in ('urgent_escalation', 'clinician_review')) = 2,
        'data', null));
  -- S47: the seven clinical guards added by S43 to S46 (all OFF). Each also needs the clinical safety case attestation (decision 9).
  elsif p_key = 'risk_instrument_who2019_enabled' then
    return jsonb_build_array(
      private.go_live_cond('risk_instrument_signed_verified', 'A signed, active risk instrument version with verified coefficients',
        exists (select 1 from public.risk_instrument_versions v
                 where v.code = 'who_cvd_2019_wssa' and v.is_active and v.approved_by is not null
                   and coalesce((v.config ->> 'coefficientsVerified')::boolean, false)), 'data', null),
      private.go_live_cond('nigeria_region_confirmed', 'The mapping of Nigeria to the chart region is confirmed', private.go_live_attested(p_key, 'nigeria_region_confirmed'), 'attestation', null),
      private.go_live_cond('coefficient_licence_checked', 'The licence for the chart coefficients has been checked', private.go_live_attested(p_key, 'coefficient_licence_checked'), 'attestation', null),
      private.go_live_cond('clinical_safety_case_current', 'A current clinical safety case and hazard log, signed off', private.go_live_attested(p_key, 'clinical_safety_case_current'), 'attestation', null));
  elsif p_key = 'screening_scheduler_enabled' then
    return jsonb_build_array(
      private.go_live_cond('screening_rules_signed', 'A signed, active screening rule set',
        exists (select 1 from public.screening_rule_sets where is_active and approved_by is not null), 'data', null),
      private.go_live_cond('clinical_safety_case_current', 'A current clinical safety case and hazard log, signed off', private.go_live_attested(p_key, 'clinical_safety_case_current'), 'attestation', null));
  elsif p_key = 'hpv_dna_enabled' then
    return jsonb_build_array(
      private.go_live_cond('positive_result_pathway_in_place', 'A positive-result pathway (colposcopy, treatment, confirmatory testing) is in place', private.go_live_attested(p_key, 'positive_result_pathway_in_place'), 'attestation', null),
      private.go_live_cond('hpv_dna_lab_active', 'An active laboratory offers HPV DNA',
        exists (select 1 from public.lab_tests t join public.lab_providers p on p.id = t.provider_id where t.is_active and p.is_active and lower(t.code) = 'hpv_dna'), 'data', null),
      private.go_live_cond('clinical_safety_case_current', 'A current clinical safety case and hazard log, signed off', private.go_live_attested(p_key, 'clinical_safety_case_current'), 'attestation', null));
  elsif p_key = 'home_kit_sensitive_enabled' then
    return jsonb_build_array(
      private.go_live_cond('human_disclosure_path_in_place', 'A clinician human-disclosure path for reactive results is in place', private.go_live_attested(p_key, 'human_disclosure_path_in_place'), 'attestation', null),
      private.go_live_cond('clinical_safety_case_current', 'A current clinical safety case and hazard log, signed off', private.go_live_attested(p_key, 'clinical_safety_case_current'), 'attestation', null));
  elsif p_key = 'lab_structured_push_enabled' then
    select count(distinct m.lab_provider_id) into v_n from public.lab_code_mappings m where m.status = 'confirmed';
    return jsonb_build_array(
      private.go_live_cond('lab_mappings_confirmed', 'At least one laboratory has confirmed code mappings', v_n > 0, 'data', v_n || ' with confirmed mappings'),
      private.go_live_cond('lab_panel_ranges_signed', 'The laboratory panel reference ranges are signed', private.go_live_attested(p_key, 'lab_panel_ranges_signed'), 'attestation', null),
      private.go_live_cond('lab_contract_names_channel', 'The laboratory contract names this channel', private.go_live_attested(p_key, 'lab_contract_names_channel'), 'attestation', null),
      private.go_live_cond('clinical_safety_case_current', 'A current clinical safety case and hazard log, signed off', private.go_live_attested(p_key, 'clinical_safety_case_current'), 'attestation', null));
  elsif p_key = 'document_capture_enabled' then
    return jsonb_build_array(
      private.go_live_cond('ai018_evaluation_recorded', 'The evaluation of AI-018 (document capture reading) is recorded', private.go_live_attested(p_key, 'ai018_evaluation_recorded'), 'attestation', null),
      private.go_live_cond('ai_provider_data_agreement_recorded', 'The data agreement with the model provider is recorded', private.go_live_attested(p_key, 'ai_provider_data_agreement_recorded'), 'attestation', null),
      private.go_live_cond('original_photo_retention_approved', 'How long the original photo is kept is approved', private.go_live_attested(p_key, 'original_photo_retention_approved'), 'attestation', null),
      private.go_live_cond('clinical_safety_case_current', 'A current clinical safety case and hazard log, signed off', private.go_live_attested(p_key, 'clinical_safety_case_current'), 'attestation', null));
  elsif p_key = 'health_report_generation_enabled' then
    return jsonb_build_array(
      private.go_live_cond('report_settings_signed', 'The report settings are signed and active',
        exists (select 1 from public.health_report_config_versions where is_active and approved_by is not null), 'data', null),
      private.go_live_cond('report_statement_approved', 'The report statement wording is marked as approved by the CMO',
        coalesce((select (c.config ->> 'statementApprovedByCmo')::boolean from public.health_report_config_versions c where c.is_active and c.approved_by is not null limit 1), false), 'data', null),
      private.go_live_cond('clinical_safety_case_current', 'A current clinical safety case and hazard log, signed off', private.go_live_attested(p_key, 'clinical_safety_case_current'), 'attestation', null));
  end if;
  -- An unknown key has no conditions, and a guard with no conditions is never satisfied (fail closed).
  return jsonb_build_array(private.go_live_cond('unknown_guard', 'This guard has no defined condition', false, 'data', null));
end $function$;

create or replace function public.attest_go_live_condition(p_key text, p_code text, p_met boolean, p_note text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if private.go_live_actor_role() is null then raise exception 'only an admin or the Chief Medical Officer can record this' using errcode = '42501'; end if;
  if not exists (select 1 from public.go_live_guards where key = p_key) then raise exception 'no such go-live guard: %', p_key using errcode = '22023'; end if;
  -- the conditions a person records (the rest are read from the data). A fixed list, so a broken data query cannot block recording one.
  if (p_key, p_code) not in (
       ('clinical_operations_enabled', 'clinical_safety_case_current'), ('prescribing_enabled', 'clinical_safety_case_current'),
       ('scribe_enabled', 'clinical_safety_case_current'), ('prescribing_enabled', 'notification_sender_deployed'),
       ('lab_booking_enabled', 'results_flow_tested'),
       ('scribe_enabled', 'con001_legal_review_recorded'), ('scribe_enabled', 'speech_provider_configured'),
       ('payouts_enabled', 'fee_schedule_approved'), ('payouts_enabled', 'paystack_transfers_configured'),
       ('public_signup_enabled', 'stage2_exit_criteria_met'),
       ('research_export_enabled', 'counsel_cross_border_cleared'), ('research_export_enabled', 'dpo_registered'),
       ('symptom_checker_enabled', 'nafdac_position_recorded'), ('symptom_checker_enabled', 'engine_licence_or_validation_recorded'),
       ('symptom_checker_enabled', 'localisation_signoff_recorded'), ('symptom_checker_enabled', 'accuracy_baseline_recorded'),
       -- S47
       ('risk_instrument_who2019_enabled', 'nigeria_region_confirmed'), ('risk_instrument_who2019_enabled', 'coefficient_licence_checked'),
       ('risk_instrument_who2019_enabled', 'clinical_safety_case_current'),
       ('screening_scheduler_enabled', 'clinical_safety_case_current'),
       ('hpv_dna_enabled', 'positive_result_pathway_in_place'), ('hpv_dna_enabled', 'clinical_safety_case_current'),
       ('home_kit_sensitive_enabled', 'human_disclosure_path_in_place'), ('home_kit_sensitive_enabled', 'clinical_safety_case_current'),
       ('lab_structured_push_enabled', 'lab_panel_ranges_signed'), ('lab_structured_push_enabled', 'lab_contract_names_channel'),
       ('lab_structured_push_enabled', 'clinical_safety_case_current'),
       ('document_capture_enabled', 'ai018_evaluation_recorded'), ('document_capture_enabled', 'ai_provider_data_agreement_recorded'),
       ('document_capture_enabled', 'original_photo_retention_approved'), ('document_capture_enabled', 'clinical_safety_case_current'),
       ('health_report_generation_enabled', 'clinical_safety_case_current')) then
    raise exception 'that condition is read from the data (or does not exist), it cannot be attested' using errcode = '22023';
  end if;
  if p_met is null or length(btrim(coalesce(p_note, ''))) < 10 then
    raise exception 'say what was checked and by whom, in a sentence' using errcode = '22023';
  end if;
  -- the safety case is the safety officer's: an admin who is not the CMO cannot record it
  if p_code = 'clinical_safety_case_current' and not private.credential_is_cmo() then
    raise exception 'only the Chief Medical Officer can record the clinical safety case' using errcode = '42501';
  end if;
  if p_code = 'clinical_safety_case_current' and p_met and length(btrim(p_note)) < 25 then
    raise exception 'name the safety case document, its version and who signed it' using errcode = '22023';
  end if;
  insert into public.go_live_attestations (guard_key, condition_code, met, note, attested_by)
  values (p_key, p_code, p_met, btrim(p_note), v_uid);
  perform private.log_audit('go_live_guard.condition_attested', 'go_live_guard', null, jsonb_build_object('key', p_key, 'code', p_code, 'met', p_met));
  return jsonb_build_object('ok', true);
end $function$;

-- The plain-language condition text the dashboard shows next to each guard now matches the conditions above.
update public.go_live_guards set condition_text = 'A signed risk instrument version with verified coefficients; the Nigeria region mapping confirmed; the coefficient licence checked; a current clinical safety case' where key = 'risk_instrument_who2019_enabled';
update public.go_live_guards set condition_text = 'A signed screening rule set; a current clinical safety case' where key = 'screening_scheduler_enabled';
update public.go_live_guards set condition_text = 'A positive-result pathway in place; an active laboratory that offers HPV DNA; a current clinical safety case' where key = 'hpv_dna_enabled';
update public.go_live_guards set condition_text = 'A clinician human-disclosure path for reactive results in place; a current clinical safety case' where key = 'home_kit_sensitive_enabled';
update public.go_live_guards set condition_text = 'A laboratory with confirmed code mappings; the panel ranges signed; the laboratory contract names this channel; a current clinical safety case' where key = 'lab_structured_push_enabled';
update public.go_live_guards set condition_text = 'The AI-018 evaluation recorded; the model provider data agreement recorded; the original photo retention approved; a current clinical safety case' where key = 'document_capture_enabled';
update public.go_live_guards set condition_text = 'Signed report settings; the statement wording marked as approved by the CMO; a current clinical safety case' where key = 'health_report_generation_enabled';

do $$
declare k text;
begin
  -- every one of the seven now has defined conditions, none of them is the unknown-guard fallback, and every one asks for the safety case
  foreach k in array array['risk_instrument_who2019_enabled', 'screening_scheduler_enabled', 'hpv_dna_enabled', 'home_kit_sensitive_enabled',
                           'lab_structured_push_enabled', 'document_capture_enabled', 'health_report_generation_enabled'] loop
    if exists (select 1 from jsonb_array_elements(private.go_live_conditions(k, null)) c where c ->> 'code' = 'unknown_guard') then
      raise exception 'S47 self-check: % still has no conditions', k;
    end if;
    if not exists (select 1 from jsonb_array_elements(private.go_live_conditions(k, null)) c where c ->> 'code' = 'clinical_safety_case_current') then
      raise exception 'S47 self-check: % does not ask for the clinical safety case', k;
    end if;
    if exists (select 1 from public.go_live_guards where key = k and is_on) then raise exception 'S47 self-check: % must still be off', k; end if;
  end loop;
  if not exists (select 1 from jsonb_array_elements(private.go_live_conditions('no_such_guard_key', null)) c where c ->> 'code' = 'unknown_guard' and not (c ->> 'met')::boolean) then
    raise exception 'S47 self-check: the unknown-guard fallback no longer fails closed';
  end if;
end $$;
