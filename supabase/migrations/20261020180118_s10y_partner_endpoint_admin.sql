-- S10y: admin reads and guarded actions for partner webhook endpoints and the partner event map.
--
-- Additive only. Builds on S10x-b (rotate_partner_webhook_secret, reenable_partner_webhook_endpoint, set_partner_event_mapping, all live).
--   1. partner_webhook_admin_overview(): one row per endpoint of the caller's organisation, for the admin screen. It NEVER returns
--      secret or previous_secret (only the key version and whether a previous key is still inside its grace window), and returns only
--      scheme and host of the url (a receiver URL can carry basic-auth credentials, a path token or a query token).
--   2. partner_event_map_admin_overview(): every active bus event type with its partner mapping, if any, and any mapping whose event
--      type has since been deactivated (so it stays visible and removable). partner_event_map is platform-wide config (no organisation_id),
--      as built in S10x-b; admin-only is the existing gate and is unchanged.
--   3. admin_reenable_partner_webhook_endpoint(endpoint, reason): admin only, a written reason of 10 to 500 characters is required,
--      and the reason goes to the audit log with the endpoint id. The existing reenable_partner_webhook_endpoint is left as it was.
--   4. remove_partner_event_mapping(event type): admin only, audited through set_partner_event_mapping (no new write path).
-- Rotation and mapping edits keep using the S10x-b functions (already audited; the audit row never holds a secret).
-- No new table, so no data_registry row. Row counts at writing (live): 0 partner_webhook_endpoints, 0 partner_event_map. No conversion.

create or replace function public.partner_webhook_admin_overview()
returns table (
  endpoint_id uuid, name text, partner_name text, url text, environment text, event_types text[],
  is_active boolean, auto_disabled_at timestamptz, disabled_reason text, consecutive_failures integer,
  last_success_at timestamptz, last_failure_at timestamptz, signing_key_version integer, previous_key_expires_at timestamptz,
  queued bigint, dead bigint, delivered_24h bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if not private.is_admin() then
    raise exception 'only an admin may read partner webhook endpoints' using errcode = '42501';
  end if;
  return query
  select e.id, e.name, p.name, regexp_replace(e.url, '^(https://)([^/@?#]*@)?([^/?#]*).*$', '\1\3'), e.environment::text,
         (select coalesce(array_agg(x::text order by x::text), '{}') from unnest(e.event_types) x),
         e.is_active, e.auto_disabled_at, e.disabled_reason, e.consecutive_failures, e.last_success_at, e.last_failure_at,
         e.signing_key_version,
         case when e.previous_secret_expires_at > now() then e.previous_secret_expires_at end,
         q.queued, q.dead, q.delivered_24h
    from public.partner_webhook_endpoints e
    join public.partner_integrations p on p.id = e.partner_integration_id
    cross join lateral (
      select count(*) filter (where o.status in ('pending', 'delivering', 'failed')) as queued,
             count(*) filter (where o.status = 'dead_letter') as dead,
             count(*) filter (where o.status = 'delivered' and o.delivered_at > now() - interval '24 hours') as delivered_24h
        from public.integration_outbound_events o where o.webhook_endpoint_id = e.id
    ) q
   where e.organisation_id = private.current_org_id()
   order by e.created_at desc, e.id;
end;
$$;

create or replace function public.partner_event_map_admin_overview()
returns table (
  bus_event_type text, ordered boolean, is_mapped boolean, integration_event_type text, id_keys text[], subscriber_key text, subscriber_active boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if not private.is_admin() then
    raise exception 'only an admin may read the partner event map' using errcode = '42501';
  end if;
  return query
  select et.event_type, et.ordered, (m.bus_event_type is not null), m.integration_event_type::text, coalesce(m.id_keys, '{}'),
         m.subscriber_key, coalesce(s.is_active, false)
    from public.event_types et
    left join public.partner_event_map m on m.bus_event_type = et.event_type
    left join public.event_subscribers s on s.subscriber_key = m.subscriber_key
   where et.is_active or m.bus_event_type is not null
   order by (m.bus_event_type is null), et.event_type;
end;
$$;

create or replace function public.admin_reenable_partner_webhook_endpoint(p_endpoint_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if not private.is_admin() then
    raise exception 'only an admin may switch a partner endpoint back on' using errcode = '42501';
  end if;
  if length(v_reason) < 10 or length(v_reason) > 500 then
    raise exception 'a reason of 10 to 500 characters is required' using errcode = '22023';
  end if;
  -- scoped before the lock, and one answer for "missing" and "someone else's", so neither a lock nor a different error reveals another org's id
  select organisation_id into v_org from public.partner_webhook_endpoints
   where id = p_endpoint_id and organisation_id = private.current_org_id() for update;
  if v_org is null then
    raise exception 'endpoint not found' using errcode = 'P0002';
  end if;
  update public.partner_webhook_endpoints
     set is_active = true, consecutive_failures = 0, auto_disabled_at = null, disabled_reason = null
   where id = p_endpoint_id;
  perform private.log_audit('integration.webhook.reenabled_by_admin', 'partner_webhook_endpoints', p_endpoint_id,
    jsonb_build_object('reason', v_reason));
end;
$$;

create or replace function public.remove_partner_event_mapping(p_bus_event_type text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_key text;
begin
  if not private.is_admin() then
    raise exception 'only an admin may remove a partner mapping' using errcode = '42501';
  end if;
  -- direct, not through set_partner_event_mapping, which refuses an event type that has since been deactivated
  delete from public.partner_event_map where bus_event_type = p_bus_event_type returning subscriber_key into v_key;
  if v_key is null then
    raise exception 'no mapping for %', p_bus_event_type using errcode = 'P0002';
  end if;
  update public.event_subscribers set is_active = false where subscriber_key = v_key;
  perform private.log_audit('event_bus.partner_mapping', 'event_subscribers', null,
    jsonb_build_object('bus_event_type', p_bus_event_type, 'integration_event_type', null, 'subscriber_key', v_key));
end;
$$;

revoke all on function public.partner_webhook_admin_overview() from public, anon;
revoke all on function public.partner_event_map_admin_overview() from public, anon;
revoke all on function public.admin_reenable_partner_webhook_endpoint(uuid, text) from public, anon;
revoke all on function public.remove_partner_event_mapping(text) from public, anon;
grant execute on function public.partner_webhook_admin_overview() to authenticated, service_role;
grant execute on function public.partner_event_map_admin_overview() to authenticated, service_role;
grant execute on function public.admin_reenable_partner_webhook_endpoint(uuid, text) to authenticated, service_role;
grant execute on function public.remove_partner_event_mapping(text) to authenticated, service_role;

do $$
begin
  if has_function_privilege('anon', 'public.partner_webhook_admin_overview()', 'EXECUTE')
     or has_function_privilege('anon', 'public.partner_event_map_admin_overview()', 'EXECUTE')
     or has_function_privilege('anon', 'public.admin_reenable_partner_webhook_endpoint(uuid, text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.remove_partner_event_mapping(text)', 'EXECUTE') then
    raise exception 'S10y: a partner admin function is executable by anon';
  end if;
  if not has_function_privilege('authenticated', 'public.partner_webhook_admin_overview()', 'EXECUTE') then
    raise exception 'S10y: the admin overview must be callable by authenticated (it checks is_admin itself)';
  end if;
end $$;
