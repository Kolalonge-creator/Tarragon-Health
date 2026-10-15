-- Follow-up FU-notify C (OQ-316): a public-safe heartbeat for the chain canary, so a free outside uptime monitor can alert when
-- chain_canary_runs stops moving (today the only watcher is the in-database stale_cron rule, which dies with the database).
--
-- Returns ONLY {ok, age_bucket}: no timestamps, no ids, no pass or fail detail, no configuration, nothing about any patient.
-- ok is false when no run has finished for staleAfterMinutes (chain_canary_config, 100 minutes today), the same line the in-database
-- incident uses. Service role only; the web route /api/status/canary is the one caller.
-- LIVE COUNTS BEFORE (2026-10-16, read only): chain_canary_runs is read-only history; this migration writes nothing to it.
-- No begin/commit here: the auto-apply workflow wraps this file.
create function public.canary_heartbeat() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_last timestamptz;
  v_stale int := coalesce((select (rules ->> 'staleAfterMinutes')::int from public.chain_canary_config where is_active), 100);
  v_age interval;
  v_bucket text;
begin
  if coalesce((select auth.role()), '') <> 'service_role' then raise exception 'not allowed' using errcode = '42501'; end if;
  select max(at) into v_last from public.chain_canary_runs where kind = 'result';
  if v_last is null then return jsonb_build_object('ok', false, 'age_bucket', 'never'); end if;
  v_age := now() - v_last;
  v_bucket := case
    when v_age < interval '1 hour' then 'under_1h'
    when v_age < interval '3 hours' then '1h_to_3h'
    when v_age < interval '24 hours' then '3h_to_24h'
    else 'over_24h' end;
  return jsonb_build_object('ok', v_age < make_interval(mins => v_stale), 'age_bucket', v_bucket);
end;
$$;
revoke all on function public.canary_heartbeat() from public, anon, authenticated;
grant execute on function public.canary_heartbeat() to service_role;

do $$
begin
  if has_function_privilege('anon', 'public.canary_heartbeat()', 'EXECUTE') or has_function_privilege('authenticated', 'public.canary_heartbeat()', 'EXECUTE') then
    raise exception 'FU-notify assertion: canary_heartbeat is executable by anon or authenticated';
  end if;
end $$;
