-- Operations alert noise controls (founder ask 2026-11-06: "this notification is getting too much").
--
-- Measured live before this migration: ~100 ops_alert sends a day since 2026-11-03 (each one an email AND a push to the single
-- on-call contact), against under 10 a day before. Two rules made almost all of it:
--   * db_connections: the quarter-hour cron burst takes the 60-connection pool to 75-87 percent for a minute or two, the alert
--     resolves four minutes later and the next burst opens a NEW alert, so every burst was a fresh send (173 alerts in 7 days).
--     Highest value ever recorded: 90.0 percent, twice.
--   * zoom_webhooks_unprocessed: four events from the first live consultation (2026-11-03, CON-01, run from a plain Zoom link
--     with no video_consultations row) could never be matched, so one alert stayed open and re-sent every 30 minutes (134 sends).
--
-- What changes:
--   1. The evaluator learns two optional, per-rule params (no new rule, no new gate, no change for any rule that does not set them):
--        raise_after           consecutive breaching evaluations before an alert opens (default 1 = today's behaviour). The
--                              running count per dedup key lives in ops_alert_rules.breach_streaks and is dropped the first time
--                              the key does not breach.
--        reopen_quiet_minutes  if the same rule and key resolved less than this many minutes ago, the old alert is reopened
--                              without a send (default 0 = today's behaviour). Reminders still follow renotify_minutes from the
--                              last send, so a real, lasting problem is still repeated. Its incident reopens with it. Such a
--                              rule posts no in-app all clear when it resolves (that notice would repeat on every flap).
--      Streaks are kept apart for test-mode runs ('test:' keys), so a proof run never resets a live count.
--   2. db_connections: line raised from 70 to 90 percent, raise_after 2, reopen_quiet_minutes 30.
--   3. Reminder interval for the infrastructure sev2 rules goes from 30/60 minutes to 240. Not touched: sev1 rules, queue_starvation
--      (patient tasks past due) and the two security sev2 rules, whose cadence is about people, not plumbing.
--   4. The four orphaned Zoom events are closed with a note saying why (data only; no row exists on a fresh replay).
-- Nothing here changes who is told or on which channel.

-- 1. Engine -------------------------------------------------------------------------------------------------------------------
alter table public.ops_alert_rules add column if not exists breach_streaks jsonb not null default '{}'::jsonb;
comment on column public.ops_alert_rules.breach_streaks is
  'Evaluator bookkeeping for params.raise_after: consecutive breaching evaluations per dedup key that have not yet opened an alert.';

-- Redefined from the LIVE body (pg_get_functiondef, 2026-11-06); only the raise_after / reopen_quiet_minutes branches are new.
create or replace function private.ops_evaluate_alerts(p_include_test boolean default false, p_force boolean default false)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  r public.ops_alert_rules; b record; a public.ops_alerts; v_keys text[];
  v_raised integer := 0; v_reminded integer := 0; v_cleared integer := 0; v_failed integer := 0; v_evaluated integer := 0;
  v_reopened integer := 0; v_held integer := 0;
  v_title text;
  v_raise_after integer; v_quiet integer; v_streaks jsonb; v_n integer; v_reopen_id uuid; v_prefix text;
begin
  for r in select * from public.ops_alert_rules where enabled order by code loop
    continue when not p_force and r.last_evaluated_at is not null and r.last_evaluated_at > now() - make_interval(secs => r.min_interval_seconds);
    begin
      v_keys := '{}';
      -- streaks are kept per mode: a test-mode run ('test:' keys) never resets a live count, and the reverse
      v_prefix := case when p_include_test then 'test:' else '' end;
      v_streaks := coalesce((select jsonb_object_agg(k, v) from jsonb_each(r.breach_streaks) e(k, v) where (k like 'test:%') <> p_include_test), '{}'::jsonb);
      v_raise_after := greatest(coalesce((r.params ->> 'raise_after')::integer, 1), 1);
      v_quiet := greatest(coalesce((r.params ->> 'reopen_quiet_minutes')::integer, 0), 0);
      for b in execute format('select dedup_key, detail from private.%I($1, $2)', 'ops_check_' || r.code) using r.params, p_include_test loop
        v_keys := v_keys || b.dedup_key;
        select * into a from public.ops_alerts where rule_code = r.code and dedup_key = b.dedup_key and state = 'open';
        if not found then
          -- raise_after: hold the alert until the breach has been seen on enough evaluations in a row
          v_n := coalesce((r.breach_streaks ->> (v_prefix || b.dedup_key))::integer, 0) + 1;
          if v_n < v_raise_after then
            v_streaks := v_streaks || jsonb_build_object(v_prefix || b.dedup_key, v_n);
            v_held := v_held + 1;
            continue;
          end if;
          -- reopen_quiet_minutes: the same alert cleared moments ago, so reopen it rather than send again
          if v_quiet > 0 then
            select x.id into v_reopen_id from public.ops_alerts x
             where x.rule_code = r.code and x.dedup_key = b.dedup_key and x.state = 'resolved' and x.is_test = p_include_test
               and x.resolved_at > now() - make_interval(mins => v_quiet)
             order by x.resolved_at desc limit 1;
            if v_reopen_id is not null then
              update public.ops_alerts set state = 'open', resolved_at = null, clean_streak = 0, last_seen_at = now(), detail = b.detail
               where id = v_reopen_id;
              v_reopen_id := null;
              -- no send, but the incident follows the alert (ops_alert_incident reuses an open one or opens a fresh one)
              if r.open_incident and r.severity in ('sev1', 'sev2') then
                perform private.ops_alert_incident('ops_alert:' || r.code || ':' || b.dedup_key, r.title, 'Reopened by the operations alert rule ' || r.code || '. Detail: ' || b.detail::text, r.severity);
              end if;
              v_reopened := v_reopened + 1;
              continue;
            end if;
          end if;
          a := null;
          insert into public.ops_alerts (rule_code, dedup_key, severity, detail, is_test) values (r.code, b.dedup_key, r.severity, b.detail, p_include_test)
          on conflict (rule_code, dedup_key) where state = 'open' do nothing returning * into a;
          if a.id is not null then
            if r.open_incident and r.severity in ('sev1', 'sev2') then
              perform private.ops_alert_incident('ops_alert:' || r.code || ':' || b.dedup_key, r.title, 'Raised by the operations alert rule ' || r.code || '. Detail: ' || b.detail::text, r.severity);
            end if;
            perform private.ops_alert_notify(a, 'raised');
            v_raised := v_raised + 1;
          end if;
        else
          update public.ops_alerts set last_seen_at = now(), clean_streak = 0, detail = b.detail where id = a.id returning * into a;
          if r.severity in ('sev1', 'sev2') and a.last_notified_at < now() - make_interval(mins => r.renotify_minutes) then
            perform private.ops_alert_notify(a, 'reminder');
            v_reminded := v_reminded + 1;
          end if;
        end if;
      end loop;
      -- anything open that did not breach this time: count a clean evaluation, resolve after two in a row, say so once, quietly
      for a in select * from public.ops_alerts where rule_code = r.code and state = 'open' and not dedup_key = any (v_keys) loop
        if a.clean_streak + 1 >= 2 then
          update public.ops_alerts set state = 'resolved', resolved_at = now(), clean_streak = a.clean_streak + 1 where id = a.id;
          -- a rule that reopens quietly would otherwise post an in-app all clear on every flap; its state is on the wall
          if v_quiet = 0 then
            perform private.ops_alert_notify(a, 'clear');
          end if;
          v_cleared := v_cleared + 1;
        else
          update public.ops_alerts set clean_streak = a.clean_streak + 1 where id = a.id;
        end if;
      end loop;
      update public.ops_alert_rules set last_evaluated_at = now(), last_error = null, breach_streaks = v_streaks where code = r.code;
      v_evaluated := v_evaluated + 1;
    exception when others then
      v_failed := v_failed + 1;
      update public.ops_alert_rules set last_evaluated_at = now(), last_error = left(sqlerrm, 300), last_error_at = now() where code = r.code;
      perform private.ops_alert_incident('ops_rule_failed:' || r.code, 'Alert rule ' || r.code || ' could not be evaluated',
        'The check raised: ' || left(sqlerrm, 300) || '. Until it is fixed this rule is blind.', 'sev2');
    end;
  end loop;
  return jsonb_build_object('evaluated', v_evaluated, 'raised', v_raised, 'reminded', v_reminded, 'cleared', v_cleared, 'failed', v_failed,
                            'held', v_held, 'reopened', v_reopened);
end;
$function$;

revoke all on function private.ops_evaluate_alerts(boolean, boolean) from public, anon, authenticated;

-- 2. db_connections line (seed markers keep the registry mirror test honest) --------------------------------------------------
-- ops-alert-rules-begin
insert into public.ops_alert_rules (code, title, severity, source, enabled, params, min_interval_seconds, renotify_minutes, off_reason) values
  ('db_connections',            'Database connections are above the safe share of the limit', 'sev2', 'database', true, '{"max_percent": 90, "raise_after": 2, "reopen_quiet_minutes": 30}'::jsonb, 60, 240, null)
on conflict (code) do update set params = excluded.params, renotify_minutes = excluded.renotify_minutes, updated_at = now();
-- ops-alert-rules-end

-- 3. Slower reminders for the infrastructure sev2 rules ----------------------------------------------------------------------
update public.ops_alert_rules set renotify_minutes = 240, updated_at = now()
 where code in ('notification_failure_rate', 'payment_webhooks_unprocessed', 'zoom_webhooks_unprocessed', 'stale_cron',
                'zoom_join_fallback', 'edge_function_errors')
   and renotify_minutes < 240;

-- 4. The four orphaned Zoom events from 2026-11-03 ---------------------------------------------------------------------------
update public.zoom_webhook_events
   set processed_at = now(),
       error = error || ' | closed by hand 2026-11-06: meeting run from a plain Zoom link (CON-01), there is no booking to match'
 where processed_at is null and error = 'no video_consultations row with zoom_meeting_id=88074609614';

-- 5. Self-check ---------------------------------------------------------------------------------------------------------------
do $$
begin
  assert (select params from public.ops_alert_rules where code = 'db_connections') = '{"max_percent": 90, "raise_after": 2, "reopen_quiet_minutes": 30}'::jsonb,
    'db_connections params not updated';
  assert not exists (select 1 from public.ops_alert_rules
                      where code in ('notification_failure_rate', 'payment_webhooks_unprocessed', 'zoom_webhooks_unprocessed', 'stale_cron',
                                     'zoom_join_fallback', 'edge_function_errors', 'db_connections') and renotify_minutes < 240),
    'an infrastructure sev2 rule still reminds faster than every 4 hours';
  assert (select renotify_minutes from public.ops_alert_rules where code = 'queue_starvation') = 30, 'queue_starvation cadence must not change';
  assert not exists (select 1 from public.ops_alert_rules where severity = 'sev1' and renotify_minutes > 60), 'sev1 cadence must not change';
  assert not exists (select 1 from public.zoom_webhook_events where processed_at is null and error like 'no video_consultations row with zoom_meeting_id=88074609614%'),
    'orphaned Zoom events still open';
  assert not has_function_privilege('authenticated', 'private.ops_evaluate_alerts(boolean, boolean)', 'EXECUTE'), 'evaluator executable by authenticated';
  assert not has_function_privilege('anon', 'private.ops_evaluate_alerts(boolean, boolean)', 'EXECUTE'), 'evaluator executable by anon';
end $$;
