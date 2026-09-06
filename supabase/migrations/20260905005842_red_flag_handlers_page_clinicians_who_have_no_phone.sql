-- Tarragon Health — the five red-flag handlers page nobody, for the same
-- reason the abnormal-result Edge Function did.
--
-- 2026-09-05: supabase/functions/abnormal-result-handler/index.ts was fixed
-- to stop filtering its clinician recipients on `phone is not null`. The five
-- database twins of that defect were left in place. Confirmed live against
-- koiplnmbgnqnbywhpjlf, this session:
--
--     private.handle_bp_reading_red_flag
--     private.handle_pulse_reading_red_flag
--     private.handle_spo2_reading_red_flag
--     private.handle_temperature_reading_red_flag
--     private.handle_emergency_event
--
-- each select their recipients with
--
--     select * from public.profiles
--      where organisation_id = new.organisation_id
--        and role = 'clinician'
--        and phone is not null      -- <- this
--
-- and there are 7 clinician profiles live, 0 of which carry a phone (in fact
-- 0 of 38 profiles of ANY role carry one). So each handler writes its
-- clinician_alerts row and then enqueues ZERO notifications. The alert exists
-- on the dashboard for anyone who happens to look; nobody is told to look.
-- handle_emergency_event is the plan-independent emergency path, so this
-- reaches the safety net too, not only the paid tiers.
--
-- WHY THE PREDICATE IS SIMPLY WRONG, not a channel requirement.
-- The loop's only use of the row is r.id. It passes that to
-- private.enqueue_critical_notification, which chooses the channel from the
-- signed escalation_slas config, and the FIRST channel for every one of these
-- pathways is 'push' — which needs a web-push subscription, never a phone
-- number. A phone is needed only if the sequence escalates to a whatsapp or
-- sms hop, and that requirement is already enforced where it belongs, per
-- hop: send-pending-notifications marks an individual whatsapp/sms/voice hop
-- failed with "recipient has no phone number on file" and leaves every other
-- hop alone. Filtering the recipient out at the top throws away the push hop
-- as well, which is the one that would have worked. This is the same argument
-- written into abnormal-result-handler/index.ts's own recipient query.
--
-- private.handle_symptom_red_flag is the in-repo counter-example: it raises
-- its clinician_alerts row with no phone predicate anywhere. (It also runs no
-- recipient loop at all, so it pages nobody either — a different gap, not
-- fixed here.)
--
-- NOTHING CLINICAL CHANGES. No threshold, no SLA in force, no alert level, no
-- plan gate. The only difference is which clinician profiles are eligible to
-- receive a notification that was already being raised.
--
-- ---------------------------------------------------------------------------
-- A LANDMINE THIS FIX WOULD OTHERWISE HAVE STEPPED ON
--
-- 'pulse_vitals_red_flag' is NOT registered in escalation_slas at all — the
-- 2026-08-29 pulse red-flag engine hardcoded its own intervals (1 hour /
-- 72 hours) and never added a config entry. private.escalation_channel_sequence
-- RAISES for an unregistered pathway, and private.enqueue_critical_notification
-- calls it unguarded. Today that is invisible: the phone predicate means the
-- loop body never executes. Remove the predicate on its own and the FIRST
-- RED-band pulse reading from an entitled patient would abort the
-- vitals_readings INSERT entirely — a worse outcome than paging nobody.
--
-- Fixed structurally rather than by special-casing pulse, because the next
-- unregistered pathway would do it again:
--
--   * private.escalation_channel_sequence_or_null() — the same lookup without
--     the raise. escalation_channel_sequence keeps its raise for any caller
--     that wants it; nothing about it changes.
--   * enqueue_critical_notification and escalate_unconfirmed_critical_
--     notifications both already contain
--         if array_length(v_channels, 1) is null then
--           v_channels := array['push','whatsapp','sms'];
--         end if;
--     — a default that has never once been reachable, because the call above
--     it raised instead of returning null. Pointing them at the _or_null form
--     makes the fallback the authors clearly intended actually run. Choosing a
--     default channel order for an unregistered pathway is not a clinical
--     decision; failing to notify anybody at all is.
--   * The SLA MINUTES lookup keeps its fail-loud raise everywhere, because a
--     due-date is a clinical value and inventing one would be. Where the
--     escalation sweep needs it and cannot get it, that row is now skipped
--     with a warning instead of aborting the whole sweep for every other
--     patient in it.
--   * escalation_slas v8 below registers pulse_vitals_red_flag properly, as an
--     UNSIGNED, INACTIVE draft. v7 is signed (approved_at 2026-09-04
--     21:27:18Z) and stays in force — this migration will not retire a signed
--     clinical config in favour of an unsigned one. Until a Clinical Director
--     signs v8, a pulse alert pages on the default sequence above.
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- 1. A non-raising channel lookup.
-- ---------------------------------------------------------------------------
create or replace function private.escalation_channel_sequence_or_null(p_pathway text, p_tier public.alert_level)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select array(select jsonb_array_elements_text(entry->'channel_sequence'))
    from public.escalation_slas c,
         jsonb_array_elements(c.config) as entry
   where c.is_active
     and entry->>'pathway' = p_pathway
     and entry->>'tier' = p_tier::text
   limit 1;
$$;

comment on function private.escalation_channel_sequence_or_null(text, public.alert_level) is
  'Channel sequence for a pathway/tier, or NULL when the active escalation_slas '
  'config does not register it. private.escalation_channel_sequence() is the '
  'fail-loud form and is unchanged; use this one wherever an unregistered '
  'pathway must degrade to a default rather than abort a clinical write.';

revoke all on function private.escalation_channel_sequence_or_null(text, public.alert_level) from public;

-- ---------------------------------------------------------------------------
-- 2. Make the existing (previously unreachable) default fallback live.
--    Body otherwise byte-identical to the live definition read with
--    pg_get_functiondef immediately before this migration was written.
-- ---------------------------------------------------------------------------
create or replace function private.enqueue_critical_notification(
  p_organisation_id uuid,
  p_recipient_id uuid,
  p_template text,
  p_payload jsonb,
  p_pathway text,
  p_alert_tier public.alert_level,
  p_source_table text default null::text,
  p_source_id uuid default null::uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_raw text[];
  v_channels public.notification_channel[];
  v_id uuid;
begin
  v_raw := private.escalation_channel_sequence_or_null(p_pathway, p_alert_tier);
  v_channels := private.normalize_escalation_channels(coalesce(v_raw, array[]::text[]));
  if array_length(v_channels, 1) is null then
    -- Previously unreachable: escalation_channel_sequence() raised here for an
    -- unregistered pathway, which aborted the clinical INSERT that triggered
    -- this call rather than degrading to a default.
    v_channels := array['push', 'whatsapp', 'sms']::public.notification_channel[];
    raise warning 'escalation_slas has no active entry for pathway=% tier=% — notifying on the default channel sequence instead',
      p_pathway, p_alert_tier;
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
    null;
  end;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Same treatment for the hop-escalation sweep, so one notification on an
--    unregistered pathway cannot abort the sweep for every other patient in
--    it. The SLA-minutes lookup keeps its raise (a due-date is a clinical
--    value); the row is skipped instead. Body otherwise byte-identical to the
--    live definition.
-- ---------------------------------------------------------------------------
create or replace function private.escalate_unconfirmed_critical_notifications()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_raw text[];
  v_channels public.notification_channel[];
  v_total_channels int;
  v_hop_minutes numeric;
  v_sla_minutes integer;
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
    v_raw := private.escalation_channel_sequence_or_null(r.escalation_pathway, r.escalation_alert_tier);
    v_channels := private.normalize_escalation_channels(coalesce(v_raw, array[]::text[]));
    if array_length(v_channels, 1) is null then
      v_channels := array['push', 'whatsapp', 'sms']::public.notification_channel[];
    end if;
    v_total_channels := array_length(v_channels, 1);

    if r.status <> 'failed' then
      -- Unregistered pathway: we do not know this alert's SLA and will not
      -- invent one, so leave it where it is and keep going. Previously this
      -- raised and killed the whole sweep.
      select (entry->>'sla_minutes')::integer into v_sla_minutes
        from public.escalation_slas c,
             jsonb_array_elements(c.config) as entry
       where c.is_active
         and entry->>'pathway' = r.escalation_pathway
         and entry->>'tier' = r.escalation_alert_tier::text
       limit 1;

      if v_sla_minutes is null then
        raise warning 'escalation_slas has no active entry for pathway=% tier=% — notification % not escalated to its next channel',
          r.escalation_pathway, r.escalation_alert_tier, r.id;
        continue;
      end if;

      v_hop_minutes := greatest(2, floor(v_sla_minutes::numeric / v_total_channels));
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

-- ---------------------------------------------------------------------------
-- 4. escalation_slas — register pulse_vitals_red_flag as an UNSIGNED DRAFT.
--
--    Values are as-transcribed from private.handle_pulse_reading_red_flag's
--    own hardcoded intervals (`v_sla := interval '1 hour'` for RED /
--    urgent_escalation, `interval '72 hours'` for AMBER / clinician_review) —
--    60 and 4320 minutes, identical to bp_vitals_red_flag and
--    temperature_vitals_red_flag. NO clinical value is changed or invented.
--    channel_sequence copied from temperature_vitals_red_flag.
--
--    Inserted inactive and unsigned. The active config (v7) is SIGNED and is
--    deliberately left in force; a Clinical Director brings this one into
--    force at /admin/settings/escalation-slas. Version resolved from the table
--    rather than hardcoded so a from-scratch replay cannot collide.
-- ---------------------------------------------------------------------------
do $$
declare
  v_active   jsonb;
  v_next     integer;
begin
  select config into v_active from public.escalation_slas where is_active limit 1;
  if v_active is null then
    raise exception 'no active escalation_slas config to base a draft on';
  end if;

  if exists (
    select 1 from jsonb_array_elements(v_active) e where e->>'pathway' = 'pulse_vitals_red_flag'
  ) then
    raise notice 'pulse_vitals_red_flag already registered in the active config; no draft needed';
    return;
  end if;

  select coalesce(max(version), 0) + 1 into v_next from public.escalation_slas;

  insert into public.escalation_slas (version, config, notes)
  values (
    v_next,
    v_active || '[
      {"pathway": "pulse_vitals_red_flag", "tier": "urgent_escalation", "sla_minutes": 60, "channel_sequence": ["push", "whatsapp_nudge"], "source_function": "private.handle_pulse_reading_red_flag", "note": "RED band (36-39 or 121-149 bpm). As-transcribed from the trigger''s own hardcoded 1h literal, unchanged; the pathway was never registered when the pulse engine shipped 2026-08-29."},
      {"pathway": "pulse_vitals_red_flag", "tier": "clinician_review", "sla_minutes": 4320, "channel_sequence": ["push, batched"], "source_function": "private.handle_pulse_reading_red_flag", "note": "AMBER band (40-49 or 101-120 bpm). As-transcribed from the trigger''s own hardcoded 72h literal, unchanged."}
    ]'::jsonb,
    'Registers pulse_vitals_red_flag, the one alert pathway that has never been in this table — the 2026-08-29 pulse red-flag engine hardcoded its intervals instead. Both values are transcribed from the live trigger and change nothing clinically. Until this is signed, a pulse alert notifies on the default push/whatsapp/sms sequence and does not hop to a further channel. DRAFT, unsigned, not in force.'
  );

  raise notice 'drafted escalation_slas v% registering pulse_vitals_red_flag, unsigned', v_next;
end $$;


-- ---------------------------------------------------------------------------
-- 5. The five handlers. Each body is the live definition
--    (pg_get_functiondef, 2026-09-05) with ONE change: `and phone is not null`
--    removed from the clinician recipient loop.
-- ---------------------------------------------------------------------------

create or replace function private.handle_bp_reading_red_flag()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_level     text;
  v_alert_lvl public.alert_level;
  v_esc       smallint;
  v_sla       interval;
  v_title     text;
  v_detail    text;
  v_existing  public.clinician_alerts%rowtype;
  v_t_sys     smallint;
  v_t_dia     smallint;
  v_pregnant  boolean;
  v_alert_id  uuid;
  v_should_page boolean := false;
  v_level_label text;
  r           public.profiles%rowtype;
  v_has_escalation_access boolean;
begin
  if new.vital_type <> 'blood_pressure' then
    return new;
  end if;

  update public.clinician_alerts
    set status = 'resolved', updated_at = now()
  where patient_id = new.patient_id
    and status = 'open'
    and title = 'Missing expected blood-pressure readings';

  v_level := private.classify_bp_level(new.systolic, new.diastolic);

  if v_level = 'green' and new.systolic is not null and new.diastolic is not null then
    select systolic, diastolic into v_t_sys, v_t_dia
    from private.patient_home_bp_target(new.patient_id);
    if new.systolic >= v_t_sys or new.diastolic >= v_t_dia then
      v_level := 'amber';
    end if;
  end if;

  select coalesce(p.is_pregnant, false) into v_pregnant from public.profiles p where p.id = new.patient_id;
  if v_pregnant and new.systolic is not null and new.diastolic is not null then
    if new.systolic >= 160 or new.diastolic >= 110 then
      v_level := 'emergency';
    elsif new.systolic >= 140 or new.diastolic >= 90 then
      if v_level not in ('emergency','red') then v_level := 'red'; end if;
    end if;
  end if;

  if v_level in ('unknown', 'green') then
    return new;
  end if;

  v_detail := format('Home BP reading %s/%s mmHg logged %s.',
                     new.systolic, new.diastolic, to_char(new.taken_at, 'YYYY-MM-DD HH24:MI'));
  if v_pregnant then
    v_detail := v_detail || ' PREGNANT — obstetric red route (§18.1); do not manage routinely on-platform.';
  end if;

  if v_level = 'emergency' then
    if not exists (
      select 1 from public.emergency_events e
      where e.patient_id = new.patient_id and e.source = 'bp_reading'
        and e.status = 'active' and e.created_at > now() - interval '6 hours'
    ) then
      insert into public.emergency_events
        (organisation_id, patient_id, source, trigger_detail, status, vital_reading_id)
      values (new.organisation_id, new.patient_id, 'bp_reading',
        v_detail || case when v_pregnant then ' Possible pre-eclampsia — urgent obstetric care.' else ' This is in the hypertensive-crisis range.' end,
        'active', new.id);
    end if;
    return new;
  end if;

  v_has_escalation_access := private.patient_has_feature_access(new.patient_id, 'vitals_red_flag_doctor_escalation');

  if v_level = 'red' then
    v_alert_lvl := 'urgent_escalation'; v_esc := 3;
    v_sla := private.escalation_sla_minutes('bp_vitals_red_flag', 'urgent_escalation') * interval '1 minute';
    v_title := case when v_pregnant then 'Priority 1: raised BP in pregnancy' else 'Priority 1: high blood pressure reading' end;
    v_detail := v_detail || ' Please ask the patient to rest 5 minutes and re-check, then review same day.';
    v_level_label := 'Priority 1';
  else
    v_alert_lvl := 'clinician_review'; v_esc := 2;
    v_sla := private.escalation_sla_minutes('bp_vitals_red_flag', 'clinician_review') * interval '1 minute';
    v_title := 'Blood pressure above target';
    v_detail := v_detail || ' Above target — review adherence, technique, lifestyle and titration.';
    v_level_label := 'Review needed';
  end if;

  if v_has_escalation_access then
    -- Scoped by vital_type (join back to vitals_readings), matching the
    -- SpO2/temperature triggers -- previously unscoped, so a patient's most
    -- recent open alert of ANY vital type could be silently overwritten with
    -- BP content.
    select ca.* into v_existing
    from public.clinician_alerts ca
    join public.vitals_readings vr on vr.id = ca.vital_reading_id
    where ca.patient_id = new.patient_id
      and vr.vital_type = 'blood_pressure'
      and ca.status = 'open'
    order by ca.created_at desc
    limit 1;

    if v_existing.id is not null then
      if v_esc >= coalesce(v_existing.escalation_level, 0) then
        update public.clinician_alerts
          set level = v_alert_lvl, escalation_level = v_esc, title = v_title,
              detail = v_detail, sla_due_at = now() + v_sla, vital_reading_id = new.id, updated_at = now()
        where id = v_existing.id;
        v_alert_id := v_existing.id;
        if v_esc > coalesce(v_existing.escalation_level, 0) then
          v_should_page := true;
        end if;
      end if;
    else
      insert into public.clinician_alerts
        (organisation_id, patient_id, level, status, title, detail, sla_due_at, escalation_level, vital_reading_id)
      values (new.organisation_id, new.patient_id, v_alert_lvl, 'open', v_title, v_detail,
        now() + v_sla, v_esc, new.id)
      returning id into v_alert_id;
      v_should_page := true;
    end if;
  else
    perform private.raise_dangerous_reading_ai_suggestion(
      new.organisation_id, new.patient_id, 'blood pressure', v_level_label,
      'Sit down and rest quietly for 5 minutes, then recheck your blood pressure. Avoid caffeine and salty food for the rest of the day. If it stays this high, or you get a headache, chest pain, or blurred vision, seek care promptly.'
    );
  end if;

  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (new.organisation_id, new.patient_id, 'bp_red_flag.raised', 'vitals_readings', new.id,
    jsonb_build_object('level', v_level, 'systolic', new.systolic, 'diastolic', new.diastolic, 'pregnant', v_pregnant,
                       'escalation_gated_by_plan', not v_has_escalation_access));

  if v_should_page then
    -- No `and phone is not null`. The first channel for this pathway is push,
    -- which needs no phone; a whatsapp/sms hop that does is failed per-hop by
    -- send-pending-notifications with "recipient has no phone number on file".
    for r in
      select * from public.profiles
      where organisation_id = new.organisation_id and role = 'clinician'
    loop
      perform private.enqueue_critical_notification(
        new.organisation_id, r.id, 'vitals_red_flag_clinician_alert',
        jsonb_build_object(
          'patient_name', coalesce((select full_name from public.profiles where id = new.patient_id), 'A patient'),
          'vital_label', 'blood pressure',
          'level_label', v_level_label
        ),
        'bp_vitals_red_flag', v_alert_lvl, 'clinician_alerts', v_alert_id
      );
    end loop;
  end if;

  return new;
end;
$$;

create or replace function private.handle_pulse_reading_red_flag()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_level       text;
  v_alert_lvl   public.alert_level;
  v_esc         smallint;
  v_sla         interval;
  v_title       text;
  v_detail      text;
  v_level_label text;
  v_existing    public.clinician_alerts%rowtype;
  v_alert_id    uuid;
  v_should_page boolean := false;
  v_has_escalation_access boolean;
  r public.profiles%rowtype;
begin
  if new.vital_type <> 'pulse' then
    return new;
  end if;

  v_level := private.classify_pulse_level(new.pulse_bpm);
  if v_level in ('unknown', 'green') then
    return new;
  end if;

  v_detail := format('Heart rate reading %s bpm logged %s.',
                     new.pulse_bpm, to_char(new.taken_at, 'YYYY-MM-DD HH24:MI'));

  -- EMERGENCY: hand off to emergency_events (its own trigger raises the
  -- Priority-1 alert + audit + acknowledge-gated contact notify + follow-up,
  -- and already applies the same plan gate + self-care fallback).
  if v_level = 'emergency' then
    if not exists (
      select 1 from public.emergency_events e
      where e.patient_id = new.patient_id
        and e.source = 'pulse_red_flag'
        and e.status = 'active'
        and e.created_at > now() - interval '6 hours'
    ) then
      insert into public.emergency_events
        (organisation_id, patient_id, source, trigger_detail, status, vital_reading_id)
      values (
        new.organisation_id, new.patient_id, 'pulse_red_flag',
        v_detail || ' This is a severely fast or slow heart rate.',
        'active', new.id
      );
    end if;
    return new;
  end if;

  v_has_escalation_access := private.patient_has_feature_access(new.patient_id, 'vitals_red_flag_doctor_escalation');

  -- Still hardcoded, deliberately: pulse_vitals_red_flag is registered by this
  -- migration only as an UNSIGNED draft, and private.escalation_sla_minutes
  -- reads the ACTIVE config, so switching to it here would raise until a
  -- Clinical Director signs. These two literals are exactly the values that
  -- draft transcribes (60 min / 4320 min); move this function onto
  -- escalation_sla_minutes in the same change that brings the draft into force.
  if v_level = 'red' then
    v_alert_lvl := 'urgent_escalation'; v_esc := 3; v_sla := interval '1 hour';
    v_title := 'Priority 1: abnormal heart rate reading';
    v_detail := v_detail || ' Please review same day and confirm reading technique/context.';
    v_level_label := 'Priority 1';
  else
    v_alert_lvl := 'clinician_review'; v_esc := 2; v_sla := interval '72 hours';
    v_title := 'Heart rate outside typical range';
    v_detail := v_detail || ' Outside typical range — review symptoms, medication and context (rest vs. activity).';
    v_level_label := 'Review needed';
  end if;

  if v_has_escalation_access then
    select ca.* into v_existing
    from public.clinician_alerts ca
    join public.vitals_readings vr on vr.id = ca.vital_reading_id
    where ca.patient_id = new.patient_id
      and vr.vital_type = 'pulse'
      and ca.status = 'open'
    order by ca.created_at desc
    limit 1;

    if v_existing.id is not null then
      if v_esc >= coalesce(v_existing.escalation_level, 0) then
        update public.clinician_alerts
          set level = v_alert_lvl, escalation_level = v_esc, title = v_title,
              detail = v_detail, sla_due_at = now() + v_sla,
              vital_reading_id = new.id, updated_at = now()
        where id = v_existing.id;
        v_alert_id := v_existing.id;
        if v_esc > coalesce(v_existing.escalation_level, 0) then
          v_should_page := true;
        end if;
      end if;
    else
      insert into public.clinician_alerts
        (organisation_id, patient_id, level, status, title, detail, sla_due_at,
         escalation_level, vital_reading_id)
      values (
        new.organisation_id, new.patient_id, v_alert_lvl, 'open', v_title, v_detail,
        now() + v_sla, v_esc, new.id
      )
      returning id into v_alert_id;
      v_should_page := true;
    end if;
  else
    -- Free tier: no clinician_alerts row, no paging — the patient still gets
    -- an immediate, specific self-care suggestion. This is the same
    -- deterministic safety net BP/SpO2/temperature already give a Free
    -- patient, never silence.
    perform private.raise_dangerous_reading_ai_suggestion(
      new.organisation_id, new.patient_id, 'heart rate', v_level_label,
      'Sit down and rest for a few minutes, then recheck your heart rate — ideally with a proper pulse oximeter or blood-pressure monitor rather than relying on the wearable reading alone. If it stays this fast or slow, or you feel dizzy, faint, chest pain, or short of breath, seek care promptly.'
    );
  end if;

  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (new.organisation_id, new.patient_id, 'pulse_red_flag.raised', 'vitals_readings', new.id,
    jsonb_build_object('level', v_level, 'pulse_bpm', new.pulse_bpm, 'source', new.source,
                       'escalation_gated_by_plan', not v_has_escalation_access));

  if v_should_page then
    -- No `and phone is not null` — see the bp handler above.
    for r in
      select * from public.profiles
      where organisation_id = new.organisation_id and role = 'clinician'
    loop
      perform private.enqueue_critical_notification(
        new.organisation_id, r.id, 'vitals_red_flag_clinician_alert',
        jsonb_build_object(
          'patient_name', coalesce((select full_name from public.profiles where id = new.patient_id), 'A patient'),
          'vital_label', 'heart rate',
          'level_label', v_level_label
        ),
        'pulse_vitals_red_flag', v_alert_lvl, 'clinician_alerts', v_alert_id
      );
    end loop;
  end if;

  return new;
end;
$$;

create or replace function private.handle_spo2_reading_red_flag()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_level     text;
  v_alert_lvl public.alert_level;
  v_esc       smallint;
  v_sla       interval;
  v_title     text;
  v_detail    text;
  v_existing  public.clinician_alerts%rowtype;
  v_alert_id  uuid;
  v_should_page boolean := false;
  v_level_label text;
  r           public.profiles%rowtype;
  v_has_escalation_access boolean;
  v_amber_threshold smallint;
begin
  if new.vital_type <> 'spo2' then
    return new;
  end if;

  v_level := private.classify_spo2_level(new.spo2_pct);

  -- §6.10 individualised-target upgrade (mirrors BP's H5.3): a green
  -- reading is upgraded to amber if it crosses THIS patient's own,
  -- clinician-set threshold. Never touches red/emergency — those stay the
  -- fixed population safety floor for every patient.
  if v_level = 'green' and new.spo2_pct is not null then
    select amber_threshold_pct into v_amber_threshold
    from public.patient_spo2_targets where patient_id = new.patient_id;
    if v_amber_threshold is not null and new.spo2_pct <= v_amber_threshold then
      v_level := 'amber';
    end if;
  end if;

  if v_level in ('unknown', 'green') then
    return new;
  end if;

  v_detail := format('SpO2 reading %s%% logged %s.',
                     new.spo2_pct, to_char(new.taken_at, 'YYYY-MM-DD HH24:MI'));

  if v_level = 'emergency' then
    if not exists (
      select 1 from public.emergency_events e
      where e.patient_id = new.patient_id
        and e.source = 'spo2_red_flag'
        and e.status = 'active'
        and e.created_at > now() - interval '6 hours'
    ) then
      insert into public.emergency_events
        (organisation_id, patient_id, source, trigger_detail, status, vital_reading_id)
      values (
        new.organisation_id, new.patient_id, 'spo2_red_flag',
        v_detail || ' This is in the hypoxia / emergency range.',
        'active', new.id
      );
    end if;
    return new;
  end if;

  v_has_escalation_access := private.patient_has_feature_access(new.patient_id, 'vitals_red_flag_doctor_escalation');

  if v_level = 'red' then
    v_alert_lvl := 'urgent_escalation'; v_esc := 3;
    v_sla := private.escalation_sla_minutes('spo2_vitals_red_flag', 'urgent_escalation') * interval '1 minute';
    v_title := 'Priority 1: low oxygen saturation reading';
    v_detail := v_detail || ' Please review same day and confirm reading technique.';
    v_level_label := 'Priority 1';
  else
    v_alert_lvl := 'clinician_review'; v_esc := 2;
    v_sla := private.escalation_sla_minutes('spo2_vitals_red_flag', 'clinician_review') * interval '1 minute';
    v_title := 'Oxygen saturation below target';
    v_detail := v_detail || ' Below target — review symptoms and recheck.';
    v_level_label := 'Review needed';
  end if;

  if v_has_escalation_access then
    select ca.* into v_existing
    from public.clinician_alerts ca
    join public.vitals_readings vr on vr.id = ca.vital_reading_id
    where ca.patient_id = new.patient_id
      and vr.vital_type = 'spo2'
      and ca.status = 'open'
    order by ca.created_at desc
    limit 1;

    if v_existing.id is not null then
      if v_esc >= coalesce(v_existing.escalation_level, 0) then
        update public.clinician_alerts
          set level = v_alert_lvl, escalation_level = v_esc, title = v_title,
              detail = v_detail, sla_due_at = now() + v_sla,
              vital_reading_id = new.id, updated_at = now()
        where id = v_existing.id;
        v_alert_id := v_existing.id;
        if v_esc > coalesce(v_existing.escalation_level, 0) then
          v_should_page := true;
        end if;
      end if;
    else
      insert into public.clinician_alerts
        (organisation_id, patient_id, level, status, title, detail, sla_due_at,
         escalation_level, vital_reading_id)
      values (
        new.organisation_id, new.patient_id, v_alert_lvl, 'open', v_title, v_detail,
        now() + v_sla, v_esc, new.id
      )
      returning id into v_alert_id;
      v_should_page := true;
    end if;
  else
    perform private.raise_dangerous_reading_ai_suggestion(
      new.organisation_id, new.patient_id, 'oxygen saturation', v_level_label,
      'Sit upright, take slow, deep breaths, and recheck in about 15 minutes. If your reading stays low, or you feel short of breath, dizzy, or unwell, seek care promptly.'
    );
  end if;

  insert into public.audit_log
    (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (
    new.organisation_id, new.patient_id, 'spo2_red_flag.raised',
    'vitals_readings', new.id,
    jsonb_build_object('level', v_level, 'spo2_pct', new.spo2_pct,
                       'escalation_gated_by_plan', not v_has_escalation_access)
  );

  if v_should_page then
    -- No `and phone is not null` — see the bp handler above.
    for r in
      select * from public.profiles
      where organisation_id = new.organisation_id and role = 'clinician'
    loop
      perform private.enqueue_critical_notification(
        new.organisation_id, r.id, 'vitals_red_flag_clinician_alert',
        jsonb_build_object(
          'patient_name', coalesce((select full_name from public.profiles where id = new.patient_id), 'A patient'),
          'vital_label', 'oxygen saturation',
          'level_label', v_level_label
        ),
        'spo2_vitals_red_flag', v_alert_lvl, 'clinician_alerts', v_alert_id
      );
    end loop;
  end if;

  return new;
end;
$$;

create or replace function private.handle_temperature_reading_red_flag()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_level     text;
  v_alert_lvl public.alert_level;
  v_esc       smallint;
  v_sla       interval;
  v_title     text;
  v_detail    text;
  v_existing  public.clinician_alerts%rowtype;
  v_alert_id  uuid;
  v_should_page boolean := false;
  v_level_label text;
  r           public.profiles%rowtype;
  v_has_escalation_access boolean;
  v_amber_threshold numeric;
begin
  if new.vital_type <> 'temperature' then
    return new;
  end if;

  v_level := private.classify_temperature_level(new.temperature_c);

  -- §6.10 individualised-target upgrade — same shape as SpO2 above.
  if v_level = 'green' and new.temperature_c is not null then
    select amber_threshold_c into v_amber_threshold
    from public.patient_temperature_targets where patient_id = new.patient_id;
    if v_amber_threshold is not null and new.temperature_c >= v_amber_threshold then
      v_level := 'amber';
    end if;
  end if;

  if v_level in ('unknown', 'green') then
    return new;
  end if;

  v_detail := format('Temperature reading %sC logged %s.',
                     new.temperature_c, to_char(new.taken_at, 'YYYY-MM-DD HH24:MI'));

  if v_level = 'emergency' then
    if not exists (
      select 1 from public.emergency_events e
      where e.patient_id = new.patient_id
        and e.source = 'temperature_red_flag'
        and e.status = 'active'
        and e.created_at > now() - interval '6 hours'
    ) then
      insert into public.emergency_events
        (organisation_id, patient_id, source, trigger_detail, status, vital_reading_id)
      values (
        new.organisation_id, new.patient_id, 'temperature_red_flag',
        v_detail || ' This is in the hyperpyrexia/hypothermia emergency range.',
        'active', new.id
      );
    end if;
    return new;
  end if;

  v_has_escalation_access := private.patient_has_feature_access(new.patient_id, 'vitals_red_flag_doctor_escalation');

  if v_level = 'red' then
    v_alert_lvl := 'urgent_escalation'; v_esc := 3;
    v_sla := private.escalation_sla_minutes('temperature_vitals_red_flag', 'urgent_escalation') * interval '1 minute';
    v_title := 'Priority 1: high fever reading';
    v_detail := v_detail || ' Sepsis-relevant range — please review same day.';
    v_level_label := 'Priority 1';
  else
    v_alert_lvl := 'clinician_review'; v_esc := 2;
    v_sla := private.escalation_sla_minutes('temperature_vitals_red_flag', 'clinician_review') * interval '1 minute';
    v_title := 'Fever reading logged';
    v_detail := v_detail || ' Review symptoms and recheck.';
    v_level_label := 'Review needed';
  end if;

  if v_has_escalation_access then
    select ca.* into v_existing
    from public.clinician_alerts ca
    join public.vitals_readings vr on vr.id = ca.vital_reading_id
    where ca.patient_id = new.patient_id
      and vr.vital_type = 'temperature'
      and ca.status = 'open'
    order by ca.created_at desc
    limit 1;

    if v_existing.id is not null then
      if v_esc >= coalesce(v_existing.escalation_level, 0) then
        update public.clinician_alerts
          set level = v_alert_lvl, escalation_level = v_esc, title = v_title,
              detail = v_detail, sla_due_at = now() + v_sla,
              vital_reading_id = new.id, updated_at = now()
        where id = v_existing.id;
        v_alert_id := v_existing.id;
        if v_esc > coalesce(v_existing.escalation_level, 0) then
          v_should_page := true;
        end if;
      end if;
    else
      insert into public.clinician_alerts
        (organisation_id, patient_id, level, status, title, detail, sla_due_at,
         escalation_level, vital_reading_id)
      values (
        new.organisation_id, new.patient_id, v_alert_lvl, 'open', v_title, v_detail,
        now() + v_sla, v_esc, new.id
      )
      returning id into v_alert_id;
      v_should_page := true;
    end if;
  else
    perform private.raise_dangerous_reading_ai_suggestion(
      new.organisation_id, new.patient_id, 'temperature', v_level_label,
      'Rest and stay hydrated, and take paracetamol if needed for fever; recheck your temperature in a few hours. If it stays this high, or you feel very unwell, seek care promptly.'
    );
  end if;

  insert into public.audit_log
    (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (
    new.organisation_id, new.patient_id, 'temperature_red_flag.raised',
    'vitals_readings', new.id,
    jsonb_build_object('level', v_level, 'temperature_c', new.temperature_c,
                       'escalation_gated_by_plan', not v_has_escalation_access)
  );

  if v_should_page then
    -- No `and phone is not null` — see the bp handler above.
    for r in
      select * from public.profiles
      where organisation_id = new.organisation_id and role = 'clinician'
    loop
      perform private.enqueue_critical_notification(
        new.organisation_id, r.id, 'vitals_red_flag_clinician_alert',
        jsonb_build_object(
          'patient_name', coalesce((select full_name from public.profiles where id = new.patient_id), 'A patient'),
          'vital_label', 'temperature',
          'level_label', v_level_label
        ),
        'temperature_vitals_red_flag', v_alert_lvl, 'clinician_alerts', v_alert_id
      );
    end loop;
  end if;

  return new;
end;
$$;

create or replace function private.handle_emergency_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_alert_id uuid;
  v_c_name  text;
  v_c_rel   text;
  v_c_phone text;
  v_contact_line text := '';
  v_actor uuid := (select auth.uid());
  v_reporter_line text := '';
  r public.profiles%rowtype;
  v_has_escalation_access boolean;
  v_source_label text;
begin
  select emergency_contact_name, emergency_contact_relationship, emergency_contact_phone
    into v_c_name, v_c_rel, v_c_phone
  from public.profiles where id = new.patient_id;
  if v_c_phone is not null then
    v_contact_line := format(' Emergency contact: %s%s — %s.',
      coalesce(v_c_name, 'on file'),
      case when v_c_rel is not null then ' (' || v_c_rel || ')' else '' end,
      v_c_phone);
  end if;

  if v_actor is not null and v_actor <> new.patient_id then
    v_reporter_line := format(' Reported by %s on the patient''s behalf, not by the patient themselves.',
      coalesce((select nullif(trim(full_name), '') from public.profiles where id = v_actor),
               'someone acting for them'));
  end if;

  if new.clinician_alert_id is null then
    v_has_escalation_access := private.patient_has_feature_access(new.patient_id, 'vitals_red_flag_doctor_escalation');

    if v_has_escalation_access then
      insert into public.clinician_alerts
        (organisation_id, patient_id, level, status, title, detail, sla_due_at, escalation_level)
      values (
        new.organisation_id,
        new.patient_id,
        'emergency',
        'open',
        'Priority 1: emergency reported',
        format('Emergency event (source: %s).%s%s%s',
               new.source,
               case when new.trigger_detail is not null then ' ' || new.trigger_detail else '' end,
               v_reporter_line,
               v_contact_line),
        now() + (private.escalation_sla_minutes('emergency_event', 'emergency') * interval '1 minute'),
        4
      )
      returning id into v_alert_id;

      new.clinician_alert_id := v_alert_id;

      -- No `and phone is not null`. This is the plan-independent emergency
      -- path: the recipient filter meant a genuine emergency alert notified
      -- nobody on a platform where no clinician profile carries a phone,
      -- even though its first channel (push) never needed one.
      for r in
        select * from public.profiles
        where organisation_id = new.organisation_id and role = 'clinician'
      loop
        perform private.enqueue_critical_notification(
          new.organisation_id, r.id, 'emergency_event_clinician_alert',
          jsonb_build_object(
            'patient_name', coalesce((select full_name from public.profiles where id = new.patient_id), 'A patient'),
            'source_label', new.source::text
          ),
          'emergency_event', 'emergency', 'clinician_alerts', v_alert_id
        );
      end loop;
    else
      -- Free tier: no clinician_alerts row, no paging — the patient still
      -- gets the full emergency_events safety net (this row itself, the
      -- acknowledge-gated hospital-now dialog, emergency-contact auto-notify,
      -- follow-up check-in) plus a specific self-care suggestion.
      v_source_label := replace(new.source::text, '_', ' ');
      perform private.raise_dangerous_reading_ai_suggestion(
        new.organisation_id, new.patient_id, v_source_label, 'Needs prompt attention',
        case new.source
          when 'bp_reading' then 'This is a hypertensive-crisis-range blood pressure reading. Sit down, rest, and recheck in a few minutes; if it stays this high, or you have a headache, chest pain, or blurred vision, go to the nearest hospital now.'
          when 'spo2_red_flag' then 'This is a very low oxygen reading. Sit upright, breathe slowly, and recheck in a few minutes; if it does not come back up or you feel breathless, go to the nearest hospital now.'
          when 'temperature_red_flag' then 'This is a very high or very low temperature reading. Rest, stay hydrated or warm as appropriate, and recheck soon; if you feel very unwell, go to the nearest hospital now.'
          when 'glucose_red_flag' then 'This is a severe blood sugar reading (very low or very high with raised ketones). Follow your usual emergency steps for this now, and go to the nearest hospital if you do not recover quickly or feel worse.'
          when 'pulse_red_flag' then 'This is a very fast or very slow heart rate reading. Sit down, rest, and recheck in a few minutes — ideally with a proper pulse oximeter or blood-pressure monitor rather than relying on the wearable reading alone. If it stays this extreme, or you feel dizzy, faint, chest pain, or short of breath, go to the nearest hospital now.'
          else 'This reading or symptom is in a range that needs prompt in-person attention. Please follow the emergency guidance above and go to the nearest hospital now.'
        end
      );
    end if;
  end if;

  insert into public.audit_log
    (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (
    new.organisation_id,
    coalesce(v_actor, new.patient_id),
    'emergency_event.created',
    'emergency_events',
    new.id,
    jsonb_build_object('source', new.source, 'clinician_alert_id', new.clinician_alert_id,
                       'patient_id', new.patient_id,
                       'escalation_gated_by_plan', new.clinician_alert_id is null)
  );

  return new;
end;
$$;


-- ---------------------------------------------------------------------------
-- 6. Assertions — the migration is the test.
--
--    6a is structural: no clinician recipient loop may filter on a phone
--        number any more, in any of the five.
--    6b is functional, in a subtransaction that is unwound before this
--        migration commits: a RED-band BP reading from an entitled patient
--        must now produce notification rows where it previously produced
--        none, and a control proves the count came from THIS reading.
-- ---------------------------------------------------------------------------
do $$
declare
  v_fn    text;
  v_src   text;
  v_org   uuid;
  v_docs  integer;
  v_paid  uuid := gen_random_uuid();
  v_before integer;
  v_after  integer;
  v_alerts integer;
  v_product uuid;
  v_price  bigint;
  v_fail   text;
begin
  ------------------------------------------------------------------ 6a
  foreach v_fn in array array[
    'handle_bp_reading_red_flag', 'handle_pulse_reading_red_flag',
    'handle_spo2_reading_red_flag', 'handle_temperature_reading_red_flag',
    'handle_emergency_event'
  ] loop
    select p.prosrc into v_src
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'private' and p.proname = v_fn;
    if v_src is null then
      raise exception 'FAIL 6a: private.% does not exist', v_fn;
    end if;
    if v_src ~ 'role\s*=\s*''clinician''\s*and\s*phone\s+is\s+not\s+null' then
      raise exception 'FAIL 6a: private.% still filters its clinician recipients on phone is not null', v_fn;
    end if;
    if v_src !~ 'role\s*=\s*''clinician''' then
      raise exception 'FAIL 6a: private.% no longer selects clinician recipients at all', v_fn;
    end if;
  end loop;

  ------------------------------------------------------------------ 6b
  select organisation_id into v_org
    from public.profiles where role = 'patient' and organisation_id is not null limit 1;
  select count(*) into v_docs
    from public.profiles where organisation_id = v_org and role = 'clinician';

  select id, price_kobo into v_product, v_price
    from public.service_products
   where is_active and 'vitals_red_flag_doctor_escalation' = any(features)
   order by code limit 1;

  if v_org is null or v_docs = 0 or v_product is null then
    raise notice 'structural check only (org=%, clinicians=%, entitlement product=%)', v_org, v_docs, v_product;
  else
    begin
      insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
      values (v_paid, 'rfp-paid@example.invalid', 'x', now(), '{}', '{}');
      insert into public.profiles (id, organisation_id, role, full_name)
      values (v_paid, v_org, 'patient', 'RFP Paid Patient')
      on conflict (id) do update
        set organisation_id = excluded.organisation_id, role = excluded.role, full_name = excluded.full_name;
      insert into public.service_purchases
        (organisation_id, patient_id, purchaser_profile_id, service_product_id,
         status, amount_kobo, currency, purchased_at, expires_at)
      values (v_org, v_paid, v_paid, v_product, 'active', v_price, 'NGN', now(), now() + interval '84 days');

      -- Nobody in this org has a phone, so under the old predicate this count
      -- could not move. Deliberately counted before and after the SAME reading.
      select count(*) into v_before
        from public.notifications
       where organisation_id = v_org and template = 'vitals_red_flag_clinician_alert';

      -- 178/104: RED per private.classify_bp_level (>=160 systolic), NOT
      -- emergency (>=200/>=120), so it exercises the clinician_alerts +
      -- paging path rather than the plan-independent emergency route.
      insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic)
      values (v_org, v_paid, 'blood_pressure', 178, 104);

      select count(*) into v_alerts
        from public.clinician_alerts where patient_id = v_paid and status = 'open';
      select count(*) into v_after
        from public.notifications
       where organisation_id = v_org and template = 'vitals_red_flag_clinician_alert';

      if v_alerts = 0 then
        v_fail := 'FAIL 6b: the RED-band reading raised no clinician_alerts row at all';
      elsif v_after - v_before <> v_docs then
        v_fail := format('FAIL 6b: expected one notification per clinician (%s), got %s — the recipient loop is still dropping phone-less clinicians',
                         v_docs, v_after - v_before);
      end if;

      raise exception using errcode = 'TG778', message = 'unwind fixture';
    exception
      when sqlstate 'TG778' then null;
    end;
  end if;

  if v_fail is not null then
    raise exception '%', v_fail;
  end if;

  raise notice 'PASS: none of the five handlers filters clinician recipients on a phone number, and a RED-band reading now enqueues one notification per clinician in the organisation';
end $$;
