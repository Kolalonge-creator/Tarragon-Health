-- A governed configuration can no longer go live, or stay live, without a signature on file.
--
-- Why: on 2026-10-29 the sign-off hub counted three areas needing the CMO's signature, two of them already live with none
-- (the capacity and cover configuration and the paging delivery configuration). Nothing in the database stopped a version
-- going live unsigned; the hub only reported it afterwards, and only when someone opened it. The existing trigger
-- (refuse_superseded_activation, 20261006223248) refuses activating a version OLDER than a signed one, but says nothing about
-- activating one that was never signed.
--
-- What it refuses, on each table below (all keep the same three columns: is_active, approved_by, approved_at):
--   1. INSERT of a row that is active and has neither approved_by nor approved_at;
--   2. UPDATE that turns an unsigned row from inactive to active;
--   3. UPDATE that takes the signature off a row that is (or becomes) active.
-- It deliberately does NOT refuse an unrelated update to an unsigned row that is already live (there are none today, and blocking the
-- edit would not make it signed), and it never fires when a signer's profile is deleted (the foreign key nulls approved_by while
-- approved_at stays, and the third rule only looks at approved_at). "Signed" means the same thing the hub means: approved_by or
-- approved_at is set.
--
-- Every signing function in the repo signs and activates in ONE statement (set approved_at, approved_by, is_active = true), so none
-- of them is affected; the app only ever inserts drafts (is_active defaults to false on all of these tables).
--
-- Covered: the 32 tables the hub's sign-off queue reads, screening_rule_sets, and 11 further governed configuration tables
-- whose signing functions were read and sign+activate together. Not covered, on purpose, and named in the proof so a table added
-- later cannot slip past unclassified: switch-style tables where activation is a separate act from signing
-- (legacy_notice_retirement_config, unified_red_paging_config), status-based or catalogue tables (clinical_config_versions,
-- poc_panel_versions, bp_target_config, pharmacy_partners), and the AI governance registry (ai_guardrails, ai_knowledge_sources,
-- ai_prompt_versions), where approval is a human judgement that must never be seeded (see docs/AI_GOVERNANCE_SPEC.md).
--
-- The triggers are named zz_* on purpose: Postgres fires same-event triggers in name order, so every older, more specific guard on a table
-- (with its own error code and message) still speaks first, and this one is the backstop that catches whatever they let through.
--
-- Revert path if it is ever needed in anger: drop the two triggers on that one table.
create or replace function private.refuse_unsigned_activation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception
    '% version % cannot be live without a signature. Sign it (the signing function activates and signs together) instead of activating it.',
    tg_table_name, coalesce(to_jsonb(new) ->> 'version', '?')
    using errcode = '23514';
end;
$$;

revoke all on function private.refuse_unsigned_activation() from public, anon;

do $$
declare
  v_table text;
  v_tables text[] := array[
    -- the 32 the hub's sign-off queue reads
    'alert_rules', 'escalation_slas', 'triage_protocols', 'mental_health_screening_cadences', 'provider_quality_policy',
    'cv_risk_config', 'risk_questionnaire_configs', 'vaccination_schedule_signoffs', 'lab_panel_signoffs',
    'lab_fallback_wording_signoffs', 'prn_limit_rules', 'medicine_interaction_rule_sets', 'home_bp_programme_signoffs',
    'cuff_check_rules', 'my_health_config', 'nutrition_target_config', 'lowcarb_protocol_config', 'nutrition_guidance_config',
    'health_report_config_versions', 'observation_limit_signoffs', 'activity_safety_config', 'fasting_safety_config',
    'home_card_config', 'bp_cuff_guidance_signoffs', 'result_release_policies', 'quality_config', 'credentialing_config',
    'capacity_cover_config', 'lead_config', 'ops_desk_config', 'queue_task_layer_config', 'paging_delivery_config',
    -- screening, and the governed configurations the hub reads through their own readers
    'screening_rule_sets', 'ai_monitoring_config', 'baseline_labs_rule_config', 'care_gap_rule_config',
    'mental_health_worklist_config', 'outcome_adjustment_config', 'outcome_cascade_config', 'outcome_reliable_change_config',
    'post_consult_checkin_config', 'symptom_ux_config', 'threshold_override_policies', 'risk_instrument_versions'
  ];
  v_n integer;
begin
  foreach v_table in array v_tables loop
    execute format(
      'create trigger zz_refuse_unsigned_activation_ins before insert on public.%I for each row '
      'when (new.is_active and new.approved_by is null and new.approved_at is null) '
      'execute function private.refuse_unsigned_activation()', v_table);
    -- approved_by is left out of the column list on purpose: the foreign key action on a deleted signer must never be refused
    execute format(
      'create trigger zz_refuse_unsigned_activation_upd before update of is_active, approved_at on public.%I for each row '
      'when (new.is_active and new.approved_by is null and new.approved_at is null '
      'and (not old.is_active or old.approved_at is not null)) '
      'execute function private.refuse_unsigned_activation()', v_table);
  end loop;

  select count(*) into v_n from pg_trigger where tgname in ('zz_refuse_unsigned_activation_ins', 'zz_refuse_unsigned_activation_upd') and not tgisinternal;
  if v_n <> 2 * array_length(v_tables, 1) then
    raise exception 'FAIL: expected % refuse_unsigned_activation triggers, found %', 2 * array_length(v_tables, 1), v_n;
  end if;
  if has_function_privilege('anon', 'private.refuse_unsigned_activation()', 'EXECUTE') then
    raise exception 'FAIL: anon can execute private.refuse_unsigned_activation';
  end if;
end $$;
