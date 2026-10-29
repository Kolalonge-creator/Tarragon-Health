-- screening_request_automation_enabled had no defined condition ("unknown_guard"), so it could never be switched on.
-- Its own condition text: the CMO has signed the screening rule set and switched the screening scheduler on.
-- Two edits, each spliced into the LIVE body (not an older migration's copy) so nothing else can drift:
--   1. private.go_live_conditions: add the key to the list that routes to private.s47_clinical_go_live_conditions;
--   2. private.s47_clinical_go_live_conditions: add the branch, ahead of the hpv_dna_enabled branch.
do $$
declare
  v_disp text := pg_get_functiondef('private.go_live_conditions(text,uuid)'::regprocedure);
  v_s47 text := pg_get_functiondef('private.s47_clinical_go_live_conditions(text,uuid)'::regprocedure);
  v_list_old constant text := '''screening_scheduler_enabled'', ''hpv_dna_enabled''';
  v_list_new constant text := '''screening_scheduler_enabled'', ''screening_request_automation_enabled'', ''hpv_dna_enabled''';
  v_marker constant text := 'elsif p_key = ''hpv_dna_enabled'' then';
  v_branch constant text := $b$elsif p_key = 'screening_request_automation_enabled' then
    return jsonb_build_array(
      private.go_live_cond('screening_scheduler_on', 'The nightly screening scheduler is switched on',
        private.go_live_guard_on('screening_scheduler_enabled'), 'data', null),
      private.go_live_cond('screening_rules_signed', 'A signed, active screening rule set',
        exists (select 1 from public.screening_rule_sets where is_active and approved_by is not null), 'data', null));
  $b$;
begin
  if position('screening_request_automation_enabled' in v_disp) = 0 then
    if position(v_list_old in v_disp) = 0 then raise exception 'private.go_live_conditions no longer has the s47 key list; re-read it before editing'; end if;
    execute replace(v_disp, v_list_old, v_list_new);
  end if;
  if position('screening_request_automation_enabled' in v_s47) = 0 then
    if position(v_marker in v_s47) = 0 then raise exception 'private.s47_clinical_go_live_conditions no longer has the hpv_dna_enabled branch; re-read it before editing'; end if;
    execute replace(v_s47, v_marker, v_branch || v_marker);
  end if;
end $$;

do $$
declare v jsonb; s jsonb;
begin
  v := private.go_live_conditions_safe('screening_request_automation_enabled', '00000000-0000-0000-0000-000000000001'::uuid);
  if v -> 0 ->> 'code' = 'unknown_guard' then raise exception 'screening_request_automation_enabled still has no defined condition'; end if;
  if jsonb_array_length(v) <> 2 then raise exception 'expected 2 conditions, got %', jsonb_array_length(v); end if;
  s := private.go_live_conditions_safe('screening_scheduler_enabled', '00000000-0000-0000-0000-000000000001'::uuid);
  if s -> 0 ->> 'code' <> 'screening_rules_signed' or jsonb_array_length(s) <> 2 then raise exception 'screening_scheduler_enabled conditions changed'; end if;
  -- an untouched neighbour still resolves
  if private.go_live_conditions_safe('hpv_dna_enabled', '00000000-0000-0000-0000-000000000001'::uuid) -> 0 ->> 'code' = 'unknown_guard' then raise exception 'hpv_dna_enabled lost its conditions'; end if;
end $$;
