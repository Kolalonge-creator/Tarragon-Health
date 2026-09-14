-- Wire marketing-consent gating into the admin broadcast composer's live
-- recipient-count preview. private.broadcast_targets already gained a 4th
-- p_marketing param (20260830002411_broadcast_marketing_consent.sql) and
-- admin_send_broadcast already reads notification_broadcasts.is_marketing
-- and passes it through to broadcast_targets — the count preview was the
-- one caller still stuck on the 3-arg call (relying on the default
-- `false`), so toggling "This is a marketing message" in the composer never
-- changed the live estimate. Dropped and recreated (not CREATE OR REPLACE
-- with an extra default param) because PostgREST RPC resolution treats an
-- added-default-param overload of the same base name as ambiguous.
drop function if exists public.admin_broadcast_audience_count(broadcast_audience, jsonb);

create function public.admin_broadcast_audience_count(
  p_audience broadcast_audience,
  p_filter jsonb,
  p_marketing boolean default false
)
returns integer
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_count integer;
begin
  if not private.is_admin() then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  select count(*) into v_count
  from private.broadcast_targets(p_audience, coalesce(p_filter, '{}'::jsonb), (select auth.uid()), p_marketing) t
  where t.email is not null or t.phone is not null;
  return v_count;
end;
$function$;

revoke all on function public.admin_broadcast_audience_count(broadcast_audience, jsonb, boolean) from public;
grant execute on function public.admin_broadcast_audience_count(broadcast_audience, jsonb, boolean) to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'admin_broadcast_audience_count'
      and pg_get_function_identity_arguments(p.oid) = 'p_audience broadcast_audience, p_filter jsonb, p_marketing boolean'
  ) then
    raise exception 'admin_broadcast_audience_count 3-arg signature missing after migration';
  end if;
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'admin_broadcast_audience_count'
      and pg_get_function_identity_arguments(p.oid) = 'p_audience broadcast_audience, p_filter jsonb'
  ) then
    raise exception 'old 2-arg admin_broadcast_audience_count still present';
  end if;
end $$;
