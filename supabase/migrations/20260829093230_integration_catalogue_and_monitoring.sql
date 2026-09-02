-- Tarragon Health — Interoperability & API Platform, part 3 of 3:
-- the integration catalogue (§33.8) and monitoring surface (§33.9).
--
-- WHY THIS EXISTS. Parts 1-2 built the plumbing (request log, idempotency,
-- external ids, outbound queue, webhooks). Nothing yet answers the actual
-- question an admin opens the integrations page to ask: "which partners are
-- connected right now, and which one is broken?" (§33.8's own mockup —
-- "Synlab / Connected / Last sync 14:32", "Insurer Y / Connection error") —
-- or the operational one §33.9 lists by name (uptime, latency, failed
-- requests, authentication failures, data mismatches, delayed messages).
--
-- BOTH FUNCTIONS ARE SECURITY INVOKER (the plpgsql/sql default — no
-- `security definer` keyword below), DELIBERATELY, unlike the cross-org
-- protocol_api admin RPCs. A protocol_partner has no Tarragon login, so
-- Tarragon's own admin has to reach across the org boundary with a narrowly-
-- scoped SECURITY DEFINER RPC. Every table these two functions read
-- (partner_integrations, api_keys, partner_webhook_endpoints, api_requests,
-- integration_outbound_events) is the CALLING org's own data, already
-- protected by the integrations.manage-gated SELECT policies from parts 1-2
-- — running as the invoker means Postgres enforces that RLS for free, and a
-- staff member without integrations.manage gets zero rows back from the
-- function for the same reason they would from the raw tables, rather than
-- this surface needing its own duplicated authorisation check that could
-- drift out of sync with the table policies over time.

-- ---------------------------------------------------------------------------
-- §33.8 — integration catalogue.
-- ---------------------------------------------------------------------------
create or replace function public.integration_catalogue()
returns table (
  partner_integration_id       uuid,
  name                         text,
  base_url                     text,
  is_active                    boolean,
  has_inbound_key              boolean,
  inbound_key_last_used_at     timestamptz,
  inbound_active_key_count     bigint,
  outbound_last_checked_at     timestamptz,
  outbound_last_check_ok       boolean,
  webhook_endpoint_count       bigint,
  webhook_active_endpoint_count bigint,
  webhook_last_success_at      timestamptz,
  webhook_last_failure_at      timestamptz,
  webhook_max_consecutive_failures integer,
  status                       text,
  last_activity_at             timestamptz
)
language sql
stable
set search_path = ''
as $$
  select
    p.id,
    p.name,
    p.base_url,
    p.is_active,
    (k.active_key_count > 0)                                as has_inbound_key,
    k.last_used_at                                          as inbound_key_last_used_at,
    coalesce(k.active_key_count, 0)                         as inbound_active_key_count,
    p.last_checked_at                                       as outbound_last_checked_at,
    p.last_check_ok                                         as outbound_last_check_ok,
    coalesce(w.endpoint_count, 0)                           as webhook_endpoint_count,
    coalesce(w.active_endpoint_count, 0)                    as webhook_active_endpoint_count,
    w.last_success_at                                       as webhook_last_success_at,
    w.last_failure_at                                       as webhook_last_failure_at,
    coalesce(w.max_consecutive_failures, 0)                 as webhook_max_consecutive_failures,
    case
      when not p.is_active then 'disabled'
      when p.last_check_ok is false then 'error'
      when coalesce(w.max_consecutive_failures, 0) >= 3 then 'error'
      when p.last_check_ok is true then 'connected'
      when k.last_used_at > now() - interval '7 days' then 'connected'
      when w.last_success_at > now() - interval '7 days' then 'connected'
      else 'not_connected'
    end                                                      as status,
    greatest(
      p.last_checked_at,
      k.last_used_at,
      w.last_success_at
    )                                                        as last_activity_at
  from public.partner_integrations p
  left join lateral (
    select
      count(*) filter (where a.revoked_at is null)          as active_key_count,
      max(a.last_used_at)                                   as last_used_at
    from public.api_keys a
    where a.partner_integration_id = p.id
  ) k on true
  left join lateral (
    select
      count(*)                                              as endpoint_count,
      count(*) filter (where we.is_active)                  as active_endpoint_count,
      max(we.last_success_at)                                as last_success_at,
      max(we.last_failure_at)                                as last_failure_at,
      max(we.consecutive_failures)                           as max_consecutive_failures
    from public.partner_webhook_endpoints we
    where we.partner_integration_id = p.id
  ) w on true
  where p.organisation_id = private.current_org_id()
    and (private.is_admin() or private.has_permission('integrations.manage'))
  order by p.name;
$$;

comment on function public.integration_catalogue() is
  'Admin integrations page catalogue (§33.8): one row per partner covering both the inbound key it may hold and the outbound reachability/webhook state it may have. SECURITY INVOKER — relies entirely on the caller''s own RLS on the underlying tables, see the migration header.';

revoke all on function public.integration_catalogue() from public, anon;
grant execute on function public.integration_catalogue() to authenticated;
revoke execute on function public.integration_catalogue() from anon;

-- ---------------------------------------------------------------------------
-- §33.9 — integration monitoring.
-- ---------------------------------------------------------------------------
create or replace function public.integration_health_metrics(p_window_hours integer default 24)
returns table (
  window_hours              integer,
  total_requests            bigint,
  ok_requests               bigint,
  failed_requests           bigint,
  authentication_failures   bigint,
  data_mismatches           bigint,
  rate_limited_requests     bigint,
  avg_latency_ms            numeric,
  p95_latency_ms            numeric,
  outbound_delivered        bigint,
  outbound_pending          bigint,
  outbound_failed_retrying  bigint,
  outbound_dead_letter      bigint,
  outbound_overdue          bigint,
  outbound_delayed_deliveries bigint
)
language sql
stable
set search_path = ''
as $$
  with w as (
    select greatest(coalesce(p_window_hours, 24), 1) as hours
  ),
  requests as (
    select r.*
    from public.api_requests r, w
    where r.organisation_id = private.current_org_id()
      and r.called_at >= now() - make_interval(hours => w.hours)
      and (private.is_admin() or private.has_permission('integrations.manage'))
  ),
  outbound as (
    select e.*
    from public.integration_outbound_events e, w
    where e.organisation_id = private.current_org_id()
      and e.created_at >= now() - make_interval(hours => w.hours)
      and (private.is_admin() or private.has_permission('integrations.manage'))
  )
  select
    (select hours from w)::integer,
    (select count(*) from requests),
    (select count(*) from requests where outcome = 'ok'),
    (select count(*) from requests where outcome <> 'ok'),
    (select count(*) from requests where outcome = 'unauthenticated'),
    (select count(*) from requests where outcome in ('unprocessable', 'conflict')),
    (select count(*) from requests where outcome = 'rate_limited'),
    (select round(avg(duration_ms), 1) from requests),
    (select round((percentile_cont(0.95) within group (order by duration_ms))::numeric, 1) from requests),
    (select count(*) from outbound where status = 'delivered'),
    (select count(*) from outbound where status = 'pending'),
    (select count(*) from outbound where status = 'failed'),
    (select count(*) from outbound where status = 'dead_letter'),
    -- Overdue right now, regardless of when it was created — the queue-depth
    -- signal an operator actually wants ("is anything stuck at this instant").
    (select count(*) from public.integration_outbound_events e
       where e.organisation_id = private.current_org_id()
         and e.status in ('pending', 'failed')
         and e.next_attempt_at < now()
         and (private.is_admin() or private.has_permission('integrations.manage'))),
    -- §33.9's "delayed messages": delivered, but only after more than one
    -- attempt — i.e. it reached the partner, just not on the first try.
    (select count(*) from outbound where status = 'delivered' and attempt_count > 1);
$$;

comment on function public.integration_health_metrics(integer) is
  'Admin monitoring dashboard (§33.9: uptime/latency/failed requests/auth failures/data mismatches/delayed messages) over a trailing window. SECURITY INVOKER, same posture as integration_catalogue() — see the migration header. Uptime itself is represented by ok_requests/total_requests together with each partner''s own outbound_last_check_ok from the catalogue, rather than a separate synthetic percentage that would need its own definition of "up".';

revoke all on function public.integration_health_metrics(integer) from public, anon;
grant execute on function public.integration_health_metrics(integer) to authenticated;
revoke execute on function public.integration_health_metrics(integer) from anon;

-- ---------------------------------------------------------------------------
-- Assertions.
-- ---------------------------------------------------------------------------
do $$
begin
  if has_function_privilege('anon', 'public.integration_catalogue()', 'EXECUTE')
     or has_function_privilege('anon', 'public.integration_health_metrics(integer)', 'EXECUTE') then
    raise exception 'integration monitoring RPCs: anon is still EXECUTE-able';
  end if;
end $$;

-- Prove the RLS-via-invoker claim in the header actually holds: a caller
-- with no integrations.manage permission and no admin flag must get back
-- zero rows from BOTH functions, not an error and not someone else's data.
-- This runs as the migration role, which typically bypasses RLS entirely
-- (table owner) — so this test targets what is independently verifiable
-- from here: that the functions carry no SECURITY DEFINER and no bypassing
-- grant, which is what makes RLS-via-invoker apply in the first place at
-- normal (non-superuser) runtime.
do $$
declare
  v_secdef boolean;
begin
  select p.prosecdef into v_secdef
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'integration_catalogue';

  if v_secdef is distinct from false then
    raise exception 'integration_catalogue must be SECURITY INVOKER (prosecdef = false) to inherit caller RLS';
  end if;

  select p.prosecdef into v_secdef
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'integration_health_metrics';

  if v_secdef is distinct from false then
    raise exception 'integration_health_metrics must be SECURITY INVOKER (prosecdef = false) to inherit caller RLS';
  end if;
end $$;
