-- Notification delivery-state + forced-channel fallback, part 6/6.
--
-- The engine. Turns escalation_slas.channel_sequence (seeded 2026-07-30,
-- "push"/"whatsapp"/"sms" per pathway+tier — previously pure documentation
-- of a desired state nothing implemented) into a real, sequential,
-- confirmation-gated paging ladder: attempt channel 1, and if the recipient
-- neither has it delivered nor opens it within that pathway's SLA window
-- divided across the ladder, automatically create the next channel's
-- notification row and try again — matching how the founder described the
-- gap: "nothing force-escalates to voice/SMS/in-app if WhatsApp silently
-- fails". Push is now channel 1 everywhere it's configured; WhatsApp/SMS are
-- the fallback, never the default.

-- Reads the pathway+tier's channel ladder as raw config tokens. Mirrors
-- private.escalation_sla_minutes' lookup shape exactly (same table, same
-- fail-loud-on-unknown-pathway discipline — escalation_slas is now
-- authoritative config for both timing and channel routing).
create or replace function private.escalation_channel_sequence(p_pathway text, p_tier public.alert_level)
returns text[]
language plpgsql
stable security definer
set search_path = ''
as $$
declare
  v_sequence text[];
begin
  select array(select jsonb_array_elements_text(entry->'channel_sequence'))
    into v_sequence
    from public.escalation_slas c,
         jsonb_array_elements(c.config) as entry
    where c.is_active
      and entry->>'pathway' = p_pathway
      and entry->>'tier' = p_tier::text
    limit 1;

  if v_sequence is null then
    raise exception 'No active escalation SLA configured for pathway=% tier=%', p_pathway, p_tier;
  end if;

  return v_sequence;
end;
$$;

revoke all on function private.escalation_channel_sequence(text, public.alert_level) from public;
revoke all on function private.escalation_channel_sequence(text, public.alert_level) from anon;

-- escalation_slas' channel_sequence entries are semantic config, not literal
-- enum values — e.g. "whatsapp_nudge" (a softer non-urgent variant),
-- "push, batched"/"push, batched digest" (a periodic digest, not a
-- real-time page), or "next_of_kin_call_if_unacknowledged" (a distinct
-- mechanism, already implemented by private.notify_unacknowledged_emergencies
-- on emergency_events — not a notification_channel at all). This normalizes
-- raw tokens to real channels the ladder can actually dispatch on, dropping
-- anything that isn't one. A batched/digest entry still resolves to its
-- underlying channel (push) — the "batched" distinction matters for how a
-- future digest-sender would treat it, not for what channel it is.
create or replace function private.normalize_escalation_channels(p_raw text[])
returns public.notification_channel[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array_agg(mapped.ch order by raw.ord), array[]::public.notification_channel[])
  from unnest(p_raw) with ordinality as raw(token, ord)
  cross join lateral (
    -- Take the part before any comma ("push, batched" -> "push") and strip a
    -- trailing "_nudge" variant marker ("whatsapp_nudge" -> "whatsapp").
    select regexp_replace(trim(split_part(lower(raw.token), ',', 1)), '_nudge$', '') as candidate
  ) stripped
  cross join lateral (
    select case
      when stripped.candidate in ('push', 'whatsapp', 'sms', 'email', 'in_app', 'voice')
        then stripped.candidate::public.notification_channel
      else null
    end as ch
  ) mapped
  where mapped.ch is not null;
$$;

-- Called by triggers that raise a clinical alert (today: the
-- abnormal-result trigger, via the public wrapper below — extend to the
-- other five escalation_slas pathways, e.g. BP/LPE red flag, when that's
-- explicitly asked for, following this same shape). Resolves hop 1 of the
-- pathway's channel ladder and inserts it as a tracked, critical-priority
-- notification, then nudges send-pending-notifications immediately rather
-- than waiting up to 5 minutes for its cron tick — matching the "immediate,
-- not scheduled" abnormal-result business rule.
create or replace function private.enqueue_critical_notification(
  p_organisation_id uuid,
  p_recipient_id uuid,
  p_template text,
  p_payload jsonb,
  p_pathway text,
  p_alert_tier public.alert_level,
  p_source_table text default null,
  p_source_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_channels public.notification_channel[];
  v_id uuid;
begin
  v_channels := private.normalize_escalation_channels(
    private.escalation_channel_sequence(p_pathway, p_alert_tier)
  );
  if array_length(v_channels, 1) is null then
    v_channels := array['push', 'whatsapp', 'sms']::public.notification_channel[];
  end if;

  insert into public.notifications
    (organisation_id, recipient_id, channel, template, payload, priority,
     escalation_pathway, escalation_alert_tier, escalation_hop, source_table, source_id)
  values
    (p_organisation_id, p_recipient_id, v_channels[1], p_template, p_payload, 'critical',
     p_pathway, p_alert_tier, 1, p_source_table, p_source_id)
  returning id into v_id;

  begin
    perform net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
        || '/functions/v1/send-pending-notifications',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'edge_function_publishable_key'),
        'Content-Type', 'application/json'
      ),
      timeout_milliseconds := 8000
    );
  exception when others then
    -- Best-effort immediacy nudge only — the 5-minute cron is the guaranteed
    -- backstop, same as every other net.http_post caller in this codebase.
    null;
  end;

  return v_id;
end;
$$;

revoke all on function private.enqueue_critical_notification(uuid, uuid, text, jsonb, text, public.alert_level, text, uuid) from public;
revoke all on function private.enqueue_critical_notification(uuid, uuid, text, jsonb, text, public.alert_level, text, uuid) from anon;

-- private.* functions aren't PostgREST-exposed (deliberately, per this
-- codebase's schema convention), so a service-role Edge Function needs a
-- public.* wrapper to reach it. Restricted to service_role only — not
-- anon/authenticated — since this is an internal trigger-invoked primitive,
-- not a patient/clinician-facing action.
create or replace function public.enqueue_critical_notification(
  p_organisation_id uuid,
  p_recipient_id uuid,
  p_template text,
  p_payload jsonb,
  p_pathway text,
  p_alert_tier public.alert_level,
  p_source_table text default null,
  p_source_id uuid default null
)
returns uuid
language sql
security definer
set search_path = ''
as $$
  select private.enqueue_critical_notification(
    p_organisation_id, p_recipient_id, p_template, p_payload,
    p_pathway, p_alert_tier, p_source_table, p_source_id
  );
$$;

revoke all on function public.enqueue_critical_notification(uuid, uuid, text, jsonb, text, public.alert_level, text, uuid) from public;
revoke all on function public.enqueue_critical_notification(uuid, uuid, text, jsonb, text, public.alert_level, text, uuid) from anon;
revoke all on function public.enqueue_critical_notification(uuid, uuid, text, jsonb, text, public.alert_level, text, uuid) from authenticated;
grant execute on function public.enqueue_critical_notification(uuid, uuid, text, jsonb, text, public.alert_level, text, uuid) to service_role;

do $$
begin
  if has_function_privilege('anon', 'public.enqueue_critical_notification(uuid, uuid, text, jsonb, text, public.alert_level, text, uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.enqueue_critical_notification(uuid, uuid, text, jsonb, text, public.alert_level, text, uuid)', 'EXECUTE') then
    raise exception 'enqueue_critical_notification() is reachable by a non-service-role session';
  end if;
end $$;

-- The forced-channel fallback engine itself. Scheduled every 2 minutes
-- (tight enough that even the shortest live SLA — 15 minutes, LPE/obesity
-- emergency — gets room for all 3 ladder hops). For each unconfirmed
-- critical notification:
--   - a row whose send attempt definitively FAILED (e.g. no active push
--     subscription — a deterministic dead end, not worth waiting out) is
--     escalated immediately, no time window;
--   - a row that was sent/delivered but never opened waits out its share of
--     the pathway's overall SLA (sla_minutes / number of ladder hops,
--     floored at 2 minutes) before the engine moves to the next hop;
--   - a chain that reaches the end of its ladder with nobody having opened
--     any hop is recorded in notification_escalation_failures and every
--     admin gets an in_app notification (never whatsapp/sms/email — I1)
--     surfacing it.
create or replace function private.escalate_unconfirmed_critical_notifications()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_channels public.notification_channel[];
  v_total_channels int;
  v_hop_minutes numeric;
  v_next_channel public.notification_channel;
begin
  for r in
    select n.*
    from public.notifications n
    where n.priority = 'critical'
      and n.opened_at is null
      and n.escalation_pathway is not null
      and (n.status = 'failed' or (n.status in ('sent', 'delivered') and n.sent_at is not null))
      and not exists (select 1 from public.notifications nxt where nxt.escalated_from_id = n.id)
      and not exists (select 1 from public.notification_escalation_failures f where f.notification_id = n.id)
  loop
    v_channels := private.normalize_escalation_channels(
      private.escalation_channel_sequence(r.escalation_pathway, r.escalation_alert_tier)
    );
    if array_length(v_channels, 1) is null then
      v_channels := array['push', 'whatsapp', 'sms']::public.notification_channel[];
    end if;
    v_total_channels := array_length(v_channels, 1);

    if r.status <> 'failed' then
      v_hop_minutes := greatest(
        2,
        floor(private.escalation_sla_minutes(r.escalation_pathway, r.escalation_alert_tier)::numeric / v_total_channels)
      );
      if now() - r.sent_at < (v_hop_minutes || ' minutes')::interval then
        continue;
      end if;
    end if;

    if r.escalation_hop >= v_total_channels then
      insert into public.notification_escalation_failures
        (organisation_id, notification_id, source_table, source_id, escalation_pathway, escalation_alert_tier, channel_sequence_exhausted)
      values
        (r.organisation_id, r.id, r.source_table, r.source_id, r.escalation_pathway, r.escalation_alert_tier, v_channels)
      on conflict (notification_id) do nothing;

      insert into public.notifications (organisation_id, recipient_id, channel, template, payload, priority)
      select
        r.organisation_id,
        p.id,
        'in_app',
        'critical_notification_escalation_exhausted',
        jsonb_build_object(
          'notification_id', r.id,
          'source_table', r.source_table,
          'source_id', r.source_id,
          'pathway', r.escalation_pathway
        ),
        'critical'
      from public.profiles p
      where p.role = 'admin';

      continue;
    end if;

    v_next_channel := v_channels[r.escalation_hop + 1];

    insert into public.notifications
      (organisation_id, recipient_id, channel, template, payload, priority,
       escalation_pathway, escalation_alert_tier, escalation_hop, escalated_from_id, source_table, source_id)
    values
      (r.organisation_id, r.recipient_id, v_next_channel, r.template, r.payload, 'critical',
       r.escalation_pathway, r.escalation_alert_tier, r.escalation_hop + 1, r.id, r.source_table, r.source_id);

    begin
      perform net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
          || '/functions/v1/send-pending-notifications',
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'edge_function_publishable_key'),
          'Content-Type', 'application/json'
        ),
        timeout_milliseconds := 8000
      );
    exception when others then
      null;
    end;
  end loop;
end;
$$;

revoke all on function private.escalate_unconfirmed_critical_notifications() from public;
revoke all on function private.escalate_unconfirmed_critical_notifications() from anon;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'escalate-critical-notifications') then
    perform cron.unschedule('escalate-critical-notifications');
  end if;
end $$;

select cron.schedule(
  'escalate-critical-notifications',
  '*/2 * * * *',
  $$ select private.escalate_unconfirmed_critical_notifications(); $$
);
