-- Open/click analytics for broadcast emails. Writes only ever happen via the
-- service-role client from the signature-verified tracking routes
-- (apps/web/src/app/api/broadcasts/track-open, .../track-click) — same
-- verify-then-service-role-write pattern as the wearables webhook. No
-- insert/update/delete access for authenticated/anon at all; RLS SELECT is
-- admin-only (this is operational data an admin reviews). This project's
-- `alter default privileges ... to authenticated` migration grants ALL
-- privileges (not just SELECT) to authenticated on every newly created
-- public table by default, so those three must be explicitly revoked here
-- rather than just omitted.
create table public.broadcast_email_events (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.notifications(id) on delete cascade,
  event_type text not null check (event_type in ('open', 'click')),
  url text,
  variant text check (variant in ('a', 'b')),
  created_at timestamptz not null default now()
);

create index broadcast_email_events_notification_id_idx
  on public.broadcast_email_events (notification_id);

alter table public.broadcast_email_events enable row level security;

create policy broadcast_email_events_select on public.broadcast_email_events
  for select to authenticated using (private.is_admin());

grant select on public.broadcast_email_events to authenticated;
revoke insert, update, delete on public.broadcast_email_events from authenticated;

-- Per-broadcast (and, once A/B exists, per-variant) send/open/click stats
-- for the "Recent broadcasts" admin history list. Keyed off
-- notifications.payload->>'broadcast_id' (added to the email/sms/whatsapp
-- enqueue payload by the previous migration) rather than a new FK column on
-- notifications, matching how subject/body/email_content already live in
-- that same jsonb payload for this template.
create function public.admin_broadcast_stats(p_broadcast_id uuid)
returns table (
  variant text,
  sent integer,
  opened integer,
  open_rate numeric,
  clicked integer,
  click_rate numeric
)
language plpgsql
stable
security definer
set search_path to ''
as $function$
begin
  if not private.is_admin() then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  return query
  with email_rows as (
    select n.id, coalesce(n.payload ->> 'variant', 'all') as row_variant
    from public.notifications n
    where n.template = 'broadcast_announcement'
      and n.channel = 'email'
      and (n.payload ? 'broadcast_id')
      and (n.payload ->> 'broadcast_id')::uuid = p_broadcast_id
  ),
  opens as (
    select distinct e.notification_id
    from public.broadcast_email_events e
    join email_rows r on r.id = e.notification_id
    where e.event_type = 'open'
  ),
  clicks as (
    select distinct e.notification_id
    from public.broadcast_email_events e
    join email_rows r on r.id = e.notification_id
    where e.event_type = 'click'
  )
  select
    r.row_variant,
    count(distinct r.id)::integer,
    count(distinct o.notification_id)::integer,
    case when count(distinct r.id) = 0 then 0::numeric
      else round(count(distinct o.notification_id)::numeric / count(distinct r.id) * 100, 1) end,
    count(distinct c.notification_id)::integer,
    case when count(distinct r.id) = 0 then 0::numeric
      else round(count(distinct c.notification_id)::numeric / count(distinct r.id) * 100, 1) end
  from email_rows r
  left join opens o on o.notification_id = r.id
  left join clicks c on c.notification_id = r.id
  group by r.row_variant
  order by r.row_variant;
end;
$function$;

revoke all on function public.admin_broadcast_stats(uuid) from public;
grant execute on function public.admin_broadcast_stats(uuid) to authenticated;

do $$
begin
  if exists (
    select 1 from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'broadcast_email_events'
      and grantee in ('anon', 'authenticated') and privilege_type in ('INSERT', 'UPDATE', 'DELETE')
  ) then
    raise exception 'broadcast_email_events must not grant write access to anon/authenticated';
  end if;
end $$;
