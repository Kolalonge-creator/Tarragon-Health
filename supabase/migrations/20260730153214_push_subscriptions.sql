-- Notification delivery-state + forced-channel fallback, part 3/6.
--
-- Web Push subscription storage. `notification_channel.push` has existed
-- since 20260706084949 but nothing has ever written to it — no subscription
-- table existed, no service worker push handler existed, and
-- send-pending-notifications never queried channel='push' at all. This is
-- the storage half of making that channel real. VAPID keys are a self-signed
-- application identity (RFC 8292), not a third-party account credential —
-- unlike Resend/Termii/Paystack there is no provider account to wait on.
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  -- The Push API endpoint URL is the natural per-device unique key — a
  -- second subscribe from the same browser/device overwrites in place
  -- (browsers reuse the same endpoint until the subscription itself expires).
  endpoint text not null unique,
  p256dh_key text not null,
  auth_key text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  -- Set when a send gets 404/410 from the push service (subscription
  -- expired/revoked browser-side) — disabled rather than deleted so the
  -- escalation engine's "recipient had a subscription but it was dead" case
  -- is distinguishable from "never subscribed at all" in the audit trail.
  disabled_at timestamptz
);

alter table public.push_subscriptions enable row level security;

create policy push_subscriptions_select on public.push_subscriptions
  for select
  using (profile_id = (select auth.uid()) or private.is_org_staff(organisation_id));

create policy push_subscriptions_insert on public.push_subscriptions
  for insert
  with check (profile_id = (select auth.uid()) and organisation_id = private.current_org_id());

create policy push_subscriptions_update on public.push_subscriptions
  for update
  using (profile_id = (select auth.uid()))
  with check (profile_id = (select auth.uid()));

create policy push_subscriptions_delete on public.push_subscriptions
  for delete
  using (profile_id = (select auth.uid()));

create index push_subscriptions_profile_idx
  on public.push_subscriptions (profile_id)
  where disabled_at is null;
