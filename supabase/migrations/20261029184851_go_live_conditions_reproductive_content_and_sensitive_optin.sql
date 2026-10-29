-- reproductive_content_enabled and screening_sensitive_request_optin_enabled had no defined condition, so they could never be
-- switched on. Same method as 20261029183910: splice into the LIVE bodies of private.go_live_conditions (key list) and
-- private.s47_clinical_go_live_conditions (branches), nothing else is re-typed.
--   reproductive_content_enabled : the Chief Medical Officer's confirmation, given by pressing the switch (the guard's text:
--                                  CMO has reviewed the contraception, menopause and danger-sign wording).
--   screening_sensitive_request_optin_enabled : the screening request automation is on (its own text requires it), and the
--                                  CMO's confirmation, who is also the registered DPO. A patient must still opt in individually.
do $$
declare
  v_disp text := pg_get_functiondef('private.go_live_conditions(text,uuid)'::regprocedure);
  v_s47 text := pg_get_functiondef('private.s47_clinical_go_live_conditions(text,uuid)'::regprocedure);
  v_list_old constant text := '''screening_request_automation_enabled'', ''hpv_dna_enabled''';
  v_list_new constant text := '''screening_request_automation_enabled'', ''reproductive_content_enabled'', ''screening_sensitive_request_optin_enabled'', ''hpv_dna_enabled''';
  v_marker constant text := 'elsif p_key = ''hpv_dna_enabled'' then';
  v_branch constant text := $b$elsif p_key = 'reproductive_content_enabled' then
    return jsonb_build_array(
      private.go_live_cond('cmo_confirmation', 'Chief Medical Officer confirmation', true, 'switch', 'Given by the Chief Medical Officer pressing the switch'));
  elsif p_key = 'screening_sensitive_request_optin_enabled' then
    return jsonb_build_array(
      private.go_live_cond('request_automation_on', 'Automatic test requests are switched on',
        private.go_live_guard_on('screening_request_automation_enabled'), 'data', null),
      private.go_live_cond('cmo_dpo_confirmation', 'Chief Medical Officer and Data Protection Officer confirmation', true, 'switch', 'Given by the Chief Medical Officer, who is also the registered Data Protection Officer, pressing the switch'));
  $b$;
begin
  if position('reproductive_content_enabled' in v_disp) = 0 then
    if position(v_list_old in v_disp) = 0 then raise exception 'private.go_live_conditions key list changed; re-read it before editing'; end if;
    execute replace(v_disp, v_list_old, v_list_new);
  end if;
  if position('reproductive_content_enabled' in v_s47) = 0 then
    if position(v_marker in v_s47) = 0 then raise exception 's47_clinical_go_live_conditions no longer has the hpv_dna_enabled branch; re-read it'; end if;
    execute replace(v_s47, v_marker, v_branch || v_marker);
  end if;
end $$;

do $$
declare org constant uuid := '00000000-0000-0000-0000-000000000001';
begin
  if private.go_live_conditions_safe('reproductive_content_enabled', org) -> 0 ->> 'code' = 'unknown_guard' then raise exception 'reproductive_content_enabled still undefined'; end if;
  if jsonb_array_length(private.go_live_conditions_safe('screening_sensitive_request_optin_enabled', org)) <> 2 then raise exception 'sensitive opt-in should have 2 conditions'; end if;
  -- earlier definitions must survive
  if jsonb_array_length(private.go_live_conditions_safe('screening_request_automation_enabled', org)) <> 2 then raise exception 'request automation conditions lost'; end if;
  if jsonb_array_length(private.go_live_conditions_safe('screening_scheduler_enabled', org)) <> 2 then raise exception 'scheduler conditions lost'; end if;
  if private.go_live_conditions_safe('hpv_dna_enabled', org) -> 0 ->> 'code' = 'unknown_guard' then raise exception 'hpv_dna_enabled lost its conditions'; end if;
end $$;
