-- Code review / replay rehearsal fix: the research_export_enabled guard (20261007212611) lists two conditions a person must attest
-- (counsel has cleared the basis for the recipient; the DPO appointment is on record), but public.attest_go_live_condition only accepts a
-- fixed list of attestable conditions, so those two could never be recorded and the guard could never be switched on. They are added to the
-- list; everything else in the function is exactly as it is live today (including the other guards' conditions).

-- Patched in place (not re-created): the two new attestable conditions go into the fixed list just before the public sign-up tuple, so every
-- other tuple another layer has added stays exactly as it is. Idempotent.
do $do$
declare
  v_def text;
  v_anchor text := '(''public_signup_enabled'', ''stage2_exit_criteria_met'')';
begin
  v_def := pg_get_functiondef('public.attest_go_live_condition(text, text, boolean, text)'::regprocedure);
  if v_def like '%counsel_cross_border_cleared%' then return; end if;
  if position(v_anchor in v_def) = 0 then raise exception 'attest_go_live_condition: the public_signup tuple was not found (definition drifted)'; end if;
  execute replace(v_def, v_anchor, '(''research_export_enabled'', ''counsel_cross_border_cleared''), (''research_export_enabled'', ''dpo_registered''),' || E'\n       ' || v_anchor);
end $do$;

revoke execute on function public.attest_go_live_condition(text, text, boolean, text) from public, anon;
grant execute on function public.attest_go_live_condition(text, text, boolean, text) to authenticated;
