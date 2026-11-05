-- Operations alert rule: AI calls are failing.
--
-- The SR5 alert engine (20261013005350_sr5_alert_rules_and_operations_wall.sql) already watches every outside service the
-- platform depends on for money or for reaching a person: Paystack webhooks, Zoom webhooks and joins, notification sends,
-- scheduled jobs. The one outside service with no rule was the AI vendor. Every AI feature has a non-AI fallback (manual entry,
-- the cautious reply, the clinician writes the note), so an AI outage does not stop care, which is exactly why it can go unseen:
-- a revoked or missing API key, a retired model id or a vendor outage looks, from the outside, like "the draft did not appear".
-- In September four coach turns failed with "Anthropic API key not found" and nobody was told.
--
-- What counts, from ai_interaction_log over the window, grouped by the AI system's vendor (Anthropic, Voyage AI, the in-house
-- ML service):
--   reached the model: status completed or blocked (a guardrail block is the model answering, then being suppressed);
--   failed:            status failed, or status fallback WITH an error_message. The second is the degraded path (the call site
--                      caught its own model failure and answered cautiously; run-governed.ts records the reason as error_message).
--   not counted:       a fallback with no error_message: the kill switch, an unregistered system, governance unreadable. Those
--                      are decisions, not vendor failures, and already have their own record and owner.
-- Test subjects are excluded unless the evaluator is run with p_include_test, the same as every other database rule.
--
-- Severity sev3: tell the on-call contact once on its channels, no incident and no reminders, because a fallback is running and
-- no patient is left without care. The thresholds (3 calls, 25 percent, 60 minutes) are PROPOSED and mirrored in
-- packages/shared/src/proposed-config/registry.ts (ops.alert_rules); a test fails if the two drift. Volume today is low, so the
-- minimum is small on purpose: three failed calls in an hour with none succeeding is a real outage at this scale.

create or replace function private.ops_check_ai_call_failures(p jsonb, p_test boolean)
returns table(dedup_key text, detail jsonb)
language sql
stable
security definer
set search_path to ''
as $$
  with w as (
    select coalesce(v.name, 'Unknown vendor') as vendor,
           count(*) filter (where l.status in ('completed', 'blocked')) as reached,
           count(*) filter (where l.status = 'failed' or (l.status = 'fallback' and l.error_message is not null)) as failed
      from public.ai_interaction_log l
      join public.ai_systems s on s.id = l.ai_system_id
      left join public.ai_vendors v on v.id = s.vendor_id
      left join public.profiles sp on sp.id = l.subject_profile_id
     where l.created_at > now() - make_interval(mins => coalesce((p ->> 'window_minutes')::integer, 60))
       and (p_test or not coalesce(sp.is_test, false))
     group by 1
  )
  select 'vendor:' || vendor,
         jsonb_build_object('vendor', vendor, 'reached_model', reached, 'failed', failed,
                            'failed_percent', round(100.0 * failed / nullif(reached + failed, 0), 1))
    from w
   where reached + failed >= coalesce((p ->> 'min_volume')::integer, 3)
     and 100.0 * failed / nullif(reached + failed, 0) > coalesce((p ->> 'max_failed_percent')::numeric, 25);
$$;

comment on function private.ops_check_ai_call_failures(jsonb, boolean) is
  'Ops alert check: share of AI calls per vendor that failed (status failed, or a degraded fallback carrying an error) in the window. Kill-switch fallbacks are not failures.';

-- anon and PUBLIC execute nothing here (anon inherits EXECUTE through PUBLIC, so the revoke must name PUBLIC)
revoke all on function private.ops_check_ai_call_failures(jsonb, boolean) from public, anon, authenticated;

-- ops-alert-rules-begin
insert into public.ops_alert_rules (code, title, severity, source, enabled, params, min_interval_seconds, renotify_minutes, open_incident, off_reason) values
  ('ai_call_failures', 'AI calls are failing (the non-AI fallback is running)', 'sev3', 'database', true, '{"window_minutes": 60, "min_volume": 3, "max_failed_percent": 25}'::jsonb, 300, 240, false, null)
on conflict (code) do nothing;
-- ops-alert-rules-end

do $$
begin
  if to_regproc('private.ops_check_ai_call_failures') is null then
    raise exception 'ops_check_ai_call_failures is missing';
  end if;
  if not exists (select 1 from public.ops_alert_rules where code = 'ai_call_failures' and enabled and severity = 'sev3') then
    raise exception 'the ai_call_failures rule is missing or not as seeded';
  end if;
  if has_function_privilege('anon', 'private.ops_check_ai_call_failures(jsonb,boolean)', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.ops_check_ai_call_failures(jsonb,boolean)', 'EXECUTE') then
    raise exception 'ops_check_ai_call_failures must not be executable by anon or authenticated';
  end if;
end $$;
