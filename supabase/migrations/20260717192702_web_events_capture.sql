-- Tarragon Health — web_events: first-party page-view capture for the analytics
-- console (Acquisition + Engagement tabs).
--
-- PRIVACY/NDPR: we store only coarse geo derived at the edge from Vercel's geo
-- headers (country / region / city). The raw visitor IP is NEVER stored — there
-- is deliberately no ip column here. profile_id is null for anonymous visitors
-- and set for signed-in users (powers DAU/WAU/MAU + retention). session_id is a
-- random client id, not tied to identity.
--
-- SECURITY: like zoom_webhook_events, RLS is ON with NO policies — no client
-- (anon or authenticated) can read or write directly. Inserts happen only via
-- the service-role edge route (/api/track); the analyst reads only through the
-- SECURITY DEFINER analytics_* RPCs.

create table public.web_events (
  id            uuid primary key default gen_random_uuid(),
  occurred_at   timestamptz not null default now(),
  path          text not null,
  referrer_host text,
  utm_source    text,
  utm_medium    text,
  utm_campaign  text,
  country       text,
  region        text,
  city          text,
  device_type   text check (device_type in ('mobile','tablet','desktop')),
  profile_id    uuid references public.profiles (id) on delete set null,
  session_id    text
);

create index web_events_occurred_idx on public.web_events (occurred_at desc);
create index web_events_profile_idx on public.web_events (profile_id, occurred_at desc);
create index web_events_country_idx on public.web_events (country);

alter table public.web_events enable row level security;
-- No policies by design: only the service role (edge route) writes; the analyst
-- reads via SECURITY DEFINER RPCs. See analytics_traffic_* / analytics_engagement_*.
