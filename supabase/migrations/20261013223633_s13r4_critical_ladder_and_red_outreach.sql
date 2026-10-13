-- S13 R4 (plan S11-S15, CMO answers Q10 to Q13, OQ-91/92/94): the critical path for red alerts.
--
--   1. Q10  A patient's critical ladder is push, email, in-app (never sms or voice). Staff ladders are untouched.
--   2. Q11  A red alert the patient has not confirmed within 30 minutes (PROPOSED, notifications.rules v4) opens ONE
--           clinician outreach task ("call the patient") and alerts the on-call clinician. Free: no clinician, no task.
--           The task type must be confirmed by the CMO on the sign-off hub before any task is created.
--   3.      A push receipt error on a critical row fails the row (the ladder moves on) and pulls the outreach forward.
--   4. Q13  The patient's "I sought care / I could not get care" answer is an append-only record shown to the on-call
--           clinician. It never stops paging: only a clinician acknowledgement does.
--   5. OQ-94 The INV-07 term list runs when a broadcast is written, and is callable for other free text.
--   6.      "Send me a test alert" for the notifications-not-arriving card.
--
-- LIVE COUNTS BEFORE (2026-10-13, read only): triage_events 0, pages 0, emergency_events 5 (all acknowledged), red-flag
-- patient notifications of kind sms 6 (all failed by the INV-08 trigger). No conversion step is needed.
-- Rewritten functions start from their LIVE definitions (pg_get_functiondef), not from older migration files.
-- No begin/commit here: the auto-apply workflow wraps this file.

-- ---------------------------------------------------------------------------------------------------------------------
-- 1. Config: notifications.rules v4 (PROPOSED, mirrored in packages/shared proposed-config as notifications.rules v4)
-- ---------------------------------------------------------------------------------------------------------------------
do $rules$
declare v_cfg jsonb; v_next integer;
begin
  select config into v_cfg from public.notification_rules_config where is_active order by version desc limit 1;
  if v_cfg is null then raise exception 'S13 R4: no active notification_rules_config row to copy'; end if;
  select max(version) + 1 into v_next from public.notification_rules_config;
  update public.notification_rules_config set is_active = false where is_active;
  insert into public.notification_rules_config (version, is_active, config, note) values
    (v_next, true,
     v_cfg || jsonb_build_object('redUnconfirmed',
       -- red-unconfirmed-rules-begin
       $json${"enabled":true,"unconfirmedMinutes":30,"undeliveredMinutes":5,"expireHours":6,"deliveredCountsAsConfirmed":true,"couldNotGetCareOutreachNow":true,"criticalReceiptCheckMinutes":2}$json$::jsonb
       -- red-unconfirmed-rules-end
     ),
     'S13 R4 PROPOSED: a red alert unconfirmed for 30 minutes (CMO Q11) opens a clinician outreach task; a push receipt error pulls it forward to 5 minutes; critical Expo tickets are checked from 2 minutes. All other values copied from the previous active row.');
end $rules$;

create function private.red_rule(p_key text) returns text
language sql stable security definer set search_path = ''
as $$ select config -> 'redUnconfirmed' ->> p_key from public.notification_rules_config where is_active $$;
revoke all on function private.red_rule(text) from public, anon, authenticated;

create function private.red_rules_version() returns integer
language sql stable security definer set search_path = ''
as $$ select version from public.notification_rules_config where is_active $$;
revoke all on function private.red_rules_version() from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- 2. Q10: the patient ladder
-- ---------------------------------------------------------------------------------------------------------------------
-- A recipient with no profile is treated as a patient (the safe direction: no sms).
create function private.recipient_is_patient(p_recipient uuid) returns boolean
language sql stable security definer set search_path = ''
as $$ select coalesce((select role = 'patient' from public.profiles where id = p_recipient), true) $$;
revoke all on function private.recipient_is_patient(uuid) from public, anon, authenticated;

create function private.patient_critical_channels(p_recipient uuid, p_channels public.notification_channel[])
returns public.notification_channel[]
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_out public.notification_channel[] := '{}';
  c public.notification_channel;
begin
  if not private.recipient_is_patient(p_recipient) then return p_channels; end if;
  foreach c in array coalesce(p_channels, '{}') loop
    if c in ('sms', 'voice', 'in_app') or c = any (v_out) then continue; end if;
    v_out := v_out || c;
  end loop;
  return v_out || 'in_app'::public.notification_channel;
end;
$$;
revoke all on function private.patient_critical_channels(uuid, public.notification_channel[]) from public, anon, authenticated;

-- LIVE definition, plus: (a) the patient ladder filter; (b) a pending in-app row that is itself the last hop of a patient
-- ladder is an eligible row, so the ladder can finish with the existing "exhausted" admin alert instead of ending
-- silently; (c) a test alert is never laddered, and a patient's red notices are not laddered either (the red timer is their ladder).
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
  v_since timestamptz;

  c_default_channels constant public.notification_channel[] :=
    array['push', 'email', 'sms']::public.notification_channel[];
  c_default_sla_minutes constant int := 120;
  c_lookback constant interval := interval '7 days';
begin
  for r in
    select n.*
    from public.notifications n
    where n.priority = 'critical'
      and n.opened_at is null
      and n.created_at > now() - c_lookback
      and n.template is distinct from 'critical_notification_escalation_exhausted'
      and (n.status = 'failed'
           or (n.status in ('sent', 'delivered') and n.sent_at is not null)
           or (n.channel = 'in_app' and n.status = 'pending' and n.escalated_from_id is not null
               and private.recipient_is_patient(n.recipient_id)))
      and coalesce(n.source_table, '') <> 'test_alert'
      and (coalesce(n.source_table, '') <> 'red_alert_watch' or not private.recipient_is_patient(n.recipient_id))
      and not exists (select 1 from public.notifications nxt where nxt.escalated_from_id = n.id)
      and not exists (select 1 from public.notification_escalation_failures f where f.notification_id = n.id)
  loop
    if r.escalation_pathway is null then
      v_channels    := c_default_channels;
      v_sla_minutes := c_default_sla_minutes;
    else
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
    -- Q10 (CMO 2026-10-07): a patient's ladder ends push, email, in-app. Staff ladders are returned unchanged.
    v_channels := private.patient_critical_channels(r.recipient_id, v_channels);
    v_sla_minutes := coalesce(v_sla_minutes, c_default_sla_minutes);
    v_total_channels := array_length(v_channels, 1);

    if r.status <> 'failed' then
      v_hop_minutes := greatest(2, floor(v_sla_minutes::numeric / v_total_channels));
      v_since := coalesce(r.sent_at, r.created_at);
      if now() - v_since < (v_hop_minutes || ' minutes')::interval then
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

-- LIVE definition, plus the patient ladder filter on hop 1.
create or replace function private.enqueue_critical_notification(
  p_organisation_id uuid, p_recipient_id uuid, p_template text, p_payload jsonb, p_pathway text,
  p_alert_tier public.alert_level, p_source_table text default null, p_source_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_raw text[];
  v_channels public.notification_channel[];
  v_id uuid;
begin
  v_raw := private.escalation_channel_sequence_or_null(p_pathway, p_alert_tier);
  v_channels := private.normalize_escalation_channels(coalesce(v_raw, array[]::text[]));
  if array_length(v_channels, 1) is null then
    v_channels := array['push', 'email', 'sms']::public.notification_channel[];
    raise warning 'escalation_slas has no active entry for pathway=% tier=% — notifying on the default channel sequence instead',
      p_pathway, p_alert_tier;
  end if;
  v_channels := private.patient_critical_channels(p_recipient_id, v_channels);

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
$function$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 3. Receipts: an error on a critical push fails the row so the ladder moves on at once
-- ---------------------------------------------------------------------------------------------------------------------
create function private.fail_critical_push_if_undelivered(p_notification uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare n public.notifications%rowtype;
begin
  select * into n from public.notifications where id = p_notification for update;
  if not found or n.priority <> 'critical' or n.channel <> 'push' or n.status <> 'sent'
     or n.delivered_at is not null or n.opened_at is not null then return; end if;
  if exists (select 1 from public.notification_delivery_events e where e.notification_id = p_notification and e.event = 'delivered') then return; end if;
  -- another ticket for the same notification (a second phone) has no outcome yet: wait for it
  if exists (
    select 1 from public.notification_delivery_events e
     where e.notification_id = p_notification and e.event = 'receipt_pending'
       and not exists (select 1 from public.notification_delivery_events r
                        where r.provider_ref = e.provider_ref and r.event in ('delivered', 'failed', 'token_dead'))
  ) then return; end if;
  update public.notifications set status = 'failed', failed_at = now(), last_error = 'push receipt: not delivered'
   where id = p_notification;
end;
$$;
revoke all on function private.fail_critical_push_if_undelivered(uuid) from public, anon, authenticated;

-- LIVE definition (pg_get_functiondef 2026-10-13) plus one call.
create or replace function public.record_notification_delivery_event(
  p_notification_id uuid, p_event text, p_provider text default null, p_provider_ref text default null,
  p_detail jsonb default '{}'::jsonb)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare v_org uuid; v_id uuid; v_sub uuid; v_email text;
begin
  select organisation_id into v_org from public.notifications where id = p_notification_id;
  if v_org is null then raise exception 'unknown notification' using errcode = '22023'; end if;
  insert into public.notification_delivery_events (notification_id, organisation_id, event, provider, provider_ref, detail)
  values (p_notification_id, v_org, p_event, p_provider, p_provider_ref, coalesce(p_detail, '{}'::jsonb))
  returning id into v_id;
  if p_event = 'delivered' then
    update public.notifications set delivered_at = coalesce(delivered_at, now()) where id = p_notification_id;
  elsif p_event = 'opened' then
    update public.notifications set opened_at = coalesce(opened_at, now()) where id = p_notification_id;
  elsif p_event = 'token_dead' then
    begin v_sub := (p_detail ->> 'subscription_id')::uuid; exception when others then v_sub := null; end;
    if v_sub is not null then
      update public.push_subscriptions set disabled_at = coalesce(disabled_at, now()) where id = v_sub;
    end if;
  elsif p_event in ('bounced', 'complained') then
    v_email := lower(nullif(p_detail ->> 'email', ''));
    if v_email is not null then
      insert into public.notification_email_suppressions (email, reason) values (v_email, p_event)
      on conflict (email) do nothing;
    end if;
  end if;
  if p_event in ('failed', 'token_dead') and p_provider = 'expo' then
    perform private.fail_critical_push_if_undelivered(p_notification_id);
  end if;
  return v_id;
end $function$;

-- LIVE definition, plus: a ticket for a critical notification is checked from criticalReceiptCheckMinutes (2), not 15.
create or replace function public.claim_expo_receipt_checks(p_limit integer default 100, p_min_age_minutes integer default 15, p_max_age_hours integer default 24)
returns table (event_id uuid, notification_id uuid, provider_ref text, subscription_id uuid)
language sql stable security definer set search_path to 'pg_catalog', 'public'
as $function$
  select e.id, e.notification_id, e.provider_ref, nullif(e.detail ->> 'subscription_id', '')::uuid
    from public.notification_delivery_events e
    join public.notifications n on n.id = e.notification_id
   where e.event = 'receipt_pending'
     and e.occurred_at <= now() - make_interval(mins => greatest(
           case when n.priority = 'critical'
                then least(p_min_age_minutes, coalesce(nullif(private.red_rule('criticalReceiptCheckMinutes'), '')::integer, p_min_age_minutes))
                else p_min_age_minutes end, 1))
     and e.occurred_at >= now() - make_interval(hours => greatest(p_max_age_hours, 1))
     and not exists (
       select 1 from public.notification_delivery_events r
        where r.provider_ref = e.provider_ref and r.id <> e.id and r.event in ('delivered', 'failed', 'token_dead'))
   order by e.occurred_at
   limit least(greatest(p_limit, 1), 500)
$function$;

-- The receipts job runs every 10 minutes; a 2 minute first check is wasted at that spacing, so a critical tick every
-- 2 minutes would need its own job. One extra job on its own odd minute, calling the same function with a short age.
-- (The existing job and its secret are reused: this is a second schedule of the same function, not a new function.)
do $$
declare v_cmd text;
begin
  select command into v_cmd from cron.job where jobname = 'expo-push-receipts';
  if v_cmd is not null and not exists (select 1 from cron.job where jobname = 'expo-push-receipts-critical') then
    perform cron.schedule('expo-push-receipts-critical', '3-59/5 * * * *', v_cmd);
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 4. Task type (data, not code). Needs the CMO's confirmation before any task is created.
-- ---------------------------------------------------------------------------------------------------------------------
insert into public.task_types
  (code, version, priority_class, default_due_minutes, min_doctor_tier, required_competencies, lead_window_minutes,
   claim_timeout_minutes, pushable, creatable, source_task_keys, note, needs_confirmation)
select 'red_patient_outreach', 1, 1, 15, 'senior_medical_officer', '{on_call}', 0, 30, false, true, '{}',
       'S13 R4 (CMO Q11): call the patient. Created when a red alert the patient has not confirmed within the configured minutes. Never has a lead window (INV-05). Awaits the CMO''s confirmation.',
       true
 where not exists (select 1 from public.task_types where code = 'red_patient_outreach');

create function private.task_type_confirmed(p_code text) returns boolean
language sql stable security definer set search_path = ''
as $$ select coalesce((select (not needs_confirmation) or confirmed_at is not null from public.task_types where code = p_code and is_active), false) $$;
revoke all on function private.task_type_confirmed(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- 5. Tables
-- ---------------------------------------------------------------------------------------------------------------------
create table public.red_alert_watch (
  id                 uuid primary key default gen_random_uuid(),
  organisation_id    uuid not null references public.organisations (id) on delete restrict,
  patient_id         uuid not null references public.profiles (id) on delete cascade,
  source_kind        text not null check (source_kind in ('emergency_event', 'triage_event')),
  source_id          uuid not null,
  state              text not null default 'watching'
                       check (state in ('watching', 'confirmed', 'clinician_acknowledged', 'outreach_created', 'skipped_free', 'expired')),
  confirmed_via      text,
  opened_at          timestamptz not null default now(),
  due_at             timestamptz not null,
  push_undelivered_at timestamptz,
  waiting_cmo_at     timestamptz,
  outreach_task_id   uuid references public.clinical_tasks (id) on delete set null,
  outreach_at        timestamptz,
  rules_version      integer,
  is_test            boolean not null default false,
  created_at         timestamptz not null default now(),
  unique (source_kind, source_id)
);
create index red_alert_watch_open_idx on public.red_alert_watch (opened_at) where state in ('watching', 'outreach_created');
create index red_alert_watch_patient_idx on public.red_alert_watch (patient_id, opened_at desc);
alter table public.red_alert_watch enable row level security;
create policy red_alert_watch_admin_read on public.red_alert_watch for select to authenticated
  using (private.is_admin() and organisation_id = private.current_org_id());
revoke all on public.red_alert_watch from public, anon, authenticated;
grant select on public.red_alert_watch to authenticated;
comment on table public.red_alert_watch is 'S13 R4: one row per red alert, tracking whether the patient confirmed it. Written only by the opener, the sweep and record_red_care_response. Admin read only; clinicians reach the outcome through the outreach task.';

create table public.red_care_responses (
  id                  uuid primary key default gen_random_uuid(),
  organisation_id     uuid not null references public.organisations (id) on delete restrict,
  patient_id          uuid not null references public.profiles (id) on delete cascade,
  client_id           uuid not null unique,
  response            text not null check (response in ('sought_care', 'could_not_get_care')),
  emergency_event_id  uuid references public.emergency_events (id),
  triage_event_id     uuid references public.triage_events (id),
  client_recorded_at  timestamptz,
  responded_at        timestamptz not null default now(),
  shown_to_clinician  boolean not null,
  is_test             boolean not null default false,
  check ((emergency_event_id is null) <> (triage_event_id is null))
);
create index red_care_responses_patient_idx on public.red_care_responses (patient_id, responded_at desc);
alter table public.red_care_responses enable row level security;
create policy red_care_responses_patient_read on public.red_care_responses for select to authenticated using (patient_id = (select auth.uid()));
-- No admin policy on purpose: an answer about seeking care is read by the patient and, through latest_red_patient_response, by the
-- clinician working that alert. Nobody else has a reason to read it row by row.
revoke all on public.red_care_responses from public, anon, authenticated;
grant select on public.red_care_responses to authenticated;
comment on table public.red_care_responses is 'S13 R4 (CMO Q13): what a patient said about seeking care after a red alert. Append only (updates refused). Shown to the on-call clinician; never stops paging.';

create function private.red_care_responses_append_only() returns trigger language plpgsql as $$
begin
  raise exception 'red_care_responses is append only' using errcode = '42501';
end $$;
create trigger red_care_responses_no_update before update on public.red_care_responses
  for each row execute function private.red_care_responses_append_only();

-- Both are safety records that must always be writable (like emergency_events and free_red_events): exempt from the
-- under-18 dependant guard, and registered with the data registry so export and retention see them.
insert into public.minor_dependant_table_policy (table_name, policy, reason) values
  ('red_alert_watch', 'exempt', 'safety: a red alert must always be recordable'),
  ('red_care_responses', 'exempt', 'safety: a patient''s answer after a red alert must always be recordable')
on conflict (table_name) do update set policy = excluded.policy, reason = excluded.reason;

insert into public.data_registry (table_name, patient_expr, retention_class, end_of_retention, in_export, notes)
select t.table_name, 'patient_id', private.retention_class_for(t.table_name), 'review', true,
       'S13 R4 2026-10-13: PROPOSED, to be confirmed by the CMO and DPO.'
  from (values ('red_alert_watch'), ('red_care_responses')) as t(table_name)
on conflict (table_name) do nothing;

-- ---------------------------------------------------------------------------------------------------------------------
-- 6. Opening a watch, telling the patient, the sweep, outreach
-- ---------------------------------------------------------------------------------------------------------------------
-- Fixed neutral wording (INV-07). One row per channel the patient actually has; in-app always lands.
create function private.kick_notification_sender() returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/send-pending-notifications',
    headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'edge_function_publishable_key'), 'Content-Type', 'application/json'),
    timeout_milliseconds := 8000);
exception when others then null;  -- the 5 minute cron is the backstop
end;
$$;
revoke all on function private.kick_notification_sender() from public, anon, authenticated;

create function private.red_patient_notify(p_watch public.red_alert_watch) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_email text;
begin
  insert into public.notifications (recipient_id, organisation_id, channel, template, payload, status, content_class, priority, source_table, source_id)
  values (p_watch.patient_id, p_watch.organisation_id, 'in_app', 'red_event_guidance_waiting', '{}'::jsonb, 'pending', 'non_clinical', 'critical', 'red_alert_watch', p_watch.id);
  if exists (select 1 from public.push_subscriptions where profile_id = p_watch.patient_id and disabled_at is null) then
    insert into public.notifications (recipient_id, organisation_id, channel, template, payload, status, content_class, priority, source_table, source_id)
    values (p_watch.patient_id, p_watch.organisation_id, 'push', 'red_event_guidance_waiting', '{}'::jsonb, 'pending', 'non_clinical', 'critical', 'red_alert_watch', p_watch.id);
  end if;
  select email into v_email from auth.users where id = p_watch.patient_id and email_confirmed_at is not null;
  if v_email is not null then
    insert into public.notifications (recipient_id, organisation_id, channel, template, payload, status, content_class, priority, source_table, source_id)
    values (p_watch.patient_id, p_watch.organisation_id, 'email', 'red_event_guidance_waiting', jsonb_build_object('to_email', v_email), 'pending', 'non_clinical', 'critical', 'red_alert_watch', p_watch.id);
  end if;
  perform private.kick_notification_sender();
end;
$$;
revoke all on function private.red_patient_notify(public.red_alert_watch) from public, anon, authenticated;

create function private.open_red_alert_watch(p_kind text, p_source uuid) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_patient uuid; v_org uuid; v_shadow boolean := false; v_test boolean; v_id uuid; w public.red_alert_watch%rowtype;
  v_may boolean;
begin
  if p_kind = 'emergency_event' then
    select patient_id, organisation_id into v_patient, v_org from public.emergency_events where id = p_source;
  else
    select patient_id, organisation_id, shadow into v_patient, v_org, v_shadow from public.triage_events where id = p_source;
  end if;
  if v_patient is null or v_shadow then return null; end if;
  select coalesce(is_test, false) into v_test from public.profiles where id = v_patient;
  v_may := private.patient_may_page_doctor(v_patient);
  insert into public.red_alert_watch (organisation_id, patient_id, source_kind, source_id, state, due_at, rules_version, is_test)
  values (v_org, v_patient, p_kind, p_source, case when v_may then 'watching' else 'skipped_free' end,
          now() + make_interval(mins => coalesce(nullif(private.red_rule('unconfirmedMinutes'), '')::integer, 30)),
          private.red_rules_version(), coalesce(v_test, false))
  on conflict (source_kind, source_id) do nothing
  returning * into w;
  if w.id is null then return null; end if;
  -- Free: the Free path sends its own notices and no clinician is involved, so nothing more is done here.
  if v_may and coalesce(private.red_rule('enabled'), 'true')::boolean then
    -- Its own block: if telling the patient fails, the watch row above stays, so the timer still runs and a clinician still gets the call.
    begin
      perform private.red_patient_notify(w);
    exception when others then
      insert into public.audit_log (organisation_id, action, entity_type, entity_id, event)
      values (v_org, 'red_watch.notify_error', 'red_alert_watch', w.id, jsonb_build_object('error', sqlerrm, 'kind', p_kind));
    end;
  end if;
  return w.id;
exception when others then
  -- A failure here must never stop the red event itself from being saved.
  insert into public.audit_log (organisation_id, action, entity_type, entity_id, event)
  values (v_org, 'red_watch.open_error', 'red_alert_watch', p_source, jsonb_build_object('error', sqlerrm, 'kind', p_kind));
  return null;
end;
$$;
revoke all on function private.open_red_alert_watch(text, uuid) from public, anon, authenticated;

create function private.red_watch_emergency_trigger() returns trigger language plpgsql security definer set search_path = ''
as $$ begin perform private.open_red_alert_watch('emergency_event', new.id); return null; end $$;
revoke all on function private.red_watch_emergency_trigger() from public, anon, authenticated;
create trigger emergency_events_open_red_watch after insert on public.emergency_events
  for each row execute function private.red_watch_emergency_trigger();

create function private.red_watch_triage_trigger() returns trigger language plpgsql security definer set search_path = ''
as $$ begin perform private.open_red_alert_watch('triage_event', new.id); return null; end $$;
revoke all on function private.red_watch_triage_trigger() from public, anon, authenticated;
create trigger triage_events_open_red_watch after insert on public.triage_events
  for each row when (new.grade = 'red' and not new.shadow and new.actions @> '[{"kind":"page_on_call"}]'::jsonb)
  execute function private.red_watch_triage_trigger();

-- The patient's latest answer given AFTER the alert opened. The server stamps responded_at when it receives the answer, and a phone's
-- answer always follows the reading that raised the alert (oldest first), so an answer older than the alert belongs to an earlier one.
create function private.latest_red_answer(p_patient uuid, p_since timestamptz) returns text
language sql stable security definer set search_path = ''
as $$
  select response from public.red_care_responses
   where patient_id = p_patient and responded_at >= p_since
   order by responded_at desc limit 1
$$;
revoke all on function private.latest_red_answer(uuid, timestamptz) from public, anon, authenticated;

create function private.red_watch_patient_confirmed(w public.red_alert_watch) returns text
language sql stable security definer set search_path = ''
as $$
  select case
    -- "I could not get care" is the one answer that means the patient still needs a call: it is never a confirmation
    when private.latest_red_answer(w.patient_id, w.opened_at) = 'could_not_get_care' then null
    when exists (select 1 from public.notifications n where n.source_table = 'red_alert_watch' and n.source_id = w.id and n.opened_at is not null) then 'opened'
    when w.source_kind = 'emergency_event' and exists (select 1 from public.emergency_events e where e.id = w.source_id and e.acknowledged_at is not null) then 'acknowledged_guidance'
    when private.latest_red_answer(w.patient_id, w.opened_at) = 'sought_care' then 'patient_response'
    when coalesce(private.red_rule('deliveredCountsAsConfirmed'), 'true')::boolean
         and exists (select 1 from public.notifications n where n.source_table = 'red_alert_watch' and n.source_id = w.id and n.channel = 'push' and n.delivered_at is not null) then 'push_receipt'
    else null end
$$;
revoke all on function private.red_watch_patient_confirmed(public.red_alert_watch) from public, anon, authenticated;

create function private.red_watch_clinician_acked(w public.red_alert_watch) returns boolean
language sql stable security definer set search_path = ''
as $$
  select (w.source_kind = 'triage_event' and exists (select 1 from public.pages p where p.triage_event_id = w.source_id and p.parent_page_id is null and p.acknowledged_at is not null))
      or (w.source_kind = 'emergency_event' and exists (select 1 from public.emergency_events e join public.clinician_alerts a on a.id = e.clinician_alert_id
                                                          where e.id = w.source_id and a.status in ('acknowledged', 'resolved', 'closed')))
      or (w.outreach_task_id is not null and exists (select 1 from public.clinical_tasks t where t.id = w.outreach_task_id and t.state in ('claimed', 'completed')))
$$;
revoke all on function private.red_watch_clinician_acked(public.red_alert_watch) from public, anon, authenticated;

-- Alerts the on-call clinician (the clinical lead and admins when nobody is on call) with a fixed-wording critical notice.
create function private.red_outreach_notify(w public.red_alert_watch) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_to uuid; r record; c text; n integer := 0;
begin
  v_to := private.page_recipient(w.organisation_id, w.is_test);
  if v_to is not null then
    foreach c in array array['push', 'in_app', 'email'] loop
      insert into public.notifications (recipient_id, organisation_id, channel, template, payload, status, content_class, priority, source_table, source_id)
      values (v_to, w.organisation_id, c::public.notification_channel, 'red_event_outreach_task', '{}'::jsonb, 'pending', 'non_clinical', 'critical', 'red_alert_watch', w.id);
    end loop;
    perform private.kick_notification_sender();
    return;
  end if;
  for r in
    select p.id from public.profiles p where p.organisation_id = w.organisation_id and p.is_active and p.role = 'admin' and p.is_test = w.is_test
    union
    select cs.profile_id from public.clinical_staff cs join public.profiles p on p.id = cs.profile_id
     where cs.organisation_id = w.organisation_id and cs.profile_id is not null and cs.active and cs.status = 'active'
       and cs.doctor_tier = 'chief_medical_officer' and p.is_test = w.is_test
  loop
    foreach c in array array['push', 'in_app', 'email'] loop
      insert into public.notifications (recipient_id, organisation_id, channel, template, payload, status, content_class, priority, source_table, source_id)
      values (r.id, w.organisation_id, c::public.notification_channel, 'red_event_outreach_task', '{}'::jsonb, 'pending', 'non_clinical', 'critical', 'red_alert_watch', w.id);
    end loop;
    n := n + 1;
  end loop;
  perform private.kick_notification_sender();
  perform private.page_incident(w.organisation_id, 'red_outreach_no_cover:' || w.id, 'A red alert needs a call and nobody is on call',
    'A patient has not confirmed a red alert and no clinician is on the rota. The clinical lead and ops were alerted' || case when n = 0 then ' (nobody matched: add or activate a chief medical officer or admin).' else '.' end);
end;
$$;
revoke all on function private.red_outreach_notify(public.red_alert_watch) from public, anon, authenticated;

-- Creates (or merges into) the one open outreach task for the patient, then alerts. Idempotent per watch.
create function private.create_red_outreach(p_watch uuid) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare w public.red_alert_watch%rowtype; v_task uuid;
begin
  select * into w from public.red_alert_watch where id = p_watch for update;
  if not found or w.state not in ('watching', 'confirmed') then return null; end if;
  if not private.patient_may_page_doctor(w.patient_id) then return null; end if;
  if not private.task_type_confirmed('red_patient_outreach') then
    -- Nothing is created until the CMO confirms the task type on the sign-off hub. Say so once.
    if w.waiting_cmo_at is null then
      update public.red_alert_watch set waiting_cmo_at = now() where id = w.id;
      insert into public.audit_log (organisation_id, action, entity_type, entity_id, event)
      values (w.organisation_id, 'red_outreach.waiting_for_cmo', 'red_alert_watch', w.id, jsonb_build_object('task_type', 'red_patient_outreach'));
      -- Not silent: a patient has an unconfirmed red alert and nobody will be called, so ops and the clinical lead see a sev1 incident.
      perform private.page_incident(w.organisation_id, 'red_outreach_task_type_unconfirmed', 'A red alert needs a call and the call task is switched off',
        'A patient has not confirmed a red alert, but the Call the patient task type is not confirmed by the Chief Medical Officer, so no task was created. Confirm it on the sign-off hub, and have someone call the patient now.');
    end if;
    return null;
  end if;
  v_task := private.create_clinical_task(w.patient_id, 'red_patient_outreach', null, 'red_outreach:' || w.patient_id,
              case when w.source_kind = 'triage_event' then w.source_id end, null, null, '{}');
  update public.red_alert_watch set state = 'outreach_created', outreach_task_id = v_task, outreach_at = now() where id = w.id;
  insert into public.audit_log (organisation_id, action, entity_type, entity_id, event)
  values (w.organisation_id, 'red_outreach.created', 'red_alert_watch', w.id, jsonb_build_object('task_id', v_task, 'rules_version', w.rules_version));
  perform private.red_outreach_notify(w);
  return v_task;
end;
$$;
revoke all on function private.create_red_outreach(uuid) from public, anon, authenticated;

create function private.red_outreach_cancel_if_unclaimed(w public.red_alert_watch, p_reason text) returns void
language plpgsql security definer set search_path = ''
as $$
declare t record;
begin
  -- The patient's alerts share one open task. Another alert that still has the call outstanding keeps it alive.
  if exists (select 1 from public.red_alert_watch o where o.outreach_task_id = w.outreach_task_id and o.id <> w.id and o.state = 'outreach_created') then
    return;
  end if;
  for t in select id from public.clinical_tasks where id = w.outreach_task_id and state in ('created', 'offered_to_lead', 'open', 'escalated') loop
    perform private.apply_task_transition(t.id, 'cancelled', 'lead', null, p_reason);
  end loop;
end;
$$;
revoke all on function private.red_outreach_cancel_if_unclaimed(public.red_alert_watch, text) from public, anon, authenticated;

create function private.sweep_unconfirmed_red_alerts() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  w public.red_alert_watch%rowtype; v_ids uuid[]; v_id uuid; v_via text;
  v_push int; v_push_failed int; v_ok_other boolean; v_failed_at timestamptz; v_due timestamptz;
  n_created int := 0; n_confirmed int := 0; n_acked int := 0; n_expired int := 0; n_errors int := 0;
begin
  if not coalesce(private.red_rule('enabled'), 'true')::boolean then return jsonb_build_object('enabled', false); end if;
  select array_agg(id order by opened_at) into v_ids from (
    select id, opened_at from public.red_alert_watch where state in ('watching', 'outreach_created', 'confirmed')
       and opened_at > now() - interval '3 days' order by opened_at limit 500) x;
  foreach v_id in array coalesce(v_ids, '{}') loop
    begin
      select * into w from public.red_alert_watch where id = v_id for update skip locked;
      if not found then continue; end if;

      if private.red_watch_clinician_acked(w) then
        update public.red_alert_watch set state = 'clinician_acknowledged' where id = w.id and state <> 'clinician_acknowledged';
        select * into w from public.red_alert_watch where id = v_id;
        perform private.red_outreach_cancel_if_unclaimed(w, 'a clinician has acknowledged this red alert');
        n_acked := n_acked + 1;
        continue;
      end if;

      v_via := private.red_watch_patient_confirmed(w);
      -- A delivered push receipt only says the handset got the message. It can end the wait, but it never cancels a call that was
      -- already created: only the person opening, acknowledging or answering does.
      if v_via = 'push_receipt' and w.state = 'outreach_created' then continue; end if;
      if v_via is not null then
        if w.state in ('watching', 'outreach_created') then
          update public.red_alert_watch set state = 'confirmed', confirmed_via = v_via where id = w.id;
          n_confirmed := n_confirmed + 1;
          if w.state = 'outreach_created' then
            select * into w from public.red_alert_watch where id = v_id;
            perform private.red_outreach_cancel_if_unclaimed(w, 'the patient has confirmed the red alert (' || v_via || ')');
          end if;
        end if;
        continue;
      end if;

      if w.state <> 'watching' then continue; end if;

      -- A receipt that will never come must not hold the clock: when every push for this alert ended in an error and
      -- no email was delivered, the due time is pulled forward.
      select count(*) filter (where channel = 'push'),
             count(*) filter (where channel = 'push' and status = 'failed'),
             bool_or(channel = 'email' and delivered_at is not null),
             max(failed_at) filter (where channel = 'push' and status = 'failed')
        into v_push, v_push_failed, v_ok_other, v_failed_at
        from public.notifications where source_table = 'red_alert_watch' and source_id = w.id;
      v_due := w.due_at;
      if v_push > 0 and v_push_failed = v_push and not coalesce(v_ok_other, false) and v_failed_at is not null then
        v_due := least(v_due, v_failed_at + make_interval(mins => coalesce(nullif(private.red_rule('undeliveredMinutes'), '')::integer, 5)));
        if w.push_undelivered_at is null then
          update public.red_alert_watch set push_undelivered_at = v_failed_at where id = w.id;
        end if;
      end if;

      if now() < v_due then continue; end if;
      if now() > w.opened_at + make_interval(hours => coalesce(nullif(private.red_rule('expireHours'), '')::integer, 6)) then
        update public.red_alert_watch set state = 'expired' where id = w.id;
        n_expired := n_expired + 1;
        continue;
      end if;
      if private.create_red_outreach(w.id) is not null then n_created := n_created + 1; end if;
    exception when others then
      n_errors := n_errors + 1;
      insert into public.audit_log (organisation_id, action, entity_type, entity_id, event)
      values (w.organisation_id, 'red_watch.sweep_error', 'red_alert_watch', v_id, jsonb_build_object('error', sqlerrm));
    end;
  end loop;
  return jsonb_build_object('outreach_created', n_created, 'confirmed', n_confirmed, 'clinician_acknowledged', n_acked, 'expired', n_expired, 'errors', n_errors);
end;
$$;
revoke all on function private.sweep_unconfirmed_red_alerts() from public, anon, authenticated;

-- Staggered off the minute marks other jobs use (sweep-free-red-events is */5).
select cron.schedule('sweep-unconfirmed-red-alerts', '4-59/5 * * * *', 'select private.sweep_unconfirmed_red_alerts();');

-- ---------------------------------------------------------------------------------------------------------------------
-- 7. Q13: the patient's answer
-- ---------------------------------------------------------------------------------------------------------------------
create function public.record_red_care_response(
  p_client_id uuid, p_response text, p_emergency_event uuid default null, p_triage_event uuid default null,
  p_client_recorded_at timestamptz default null)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid()); v_id uuid; v_patient uuid; v_org uuid; v_test boolean; v_shown boolean;
  v_ee uuid := p_emergency_event; v_te uuid := p_triage_event; w record;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if p_client_id is null then raise exception 'a client id is needed' using errcode = '22023'; end if;
  if p_response is null or p_response not in ('sought_care', 'could_not_get_care') then raise exception 'unknown response' using errcode = '22023'; end if;
  if p_emergency_event is not null and p_triage_event is not null then raise exception 'name one red event, not two' using errcode = '22023'; end if;
  select id into v_id from public.red_care_responses where client_id = p_client_id and patient_id = v_uid;
  if found then return v_id; end if;
  if v_ee is null and v_te is null then
    -- The phone answers without knowing the server's event id (it may not have synced yet): take the patient's latest red
    -- alert of the last day. None yet means the reading has not arrived; the phone's outbox retries (P0002 is a retryable code).
    select x.kind_ee, x.kind_te into v_ee, v_te from (
      select case when src = 'e' then id end as kind_ee, case when src = 't' then id end as kind_te
        from (select id, created_at, 'e' as src from public.emergency_events where patient_id = v_uid and created_at > now() - interval '24 hours'
              union all
              select id, created_at, 't' from public.triage_events where patient_id = v_uid and grade = 'red' and not shadow and created_at > now() - interval '24 hours') u
       order by created_at desc limit 1) x;
    if v_ee is null and v_te is null then
      raise exception 'no red alert to answer yet' using errcode = 'P0002';
    end if;
  end if;
  if v_ee is not null then
    select patient_id, organisation_id into v_patient, v_org from public.emergency_events where id = v_ee;
  else
    select patient_id, organisation_id into v_patient, v_org from public.triage_events where id = v_te;
  end if;
  if v_patient is distinct from v_uid then raise exception 'this red event is not yours' using errcode = '42501'; end if;
  select coalesce(is_test, false) into v_test from public.profiles where id = v_uid;
  v_shown := private.patient_may_page_doctor(v_uid);
  insert into public.red_care_responses (organisation_id, patient_id, client_id, response, emergency_event_id, triage_event_id, client_recorded_at, shown_to_clinician, is_test)
  values (v_org, v_uid, p_client_id, p_response, v_ee, v_te, p_client_recorded_at, v_shown, coalesce(v_test, false))
  on conflict (client_id) do nothing
  returning id into v_id;
  if v_id is null then
    select id into v_id from public.red_care_responses where client_id = p_client_id and patient_id = v_uid;
    return v_id;
  end if;
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (v_org, v_uid, 'red_care_response.recorded', 'red_care_responses', v_id, jsonb_build_object('response', p_response, 'shown_to_clinician', v_shown));

  -- Information for the responder, never a way to stop paging. "Could not get care" brings the call forward on the alert it was
  -- linked to; nothing here touches pages, claimed tasks or acknowledgements.
  if v_shown and p_response = 'could_not_get_care' and coalesce(private.red_rule('couldNotGetCareOutreachNow'), 'false')::boolean then
    for w in select id from public.red_alert_watch
              where patient_id = v_uid and state in ('watching', 'confirmed')
                and source_kind = case when v_ee is not null then 'emergency_event' else 'triage_event' end
                and source_id = coalesce(v_ee, v_te) loop
      perform private.create_red_outreach(w.id);
    end loop;
  end if;
  return v_id;
end;
$$;
revoke all on function public.record_red_care_response(uuid, text, uuid, uuid, timestamptz) from public, anon;
grant execute on function public.record_red_care_response(uuid, text, uuid, uuid, timestamptz) to authenticated;

-- What the responder sees: the latest answer, no patient identity. A paged clinician (or the CMO) for a page; the
-- clinician working or eligible for the outreach task for a task.
create function public.latest_red_patient_response(p_page uuid default null, p_task uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_uid uuid := (select auth.uid()); v_patient uuid; v_since timestamptz; v_ok boolean := false; r record;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if (p_page is null) = (p_task is null) then raise exception 'name a page or a task' using errcode = '22023'; end if;
  if p_page is not null then
    select root.patient_id, root.sent_at into v_patient, v_since
      from public.pages pg join public.pages root on root.id = coalesce(pg.parent_page_id, pg.id)
     where pg.id = p_page and pg.organisation_id = private.current_org_id();
    v_ok := v_patient is not null and (private.credential_is_cmo() or exists (
      select 1 from public.pages x join public.pages root on root.id = coalesce(x.parent_page_id, x.id)
       where coalesce(x.parent_page_id, x.id) = (select coalesce(parent_page_id, id) from public.pages where id = p_page)
         and (x.to_clinician_id = v_uid or root.acknowledged_by = v_uid)));
  else
    select t.patient_id, t.created_at into v_patient, v_since from public.clinical_tasks t
     where t.id = p_task and t.organisation_id = private.current_org_id() and t.type in ('red_patient_outreach', 'red_event_unacknowledged');
    v_ok := v_patient is not null and (private.credential_is_cmo() or exists (
      select 1 from public.clinical_tasks t where t.id = p_task
         and (t.claimed_by = v_uid or t.pushed_to = v_uid or t.lead_clinician_id = v_uid
              or (t.state in ('open', 'escalated', 'offered_to_lead') and private.clinician_is_eligible(v_uid)))));
  end if;
  if not v_ok then raise exception 'not allowed' using errcode = '42501'; end if;
  select response, responded_at into r from public.red_care_responses
   where patient_id = v_patient and shown_to_clinician and responded_at >= v_since - interval '1 hour'
   order by responded_at desc limit 1;
  if not found then return null; end if;
  return jsonb_build_object('response', r.response, 'responded_at', r.responded_at);
end;
$$;
revoke all on function public.latest_red_patient_response(uuid, uuid) from public, anon;
grant execute on function public.latest_red_patient_response(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- 8. OQ-94: the INV-07 term list at write time
-- ---------------------------------------------------------------------------------------------------------------------
create function public.check_notification_text(p_text text) returns text[]
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not (private.is_admin() or (select auth.role()) = 'service_role') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return private.notification_text_violations(p_text);
end;
$$;
revoke all on function public.check_notification_text(text) from public, anon;
grant execute on function public.check_notification_text(text) to authenticated, service_role;

create function private.broadcast_inv07_guard() returns trigger language plpgsql security definer set search_path = ''
as $$
declare v_text text; v_hits text[];
begin
  v_text := coalesce(new.title, '') || ' ' || coalesce(new.body, '');
  if new.email_content is not null then
    v_text := v_text || ' ' || coalesce((select string_agg(e.value, ' ') from jsonb_each_text(new.email_content) e where e.key not ilike '%url' and e.key <> 'bandColor'), '');
  end if;
  if new.email_content_b is not null then
    v_text := v_text || ' ' || coalesce((select string_agg(e.value, ' ') from jsonb_each_text(new.email_content_b) e where e.key not ilike '%url' and e.key <> 'bandColor'), '');
  end if;
  v_hits := private.notification_text_violations(v_text);
  if array_length(v_hits, 1) > 0 then
    raise exception 'This message names a condition, reading, result or medicine (%). Notifications never do (INV-07); say it in the app instead.', array_to_string(v_hits, ', ')
      using errcode = '22023';
  end if;
  return new;
end;
$$;
create trigger notification_broadcasts_inv07 before insert or update of title, body, email_content, email_content_b
  on public.notification_broadcasts for each row execute function private.broadcast_inv07_guard();

-- ---------------------------------------------------------------------------------------------------------------------
-- 9. "Send me a test alert"
-- ---------------------------------------------------------------------------------------------------------------------
create function public.send_my_test_alert() returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid()); v_org uuid; v_n integer := 0;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  select organisation_id into v_org from public.profiles where id = v_uid;
  if v_org is null then raise exception 'no profile' using errcode = '42501'; end if;
  if (select count(*) from public.notifications where recipient_id = v_uid and template = 'test_alert' and created_at > now() - interval '24 hours') >= 6 then
    raise exception 'You have sent enough test alerts for today. Try again tomorrow.' using errcode = '22023';
  end if;
  insert into public.notifications (recipient_id, organisation_id, channel, template, payload, status, content_class, priority, source_table)
  values (v_uid, v_org, 'in_app', 'test_alert', '{}'::jsonb, 'pending', 'non_clinical', 'critical', 'test_alert');
  v_n := 1;
  if exists (select 1 from public.push_subscriptions where profile_id = v_uid and disabled_at is null) then
    insert into public.notifications (recipient_id, organisation_id, channel, template, payload, status, content_class, priority, source_table)
    values (v_uid, v_org, 'push', 'test_alert', '{}'::jsonb, 'pending', 'non_clinical', 'critical', 'test_alert');
    v_n := 2;
  end if;
  perform private.kick_notification_sender();
  return v_n;
end;
$$;
revoke all on function public.send_my_test_alert() from public, anon;
grant execute on function public.send_my_test_alert() to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- 10. Closing self-check: "removed" and "added" are provable, not hopeful
-- ---------------------------------------------------------------------------------------------------------------------
do $check$
begin
  if private.patient_critical_channels(gen_random_uuid(), array['push', 'email', 'sms']::public.notification_channel[])
       <> array['push', 'email', 'in_app']::public.notification_channel[] then
    raise exception 'S13 R4: the patient ladder did not become push, email, in-app';
  end if;
  if has_function_privilege('anon', 'public.record_red_care_response(uuid,text,uuid,uuid,timestamptz)', 'EXECUTE')
     or has_function_privilege('anon', 'public.latest_red_patient_response(uuid,uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.check_notification_text(text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.send_my_test_alert()', 'EXECUTE')
     or has_function_privilege('anon', 'private.sweep_unconfirmed_red_alerts()', 'EXECUTE') then
    raise exception 'S13 R4: a new function is executable by anon';
  end if;
  if not exists (select 1 from public.task_types where code = 'red_patient_outreach' and is_active and needs_confirmation and confirmed_at is null) then
    raise exception 'S13 R4: the outreach task type should exist and await the CMO';
  end if;
end $check$;
