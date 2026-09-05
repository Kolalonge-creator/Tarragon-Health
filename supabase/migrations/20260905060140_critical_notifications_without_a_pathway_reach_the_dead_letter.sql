-- ===========================================================================
-- The critical-notification dead-letter has never fired in production.
--
-- WHAT WAS WRONG
--
-- private.notify_clinician_alert() raises the platform's clinical pages. For
-- a severity>=3 alert it writes one `priority='critical'` notifications row
-- per channel in the alert's rule (in_app, then push/whatsapp/sms). It has
-- never set escalation_pathway or escalation_alert_tier.
--
-- private.escalate_unconfirmed_critical_notifications() -- the cron that
-- retries, hops and finally dead-letters an unconfirmed critical page (job
-- 'escalate-critical-notifications', every 2 minutes) -- selected
--
--     where n.priority = 'critical' ... and n.escalation_pathway is not null
--
-- so every one of those rows was invisible to it. Measured on the live
-- project (koiplnmbgnqnbywhpjlf) on 2026-09-05:
--
--     critical notifications ......................... 148
--     of those, escalation_pathway is null ........... 148   (100%)
--     of those, status = 'failed' .....................  97
--     rows in notification_escalation_failures ........   0
--
-- 97 critical clinical pages failed to deliver and not one reached the
-- dead-letter or raised the `critical_notification_escalation_exhausted`
-- admin alert. The safety net exists, is wired to a cron, and had never
-- caught anything.
--
-- WHY THIS FIX AND NOT THE OTHER ONE
--
-- The alternative was to route notify_clinician_alert() through
-- private.enqueue_critical_notification() with a pathway derived from the
-- alert's type_code. Rejected, for two reasons:
--
--   1. private.escalation_channel_sequence() and
--      private.escalation_sla_minutes() RAISE when escalation_slas has no
--      entry for the (pathway, tier) pair, and escalation_slas has no entry
--      for any clinician_alerts pathway at all. enqueue_critical_notification
--      calls escalation_channel_sequence unguarded, so the derived-pathway
--      route would raise inside notify_clinician_alert -- which runs inside
--      the trigger that creates the clinician_alerts row. A missing config
--      line would stop the alert being created at all. That trades a silent
--      monitoring gap for a loud clinical-data-loss bug.
--
--   2. notify_clinician_alert deliberately fans out to every channel in the
--      alert rule AT ONCE. The escalation engine is a sequential ladder.
--      Forcing the former through the latter would change live paging
--      behaviour for every alert on the platform, which is not what a
--      dead-letter fix should do.
--
-- So the engine is relaxed instead, exactly as its own code already
-- anticipated: it carries `v_channels := array['push','whatsapp','sms']` as a
-- fallback that was unreachable, because escalation_channel_sequence raises
-- rather than returning null. That fallback becomes the real ladder for a
-- notification that carries no pathway.
--
-- THREE THINGS THAT COME WITH IT
--
--   * SELF-ESCALATION LOOP GUARD. The engine's own admin alarm
--     ('critical_notification_escalation_exhausted') is itself
--     priority='critical' with no pathway. Without excluding it by template,
--     relaxing the guard would make the engine escalate its own alarms, then
--     dead-letter those, then alarm about the alarms, forever. Excluded
--     explicitly.
--
--   * A LOOKBACK WINDOW. With a 2-minute cron a healthy row escalates within
--     minutes, so nothing legitimate is older than the window. Without one,
--     the first run after this migration would hop and dead-letter the entire
--     historical backlog (97 rows reaching back to 2026-08-28) in a single
--     tick -- paging clinicians about week-old alerts. 7 days is generous
--     against the 2-minute cadence and bounds the burst.
--
--   * THE CONFIG LOOKUP NO LONGER ABORTS THE WHOLE SWEEP. escalation_slas is
--     editable in the admin app, so a pathway can lose its config row while
--     notifications carrying that pathway are still in flight. Today that
--     raises out of the loop and stops EVERY row in the tick from escalating,
--     not just the one. Now it falls back to the default ladder for that row
--     and carries on.
--
-- notification_escalation_failures.escalation_pathway/escalation_alert_tier
-- become nullable: a notification that carried no pathway did not carry a
-- tier either, and recording a sentinel tier would assert a triage decision
-- nobody made. Nothing in apps/ or packages/ reads either column (checked);
-- the only readers are packages/db/tests/notification_delivery_fallback.sql
-- and the engine itself.
-- ===========================================================================

alter table public.notification_escalation_failures
  alter column escalation_pathway drop not null,
  alter column escalation_alert_tier drop not null;

comment on column public.notification_escalation_failures.escalation_pathway is
  'The escalation_slas pathway the exhausted notification carried, or null when it carried none -- e.g. a clinician page raised by private.notify_clinician_alert, which sets no pathway and is escalated on the engine''s default push/whatsapp/sms ladder.';

comment on column public.notification_escalation_failures.escalation_alert_tier is
  'The alert_level the exhausted notification carried, or null when it carried none. Never defaulted: a tier is a triage decision, and inventing one here would put a judgement nobody made into the audit record.';

create or replace function private.escalate_unconfirmed_critical_notifications()
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  r record;
  v_channels public.notification_channel[];
  v_total_channels int;
  v_sla_minutes int;
  v_hop_minutes numeric;
  v_next_channel public.notification_channel;

  -- The ladder the engine has always carried as a fallback and could never
  -- actually reach, because escalation_channel_sequence() raises instead of
  -- returning null. It is now the real ladder for an unpathwayed critical.
  c_default_channels constant public.notification_channel[] :=
    array['push', 'whatsapp', 'sms']::public.notification_channel[];

  -- The contact SLA for an emergency_event, the closest configured analogue
  -- to "a clinician has been paged and has not confirmed". Divided by the
  -- ladder length below, it puts ~40 minutes between hops.
  c_default_sla_minutes constant int := 120;

  -- See the header: bounds the first run after this migration to notifications
  -- recent enough that hopping them is still useful.
  c_lookback constant interval := interval '7 days';
begin
  for r in
    select n.*
    from public.notifications n
    where n.priority = 'critical'
      and n.opened_at is null
      and n.created_at > now() - c_lookback
      -- The engine's own admin alarm. Escalating it would make the engine
      -- alarm about its own alarms without end.
      and n.template is distinct from 'critical_notification_escalation_exhausted'
      and (n.status = 'failed' or (n.status in ('sent', 'delivered') and n.sent_at is not null))
      and not exists (select 1 from public.notifications nxt where nxt.escalated_from_id = n.id)
      and not exists (select 1 from public.notification_escalation_failures f where f.notification_id = n.id)
  loop
    if r.escalation_pathway is null then
      v_channels    := c_default_channels;
      v_sla_minutes := c_default_sla_minutes;
    else
      -- escalation_slas is admin-editable, so a pathway can lose its config
      -- while notifications carrying it are still in flight. Previously that
      -- raised out of the whole loop; now it degrades this one row.
      begin
        v_channels := private.normalize_escalation_channels(
          private.escalation_channel_sequence(r.escalation_pathway, r.escalation_alert_tier)
        );
        v_sla_minutes := private.escalation_sla_minutes(r.escalation_pathway, r.escalation_alert_tier);
      exception when others then
        v_channels    := null;
        v_sla_minutes := null;
      end;
    end if;

    if array_length(v_channels, 1) is null then
      v_channels := c_default_channels;
    end if;
    v_sla_minutes := coalesce(v_sla_minutes, c_default_sla_minutes);
    v_total_channels := array_length(v_channels, 1);

    if r.status <> 'failed' then
      v_hop_minutes := greatest(2, floor(v_sla_minutes::numeric / v_total_channels));
      if now() - r.sent_at < (v_hop_minutes || ' minutes')::interval then
        continue;
      end if;
    end if;

    if r.escalation_hop >= v_total_channels then
      insert into public.notification_escalation_failures
        (organisation_id, notification_id, source_table, source_id,
         escalation_pathway, escalation_alert_tier, channel_sequence_exhausted)
      values
        (r.organisation_id, r.id, r.source_table, r.source_id,
         r.escalation_pathway, r.escalation_alert_tier, v_channels)
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
$function$;

comment on function private.escalate_unconfirmed_critical_notifications() is
  'Hops an unconfirmed critical notification along its escalation ladder and dead-letters it when the ladder is exhausted. Handles notifications with NO escalation_pathway (every clinical page raised by private.notify_clinician_alert) on a default push/whatsapp/sms ladder -- before 2026-09-05 those were excluded by an `escalation_pathway is not null` guard and the dead-letter had never fired once in production.';

-- Proof that the guard is actually gone, so a later edit cannot quietly
-- reinstate it without this failing.
do $$
begin
  if pg_get_functiondef('private.escalate_unconfirmed_critical_notifications()'::regprocedure)
     ilike '%escalation_pathway is not null%' then
    raise exception 'FAIL: the escalation_pathway is not null guard is still in the engine';
  end if;
  if pg_get_functiondef('private.escalate_unconfirmed_critical_notifications()'::regprocedure)
     not ilike '%critical_notification_escalation_exhausted%' then
    raise exception 'FAIL: the self-escalation loop guard is missing';
  end if;
  if (select count(*) from information_schema.columns
       where table_schema = 'public'
         and table_name = 'notification_escalation_failures'
         and column_name in ('escalation_pathway', 'escalation_alert_tier')
         and is_nullable = 'YES') <> 2 then
    raise exception 'FAIL: the dead-letter still cannot record an unpathwayed notification';
  end if;
end $$;
