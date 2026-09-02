-- Tarragon Health — Alert System infrastructure, part 3/6: delivery
-- channels (8.6).
--
-- "Critical clinical alerts should not depend solely on email." The
-- existing `notifications` table already has a rich delivery-state model
-- (delivered_at/opened_at/failed_at, priority, escalation ladder) and a
-- content_class CHECK that forces clinical content onto the in_app rail
-- only (20260730094515) -- both untouched here. What's missing is (a) a
-- structural guarantee that a severity>=3 clinician_alerts row always gets
-- an in_app delivery (never email-only, never nothing), and (b) a per-alert
-- delivery ledger so "who was this actually sent to, and by which channel"
-- is queryable per alert rather than only per notification row.
--
-- private.notify_clinician_alert() is intentionally a NEW, separate helper
-- from the existing private.enqueue_critical_notification() /
-- private.escalation_channel_sequence() -- those are keyed by the 8
-- existing trigger pathways' `pathway` string against escalation_slas, and
-- this migration does not touch that live, working mechanism. This helper
-- is keyed by alert_type_code against alert_rules instead, for the new
-- unified routing this feature introduces (used by part 4's ack-timeout
-- ladder and part 5's new generators).

create table public.alert_deliveries (
  id                  uuid primary key default gen_random_uuid(),
  clinician_alert_id  uuid not null references public.clinician_alerts (id) on delete cascade,
  notification_id     uuid references public.notifications (id) on delete set null,
  channel             public.notification_channel not null,
  recipient_id        uuid not null references public.profiles (id) on delete cascade,
  created_at          timestamptz not null default now()
);

comment on table public.alert_deliveries is
  'Per-channel delivery ledger for clinician_alerts (8.6), one row per notification actually sent for an alert. Populated only by private.notify_clinician_alert() -- no client insert path, same posture as case_briefs (service-role/SECURITY DEFINER write only).';

create index alert_deliveries_alert_idx on public.alert_deliveries (clinician_alert_id);
create index alert_deliveries_recipient_idx on public.alert_deliveries (recipient_id);

alter table public.alert_deliveries enable row level security;

create policy alert_deliveries_select on public.alert_deliveries
  for select to authenticated
  using (
    exists (
      select 1 from public.clinician_alerts ca
      where ca.id = clinician_alert_id and private.is_org_staff(ca.organisation_id)
    )
  );

grant select on public.alert_deliveries to authenticated;

create or replace function private.notify_clinician_alert(
  p_alert_id uuid,
  p_recipient_id uuid,
  p_template text,
  p_payload jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_alert record;
  v_rule jsonb;
  v_extra_channels public.notification_channel[];
  v_notif_id uuid;
  v_ch public.notification_channel;
begin
  select organisation_id, severity, type_code into v_alert
  from public.clinician_alerts where id = p_alert_id;

  if v_alert.organisation_id is null then
    raise exception 'clinician_alerts row % not found', p_alert_id;
  end if;

  -- The in_app delivery always happens first and always carries the real
  -- clinical content -- content_class='clinical' is only ever permitted on
  -- in_app (notifications_no_clinical_on_open_rail, 20260730094515), and
  -- in_app is never email, so this one insert alone already satisfies
  -- "not solely email" for every severity.
  insert into public.notifications
    (organisation_id, recipient_id, channel, template, payload, content_class,
     priority, source_table, source_id)
  values
    (v_alert.organisation_id, p_recipient_id, 'in_app', p_template, p_payload, 'clinical',
     (case when v_alert.severity >= 3 then 'critical' else 'routine' end)::public.notification_priority,
     'clinician_alerts', p_alert_id)
  returning id into v_notif_id;

  insert into public.alert_deliveries (clinician_alert_id, notification_id, channel, recipient_id)
  values (p_alert_id, v_notif_id, 'in_app', p_recipient_id);

  -- Urgent/emergency alerts additionally fan out over whatever extra
  -- channels governance configured for this type (8.6's "depending on
  -- urgency"), each carrying a generic non-PHI nudge only -- clinical
  -- detail never leaves the in_app rail.
  if v_alert.severity >= 3 then
    v_rule := private.alert_rule_config(v_alert.type_code);
    v_extra_channels := array(
      select distinct c
      from jsonb_array_elements_text(coalesce(v_rule->'channel_sequence', '[]'::jsonb)) as raw(token)
      cross join lateral (select raw.token::public.notification_channel as c) mapped
      where mapped.c <> 'in_app'
    );

    foreach v_ch in array coalesce(v_extra_channels, array[]::public.notification_channel[])
    loop
      insert into public.notifications
        (organisation_id, recipient_id, channel, template, payload, content_class, priority,
         source_table, source_id)
      values
        (v_alert.organisation_id, p_recipient_id, v_ch, p_template,
         jsonb_build_object('message', 'You have a new urgent alert on Tarragon Health -- please check your dashboard.'),
         'non_clinical', 'critical', 'clinician_alerts', p_alert_id)
      returning id into v_notif_id;

      insert into public.alert_deliveries (clinician_alert_id, notification_id, channel, recipient_id)
      values (p_alert_id, v_notif_id, v_ch, p_recipient_id);
    end loop;
  end if;
end;
$$;

comment on function private.notify_clinician_alert(uuid, uuid, text, jsonb) is
  'Sends and records a clinician_alerts notification. Always writes an in_app row with the real (clinical) content first -- structurally guaranteeing 8.6''s "critical alerts must not depend solely on email" for every severity, since in_app is never email and always included. Severity>=3 additionally fans out over alert_rules'' configured extra channels with a generic, non-PHI nudge (content_class=non_clinical, matching the existing notifications_no_clinical_on_open_rail CHECK). Every send is mirrored into alert_deliveries for per-alert delivery tracking.';

revoke all on function private.notify_clinician_alert(uuid, uuid, text, jsonb) from public, anon;

do $$
begin
  if not exists (select 1 from information_schema.tables where table_schema='public' and table_name='alert_deliveries') then
    raise exception 'alert_deliveries was not created';
  end if;
  if has_function_privilege('anon', 'private.notify_clinician_alert(uuid,uuid,text,jsonb)', 'EXECUTE') then
    raise exception 'FAIL: anon can execute private.notify_clinician_alert';
  end if;
  raise notice 'PASS: alert_deliveries + private.notify_clinician_alert() in place, anon denied';
end $$;
