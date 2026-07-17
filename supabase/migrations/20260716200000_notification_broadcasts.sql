-- Tarragon Health — Admin broadcast / announcement engine
--
-- Lets a platform admin send a one-off announcement (email + WhatsApp/SMS) to a
-- targeted audience: all patients, patients in a state, subscribers on a plan,
-- all partners, or a specific partner group. It is a thin producer on top of the
-- existing notifications queue — it resolves an audience to recipients and
-- enqueues notification rows the send-pending-notifications Edge Function already
-- drains. It NEVER sends inbound-parseable messages or gates anything; it's a
-- pure outbound announcement layer (stays inside the WhatsApp-is-notifications-
-- only rule).
--
-- notifications.recipient_id is NOT NULL → profiles. Partners are catalogue rows
-- with no profile, so (exactly like enqueue_pharmacy_order_notifications) their
-- real destination travels in payload.to_email / payload.to_phone and
-- recipient_id is set to the sending admin as a satisfy-the-FK proxy.

create type public.broadcast_audience as enum (
  'all_patients',
  'patients_by_state',
  'subscribers_by_plan',
  'all_partners',
  'partners_by_type'
);

create type public.broadcast_status as enum ('draft', 'sent');

create table public.notification_broadcasts (
  id               uuid primary key default gen_random_uuid(),
  created_by       uuid not null references public.profiles (id) on delete restrict,
  title            text not null,
  body             text not null,
  audience         public.broadcast_audience not null,
  -- Optional filters: { state, plan_code, partner_type }. state applies to any
  -- patient audience; plan_code to subscribers_by_plan; partner_type to
  -- partners_by_type ('pharmacy' | 'specialist').
  audience_filter  jsonb not null default '{}'::jsonb,
  -- Which channels to enqueue (subset of email / whatsapp / sms).
  channels         public.notification_channel[] not null,
  status           public.broadcast_status not null default 'draft',
  recipient_count  integer not null default 0,
  sent_at          timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint notification_broadcasts_channels_nonempty
    check (array_length(channels, 1) >= 1)
);

create index notification_broadcasts_created_idx
  on public.notification_broadcasts (created_at desc);

create trigger notification_broadcasts_set_updated_at
  before update on public.notification_broadcasts
  for each row execute function private.set_updated_at();

alter table public.notification_broadcasts enable row level security;

-- Admin-only in every direction — this is a platform-operations table.
create policy notification_broadcasts_select on public.notification_broadcasts
  for select to authenticated using (private.is_admin());
create policy notification_broadcasts_insert on public.notification_broadcasts
  for insert to authenticated with check (private.is_admin() and created_by = (select auth.uid()));
create policy notification_broadcasts_update on public.notification_broadcasts
  for update to authenticated using (private.is_admin()) with check (private.is_admin());
create policy notification_broadcasts_delete on public.notification_broadcasts
  for delete to authenticated using (private.is_admin());

grant select, insert, update, delete on public.notification_broadcasts to authenticated;

-- ---------------------------------------------------------------------------
-- Audience resolver — one place both the preview-count and send paths use, so
-- the count the admin sees is exactly what gets enqueued. Returns one row per
-- reachable recipient with the destination the dispatcher should use.
--   is_partner=false → a patient; whatsapp/sms resolve to their profile phone.
--   is_partner=true  → a partner; recipient_id is the admin proxy, real
--                       destination is email/phone here.
-- SECURITY DEFINER so it can read auth.users email + all profiles; every caller
-- is admin-gated below.
-- ---------------------------------------------------------------------------
create or replace function private.broadcast_targets(
  p_audience public.broadcast_audience,
  p_filter   jsonb,
  p_admin_id uuid
)
returns table (
  recipient_id    uuid,
  organisation_id uuid,
  email           text,
  phone           text,
  is_partner      boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  -- Patient cohorts. `state` is an optional filter on any patient audience;
  -- subscribers_by_plan additionally requires an active subscription (plan_code
  -- optional — null means any plan).
  select p.id, p.organisation_id, u.email, p.phone, false
  from public.profiles p
  join auth.users u on u.id = p.id
  where p.role = 'patient'
    and p_audience in ('all_patients', 'patients_by_state', 'subscribers_by_plan')
    and ((p_filter->>'state') is null or p.state = (p_filter->>'state'))
    and (
      p_audience <> 'subscribers_by_plan'
      or exists (
        select 1
        from public.subscriptions s
        join public.subscription_plans pl on pl.id = s.plan_id
        where s.subscriber_id = p.id
          and s.status in ('active', 'trialing')
          and ((p_filter->>'plan_code') is null or pl.code = (p_filter->>'plan_code'))
      )
    )

  union all

  -- Pharmacy partners.
  select p_admin_id, null::uuid, ph.contact_email, ph.contact_phone, true
  from public.pharmacy_partners ph
  where ph.is_active
    and (
      p_audience = 'all_partners'
      or (p_audience = 'partners_by_type' and (p_filter->>'partner_type') = 'pharmacy')
    )

  union all

  -- Specialist partners.
  select p_admin_id, null::uuid, sp.contact_email, sp.contact_phone, true
  from public.specialist_providers sp
  where sp.is_active
    and (
      p_audience = 'all_partners'
      or (p_audience = 'partners_by_type' and (p_filter->>'partner_type') = 'specialist')
    );
$$;

-- Preview: how many reachable recipients an audience resolves to (a recipient is
-- reachable if it has at least an email or a phone). Admin-gated.
create or replace function public.admin_broadcast_audience_count(
  p_audience public.broadcast_audience,
  p_filter   jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if not private.is_admin() then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  select count(*) into v_count
  from private.broadcast_targets(p_audience, coalesce(p_filter, '{}'::jsonb), (select auth.uid())) t
  where t.email is not null or t.phone is not null;
  return v_count;
end;
$$;

-- Send: resolves the broadcast's audience and enqueues notification rows, one
-- per selected channel per reachable recipient, then marks the broadcast sent.
-- Idempotent guard: a broadcast can only be sent once. Admin-gated.
create or replace function public.admin_send_broadcast(p_broadcast_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_b     public.notification_broadcasts%rowtype;
  v_ch    public.notification_channel;
  v_count integer;
begin
  if not private.is_admin() then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  select * into v_b from public.notification_broadcasts where id = p_broadcast_id;
  if not found then
    raise exception 'broadcast not found';
  end if;
  if v_b.status = 'sent' then
    raise exception 'broadcast already sent';
  end if;

  foreach v_ch in array v_b.channels loop
    if v_ch = 'email' then
      insert into public.notifications
        (organisation_id, recipient_id, channel, status, template, payload)
      select t.organisation_id, t.recipient_id, 'email', 'pending', 'broadcast_announcement',
             jsonb_build_object('subject', v_b.title, 'body', v_b.body, 'to_email', t.email)
      from private.broadcast_targets(v_b.audience, v_b.audience_filter, v_b.created_by) t
      where t.email is not null;

    elsif v_ch = 'sms' then
      insert into public.notifications
        (organisation_id, recipient_id, channel, status, template, payload)
      select t.organisation_id, t.recipient_id, 'sms', 'pending', 'broadcast_announcement',
             jsonb_build_object('subject', v_b.title, 'body', v_b.body, 'to_phone', t.phone)
      from private.broadcast_targets(v_b.audience, v_b.audience_filter, v_b.created_by) t
      where t.phone is not null;

    elsif v_ch = 'whatsapp' then
      -- Patients only — partners have no WhatsApp channel.
      insert into public.notifications
        (organisation_id, recipient_id, channel, status, template, payload)
      select t.organisation_id, t.recipient_id, 'whatsapp', 'pending', 'broadcast_announcement',
             jsonb_build_object('subject', v_b.title, 'body', v_b.body)
      from private.broadcast_targets(v_b.audience, v_b.audience_filter, v_b.created_by) t
      where t.phone is not null and t.is_partner = false;
    end if;
  end loop;

  select count(*) into v_count
  from private.broadcast_targets(v_b.audience, v_b.audience_filter, v_b.created_by) t
  where t.email is not null or t.phone is not null;

  update public.notification_broadcasts
    set status = 'sent', recipient_count = v_count, sent_at = now()
  where id = p_broadcast_id;

  return v_count;
end;
$$;

revoke all on function public.admin_broadcast_audience_count(public.broadcast_audience, jsonb) from anon;
revoke all on function public.admin_send_broadcast(uuid) from anon;
grant execute on function public.admin_broadcast_audience_count(public.broadcast_audience, jsonb) to authenticated;
grant execute on function public.admin_send_broadcast(uuid) to authenticated;
