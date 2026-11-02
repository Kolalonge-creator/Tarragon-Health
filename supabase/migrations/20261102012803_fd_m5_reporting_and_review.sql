-- Front Desk M5: reporting and review (spec F15 weekly report, F16 transcript-review sampler, dashboard, plus the data they need).
--
-- WHAT THIS ADDS
--   1. The numbers the report and dashboard are made of. Two facts nothing recorded before are recorded now: a conversation's TOPIC
--      (fd_conversations.intent, set from the visitor's words by the web app) and how a conversation ENDED (resolution_type, settled by a sweep:
--      ai_resolved when the assistant answered and no person was needed, abandoned when the visitor wrote and got no answer). Without these
--      the first report would show no topics and 0% resolved.
--   2. The weekly report (F15): generated in the database exactly once per week (unique week_start), Friday 07:30 London. The Edge Function
--      only ever SENDS it. London time is decided in SQL, so British summer time needs no second schedule. Missing the slot is healed for up to
--      24 hours; a stale report is never produced days later.
--   3. The review sampler (F16): every flagged conversation, every handoff, plus a share of the rest chosen by a stable hash of the id (so
--      the same conversation is always in or out; no random state). review_sample_percent = 100 is the pilot's "review everything" (M7).
--      A reviewer marks each ok / wrong / unsafe. An UNSAFE mark opens an incident, and an incident can only be closed by saying what rule was
--      tightened. The rule change itself stays a human act on purpose: nothing here edits approved wording or safety rules by itself.
--   4. The dashboard read model (one admin-only function) and the review list.
--   5. Transcript retention: after transcript_retention_days the messages are deleted and a retained summary stays. This is what makes the
--      12 month promise true; nothing is deleted while a review, an open handoff or an open incident still needs the text.
--
-- NOT BUILT HERE (stated, not hidden): a Sonnet-written narrative (the narrative is rule-based and always produced; an AI narrative needs its own
-- registered AI system and sign-off), the optional Google Drive Word copy, and subject-access/erasure tracking.
--
-- Conversation text stays admin only (M4). The report email carries counts and topic names, never what a visitor wrote.

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 1. Config: how much of the unflagged traffic is reviewed
-- ---------------------------------------------------------------------------------------------------------------------------------
insert into public.fd_app_config (key, value, description) values
  ('review_sample_percent', '10'::jsonb,
   'Share (0 to 100) of ordinary, unflagged conversations put on the review queue. Flagged conversations and handoffs are always reviewed. 100 means review everything (the live pilot).')
on conflict do nothing;

-- The validator is M3's; extend it with the new key (a whole number from 0 to 100; 0 is allowed, unlike the other counters).
create or replace function private.fd_validate_config(p_key text, p_value jsonb) returns void language plpgsql immutable set search_path = '' as $$
declare v_num numeric;
begin
  if p_key in ('assistant_enabled', 'prelaunch_mode', 'followups_enabled', 'followups_dry_run', 'account_followup_basis_confirmed', 'hubspot_enabled') then
    if jsonb_typeof(p_value) <> 'boolean' then raise exception '% must be true or false', p_key; end if;
  elsif p_key = 'review_sample_percent' then
    if jsonb_typeof(p_value) <> 'number' then raise exception '% must be a whole number', p_key; end if;
    v_num := (p_value #>> '{}')::numeric;
    if v_num < 0 or v_num > 100 or v_num <> trunc(v_num) then raise exception '% must be a whole number from 0 to 100', p_key; end if;
  elsif p_key in ('weekly_send_cap', 'stall_minutes', 'inactive_days', 'session_message_cap', 'transcript_retention_days') then
    if jsonb_typeof(p_value) <> 'number' then raise exception '% must be a whole number', p_key; end if;
    v_num := (p_value #>> '{}')::numeric;
    if v_num < 1 or v_num <> trunc(v_num) or v_num > 100000 then raise exception '% must be a whole number from 1 to 100000', p_key; end if;
  elsif p_key = 'daily_model_spend_cap_usd' then
    if jsonb_typeof(p_value) <> 'number' or (p_value #>> '{}')::numeric <= 0 or (p_value #>> '{}')::numeric > 100000 then
      raise exception 'daily_model_spend_cap_usd must be a positive number'; end if;
  elsif p_key = 'launch_date' then
    if jsonb_typeof(p_value) <> 'string' or (p_value #>> '{}') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'launch_date must be YYYY-MM-DD'; end if;
  elsif p_key = 'quiet_hours' then
    if jsonb_typeof(p_value) <> 'object' or coalesce(p_value ->> 'start', '') !~ '^([01]\d|2[0-3]):[0-5]\d$'
       or coalesce(p_value ->> 'end', '') !~ '^([01]\d|2[0-3]):[0-5]\d$' or coalesce(p_value ->> 'timezone', '') = '' then
      raise exception 'quiet_hours needs start and end as HH:MM and a timezone'; end if;
  elsif p_key in ('model_fast', 'model_strong', 'sender_name', 'reply_to') then
    if jsonb_typeof(p_value) <> 'string' or btrim(p_value #>> '{}') = '' then raise exception '% must be non-empty text', p_key; end if;
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 2. Tables: incidents, report delivery state, purge marker
-- ---------------------------------------------------------------------------------------------------------------------------------
create table public.fd_incidents (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null default '00000000-0000-0000-0000-000000000001' references public.organisations (id) on delete restrict,
  -- Both links survive the thing they point at: an incident is a compliance record and outlives a purged or erased conversation.
  review_id       uuid references public.fd_review_queue (id) on delete set null,
  conversation_id uuid references public.fd_conversations (id) on delete set null,
  status          text not null default 'open' check (status in ('open', 'closed')),
  opened_note     text not null check (char_length(opened_note) between 1 and 1000),
  opened_by       uuid references public.profiles (id) on delete restrict,
  opened_at       timestamptz not null default now(),
  rule_change     text check (rule_change is null or char_length(rule_change) between 10 and 1000),
  closed_by       uuid references public.profiles (id) on delete restrict,
  closed_at       timestamptz,
  check ((status = 'closed') = (rule_change is not null and closed_by is not null and closed_at is not null))
);
create unique index fd_incidents_review_uq on public.fd_incidents (review_id) where review_id is not null;
create index fd_incidents_open_idx on public.fd_incidents (opened_at desc) where status = 'open';
alter table public.fd_incidents enable row level security;
create policy fd_incidents_admin_select on public.fd_incidents for select to authenticated using (private.is_admin());
revoke all on public.fd_incidents from anon;
revoke insert, update, delete, truncate on public.fd_incidents from authenticated;

alter table public.fd_report_runs
  add column if not exists week_end date,
  add column if not exists attempts integer not null default 0,
  add column if not exists claimed_at timestamptz,
  add column if not exists last_error text;
alter table public.fd_report_runs drop constraint if exists fd_report_runs_status_check;
alter table public.fd_report_runs add constraint fd_report_runs_status_check check (status in ('pending', 'sending', 'sent', 'failed'));
create index if not exists fd_report_runs_pending_idx on public.fd_report_runs (created_at) where status in ('pending', 'sending');

alter table public.fd_conversations add column if not exists transcript_purged_at timestamptz;

-- A reviewer's note can quote what a visitor wrote ("gave a dose"), so the queue is admin only to read, like the transcripts it points at (M4).
drop policy if exists fd_review_queue_staff_select on public.fd_review_queue;
create policy fd_review_queue_admin_select on public.fd_review_queue for select to authenticated using (private.is_admin());

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 3. Topic and outcome of each conversation
-- ---------------------------------------------------------------------------------------------------------------------------------
-- The web app classifies the visitor's words into a fixed vocabulary of topics. The first real topic sticks; 'other' can be replaced.
create function public.service_fd_chat_note_topic(p_conv uuid, p_topic text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_topic is null or p_topic !~ '^[a-z_]{3,40}$' then raise exception 'bad topic'; end if;
  update public.fd_conversations set intent = p_topic where id = p_conv and (intent is null or intent = 'other');
end $$;

-- A conversation that has gone quiet for 30 minutes ended without a person if the assistant answered it, and was abandoned if the visitor
-- wrote and never got an answer. A handoff or emergency already set its own outcome and is never touched. Status stays 'open' on purpose, so a
-- visitor who comes back after lunch continues the same chat.
create function public.service_fd_settle_conversations() returns integer
language plpgsql security definer set search_path = '' as $$
declare v_n integer;
begin
  with s as (
    update public.fd_conversations
       set resolution_type = case when first_reply_at is not null then 'ai_resolved' else 'abandoned' end
     where organisation_id = '00000000-0000-0000-0000-000000000001'
       and resolution_type is null and status = 'open' and visitor_message_count >= 1
       and last_message_at < now() - interval '30 minutes'
    returning 1)
  select count(*) into v_n from s;
  return v_n;
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 4. The numbers (one function; the report, the dashboard and the proof all read it)
-- ---------------------------------------------------------------------------------------------------------------------------------
create function private.fd_week_metrics(p_from timestamptz, p_to timestamptz) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_org constant uuid := '00000000-0000-0000-0000-000000000001';
  v_conv jsonb; v_hand jsonb; v_topics jsonb; v_unans jsonb; v_funnel jsonb; v_leads jsonb; v_review jsonb; v_spend jsonb; v_fu jsonb;
  v_ds date := (p_from at time zone 'Europe/London')::date; v_de date := (p_to at time zone 'Europe/London')::date;
begin
  select jsonb_build_object(
           'total', count(*),
           'visitor_messages', coalesce(sum(visitor_message_count), 0),
           'ai_resolved', count(*) filter (where resolution_type = 'ai_resolved'),
           'handed_off', count(*) filter (where resolution_type = 'handed_off'),
           'emergency', count(*) filter (where resolution_type = 'emergency' or red_flag_triggered or status = 'emergency'),
           'abandoned', count(*) filter (where resolution_type = 'abandoned'),
           'unsettled', count(*) filter (where resolution_type is null),
           -- Of the conversations that have ended, how many needed no person. Null (not 0) when none has ended yet.
           'ai_resolved_pct', case when count(*) filter (where resolution_type is not null) = 0 then null
                                   else round(100.0 * count(*) filter (where resolution_type = 'ai_resolved') / count(*) filter (where resolution_type is not null), 1) end,
           'median_first_response_seconds', round((percentile_cont(0.5) within group (order by first_response_ms))::numeric / 1000, 1))
    into v_conv
    from public.fd_conversations
   where organisation_id = v_org and started_at >= p_from and started_at < p_to and visitor_message_count >= 1;

  select jsonb_build_object(
           'total', count(*),
           'urgent', count(*) filter (where urgency = 'urgent'),
           'replied', count(*) filter (where replied_at is not null),
           'alerts_failed', count(*) filter (where alert_state = 'failed'),
           'median_reply_minutes', round((percentile_cont(0.5) within group (order by extract(epoch from (replied_at - created_at)) / 60)
                                          filter (where replied_at is not null))::numeric, 1),
           'by_reason', coalesce((select jsonb_object_agg(reason, n) from (select reason, count(*) as n from public.fd_handoffs
                                   where organisation_id = v_org and created_at >= p_from and created_at < p_to group by reason) r), '{}'::jsonb),
           'open_now', (select count(*) from public.fd_handoffs where organisation_id = v_org and status = 'open'))
    into v_hand
    from public.fd_handoffs where organisation_id = v_org and created_at >= p_from and created_at < p_to;

  select coalesce(jsonb_agg(jsonb_build_object('topic', topic, 'count', n) order by n desc, topic), '[]'::jsonb) into v_topics
    from (select intent as topic, count(*) as n from public.fd_conversations
           where organisation_id = v_org and started_at >= p_from and started_at < p_to and visitor_message_count >= 1 and intent is not null
           group by intent order by count(*) desc, intent limit 8) t;

  -- Questions the assistant could not answer, by topic. Topic names only: what the visitor wrote never goes into a report.
  select coalesce(jsonb_agg(jsonb_build_object('topic', topic, 'count', n) order by n desc, topic), '[]'::jsonb) into v_unans
    from (select coalesce(c.intent, 'other') as topic, count(*) as n
            from public.fd_handoffs h join public.fd_conversations c on c.id = h.conversation_id
           where h.organisation_id = v_org and h.created_at >= p_from and h.created_at < p_to and h.reason = 'cannot_answer'
           group by coalesce(c.intent, 'other') order by count(*) desc, coalesce(c.intent, 'other') limit 8) t;

  select jsonb_build_object(
           'total', count(*),
           'by_source', coalesce((select jsonb_object_agg(source, n) from (select source, count(*) as n from public.fd_contacts
                                   where organisation_id = v_org and created_at >= p_from and created_at < p_to and source in ('website_form', 'chat')
                                   group by source) s), '{}'::jsonb))
    into v_leads
    from public.fd_contacts where organisation_id = v_org and created_at >= p_from and created_at < p_to and source in ('website_form', 'chat');

  select coalesce(jsonb_object_agg(event_type, n), '{}'::jsonb) into v_funnel
    from (select event_type, count(distinct coalesce(contact_id::text, app_user_id::text)) as n from public.fd_funnel_events
           where organisation_id = v_org and occurred_at >= p_from and occurred_at < p_to group by event_type) e;

  select jsonb_build_object(
           'pending', (select count(*) from public.fd_review_queue where organisation_id = v_org and status = 'pending'),
           'ok', count(*) filter (where verdict = 'ok'),
           'wrong', count(*) filter (where verdict = 'wrong'),
           'unsafe', count(*) filter (where verdict = 'unsafe'),
           'incidents_open', (select count(*) from public.fd_incidents where organisation_id = v_org and status = 'open'),
           'incidents_opened', (select count(*) from public.fd_incidents where organisation_id = v_org and opened_at >= p_from and opened_at < p_to))
    into v_review
    from public.fd_review_queue where organisation_id = v_org and reviewed_at >= p_from and reviewed_at < p_to;

  select jsonb_build_object('cost_usd', coalesce(sum(cost_usd), 0), 'calls', coalesce(sum(calls), 0),
                            'tokens_in', coalesce(sum(tokens_in), 0), 'tokens_out', coalesce(sum(tokens_out), 0),
                            'daily_cap_usd', private.fd_cfg('daily_model_spend_cap_usd'))
    into v_spend
    from public.fd_model_usage where organisation_id = v_org and day >= v_ds and day < v_de;

  select jsonb_build_object(
           'sent', count(*) filter (where state = 'sent' and not dry_run and sent_at >= p_from and sent_at < p_to),
           'held_by_dry_run', count(*) filter (where state = 'skipped' and skip_reason = 'dry_run' and scheduled_for >= p_from and scheduled_for < p_to),
           'failed', count(*) filter (where state = 'failed' and scheduled_for >= p_from and scheduled_for < p_to))
    into v_fu
    from public.fd_followup_runs where organisation_id = v_org;

  return jsonb_build_object(
    'window', jsonb_build_object('from', p_from, 'to', p_to),
    'conversations', v_conv,
    'handoffs', v_hand,
    'topics', v_topics,
    'unanswered', v_unans,
    'leads', v_leads,
    'funnel', jsonb_build_object(
      'events', v_funnel,
      -- In-week counts against in-week enquiries, not a tracked cohort: read them as a trend, not an exact conversion rate.
      'enquiry_to_account_pct', case when (v_leads ->> 'total')::int = 0 then null
                                     else round(100.0 * coalesce((v_funnel ->> 'account_created')::int, 0) / (v_leads ->> 'total')::int, 1) end,
      'account_to_paid_pct', case when coalesce((v_funnel ->> 'account_created')::int, 0) = 0 then null
                                  else round(100.0 * coalesce((v_funnel ->> 'paid')::int, 0) / (v_funnel ->> 'account_created')::int, 1) end),
    'review', v_review,
    'spend', v_spend,
    'followups', v_fu,
    'switches', jsonb_build_object(
      'assistant_enabled', private.fd_cfg('assistant_enabled'), 'followups_enabled', private.fd_cfg('followups_enabled'),
      'followups_dry_run', private.fd_cfg('followups_dry_run'), 'prelaunch_mode', private.fd_cfg('prelaunch_mode')));
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 5. The weekly report (F15): generated here, sent by the dispatcher
-- ---------------------------------------------------------------------------------------------------------------------------------
-- p_at is a parameter so the proof can run any moment of any week. The week reported is the seven London days before the report's Friday.
create function private.fd_generate_report_at(p_at timestamptz, p_force boolean) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_local timestamp := p_at at time zone 'Europe/London';
  v_dow integer := extract(isodow from v_local)::integer;
  v_friday date := v_local::date - ((v_dow - 5 + 7) % 7);
  v_due timestamptz; v_to_day date; v_week_start date; v_id uuid;
begin
  if v_dow = 5 and v_local::time < time '07:30' then v_friday := v_friday - 7; end if;
  if p_force then
    v_to_day := v_local::date;
  else
    v_due := (v_friday::timestamp + time '07:30') at time zone 'Europe/London';
    -- Due from 07:30 London on the Friday, and healed for 24 hours if the schedule missed it. Never days late.
    if p_at < v_due or p_at >= v_due + interval '24 hours' then return null; end if;
    v_to_day := v_friday;
  end if;
  v_week_start := v_to_day - 7;
  insert into public.fd_report_runs (week_start, week_end, metrics)
  values (v_week_start, v_to_day,
          private.fd_week_metrics(v_week_start::timestamp at time zone 'Europe/London', v_to_day::timestamp at time zone 'Europe/London'))
  on conflict (organisation_id, week_start) do nothing
  returning id into v_id;
  if v_id is not null then perform private.fd_audit('report_generated', 'fd_report_runs', v_id::text, jsonb_build_object('week_start', v_week_start), 'system'); end if;
  return v_id;
end $$;

create function public.service_fd_generate_report() returns uuid
language sql security definer set search_path = '' as $$ select private.fd_generate_report_at(now(), false) $$;

-- Admin: produce a report for the seven days ending today (to check it before the first Friday). Idempotent per day. Says what it found, so the
-- page can tell "made and on its way" from "already sent earlier" (a second email for the same week would be dropped by the email provider's
-- duplicate check, so it is never re-sent from here). A failed one is put back in the queue.
create function public.fd_report_generate_now() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_created boolean; v_status text; v_week_start date := (now() at time zone 'Europe/London')::date - 7;
begin
  perform private.fd_require_admin();
  v_id := private.fd_generate_report_at(now(), true);
  v_created := v_id is not null;
  if v_id is null then
    select id into v_id from public.fd_report_runs where organisation_id = '00000000-0000-0000-0000-000000000001' and week_start = v_week_start;
    update public.fd_report_runs set status = 'pending', attempts = 0, last_error = null where id = v_id and status = 'failed';
  end if;
  select status into v_status from public.fd_report_runs where id = v_id;
  return jsonb_build_object('id', v_id, 'created', v_created, 'status', v_status);
end $$;

create function public.service_fd_claim_reports(p_limit integer default 1)
returns table (report_id uuid, week_start date, week_end date, metrics jsonb, prev_metrics jsonb, attempts integer)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare r record;
begin
  if p_limit is null or p_limit < 1 or p_limit > 5 then p_limit := 1; end if;
  update public.fd_report_runs set status = 'failed', last_error = coalesce(last_error, 'gave up after 5 attempts')
   where status = 'sending' and claimed_at < now() - interval '10 minutes' and attempts >= 5;
  for r in
    select f.id as rid, f.week_start as ws, f.week_end as we, f.metrics as m, f.attempts as tries
      from public.fd_report_runs f
     where f.status = 'pending' or (f.status = 'sending' and f.claimed_at < now() - interval '10 minutes' and f.attempts < 5)
     order by f.week_start
     limit p_limit
       for update of f skip locked
  loop
    update public.fd_report_runs set status = 'sending', attempts = fd_report_runs.attempts + 1, claimed_at = now() where id = r.rid;
    report_id := r.rid; week_start := r.ws; week_end := r.we; metrics := r.m; attempts := r.tries + 1;
    -- The week before it, for "up or down". An old report without an end date compares nothing.
    prev_metrics := case when r.we is null then null
                         else private.fd_week_metrics((r.ws - 7)::timestamp at time zone 'Europe/London', r.ws::timestamp at time zone 'Europe/London') end;
    return next;
  end loop;
end $$;

create function public.service_fd_finish_report(p_report uuid, p_ok boolean, p_narrative text, p_recipient text, p_error text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.fd_report_runs
     set status = case when p_ok then 'sent' when attempts >= 5 then 'failed' else 'pending' end,
         narrative = case when p_ok then left(p_narrative, 8000) else narrative end,
         recipient = case when p_ok then p_recipient else recipient end,
         sent_at = case when p_ok then now() else sent_at end,
         last_error = case when p_ok then null else left(coalesce(p_error, 'unknown'), 300) end
   where id = p_report and status = 'sending';
  if not p_ok then perform private.fd_audit('report_failed', 'fd_report_runs', p_report::text, jsonb_build_object('error', left(coalesce(p_error, 'unknown'), 200)), 'system'); end if;
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 6. The review sampler (F16), reviews and incidents
-- ---------------------------------------------------------------------------------------------------------------------------------
-- Looks at conversations that went quiet in the last 3 days (so a missed run heals) and puts the right ones on the queue. Idempotent: a
-- conversation is on the queue once (unique), however many times this runs.
create function public.service_fd_sample_reviews() returns integer
language plpgsql security definer set search_path = '' as $$
declare v_pct integer := least(100, greatest(0, private.fd_cfg_int('review_sample_percent', 10) )); v_n integer;
begin
  with cand as (
    select c.id,
           (c.red_flag_triggered or c.status = 'emergency'
            or exists (select 1 from public.fd_messages m where m.conversation_id = c.id and cardinality(m.safety_flags) > 0)) as flagged,
           exists (select 1 from public.fd_handoffs h where h.conversation_id = c.id) as handed,
           (c.first_reply_at is not null) as answered
      from public.fd_conversations c
     where c.organisation_id = '00000000-0000-0000-0000-000000000001'
       and c.visitor_message_count >= 1
       and c.last_message_at >= now() - interval '3 days' and c.last_message_at < now() - interval '30 minutes'
  ), ins as (
    insert into public.fd_review_queue (conversation_id, reason)
    select id, case when flagged then 'flagged' when handed then 'handoff' when v_pct >= 100 then 'pilot_full_review' else 'random_sample' end
      from cand
     where flagged or handed or v_pct >= 100
        or (answered and ((hashtextextended(id::text, 0) & 9223372036854775807) % 100) < v_pct)
    on conflict (conversation_id) do nothing
    returning 1)
  select count(*) into v_n from ins;
  return v_n;
end $$;

create function public.fd_review_list(p_status text default 'pending', p_limit integer default 20) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_out jsonb;
begin
  perform private.fd_require_admin();
  if p_status not in ('pending', 'reviewed', 'all') then raise exception 'bad status'; end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 then p_limit := 20; end if;
  select coalesce(jsonb_agg(x.j order by x.rn), '[]'::jsonb) into v_out
    from (
      select row_number() over (order by (q.status = 'pending' and q.reason = 'flagged') desc,
                                         case when q.status = 'pending' then q.created_at end asc, q.reviewed_at desc nulls last) as rn,
             jsonb_build_object(
               'id', q.id, 'reason', q.reason, 'status', q.status, 'verdict', q.verdict, 'note', q.note,
               'created_at', q.created_at, 'reviewed_at', q.reviewed_at,
               'conversation', jsonb_build_object('id', c.id, 'started_at', c.started_at, 'status', c.status, 'intent', c.intent, 'summary', c.summary,
                                                  'red_flag', c.red_flag_triggered, 'purged', c.transcript_purged_at is not null),
               'messages', coalesce((select jsonb_agg(jsonb_build_object('role', m.role, 'content', m.content, 'flags', m.safety_flags, 'at', m.created_at)
                                                       order by m.created_at)
                                       from public.fd_messages m where m.conversation_id = c.id), '[]'::jsonb)) as j
        from public.fd_review_queue q join public.fd_conversations c on c.id = q.conversation_id
       where p_status = 'all' or q.status = p_status
       order by 1
       limit p_limit) x;
  return v_out;
end $$;

-- Records a reviewer's verdict. Returns the incident id when the verdict was 'unsafe', else null. A verdict is final: it is not edited later.
create function public.fd_review_record(p_review uuid, p_verdict text, p_note text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_conv uuid; v_incident uuid; v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  perform private.fd_require_admin();
  if p_verdict not in ('ok', 'wrong', 'unsafe') then raise exception 'verdict must be ok, wrong or unsafe'; end if;
  if p_verdict <> 'ok' and v_note is null then raise exception 'say what was %', p_verdict; end if;
  update public.fd_review_queue
     set status = 'reviewed', verdict = p_verdict, note = left(v_note, 1000), reviewer_id = auth.uid(), reviewed_at = now()
   where id = p_review and status = 'pending'
  returning conversation_id into v_conv;
  if not found then raise exception 'that review is not waiting (already reviewed, or unknown)'; end if;
  perform private.fd_audit('review_recorded', 'fd_review_queue', p_review::text, jsonb_build_object('verdict', p_verdict));
  if p_verdict = 'unsafe' then
    insert into public.fd_incidents (review_id, conversation_id, opened_note, opened_by)
    values (p_review, v_conv, left(v_note, 1000), auth.uid())
    returning id into v_incident;
    perform private.fd_audit('incident_opened', 'fd_incidents', v_incident::text, jsonb_build_object('review', p_review));
  end if;
  return v_incident;
end $$;

-- An incident is closed only by saying which rule was tightened. This function records that decision; it does not make it.
create function public.fd_incident_close(p_incident uuid, p_rule_change text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_text text := btrim(coalesce(p_rule_change, ''));
begin
  perform private.fd_require_admin();
  if char_length(v_text) < 10 then raise exception 'say which rule or wording was tightened (at least 10 characters)'; end if;
  update public.fd_incidents set status = 'closed', rule_change = left(v_text, 1000), closed_by = auth.uid(), closed_at = now()
   where id = p_incident and status = 'open';
  if not found then raise exception 'that incident is not open'; end if;
  perform private.fd_audit('incident_closed', 'fd_incidents', p_incident::text, '{}'::jsonb);
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 7. The dashboard (one read, admin only)
-- ---------------------------------------------------------------------------------------------------------------------------------
create function public.fd_dashboard() returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.fd_require_admin();
  return jsonb_build_object(
    'current', private.fd_week_metrics(now() - interval '7 days', now()),
    'previous', private.fd_week_metrics(now() - interval '14 days', now() - interval '7 days'),
    'spend_today_usd', public.service_fd_spend_today(),
    'reports', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'week_start', r.week_start, 'week_end', r.week_end, 'status', r.status,
                                                              'sent_at', r.sent_at, 'recipient', r.recipient, 'last_error', r.last_error, 'attempts', r.attempts)
                                           order by r.week_start desc)
                           from (select * from public.fd_report_runs where organisation_id = '00000000-0000-0000-0000-000000000001'
                                  order by week_start desc limit 8) r), '[]'::jsonb),
    'incidents', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'opened_at', i.opened_at, 'opened_note', i.opened_note, 'conversation_id', i.conversation_id)
                                             order by i.opened_at)
                             from public.fd_incidents i where i.status = 'open'), '[]'::jsonb),
    'review_sample_percent', private.fd_cfg('review_sample_percent'));
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 8. Transcript retention
-- ---------------------------------------------------------------------------------------------------------------------------------
-- After transcript_retention_days of silence the messages are deleted and a summary stays (the numbers keep counting; the words go). Text that
-- a person still has to look at is never deleted from under them: a pending review, an open handoff or an open incident holds it.
create function public.service_fd_retention_purge() returns integer
language plpgsql security definer set search_path = '' as $$
declare v_days integer := private.fd_cfg_int('transcript_retention_days', 365); v_n integer := 0; r record;
begin
  for r in
    select c.id from public.fd_conversations c
     where c.organisation_id = '00000000-0000-0000-0000-000000000001'
       and c.transcript_purged_at is null
       and c.last_message_at < now() - make_interval(days => v_days)
       and not exists (select 1 from public.fd_review_queue q where q.conversation_id = c.id and q.status = 'pending')
       and not exists (select 1 from public.fd_handoffs h where h.conversation_id = c.id and h.status = 'open')
       and not exists (select 1 from public.fd_incidents i where i.conversation_id = c.id and i.status = 'open')
     order by c.last_message_at
     limit 500
       for update of c skip locked
  loop
    delete from public.fd_messages where conversation_id = r.id;
    update public.fd_conversations set transcript_purged_at = now(), summary = coalesce(summary, 'Transcript removed after the retention period.') where id = r.id;
    update public.fd_handoffs set suggested_reply = null where conversation_id = r.id;
    v_n := v_n + 1;
  end loop;
  if v_n > 0 then perform private.fd_audit('retention_purge', 'fd_conversations', 'batch', jsonb_build_object('conversations', v_n, 'older_than_days', v_days), 'system'); end if;
  return v_n;
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 9. Schedules
-- ---------------------------------------------------------------------------------------------------------------------------------
-- One test for "is there anything for the dispatcher to do", so the schedule and the next milestone cannot disagree about it.
create function private.fd_dispatch_wanted() returns boolean language plpgsql stable security definer set search_path = '' as $$
begin
  return exists (select 1 from vault.decrypted_secrets where name = 'fd_followup_secret')
     and (private.fd_cfg('followups_enabled') = 'true'::jsonb
          or exists (select 1 from public.fd_handoffs where alert_state in ('pending', 'sending') or reply_state in ('queued', 'sending'))
          or exists (select 1 from public.fd_report_runs where status in ('pending', 'sending')));
end $$;

select cron.schedule('fd-dispatch', '*/5 * * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/fd-followup-dispatcher',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'edge_function_publishable_key'),
      'x-fd-followup-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'fd_followup_secret'),
      'Content-Type', 'application/json'
    ),
    timeout_milliseconds := 55000
  ) as request_id
  where private.fd_dispatch_wanted();
$$);
-- Hourly: generating is a no-op unless the Friday slot (07:30 London, healed for 24 hours) is open and no report exists for it yet.
select cron.schedule('fd-report', '35 * * * *', $$ select public.service_fd_generate_report(); $$);
select cron.schedule('fd-settle', '*/10 * * * *', $$ select public.service_fd_settle_conversations(); $$);
select cron.schedule('fd-review-sample', '20 * * * *', $$ select public.service_fd_sample_reviews(); $$);
select cron.schedule('fd-retention', '15 3 * * *', $$ select public.service_fd_retention_purge(); $$);

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 10. Privileges and self-check
-- ---------------------------------------------------------------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'public.service_fd_chat_note_topic(uuid, text)', 'public.service_fd_settle_conversations()', 'public.service_fd_generate_report()',
    'public.service_fd_claim_reports(integer)', 'public.service_fd_finish_report(uuid, boolean, text, text, text)', 'public.service_fd_sample_reviews()',
    'public.service_fd_retention_purge()'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  foreach f in array array[
    'private.fd_week_metrics(timestamptz, timestamptz)', 'private.fd_generate_report_at(timestamptz, boolean)', 'private.fd_dispatch_wanted()'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  foreach f in array array[
    'public.fd_report_generate_now()', 'public.fd_review_list(text, integer)', 'public.fd_review_record(uuid, text, text)',
    'public.fd_incident_close(uuid, text)', 'public.fd_dashboard()'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  if has_function_privilege('authenticated', 'public.service_fd_claim_reports(integer)', 'EXECUTE') or has_function_privilege('anon', 'public.service_fd_retention_purge()', 'EXECUTE') then
    raise exception 'fd M5: a service function is callable by a non service role';
  end if;
  if has_table_privilege('anon', 'public.fd_incidents', 'SELECT') then raise exception 'fd M5: anon can read incidents'; end if;
  if (select count(*) from cron.job where jobname in ('fd-dispatch', 'fd-report', 'fd-settle', 'fd-review-sample', 'fd-retention')) <> 5 then
    raise exception 'fd M5: a schedule is missing';
  end if;
end $$;
