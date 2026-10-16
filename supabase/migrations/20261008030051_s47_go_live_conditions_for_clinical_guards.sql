-- S47 (decisions 7 and 8 of the go-live list; chat selections 2026-10-07, NOT signatures): conditions for the seven clinical guards added by S43 to S46.
--
-- A guard with no conditions reports "unknown guard" and can never be switched on (fail closed). S43 to S46 registered seven guards that way, all OFF.
-- Reworked 2026-10-16 at merge: the first version restated private.go_live_conditions and public.attest_go_live_condition wholesale from a live
-- definition read on 2026-10-07. Since then a dozen migrations (S60 to S63, S69 to S74, S77, S85, Community and others) added their own branches, so a
-- wholesale restatement would silently delete every guard they defined (both on replay and in production). This version instead puts the seven
-- branches in their own function and PATCHES the CURRENT definitions in place, the same way the Community guard does: it raises if the anchor moved and
-- does nothing if already patched.
--
-- Every clinical guard also requires the attestation clinical_safety_case_current (decision 9), which only the Chief Medical Officer can record.
-- Nothing is attested and nothing is switched on here.

create or replace function private.s47_clinical_go_live_conditions(p_key text, p_org uuid)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to ''
as $function$
declare
  v_n integer;
begin
  if p_key = 'risk_instrument_who2019_enabled' then
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
  return null;
end $function$;
revoke all on function private.s47_clinical_go_live_conditions(text, uuid) from public, anon, authenticated, service_role;

-- Add the branch to the CURRENT go_live_conditions.
do $patch$
declare
  v_def text;
  v_anchor constant text := E'\n  end if;\n  -- An unknown key has no conditions';
  v_new text;
begin
  v_def := pg_get_functiondef('private.go_live_conditions(text, uuid)'::regprocedure);
  if v_def like '%s47_clinical_go_live_conditions%' then
    return;
  end if;
  if position(v_anchor in v_def) = 0 then
    raise exception 'private.go_live_conditions no longer ends with the expected fall-through; add the S47 branch by hand' using errcode = '55000';
  end if;
  v_new := replace(v_def, v_anchor,
    E'\n  elsif p_key in (\'risk_instrument_who2019_enabled\', \'screening_scheduler_enabled\', \'hpv_dna_enabled\', \'home_kit_sensitive_enabled\', \'lab_structured_push_enabled\', \'document_capture_enabled\', \'health_report_generation_enabled\') then\n    return private.s47_clinical_go_live_conditions(p_key, p_org);\n  end if;\n  -- An unknown key has no conditions');
  execute v_new;
end $patch$;

-- The conditions a person records must be on the list of attestable conditions. Patched in place from the CURRENT definition.
do $patch$
declare
  v_def text := pg_get_functiondef('public.attest_go_live_condition(text,text,boolean,text)'::regprocedure);
  v_anchor text := E'\')) then\n    raise exception \'that condition is read from the data';
  v_new text;
begin
  if position('risk_instrument_who2019_enabled' in v_def) > 0 then return; end if;
  if position(v_anchor in v_def) = 0 then
    raise exception 'attest_go_live_condition: anchor not found, refusing to rewrite';
  end if;
  v_new := replace(v_def, v_anchor,
    E'\'),\n       -- S47\n(\'risk_instrument_who2019_enabled\', \'nigeria_region_confirmed\'), (\'risk_instrument_who2019_enabled\', \'coefficient_licence_checked\'),\n       (\'risk_instrument_who2019_enabled\', \'clinical_safety_case_current\'),\n       (\'screening_scheduler_enabled\', \'clinical_safety_case_current\'),\n       (\'hpv_dna_enabled\', \'positive_result_pathway_in_place\'), (\'hpv_dna_enabled\', \'clinical_safety_case_current\'),\n       (\'home_kit_sensitive_enabled\', \'human_disclosure_path_in_place\'), (\'home_kit_sensitive_enabled\', \'clinical_safety_case_current\'),\n       (\'lab_structured_push_enabled\', \'lab_panel_ranges_signed\'), (\'lab_structured_push_enabled\', \'lab_contract_names_channel\'),\n       (\'lab_structured_push_enabled\', \'clinical_safety_case_current\'),\n       (\'document_capture_enabled\', \'ai018_evaluation_recorded\'), (\'document_capture_enabled\', \'ai_provider_data_agreement_recorded\'),\n       (\'document_capture_enabled\', \'original_photo_retention_approved\'), (\'document_capture_enabled\', \'clinical_safety_case_current\'),\n       (\'health_report_generation_enabled\', \'clinical_safety_case_current\')'||
    E') then\n    raise exception \'that condition is read from the data');
  execute v_new;
end $patch$;
revoke all on function public.attest_go_live_condition(text, text, boolean, text) from public, anon;
grant execute on function public.attest_go_live_condition(text, text, boolean, text) to authenticated;

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
