-- S10y: admin screen support for partner webhook endpoints (additive; no table or existing function is changed).
--   1. admin_list_partner_webhook_endpoints(): admin only, current organisation. Projects status columns and the host and port of the URL
--      (any user:password@ part removed),
--      NEVER secret or previous_secret (the table holds both; this is the only read the screen uses).
--   2. admin_reenable_partner_webhook_endpoint(id, reason): admin only, a typed reason of 10 to 300 characters is required and is
--      written to the audit log with the failure count it cleared. Resets through the existing on-enable trigger.
--      The older reenable_partner_webhook_endpoint(uuid) (no reason) is left in place untouched because the S10x proof calls it; no
--      screen uses it. Revoking it is a follow-up once that proof is moved.
--   3. admin_disable_partner_event_mapping(event_type): admin only, wraps set_partner_event_mapping(.., null) so the app does not have
--      to pass a null enum. Creating a mapping still goes through set_partner_event_mapping.
--   4. admin_list_partner_event_mappings(): admin only, active event types with their mapping (if any), for the picklist.
-- Rotation uses the existing rotate_partner_webhook_secret (returns the new secret once; the audit row never holds it).
-- No rows are created or changed by this migration. 0 mappings is the intended state at launch.

create or replace function public.admin_list_partner_webhook_endpoints()
returns table (
  id uuid, name text, url_host text, environment public.api_environment, is_active boolean,
  event_types public.integration_event_type[], last_success_at timestamptz, last_failure_at timestamptz,
  consecutive_failures integer, auto_disabled_at timestamptz, disabled_reason text,
  signing_key_version integer, previous_secret_expires_at timestamptz, queued_events bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if not private.is_admin() then
    raise exception 'only an admin may list partner endpoints' using errcode = '42501';
  end if;
  return query
  select w.id, w.name, regexp_replace((regexp_match(substr(w.url, 9), '^([^/?#]*)'))[1], '^.*@', ''), w.environment, w.is_active, w.event_types,
         w.last_success_at, w.last_failure_at, w.consecutive_failures, w.auto_disabled_at, w.disabled_reason,
         w.signing_key_version,
         case when w.previous_secret_expires_at > now() then w.previous_secret_expires_at end,
         (select count(*) from public.integration_outbound_events e
           where e.webhook_endpoint_id = w.id and e.status in ('pending', 'failed'))
    from public.partner_webhook_endpoints w
   where w.organisation_id = private.current_org_id()
   order by w.created_at desc;
end;
$$;

create or replace function public.admin_list_partner_event_mappings()
returns table (
  event_type text, description text, is_urgent boolean, mapped boolean,
  integration_event_type public.integration_event_type, id_keys text[], subscriber_active boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if not private.is_admin() then
    raise exception 'only an admin may list partner mappings' using errcode = '42501';
  end if;
  return query
  select t.event_type, t.description, t.is_urgent, (m.bus_event_type is not null),
         m.integration_event_type, coalesce(m.id_keys, '{}'::text[]), s.is_active
    from public.event_types t
    left join public.partner_event_map m on m.bus_event_type = t.event_type
    left join public.event_subscribers s on s.subscriber_key = m.subscriber_key
   where t.is_active or m.bus_event_type is not null
   order by (m.bus_event_type is null), t.event_type;
end;
$$;

create or replace function public.admin_reenable_partner_webhook_endpoint(p_endpoint_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text := btrim(coalesce(p_reason, ''));
  v_fails integer;
  v_active boolean;
begin
  if not private.is_admin() then
    raise exception 'only an admin may switch an endpoint back on' using errcode = '42501';
  end if;
  if length(v_reason) < 10 or length(v_reason) > 300 then
    raise exception 'a reason of 10 to 300 characters is required' using errcode = '22023';
  end if;
  select consecutive_failures, is_active into v_fails, v_active
    from public.partner_webhook_endpoints
   where id = p_endpoint_id and organisation_id = private.current_org_id() for update;
  if not found then
    raise exception 'endpoint not found';
  end if;
  if v_active then
    raise exception 'the endpoint is already on' using errcode = '55000';
  end if;
  update public.partner_webhook_endpoints
     set is_active = true, consecutive_failures = 0, auto_disabled_at = null, disabled_reason = null
   where id = p_endpoint_id;
  perform private.log_audit('integration.webhook.reenabled', 'partner_webhook_endpoints', p_endpoint_id,
    jsonb_build_object('reason', v_reason, 'cleared_consecutive_failures', v_fails, 'via', 'admin_ui'));
end;
$$;

create or replace function public.admin_disable_partner_event_mapping(p_bus_event_type text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'only an admin may remove a partner mapping' using errcode = '42501';
  end if;
  if not exists (select 1 from public.partner_event_map where bus_event_type = p_bus_event_type) then
    raise exception 'no such mapping' using errcode = '22023';
  end if;
  -- Done directly, not through set_partner_event_mapping, which refuses an event type that has since been deactivated: a mapping
  -- whose event type was switched off must still be removable.
  delete from public.partner_event_map where bus_event_type = p_bus_event_type;
  update public.event_subscribers set is_active = false
   where subscriber_key = 'partner.webhook.' || replace(p_bus_event_type, '.', '_');
  perform private.log_audit('event_bus.partner_mapping', 'event_subscribers', null,
    jsonb_build_object('bus_event_type', p_bus_event_type, 'integration_event_type', null, 'removed', true));
end;
$$;

revoke all on function public.admin_list_partner_webhook_endpoints() from public, anon;
revoke all on function public.admin_reenable_partner_webhook_endpoint(uuid, text) from public, anon;
revoke all on function public.admin_disable_partner_event_mapping(text) from public, anon;
revoke all on function public.admin_list_partner_event_mappings() from public, anon;
grant execute on function public.admin_list_partner_webhook_endpoints() to authenticated;
grant execute on function public.admin_reenable_partner_webhook_endpoint(uuid, text) to authenticated;
grant execute on function public.admin_disable_partner_event_mapping(text) to authenticated;
grant execute on function public.admin_list_partner_event_mappings() to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.admin_list_partner_webhook_endpoints()', 'EXECUTE')
     or has_function_privilege('anon', 'public.admin_reenable_partner_webhook_endpoint(uuid, text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.admin_list_partner_event_mappings()', 'EXECUTE')
     or has_function_privilege('anon', 'public.admin_disable_partner_event_mapping(text)', 'EXECUTE') then
    raise exception 'S10y: an admin partner function is executable by anon';
  end if;
end $$;
