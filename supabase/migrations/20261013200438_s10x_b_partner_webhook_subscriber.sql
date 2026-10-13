-- S10x-b: the partner.webhook bus subscriber, signing-key rotation and automatic endpoint disable.
--
-- The bus feeds the EXISTING partner webhook queue (integration_outbound_events, claim with SKIP LOCKED, backoff, dead letter);
-- nothing about that queue is replaced. What is added:
--   1. partner_event_map: which bus event type maps to which partner-facing integration_event_type. Data, empty at writing, so
--      nothing reaches a partner until a person (admin) calls set_partner_event_mapping. Each mapping creates one
--      event_subscribers row (handler_key partner.webhook). IMPORTANT: deploy process-events (which registers the handler) before
--      the first mapping, or the deliveries go to the dead letter as "no handler registered".
--   2. public.partner_webhook_enqueue_for_delivery(delivery): called by the handler. Builds an ids-only envelope (event id, type,
--      aggregate type and id, the payload keys that end in _id or _ids). It never carries patient_id, a name, a reading or a
--      condition: a partner that needs more reads it through the partner API, which has the consent checks. Test events go to
--      sandbox endpoints only. Idempotent on (endpoint, 'bus:' || event id).
--   3. Key rotation: rotate_partner_webhook_secret keeps the old secret valid for a grace window (1 to 168 hours, default 24) and the
--      drainer signs with both during it. The new secret is returned once to the caller and never written to the audit log.
--   4. Auto-disable: after event_bus_config.partner_disable_after_failures consecutive failed attempts (PROPOSED 20, floor 5) an
--      endpoint is set inactive with a reason and ONE ops_incidents row is opened (none while one is open). Inactive endpoints are
--      no longer claimed. reenable_partner_webhook_endpoint resets it.
--
-- Row counts at writing (live): 0 partner_webhook_endpoints, 0 integration_outbound_events. No data conversion, and the signature
-- change is additive (the existing X-Tarragon-Signature header is kept).

-- ---------------------------------------------------------------------------
-- Config version 3
-- ---------------------------------------------------------------------------
alter table public.event_bus_config
  add column partner_disable_after_failures integer not null default 20 check (partner_disable_after_failures >= 5);

update public.event_bus_config set is_active = false where is_active;
insert into public.event_bus_config
  (version, is_active, batch_size, lease_seconds, max_attempts, backoff_base_seconds, backoff_max_seconds, jitter_percent,
   lag_alert_seconds, partner_disable_after_failures, note)
values (3, true, 50, 60, 8, 15, 900, 20, 600, 20, 'PROPOSED: S10x-b adds partner_disable_after_failures (20, floor 5), other values as version 2');

-- ---------------------------------------------------------------------------
-- Endpoint columns
-- ---------------------------------------------------------------------------
alter table public.partner_webhook_endpoints
  add column signing_key_version integer not null default 1 check (signing_key_version >= 1),
  add column previous_secret text check (previous_secret is null or length(previous_secret) >= 32),
  add column previous_secret_expires_at timestamptz,
  add column auto_disabled_at timestamptz,
  add column disabled_reason text;

-- ---------------------------------------------------------------------------
-- Mapping (data)
-- ---------------------------------------------------------------------------
create table public.partner_event_map (
  bus_event_type         text primary key references public.event_types(event_type),
  integration_event_type public.integration_event_type not null,
  subscriber_key         text not null unique references public.event_subscribers(subscriber_key),
  -- The payload keys that may be sent to partners for this event type: an allow-list chosen by a person, not a filter.
  id_keys                text[] not null default '{}' check (cardinality(id_keys) <= 20),
  created_by             uuid,
  created_at             timestamptz not null default now()
);
alter table public.partner_event_map enable row level security;
create policy partner_event_map_admin_read on public.partner_event_map for select to authenticated using (private.is_admin());
revoke all on public.partner_event_map from public, anon, authenticated;
grant select on public.partner_event_map to authenticated;
comment on table public.partner_event_map is 'S10x-b: bus event type to partner-facing event type. Empty until an admin maps one; written only by set_partner_event_mapping.';

create or replace function public.set_partner_event_mapping(
  p_bus_event_type text, p_integration_event_type public.integration_event_type, p_id_keys text[] default '{}')
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text := 'partner.webhook.' || replace(p_bus_event_type, '.', '_');
begin
  if not private.is_admin() then
    raise exception 'only an admin may map a bus event to partners' using errcode = '42501';
  end if;
  if exists (select 1 from unnest(coalesce(p_id_keys, '{}')) k where k !~ '^[a-z][a-z0-9_]*(_id|_ids)$'
             or k in ('patient_id', 'profile_id', 'user_id', 'member_id', 'person_id', 'clinician_id', 'staff_id', 'caregiver_id')) then
    raise exception 'id keys must end in _id or _ids and may not name a person' using errcode = '22023';
  end if;
  if not exists (select 1 from public.event_types where event_type = p_bus_event_type and is_active) then
    raise exception 'unknown or inactive event type %', p_bus_event_type using errcode = '22023';
  end if;

  if p_integration_event_type is null then
    delete from public.partner_event_map where bus_event_type = p_bus_event_type;
    update public.event_subscribers set is_active = false where subscriber_key = v_key;
  else
    insert into public.event_subscribers (subscriber_key, event_type, handler_key, note)
    values (v_key, p_bus_event_type, 'partner.webhook', 'S10x-b: feeds partner webhook endpoints')
    on conflict (subscriber_key) do update set is_active = true;
    insert into public.partner_event_map (bus_event_type, integration_event_type, subscriber_key, id_keys, created_by)
    values (p_bus_event_type, p_integration_event_type, v_key, coalesce(p_id_keys, '{}'), (select auth.uid()))
    on conflict (bus_event_type) do update set integration_event_type = excluded.integration_event_type, id_keys = excluded.id_keys;
  end if;

  perform private.log_audit('event_bus.partner_mapping', 'event_subscribers', null,
    jsonb_build_object('bus_event_type', p_bus_event_type, 'integration_event_type', p_integration_event_type, 'subscriber_key', v_key));
  return v_key;
end;
$$;

-- ---------------------------------------------------------------------------
-- The handler's database side
-- ---------------------------------------------------------------------------
create or replace function public.partner_webhook_enqueue_for_delivery(p_delivery_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.domain_event_deliveries%rowtype;
  e public.domain_events%rowtype;
  m public.partner_event_map%rowtype;
  v_n integer;
begin
  select * into d from public.domain_event_deliveries where id = p_delivery_id;
  if not found then
    raise exception 'partner_webhook_enqueue_for_delivery: unknown delivery %', p_delivery_id using errcode = '22023';
  end if;
  select * into e from public.domain_events where id = d.event_id;
  select * into m from public.partner_event_map where subscriber_key = d.subscriber_key and bus_event_type = e.event_type;
  if not found then
    return -1;  -- the mapping was removed after this delivery was created: nothing to send
  end if;
  -- Inserted here (not through enqueue_integration_event) for two reasons. An endpoint the system switched off must still receive a
  -- queued row, or an event emitted during the outage would be lost for good: the claim skips inactive endpoints, and the row waits
  -- until it is switched back on. And a replay of this bus delivery must do something: a dead-lettered or cancelled partner row
  -- for the same event is put back in the queue; one that was delivered is left alone (no second send).
  with ins as (
    insert into public.integration_outbound_events
      (organisation_id, partner_integration_id, webhook_endpoint_id, event_id, event_type, dedupe_key, payload, environment)
    select w.organisation_id, w.partner_integration_id, w.id, gen_random_uuid(), m.integration_event_type, 'bus:' || e.id::text,
           jsonb_build_object(
             'bus_event_id', e.id,
             'bus_event_type', e.event_type,
             'event_version', e.event_version,
             'aggregate_type', e.aggregate_type,
             'aggregate_id', case when 'aggregate_id' = any (m.id_keys) then e.aggregate_id else null end,   -- sent only when the mapping lists it
             'occurred_at', e.occurred_at,
             'ids', (select coalesce(jsonb_object_agg(i.k, i.v), '{}'::jsonb) from jsonb_each(private.event_payload_ids(e.payload)) i(k, v) where i.k = any (m.id_keys))),
           case when e.is_test then 'sandbox'::public.api_environment else 'live'::public.api_environment end
      from public.partner_webhook_endpoints w
     where w.organisation_id = e.organisation_id
       and (w.is_active or w.auto_disabled_at is not null)
       and w.environment = case when e.is_test then 'sandbox'::public.api_environment else 'live'::public.api_environment end
       and m.integration_event_type = any (w.event_types)
    on conflict (webhook_endpoint_id, dedupe_key) do update
      set status = 'pending', attempt_count = 0, next_attempt_at = now(), last_attempt_at = null, last_error = null
      where public.integration_outbound_events.status in ('dead_letter', 'cancelled')
    returning 1
  )
  select count(*) into v_n from ins;
  return v_n;
end;
$$;

-- ---------------------------------------------------------------------------
-- Claim: also hands the drainer the previous secret while it is in its grace window; inactive endpoints are not claimed
-- ---------------------------------------------------------------------------
drop function public.claim_integration_outbound_batch(integer);
create function public.claim_integration_outbound_batch(p_limit integer default 25)
returns table (
  id                uuid,
  event_id          uuid,
  event_type        public.integration_event_type,
  payload           jsonb,
  attempt_count     integer,
  max_attempts      integer,
  url               text,
  secret            text,
  endpoint_name     text,
  previous_secret   text,
  signing_key_version integer
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  return query
  with due as (
    select e.id
    from public.integration_outbound_events e
    join public.partner_webhook_endpoints w on w.id = e.webhook_endpoint_id
    where w.is_active
      and ((e.status in ('pending', 'failed') and e.next_attempt_at <= now())
        or (e.status = 'delivering' and e.last_attempt_at < now() - interval '10 minutes'))
    order by e.next_attempt_at
    limit greatest(p_limit, 1)
    for update of e skip locked
  )
  update public.integration_outbound_events e
  set status = 'delivering',
      attempt_count = e.attempt_count + 1,
      last_attempt_at = now()
  from due, public.partner_webhook_endpoints w
  where e.id = due.id and w.id = e.webhook_endpoint_id
  returning e.id, e.event_id, e.event_type, e.payload, e.attempt_count, e.max_attempts,
            w.url, w.secret, w.name,
            case when w.previous_secret_expires_at > now() then w.previous_secret end,
            w.signing_key_version;
end;
$$;

-- ---------------------------------------------------------------------------
-- Result: same as before plus the automatic disable
-- ---------------------------------------------------------------------------
create or replace function public.record_integration_delivery_result(
  p_outbound_event_id uuid, p_ok boolean, p_status_code integer, p_error text, p_duration_ms integer
)
returns public.integration_delivery_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event  record;
  v_status public.integration_delivery_status;
  v_fails  integer;
  v_was_active boolean;
  v_limit  integer;
  v_name   text;
  v_org    uuid;
  v_ref    text;
begin
  select * into v_event
  from public.integration_outbound_events
  where id = p_outbound_event_id
  for update;

  if v_event is null then
    raise exception 'record_integration_delivery_result: unknown event %', p_outbound_event_id;
  end if;

  insert into public.integration_delivery_attempts (
    outbound_event_id, attempt_no, ok, status_code, error, duration_ms
  ) values (
    p_outbound_event_id, v_event.attempt_count, p_ok, p_status_code,
    left(p_error, 500), greatest(coalesce(p_duration_ms, 0), 0)
  );

  if p_ok then
    v_status := 'delivered';
    update public.integration_outbound_events
    set status = 'delivered',
        delivered_at = now(),
        last_status_code = p_status_code,
        last_error = null
    where id = p_outbound_event_id;

    update public.partner_webhook_endpoints
    set last_success_at = now(), consecutive_failures = 0
    where id = v_event.webhook_endpoint_id;
  else
    v_status := case when v_event.attempt_count >= v_event.max_attempts
                     then 'dead_letter'::public.integration_delivery_status
                     else 'failed'::public.integration_delivery_status end;

    update public.integration_outbound_events
    set status = v_status,
        last_status_code = p_status_code,
        last_error = left(p_error, 500),
        next_attempt_at = case
          when v_status = 'failed'
          then now() + make_interval(secs =>
                 private.integration_backoff_seconds(v_event.attempt_count) * (0.75 + random() * 0.5))
          else next_attempt_at
        end
    where id = p_outbound_event_id;

    update public.partner_webhook_endpoints
    set last_failure_at = now(), consecutive_failures = consecutive_failures + 1
    where id = v_event.webhook_endpoint_id
    returning consecutive_failures, is_active, name, organisation_id into v_fails, v_was_active, v_name, v_org;

    if v_status = 'dead_letter' then
      perform private.log_audit(
        'integration.delivery.dead_letter',
        'integration_outbound_events',
        p_outbound_event_id,
        jsonb_build_object(
          'event_type', v_event.event_type,
          'webhook_endpoint_id', v_event.webhook_endpoint_id,
          'attempts', v_event.attempt_count,
          'last_status_code', p_status_code
        )
      );
    end if;

    begin
    v_limit := greatest((private.event_bus_setting()).partner_disable_after_failures, 5);
    if v_was_active and v_fails >= v_limit then
      update public.partner_webhook_endpoints
         set is_active = false, auto_disabled_at = now(),
             disabled_reason = format('Switched off automatically after %s failed deliveries in a row. Fix the endpoint, then switch it back on.', v_fails)
       where id = v_event.webhook_endpoint_id;
      perform private.log_audit('integration.webhook.auto_disabled', 'partner_webhook_endpoints', v_event.webhook_endpoint_id,
        jsonb_build_object('consecutive_failures', v_fails, 'last_status_code', p_status_code));
      v_ref := 'partner_webhook:' || v_event.webhook_endpoint_id::text;
      if not exists (select 1 from public.ops_incidents where external_reference = v_ref and status not in ('resolved', 'closed')) then
        insert into public.ops_incidents
          (organisation_id, category, severity, title, summary, external_reference, ack_due_at, resolve_due_at)
        values
          (v_org, 'technical', 'sev3', 'Partner webhook endpoint switched off after repeated failures',
           format('Endpoint "%s" failed %s deliveries in a row and was switched off. Nothing is sent to it until it is switched back on from the integrations page. Queued events wait.', v_name, v_fails),
           v_ref, now() + interval '1 day', now() + interval '3 days');
      end if;
    end if;
    exception when others then
      -- the delivery result above must still be recorded; a failed switch-off shows in the database log and on the next failure
      raise warning 'auto-disable check for endpoint % failed: %', v_event.webhook_endpoint_id, sqlerrm;
    end;
  end if;

  return v_status;
end;
$$;

-- ---------------------------------------------------------------------------
-- Rotation and re-enable (integrations.manage, same organisation)
-- ---------------------------------------------------------------------------
create or replace function public.rotate_partner_webhook_secret(p_endpoint_id uuid, p_grace_hours integer default 24)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_new text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  v_version integer;
begin
  if p_grace_hours is null or p_grace_hours < 1 or p_grace_hours > 168 then
    raise exception 'grace period must be between 1 and 168 hours' using errcode = '22023';
  end if;
  select organisation_id into v_org from public.partner_webhook_endpoints where id = p_endpoint_id for update;
  if v_org is null then
    raise exception 'endpoint not found';
  end if;
  if v_org <> private.current_org_id() or not (private.is_admin() or private.has_permission('integrations.manage')) then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  if exists (select 1 from public.partner_webhook_endpoints where id = p_endpoint_id and previous_secret_expires_at > now()) then
    raise exception 'the previous rotation is still in its grace window' using errcode = '55000';
  end if;
  update public.partner_webhook_endpoints
     set previous_secret = secret,
         previous_secret_expires_at = now() + make_interval(hours => p_grace_hours),
         secret = v_new,
         signing_key_version = signing_key_version + 1
   where id = p_endpoint_id
   returning signing_key_version into v_version;
  perform private.log_audit('integration.webhook.secret_rotated', 'partner_webhook_endpoints', p_endpoint_id,
    jsonb_build_object('signing_key_version', v_version, 'grace_hours', p_grace_hours));
  return v_new;
end;
$$;

create or replace function public.reenable_partner_webhook_endpoint(p_endpoint_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_org uuid;
begin
  select organisation_id into v_org from public.partner_webhook_endpoints where id = p_endpoint_id;
  if v_org is null then
    raise exception 'endpoint not found';
  end if;
  if v_org <> private.current_org_id() or not (private.is_admin() or private.has_permission('integrations.manage')) then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  update public.partner_webhook_endpoints
     set is_active = true, consecutive_failures = 0, auto_disabled_at = null, disabled_reason = null
   where id = p_endpoint_id;
  perform private.log_audit('integration.webhook.reenabled', 'partner_webhook_endpoints', p_endpoint_id, '{}'::jsonb);
end;
$$;

-- Switching an endpoint back on by any route (the integrations page toggle included) clears the automatic switch-off, or the next
-- failure would switch it straight off again.
create or replace function private.partner_endpoint_reset_on_enable()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.is_active and not old.is_active then
    new.consecutive_failures := 0;
    new.auto_disabled_at := null;
    new.disabled_reason := null;
  end if;
  return new;
end;
$$;
create trigger partner_webhook_endpoints_reset_on_enable before update of is_active on public.partner_webhook_endpoints
  for each row execute function private.partner_endpoint_reset_on_enable();

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke all on function public.set_partner_event_mapping(text, public.integration_event_type, text[]) from public, anon;
revoke all on function public.partner_webhook_enqueue_for_delivery(uuid) from public, anon, authenticated;
revoke all on function public.claim_integration_outbound_batch(integer) from public, anon, authenticated;
revoke all on function public.record_integration_delivery_result(uuid, boolean, integer, text, integer) from public, anon, authenticated;
revoke all on function public.rotate_partner_webhook_secret(uuid, integer) from public, anon;
revoke all on function public.reenable_partner_webhook_endpoint(uuid) from public, anon;
grant execute on function public.set_partner_event_mapping(text, public.integration_event_type, text[]) to authenticated, service_role;
grant execute on function public.partner_webhook_enqueue_for_delivery(uuid) to service_role;
grant execute on function public.claim_integration_outbound_batch(integer) to service_role;
grant execute on function public.record_integration_delivery_result(uuid, boolean, integer, text, integer) to service_role;
grant execute on function public.rotate_partner_webhook_secret(uuid, integer) to authenticated;
grant execute on function public.reenable_partner_webhook_endpoint(uuid) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.partner_webhook_enqueue_for_delivery(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.rotate_partner_webhook_secret(uuid, integer)', 'EXECUTE')
     or has_function_privilege('anon', 'public.reenable_partner_webhook_endpoint(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.set_partner_event_mapping(text, public.integration_event_type, text[])', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.partner_webhook_enqueue_for_delivery(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.claim_integration_outbound_batch(integer)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.record_integration_delivery_result(uuid, boolean, integer, text, integer)', 'EXECUTE') then
    raise exception 'S10x-b: a partner webhook function is executable by a role that must not run it';
  end if;
  if (select count(*) from public.event_bus_config where is_active) <> 1 then
    raise exception 'S10x-b: exactly one active event_bus_config row expected';
  end if;
end $$;
