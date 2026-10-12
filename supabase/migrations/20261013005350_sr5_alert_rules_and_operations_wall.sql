-- SR5: alert rules, the evaluator, the on-call contact list and the operations wall.
-- Plan: docs/plans/SCALE-READINESS-PLAN.md section 3 (Phase 3). Extends, does not replace: ops_incidents (register), pages and
-- paging_overview (S19), queue_health (S16), rota_gaps (S18), ops_system_health (module 30.19), event_bus_health (S10).
--
-- NOT APPLIED to any project by this branch. Thresholds below are PROPOSED (registry key ops.alert_rules, owner Founder).
-- Measured on 2026-10-12 against a local replay: see docs/design/load-results/ for the evaluator cost.
--
-- Design:
--  * ops_alert_rules: one row per rule (data, not code): severity, on/off, thresholds, how often to evaluate, how often to remind.
--  * Each rule has a check function private.ops_check_<code>(params, include_test) returning the rows that are breaching NOW
--    (dedup_key + neutral numeric detail, never a patient reference or a reading).
--  * private.ops_evaluate_alerts() runs every minute (pg_cron). A new breach opens ONE alert (and one incident) and tells the
--    on-call contacts; a continuing breach is quiet apart from a reminder every renotify_minutes for sev1 and sev2; a breach that
--    has been clear on two evaluations in a row resolves and sends one quiet in-app "all clear". A rule whose check fails opens an
--    incident instead of staying silent. A rule with no feed (external signals) ships OFF and says so on the wall.
--  * Contacts: ops_oncall_contacts (push, email, in-app only; SMS is deliberately not a channel here, it stays on the paging path).
--    With no contact configured the active admins are told and a sev1 incident says the list is empty.
--  * public.operations_wall(): one aggregate answer for the screen. No patient reference in it.
--  * Test rows (is_test) are excluded everywhere (INV-13) unless the evaluator is called with p_include_test (local load runs only).

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------
create table public.ops_alert_rules (
  code               text primary key check (code ~ '^[a-z][a-z0-9_]*$'),
  title              text not null,
  severity           public.ops_incident_severity not null,
  source             text not null check (source in ('database', 'external')),
  enabled            boolean not null default true,
  params             jsonb not null default '{}'::jsonb,
  min_interval_seconds integer not null default 60 check (min_interval_seconds between 15 and 86400),
  renotify_minutes   integer not null default 30 check (renotify_minutes between 5 and 1440),
  open_incident      boolean not null default true,
  off_reason         text,
  last_evaluated_at  timestamptz,
  last_error         text,
  last_error_at      timestamptz,
  updated_at         timestamptz not null default now(),
  check (enabled or off_reason is not null)
);

create table public.ops_oncall_contacts (
  id            uuid primary key default gen_random_uuid(),
  profile_id    uuid not null references public.profiles (id) on delete cascade,
  channels      text[] not null default array['push', 'email'] check (channels <@ array['push', 'email', 'in_app'] and cardinality(channels) > 0),
  min_severity  public.ops_incident_severity not null default 'sev2',
  delay_minutes integer not null default 0 check (delay_minutes between 0 and 240),
  is_active     boolean not null default true,
  created_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  unique (profile_id)
);

create table public.ops_alerts (
  id               uuid primary key default gen_random_uuid(),
  rule_code        text not null references public.ops_alert_rules (code),
  dedup_key        text not null,
  state            text not null default 'open' check (state in ('open', 'resolved')),
  severity         public.ops_incident_severity not null,
  first_seen_at    timestamptz not null default now(),
  last_seen_at     timestamptz not null default now(),
  last_notified_at timestamptz,
  notify_count     integer not null default 0,
  notified_contacts uuid[] not null default '{}',
  clean_streak     integer not null default 0,
  resolved_at      timestamptz,
  detail           jsonb not null default '{}'::jsonb,
  is_test          boolean not null default false,
  created_at       timestamptz not null default now()
);
create unique index ops_alerts_one_open on public.ops_alerts (rule_code, dedup_key) where state = 'open';
create index ops_alerts_open_idx on public.ops_alerts (severity, first_seen_at) where state = 'open';

-- Signals fed from outside the database (edge function error rate, deployed-vs-source drift, spend). Service role writes.
create table public.ops_signals (
  key         text primary key,
  value       numeric not null,
  note        text,
  observed_at timestamptz not null default now()
);

alter table public.ops_alert_rules enable row level security;
alter table public.ops_oncall_contacts enable row level security;
alter table public.ops_alerts enable row level security;
alter table public.ops_signals enable row level security;

create policy ops_alert_rules_read on public.ops_alert_rules for select to authenticated using (private.can_view_ops_console());
create policy ops_oncall_contacts_read on public.ops_oncall_contacts for select to authenticated using (private.can_view_ops_console());
create policy ops_alerts_read on public.ops_alerts for select to authenticated using (private.can_view_ops_console() and not is_test);
create policy ops_signals_read on public.ops_signals for select to authenticated using (private.can_view_ops_console());

revoke all on public.ops_alert_rules, public.ops_oncall_contacts, public.ops_alerts, public.ops_signals from public, anon, authenticated;
grant select on public.ops_alert_rules, public.ops_oncall_contacts, public.ops_alerts, public.ops_signals to authenticated;

-- ---------------------------------------------------------------------------
-- 2. The rules (PROPOSED numbers; mirrored by the registry key ops.alert_rules and a drift test)
-- ---------------------------------------------------------------------------
-- ops-alert-rules-begin
insert into public.ops_alert_rules (code, title, severity, source, enabled, params, min_interval_seconds, renotify_minutes, off_reason) values
  ('unacknowledged_page',       'A red-event page is unacknowledged past its first step', 'sev1', 'database', true,  '{}'::jsonb, 60, 5, null),
  ('queue_starvation',          'Open tasks are past their due time',                      'sev2', 'database', true,  '{"grace_minutes": 0}'::jsonb, 60, 30, null),
  ('rota_gap_12h',              'Nobody is on call for part of the next 12 hours',         'sev1', 'database', true,  '{"hours": 12}'::jsonb, 300, 60, null),
  ('notification_failure_rate', 'Notification sends are failing',                          'sev2', 'database', true,  '{"window_minutes": 15, "max_failure_percent": 2, "min_volume": 20, "stuck_pending_minutes": 10}'::jsonb, 60, 30, null),
  ('payment_webhooks_unprocessed', 'Payment webhooks are not being processed',             'sev2', 'database', true,  '{"older_than_minutes": 5, "errored_window_minutes": 60}'::jsonb, 60, 30, null),
  ('zoom_webhooks_unprocessed', 'Zoom webhooks are not being processed',                   'sev2', 'database', true,  '{"older_than_minutes": 5, "errored_window_minutes": 60}'::jsonb, 60, 30, null),
  ('db_connections',            'Database connections are above the safe share of the limit', 'sev2', 'database', true, '{"max_percent": 70}'::jsonb, 60, 30, null),
  ('db_disk',                   'Database size is above the safe share of its disk',       'sev2', 'database', true,  '{"max_percent": 70, "disk_limit_bytes": 8589934592}'::jsonb, 3600, 720, null),
  ('stale_cron',                'A scheduled job has stopped succeeding',                  'sev2', 'database', true,  '{"lookback_hours": 72, "factor": 2, "min_slack_minutes": 2}'::jsonb, 300, 60, null),
  ('lab_result_unreviewed',     'A held lab result is unreviewed past the target',         'sev2', 'database', true,  '{"review_target_hours": 24}'::jsonb, 600, 240, null),
  ('zoom_join_fallback',        'Consultation joins are failing or falling back to phone', 'sev2', 'database', true,  '{"window_minutes": 60, "min_volume": 20, "max_failed_percent": 3, "max_fallback_percent": 10}'::jsonb, 300, 60, null),
  ('edge_function_errors',      'Edge function error rate is high',                        'sev2', 'external', false, '{"signal": "edge_error_rate_percent", "max_value": 1, "max_age_minutes": 15}'::jsonb, 60, 30, 'No feed yet: the error rate must be written by a monitor through ops_record_signal. Off, not green.'),
  ('edge_function_drift',       'A deployed edge function differs from source',            'sev2', 'external', false, '{"signal": "edge_drift_count", "max_value": 0, "max_age_minutes": 480}'::jsonb, 300, 240, 'No feed yet: the release-integrity edge-drift job does not write its result here. Off, not green.'),
  ('cost_projection',           'Monthly spend projection is above budget',                'sev3', 'external', false, '{"signal": "cost_projection_percent_of_budget", "max_value": 100, "max_age_minutes": 1440}'::jsonb, 3600, 1440, 'Placeholder: no budget and no spend feed exist yet (plan section 5, decision 4).');
-- ops-alert-rules-end

-- ---------------------------------------------------------------------------
-- 3. Check functions. Each returns the rows breaching now; none returns a patient reference or a clinical value.
-- ---------------------------------------------------------------------------
create function private.ops_check_unacknowledged_page(p jsonb, p_test boolean) returns table (dedup_key text, detail jsonb)
language sql stable security definer set search_path = ''
as $$
  select r.id::text, jsonb_build_object('minutes_waiting', extract(epoch from now() - r.sent_at)::integer / 60, 'no_cover', r.no_cover)
    from public.pages r
   where r.parent_page_id is null and r.closed_at is null and r.acknowledged_at is null
     and (p_test or not r.is_test)
     and r.sent_at < now() - make_interval(mins => coalesce((private.paging_rule('escalation_minutes') ->> 0)::integer, 5));
$$;

create function private.ops_check_queue_starvation(p jsonb, p_test boolean) returns table (dedup_key text, detail jsonb)
language sql stable security definer set search_path = ''
as $$
  select 'class:' || t.priority_class, jsonb_build_object('priority_class', t.priority_class, 'overdue', count(*),
           'oldest_overdue_minutes', (extract(epoch from now() - min(t.due_at)) / 60)::integer)
    from public.clinical_tasks t
   where t.state in ('open', 'offered_to_lead', 'escalated') and (p_test or not t.is_test)
     and t.due_at < now() - make_interval(mins => coalesce((p ->> 'grace_minutes')::integer, 0))
   group by t.priority_class;
$$;

create function private.ops_check_rota_gap_12h(p jsonb, p_test boolean) returns table (dedup_key text, detail jsonb)
language sql stable security definer set search_path = ''
as $$
  select o.id::text || ':' || to_char(g.gap_start at time zone 'utc', 'YYYYMMDDHH24MI'),
         jsonb_build_object('gap_start', g.gap_start, 'gap_end', g.gap_end, 'hours', round(extract(epoch from g.gap_end - g.gap_start) / 3600.0, 1))
    from public.organisations o
    cross join lateral private.rota_gaps(o.id, now(), now() + make_interval(hours => coalesce((p ->> 'hours')::integer, 12))) g
   where exists (select 1 from public.clinical_staff cs where cs.organisation_id = o.id and cs.active and cs.status = 'active' and (p_test or not cs.is_test));
$$;

create function private.ops_check_notification_failure_rate(p jsonb, p_test boolean) returns table (dedup_key text, detail jsonb)
language sql stable security definer set search_path = ''
as $$
  with w as (
    select n.channel::text ch,
           count(*) filter (where n.status = 'sent') sent,
           count(*) filter (where n.status = 'failed') failed,
           count(*) filter (where n.status = 'pending' and n.created_at < now() - make_interval(mins => coalesce((p ->> 'stuck_pending_minutes')::integer, 10))) stuck
      from public.notifications n join public.profiles rp on rp.id = n.recipient_id
     where n.created_at > now() - make_interval(mins => coalesce((p ->> 'window_minutes')::integer, 15))
       and (p_test or not rp.is_test)
     group by n.channel
  )
  select 'rate:' || ch, jsonb_build_object('channel', ch, 'sent', sent, 'failed', failed, 'failed_percent', round(100.0 * failed / nullif(sent + failed, 0), 1))
    from w where sent + failed >= coalesce((p ->> 'min_volume')::integer, 20) and 100.0 * failed / nullif(sent + failed, 0) > coalesce((p ->> 'max_failure_percent')::numeric, 2)
  union all
  select 'silent:' || ch, jsonb_build_object('channel', ch, 'stuck_pending', stuck, 'sent', sent)
    from w where sent = 0 and stuck >= coalesce((p ->> 'min_volume')::integer, 20) / 4;
$$;

create function private.ops_check_payment_webhooks_unprocessed(p jsonb, p_test boolean) returns table (dedup_key text, detail jsonb)
language sql stable security definer set search_path = ''
as $$
  select 'unprocessed', jsonb_build_object('count', count(*), 'oldest_minutes', (extract(epoch from now() - min(created_at)) / 60)::integer)
    from public.payment_transactions
   where processed_at is null and created_at < now() - make_interval(mins => coalesce((p ->> 'older_than_minutes')::integer, 5))
  having count(*) > 0
  union all
  select 'errored', jsonb_build_object('count', count(*))
    from public.payment_transactions
   where error is not null and created_at > now() - make_interval(mins => coalesce((p ->> 'errored_window_minutes')::integer, 60))
  having count(*) > 0;
$$;

create function private.ops_check_zoom_webhooks_unprocessed(p jsonb, p_test boolean) returns table (dedup_key text, detail jsonb)
language sql stable security definer set search_path = ''
as $$
  select 'unprocessed', jsonb_build_object('count', count(*), 'oldest_minutes', (extract(epoch from now() - min(created_at)) / 60)::integer)
    from public.zoom_webhook_events
   where processed_at is null and created_at < now() - make_interval(mins => coalesce((p ->> 'older_than_minutes')::integer, 5))
  having count(*) > 0
  union all
  select 'errored', jsonb_build_object('count', count(*))
    from public.zoom_webhook_events
   where error is not null and created_at > now() - make_interval(mins => coalesce((p ->> 'errored_window_minutes')::integer, 60))
  having count(*) > 0;
$$;

create function private.ops_check_db_connections(p jsonb, p_test boolean) returns table (dedup_key text, detail jsonb)
language sql stable security definer set search_path = ''
as $$
  select 'connections', jsonb_build_object('in_use', c.n, 'limit', m.v, 'percent', round(100.0 * c.n / m.v, 1))
    from (select count(*)::integer n from pg_stat_activity where backend_type = 'client backend') c,
         (select setting::integer v from pg_settings where name = 'max_connections') m
   where 100.0 * c.n / m.v > coalesce((p ->> 'max_percent')::numeric, 70);
$$;

create function private.ops_check_db_disk(p jsonb, p_test boolean) returns table (dedup_key text, detail jsonb)
language sql stable security definer set search_path = ''
as $$
  select 'disk', jsonb_build_object('bytes', s.b, 'limit_bytes', (p ->> 'disk_limit_bytes')::bigint, 'percent', round(100.0 * s.b / (p ->> 'disk_limit_bytes')::bigint, 1))
    from (select pg_database_size(current_database()) b) s
   where (p ->> 'disk_limit_bytes') is not null and 100.0 * s.b / (p ->> 'disk_limit_bytes')::bigint > coalesce((p ->> 'max_percent')::numeric, 70);
$$;

-- The expected gap between runs, from the schedule text. Null when the shape is not recognised (such a job is counted, not checked).
create function private.ops_cron_expected_interval(p_schedule text) returns interval
language sql immutable set search_path = ''
as $$
  select case
    when p_schedule ~ '^\d+ seconds?$' then make_interval(secs => (regexp_match(p_schedule, '^(\d+)'))[1]::integer)
    when p_schedule = '* * * * *' then interval '1 minute'
    when p_schedule ~ '^\*/\d+ \* \* \* \*$' then make_interval(mins => (regexp_match(p_schedule, '^\*/(\d+)'))[1]::integer)
    when p_schedule ~ '^[\d,]+ \* \* \* \*$' then interval '1 hour'
    when p_schedule ~ '^[\d,]+ \*/\d+ \* \* \*$' then make_interval(hours => (regexp_match(p_schedule, '\*/(\d+)'))[1]::integer)
    when p_schedule ~ '^[\d,]+ [\d,]+ \* \* \*$' then interval '1 day'
    else null
  end
$$;

create function private.ops_check_stale_cron(p jsonb, p_test boolean) returns table (dedup_key text, detail jsonb)
language sql stable security definer set search_path = ''
as $$
  with runs as (
    select d.jobid, max(d.end_time) filter (where d.status = 'succeeded') last_ok, count(*) n
      from cron.job_run_details d
     where d.start_time > now() - make_interval(hours => coalesce((p ->> 'lookback_hours')::integer, 72))
     group by d.jobid
  )
  select 'job:' || j.jobname, jsonb_build_object('job', j.jobname, 'schedule', j.schedule,
           'minutes_since_success', case when r.last_ok is null then null else (extract(epoch from now() - r.last_ok) / 60)::integer end)
    from cron.job j
    join runs r on r.jobid = j.jobid
   where j.active and j.jobname is not null
     and private.ops_cron_expected_interval(j.schedule) is not null
     and coalesce(r.last_ok, '-infinity'::timestamptz)
         < now() - greatest(private.ops_cron_expected_interval(j.schedule) * coalesce((p ->> 'factor')::numeric, 2),
                            make_interval(mins => coalesce((p ->> 'min_slack_minutes')::integer, 2)));
$$;

create function private.ops_check_lab_result_unreviewed(p jsonb, p_test boolean) returns table (dedup_key text, detail jsonb)
language sql stable security definer set search_path = ''
as $$
  select 'held', jsonb_build_object('count', count(*), 'oldest_hours', (extract(epoch from now() - min(received_at)) / 3600)::integer)
    from public.lab_results
   where release_state in ('awaiting_review', 'clinician_disclosure_required') and superseded_by is null and (p_test or not is_test)
     and received_at < now() - make_interval(hours => coalesce((p ->> 'review_target_hours')::integer, 24))
  having count(*) > 0;
$$;

create function private.ops_check_zoom_join_fallback(p jsonb, p_test boolean) returns table (dedup_key text, detail jsonb)
language sql stable security definer set search_path = ''
as $$
  with e as (
    select count(*) total,
           count(*) filter (where status in ('failed', 'no_show_clinician')) failed,
           count(*) filter (where final_media_mode is not null and final_media_mode <> 'video' and type = 'video') fell_back
      from public.encounters
     where type = 'video' and created_at > now() - make_interval(mins => coalesce((p ->> 'window_minutes')::integer, 60)) and (p_test or not is_test)
  )
  select 'failed', jsonb_build_object('total', total, 'failed', failed, 'percent', round(100.0 * failed / total, 1))
    from e where total >= coalesce((p ->> 'min_volume')::integer, 20) and 100.0 * failed / total > coalesce((p ->> 'max_failed_percent')::numeric, 3)
  union all
  select 'fallback', jsonb_build_object('total', total, 'fell_back', fell_back, 'percent', round(100.0 * fell_back / total, 1))
    from e where total >= coalesce((p ->> 'min_volume')::integer, 20) and 100.0 * fell_back / total > coalesce((p ->> 'max_fallback_percent')::numeric, 10);
$$;

-- External rules: value from ops_signals. A missing or stale signal is itself a breach once the rule is switched on.
create function private.ops_check_signal(p jsonb, p_test boolean) returns table (dedup_key text, detail jsonb)
language sql stable security definer set search_path = ''
as $$
  select 'signal_stale', jsonb_build_object('signal', p ->> 'signal', 'age_minutes', (extract(epoch from now() - s.observed_at) / 60)::integer)
    from (select 1) x left join public.ops_signals s on s.key = p ->> 'signal'
   where s.key is null or s.observed_at < now() - make_interval(mins => coalesce((p ->> 'max_age_minutes')::integer, 60))
  union all
  select 'value', jsonb_build_object('signal', s.key, 'value', s.value, 'max', (p ->> 'max_value')::numeric)
    from public.ops_signals s
   where s.key = p ->> 'signal' and s.value > (p ->> 'max_value')::numeric
     and s.observed_at >= now() - make_interval(mins => coalesce((p ->> 'max_age_minutes')::integer, 60));
$$;
create function private.ops_check_edge_function_errors(p jsonb, p_test boolean) returns table (dedup_key text, detail jsonb)
language sql stable security definer set search_path = '' as $$ select * from private.ops_check_signal(p, p_test) $$;
create function private.ops_check_edge_function_drift(p jsonb, p_test boolean) returns table (dedup_key text, detail jsonb)
language sql stable security definer set search_path = '' as $$ select * from private.ops_check_signal(p, p_test) $$;
create function private.ops_check_cost_projection(p jsonb, p_test boolean) returns table (dedup_key text, detail jsonb)
language sql stable security definer set search_path = '' as $$ select * from private.ops_check_signal(p, p_test) $$;

-- ---------------------------------------------------------------------------
-- 4. Routing
-- ---------------------------------------------------------------------------
create function private.ops_sev_rank(s public.ops_incident_severity) returns integer
language sql immutable set search_path = '' as $$ select case s when 'sev1' then 1 when 'sev2' then 2 when 'sev3' then 3 else 4 end $$;

-- Opens or refreshes ONE incident per (rule, key). Never duplicates.
create function private.ops_alert_incident(p_ref text, p_title text, p_summary text, p_sev public.ops_incident_severity) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if exists (select 1 from public.ops_incidents where external_reference = p_ref and status not in ('resolved', 'closed')) then
    update public.ops_incidents set summary = p_summary where external_reference = p_ref and status not in ('resolved', 'closed');
  else
    insert into public.ops_incidents (organisation_id, category, severity, title, summary, external_reference, ack_due_at, resolve_due_at)
    values (null, 'technical', p_sev, left(p_title, 200), p_summary, p_ref, now(), now());
  end if;
end;
$$;

-- Tells the contacts. kind: raised (contacts not yet told), reminder (everyone eligible again), clear (in-app only, those told).
-- Returns how many contacts were told. With no contacts configured the active admins are told and a sev1 incident says so.
create function private.ops_alert_notify(p_alert public.ops_alerts, p_kind text) returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  c record; ch text; n integer := 0; v_age integer := extract(epoch from now() - p_alert.first_seen_at)::integer / 60;
  v_template text := case when p_kind = 'clear' then 'ops_all_clear' else 'ops_alert' end;
  v_have_contacts boolean := exists (select 1 from public.ops_oncall_contacts where is_active);
  v_ids uuid[] := '{}';
begin
  for c in
    select k.id contact_id, k.profile_id, k.channels, pr.organisation_id
      from public.ops_oncall_contacts k join public.profiles pr on pr.id = k.profile_id
     where v_have_contacts and k.is_active and pr.is_active
       and private.ops_sev_rank(p_alert.severity) <= private.ops_sev_rank(k.min_severity)
       and (p_kind = 'clear' and k.id = any (p_alert.notified_contacts)
            or p_kind <> 'clear' and v_age >= k.delay_minutes and (p_kind = 'reminder' or not k.id = any (p_alert.notified_contacts)))
    union all
    select null, pr.id, array['push', 'email', 'in_app'], pr.organisation_id
      from public.profiles pr
     where not v_have_contacts and pr.role = 'admin' and pr.is_active and not pr.is_test and p_kind <> 'clear'
  loop
    foreach ch in array case when p_kind = 'clear' then array['in_app'] else c.channels end loop
      insert into public.notifications (recipient_id, organisation_id, channel, template, payload, status, content_class, priority, source_table, source_id)
      values (c.profile_id, c.organisation_id, ch::public.notification_channel, v_template,
              jsonb_build_object('alert_id', p_alert.id, 'rule', p_alert.rule_code, 'severity', p_alert.severity),
              'pending', 'non_clinical', (case when p_alert.severity = 'sev1' then 'critical' else 'routine' end)::public.notification_priority, 'ops_alerts', p_alert.id);
    end loop;
    if c.contact_id is not null then v_ids := v_ids || c.contact_id; end if;
    n := n + 1;
  end loop;
  if p_kind <> 'clear' then
    update public.ops_alerts set last_notified_at = now(), notify_count = notify_count + 1,
           notified_contacts = (select coalesce(array_agg(distinct x), '{}') from unnest(notified_contacts || v_ids) x)
     where id = p_alert.id;
    if not v_have_contacts then
      perform private.ops_alert_incident('ops_alerts_no_contacts', 'Operations alerts have nobody configured to receive them',
        'An alert fired and the on-call contact list is empty, so the active admins were told instead. Add contacts in the operations wall settings.', 'sev1');
    end if;
  end if;
  return n;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. The evaluator
-- ---------------------------------------------------------------------------
create function private.ops_evaluate_alerts(p_include_test boolean default false, p_force boolean default false) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  r public.ops_alert_rules; b record; a public.ops_alerts; v_keys text[];
  v_raised integer := 0; v_reminded integer := 0; v_cleared integer := 0; v_failed integer := 0; v_evaluated integer := 0;
  v_title text;
begin
  for r in select * from public.ops_alert_rules where enabled order by code loop
    continue when not p_force and r.last_evaluated_at is not null and r.last_evaluated_at > now() - make_interval(secs => r.min_interval_seconds);
    begin
      v_keys := '{}';
      for b in execute format('select dedup_key, detail from private.%I($1, $2)', 'ops_check_' || r.code) using r.params, p_include_test loop
        v_keys := v_keys || b.dedup_key;
        select * into a from public.ops_alerts where rule_code = r.code and dedup_key = b.dedup_key and state = 'open';
        if not found then
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
          perform private.ops_alert_notify(a, 'clear');
          v_cleared := v_cleared + 1;
        else
          update public.ops_alerts set clean_streak = a.clean_streak + 1 where id = a.id;
        end if;
      end loop;
      update public.ops_alert_rules set last_evaluated_at = now(), last_error = null where code = r.code;
      v_evaluated := v_evaluated + 1;
    exception when others then
      v_failed := v_failed + 1;
      update public.ops_alert_rules set last_evaluated_at = now(), last_error = left(sqlerrm, 300), last_error_at = now() where code = r.code;
      perform private.ops_alert_incident('ops_rule_failed:' || r.code, 'Alert rule ' || r.code || ' could not be evaluated',
        'The check raised: ' || left(sqlerrm, 300) || '. Until it is fixed this rule is blind.', 'sev2');
    end;
  end loop;
  return jsonb_build_object('evaluated', v_evaluated, 'raised', v_raised, 'reminded', v_reminded, 'cleared', v_cleared, 'failed', v_failed);
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Admin functions (admin only, audited) and the feed for external signals (service role only)
-- ---------------------------------------------------------------------------
create function public.ops_set_alert_rule(p_code text, p_enabled boolean, p_params jsonb default null, p_off_reason text default null) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not private.is_admin() then raise exception 'not authorised' using errcode = '42501'; end if;
  if not p_enabled and coalesce(btrim(p_off_reason), '') = '' then raise exception 'a rule switched off needs a reason' using errcode = '22023'; end if;
  update public.ops_alert_rules set enabled = p_enabled, params = coalesce(p_params, params), off_reason = case when p_enabled then null else btrim(p_off_reason) end, updated_at = now()
   where code = p_code;
  if not found then raise exception 'no such rule' using errcode = '22023'; end if;
  perform private.log_audit('ops_alert_rule.changed', 'ops_alert_rules', null, jsonb_build_object('code', p_code, 'enabled', p_enabled));
end;
$$;

create function public.ops_set_oncall_contact(p_profile uuid, p_channels text[], p_min_severity public.ops_incident_severity default 'sev2', p_delay_minutes integer default 0, p_active boolean default true) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_id uuid;
begin
  if not private.is_admin() then raise exception 'not authorised' using errcode = '42501'; end if;
  if not exists (select 1 from public.profiles where id = p_profile and is_active and role in ('admin', 'clinician')) then
    raise exception 'a contact must be an active admin or clinician account' using errcode = '22023';
  end if;
  insert into public.ops_oncall_contacts (profile_id, channels, min_severity, delay_minutes, is_active, created_by)
  values (p_profile, p_channels, p_min_severity, p_delay_minutes, p_active, (select auth.uid()))
  on conflict (profile_id) do update set channels = excluded.channels, min_severity = excluded.min_severity, delay_minutes = excluded.delay_minutes, is_active = excluded.is_active
  returning id into v_id;
  perform private.log_audit('ops_oncall_contact.changed', 'ops_oncall_contacts', v_id, jsonb_build_object('active', p_active));
  return v_id;
end;
$$;

create function public.ops_record_signal(p_key text, p_value numeric, p_note text default null) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if (select auth.role()) is distinct from 'service_role' then raise exception 'not authorised' using errcode = '42501'; end if;
  insert into public.ops_signals (key, value, note, observed_at) values (p_key, p_value, left(p_note, 300), now())
  on conflict (key) do update set value = excluded.value, note = excluded.note, observed_at = excluded.observed_at;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. The operations wall. One aggregate, no patient reference, test rows excluded.
-- ---------------------------------------------------------------------------
create function public.operations_wall() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v jsonb;
begin
  if not private.can_view_ops_console() then raise exception 'not authorised' using errcode = '42501'; end if;
  select jsonb_build_object(
    'generated_at', now(),
    'queue', coalesce((select jsonb_agg(jsonb_build_object('priority_class', priority_class, 'waiting', waiting, 'oldest_minutes', oldest, 'past_due', past_due) order by priority_class)
        from (select t.priority_class, count(*) waiting, (extract(epoch from now() - min(t.created_at)) / 60)::integer oldest, count(*) filter (where t.due_at < now()) past_due
                from public.clinical_tasks t where not t.is_test and t.state in ('open', 'offered_to_lead', 'escalated') group by t.priority_class) q), '[]'::jsonb),
    'tasks_claimed', (select count(*) from public.clinical_tasks where not is_test and state = 'claimed'),
    'pages', (select jsonb_build_object('open', count(*) filter (where closed_at is null),
                 'unacknowledged', count(*) filter (where closed_at is null and acknowledged_at is null),
                 'oldest_unacknowledged_seconds', coalesce(max(extract(epoch from now() - sent_at)::integer) filter (where closed_at is null and acknowledged_at is null), 0),
                 'sent_24h', count(*) filter (where sent_at > now() - interval '24 hours'))
               from public.pages where parent_page_id is null and not is_test),
    'doctors_online', (select count(distinct a.clinician_id) from public.availability_blocks a where not a.is_test and a.kind = 'queue' and a.starts_at <= now() and a.ends_at > now()),
    'on_call_covered', exists (select 1 from public.on_call_rota r where not r.is_test and r.cancelled_at is null and r.starts_at <= now() and r.ends_at > now()),
    'calls_in_progress', (select count(*) from public.encounters where not is_test and status = 'in_progress'),
    'calls_waiting', (select count(*) from public.encounters where not is_test and status = 'waiting'),
    'tests_this_week', jsonb_build_object(
        'orders', (select count(*) from public.lab_orders lo join public.profiles lp on lp.id = lo.patient_id where not lp.is_test and lo.created_at > now() - interval '7 days'),
        'results_received', (select count(*) from public.lab_results where not is_test and received_at > now() - interval '7 days'),
        'results_held', (select count(*) from public.lab_results where not is_test and release_state in ('awaiting_review', 'clinician_disclosure_required') and superseded_by is null)),
    'notifications', coalesce((select jsonb_agg(jsonb_build_object('channel', ch, 'sent', sent, 'failed', failed, 'pending', pending) order by ch)
        from (select n.channel::text ch, count(*) filter (where n.status = 'sent') sent, count(*) filter (where n.status = 'failed') failed,
                     count(*) filter (where n.status = 'pending') pending
                from public.notifications n join public.profiles rp on rp.id = n.recipient_id where not rp.is_test and n.created_at > now() - interval '1 hour' group by n.channel) x), '[]'::jsonb),
    'payments', (select jsonb_build_object('events', count(*), 'processed', count(*) filter (where processed_at is not null), 'unprocessed', count(*) filter (where processed_at is null),
                   'errored', count(*) filter (where error is not null), 'taken_minor', coalesce(sum(amount_minor) filter (where processed_at is not null and error is null), 0))
                 from public.payment_transactions where created_at > now() - interval '1 hour'),
    'alerts', jsonb_build_object(
        'open', coalesce((select jsonb_agg(jsonb_build_object('rule', a.rule_code, 'title', r.title, 'severity', a.severity, 'minutes_open', (extract(epoch from now() - a.first_seen_at) / 60)::integer, 'detail', a.detail)
            order by private.ops_sev_rank(a.severity), a.first_seen_at) from public.ops_alerts a join public.ops_alert_rules r on r.code = a.rule_code where a.state = 'open' and not a.is_test), '[]'::jsonb),
        'rules_on', (select count(*) from public.ops_alert_rules where enabled),
        'rules_off', coalesce((select jsonb_agg(jsonb_build_object('rule', code, 'reason', off_reason)) from public.ops_alert_rules where not enabled), '[]'::jsonb),
        'rules_failing', (select count(*) from public.ops_alert_rules where enabled and last_error is not null),
        'last_evaluated_at', (select max(last_evaluated_at) from public.ops_alert_rules),
        'contacts', (select count(*) from public.ops_oncall_contacts where is_active)),
    'incidents_open', (select jsonb_build_object('sev1', count(*) filter (where severity = 'sev1'), 'sev2', count(*) filter (where severity = 'sev2'))
                         from public.ops_incidents where status not in ('resolved', 'closed'))
  ) into v;
  return v;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Grants. anon and PUBLIC execute nothing here; the revoke is from PUBLIC (anon inherits through it).
-- ---------------------------------------------------------------------------
do $g$
declare f record;
begin
  for f in select p.oid::regprocedure sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where (n.nspname = 'private' and (p.proname like 'ops\_check\_%' or p.proname in ('ops_sev_rank', 'ops_alert_incident', 'ops_alert_notify', 'ops_evaluate_alerts', 'ops_cron_expected_interval'))) or (n.nspname = 'public' and p.proname in ('ops_set_alert_rule', 'ops_set_oncall_contact', 'ops_record_signal', 'operations_wall'))
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
  end loop;
end $g$;
grant execute on function public.operations_wall() to authenticated;
grant execute on function public.ops_set_alert_rule(text, boolean, jsonb, text) to authenticated;
grant execute on function public.ops_set_oncall_contact(uuid, text[], public.ops_incident_severity, integer, boolean) to authenticated;
grant execute on function public.ops_record_signal(text, numeric, text) to service_role;

select cron.schedule('ops-evaluate-alerts', '* * * * *', $$ select private.ops_evaluate_alerts(); $$);

-- Closing self-check.
do $c$
begin
  if (select count(*) from public.ops_alert_rules) <> 14 then raise exception 'SR5: expected 14 rules'; end if;
  if exists (select 1 from public.ops_alert_rules r where not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'private' and p.proname = 'ops_check_' || r.code)) then
    raise exception 'SR5: a rule has no check function';
  end if;
  if has_function_privilege('anon', 'public.operations_wall()', 'EXECUTE') or has_function_privilege('anon', 'public.ops_record_signal(text,numeric,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.ops_record_signal(text,numeric,text)', 'EXECUTE') then
    raise exception 'SR5: a function is executable by a role that must not run it';
  end if;
end $c$;
