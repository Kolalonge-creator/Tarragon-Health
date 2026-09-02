-- Tarragon Health — Interoperability & API Platform, part 2 of 3:
-- the outbound event queue, partner webhooks, retry ladder and dead-letter queue.
-- (Full rationale in the committed migration file.)

create type public.integration_event_type as enum (
  'result.available',
  'result.amended',
  'lab_order.created',
  'lab_order.cancelled',
  'appointment.booked',
  'appointment.cancelled',
  'appointment.rescheduled',
  'prescription.created',
  'prescription.cancelled',
  'dispense.completed',
  'patient.registered',
  'patient.consent_changed',
  'payment.settled',
  'payment.refunded',
  'claim.status_changed'
);

comment on type public.integration_event_type is
  'Outbound event catalogue (§33.15). Adding a value is a migration on purpose: every value is a public contract a partner has subscribed to by name, so it should not be possible to invent one at runtime.';

create type public.integration_delivery_status as enum (
  'pending',
  'delivering',
  'delivered',
  'failed',
  'dead_letter',
  'cancelled'
);

create table public.partner_webhook_endpoints (
  id                      uuid primary key default gen_random_uuid(),
  organisation_id         uuid not null references public.organisations (id),
  partner_integration_id  uuid not null references public.partner_integrations (id) on delete cascade,
  name                    text not null,
  url                     text not null,
  secret                  text not null,
  event_types             public.integration_event_type[] not null,
  environment             public.api_environment not null default 'live',
  is_active               boolean not null default true,
  description             text,
  last_success_at         timestamptz,
  last_failure_at         timestamptz,
  consecutive_failures    integer not null default 0,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),

  constraint partner_webhook_url_https check (url like 'https://%' and length(url) between 12 and 500),
  constraint partner_webhook_has_events check (array_length(event_types, 1) >= 1),
  constraint partner_webhook_secret_strength check (length(secret) >= 32)
);

comment on table public.partner_webhook_endpoints is
  'Partner webhook subscriptions (§33.15). Holds a signing secret, so RLS is the same integrations.manage gate as partner_integrations and the admin UI must project has_secret rather than the secret itself.';

create index partner_webhook_endpoints_partner_idx
  on public.partner_webhook_endpoints (partner_integration_id);
create index partner_webhook_endpoints_org_idx
  on public.partner_webhook_endpoints (organisation_id);

alter table public.partner_webhook_endpoints enable row level security;

create policy partner_webhook_endpoints_select on public.partner_webhook_endpoints
  for select to authenticated
  using (
    organisation_id = private.current_org_id()
    and (private.is_admin() or private.has_permission('integrations.manage'))
  );

create policy partner_webhook_endpoints_insert on public.partner_webhook_endpoints
  for insert to authenticated
  with check (
    organisation_id = private.current_org_id()
    and (private.is_admin() or private.has_permission('integrations.manage'))
  );

create policy partner_webhook_endpoints_update on public.partner_webhook_endpoints
  for update to authenticated
  using (
    organisation_id = private.current_org_id()
    and (private.is_admin() or private.has_permission('integrations.manage'))
  );

create policy partner_webhook_endpoints_delete on public.partner_webhook_endpoints
  for delete to authenticated
  using (
    organisation_id = private.current_org_id()
    and (private.is_admin() or private.has_permission('integrations.manage'))
  );

grant select, insert, update, delete on public.partner_webhook_endpoints to authenticated;

create trigger partner_webhook_endpoints_updated_at
  before update on public.partner_webhook_endpoints
  for each row execute function private.set_updated_at();

create table public.integration_outbound_events (
  id                      uuid primary key default gen_random_uuid(),
  organisation_id         uuid not null references public.organisations (id),
  partner_integration_id  uuid not null references public.partner_integrations (id) on delete cascade,
  webhook_endpoint_id     uuid not null references public.partner_webhook_endpoints (id) on delete cascade,
  event_id                uuid not null,
  event_type              public.integration_event_type not null,
  dedupe_key              text not null,
  payload                 jsonb not null,
  environment             public.api_environment not null default 'live',

  status                  public.integration_delivery_status not null default 'pending',
  attempt_count           integer not null default 0,
  max_attempts            integer not null default 8,
  next_attempt_at         timestamptz not null default now(),
  last_attempt_at         timestamptz,
  delivered_at            timestamptz,
  last_status_code        integer,
  last_error              text,
  created_at              timestamptz not null default now(),

  constraint integration_outbound_attempts_sane
    check (attempt_count >= 0 and max_attempts between 1 and 20 and attempt_count <= max_attempts),
  constraint integration_outbound_delivered_is_stamped
    check ((status = 'delivered') = (delivered_at is not null)),
  constraint integration_outbound_dead_letter_was_attempted
    check (status <> 'dead_letter' or attempt_count > 0)
);

comment on table public.integration_outbound_events is
  'Durable outbound delivery queue (§33.10/§33.11). One row per (business event, subscribed endpoint) so a partner outage blocks only that partner. Retry state is data on the row — attempt_count, next_attempt_at, max_attempts — never implied by a worker''s control flow.';

create unique index integration_outbound_dedupe
  on public.integration_outbound_events (webhook_endpoint_id, dedupe_key);
create index integration_outbound_due_idx
  on public.integration_outbound_events (next_attempt_at)
  where status in ('pending', 'failed');
create index integration_outbound_inflight_idx
  on public.integration_outbound_events (last_attempt_at)
  where status = 'delivering';
create index integration_outbound_dlq_idx
  on public.integration_outbound_events (organisation_id, created_at desc)
  where status = 'dead_letter';
create index integration_outbound_endpoint_idx
  on public.integration_outbound_events (webhook_endpoint_id, created_at desc);
create index integration_outbound_event_id_idx
  on public.integration_outbound_events (event_id);

alter table public.integration_outbound_events enable row level security;

create policy integration_outbound_events_select on public.integration_outbound_events
  for select to authenticated
  using (
    organisation_id = private.current_org_id()
    and (private.is_admin() or private.has_permission('integrations.manage'))
  );

grant select on public.integration_outbound_events to authenticated;

create table public.integration_delivery_attempts (
  id                 uuid primary key default gen_random_uuid(),
  outbound_event_id  uuid not null references public.integration_outbound_events (id) on delete cascade,
  attempt_no         integer not null,
  ok                 boolean not null,
  status_code        integer,
  error              text,
  duration_ms        integer not null,
  attempted_at       timestamptz not null default now(),

  constraint integration_delivery_attempt_duration_sane check (duration_ms >= 0)
);

create index integration_delivery_attempts_event_idx
  on public.integration_delivery_attempts (outbound_event_id, attempt_no);
create index integration_delivery_attempts_recent_idx
  on public.integration_delivery_attempts (attempted_at desc);

alter table public.integration_delivery_attempts enable row level security;

create policy integration_delivery_attempts_select on public.integration_delivery_attempts
  for select to authenticated
  using (
    exists (
      select 1 from public.integration_outbound_events e
      where e.id = outbound_event_id
        and e.organisation_id = private.current_org_id()
        and (private.is_admin() or private.has_permission('integrations.manage'))
    )
  );

grant select on public.integration_delivery_attempts to authenticated;

create or replace function private.integration_backoff_seconds(p_attempt integer)
returns integer
language sql
immutable
set search_path = ''
as $$
  select least(30 * (2 ^ greatest(p_attempt - 1, 0))::bigint, 3600)::integer;
$$;

comment on function private.integration_backoff_seconds(integer) is
  'Exponential backoff ladder for outbound delivery (§33.11): 30s doubling to a 1h cap. Pure and immutable so the app-side worker and the database agree on the schedule by construction, and so it can be asserted on directly in a test.';

revoke all on function private.integration_backoff_seconds(integer) from public;
grant execute on function private.integration_backoff_seconds(integer) to authenticated;

create or replace function private.enqueue_integration_event(
  p_organisation_id uuid,
  p_event_type      public.integration_event_type,
  p_payload         jsonb,
  p_dedupe_key      text,
  p_environment     public.api_environment default 'live'
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event_id uuid := gen_random_uuid();
  v_queued   integer := 0;
begin
  if p_dedupe_key is null or length(trim(p_dedupe_key)) = 0 then
    raise exception 'enqueue_integration_event: a dedupe_key is required';
  end if;

  insert into public.integration_outbound_events (
    organisation_id, partner_integration_id, webhook_endpoint_id,
    event_id, event_type, dedupe_key, payload, environment
  )
  select
    w.organisation_id, w.partner_integration_id, w.id,
    v_event_id, p_event_type, p_dedupe_key, p_payload, p_environment
  from public.partner_webhook_endpoints w
  where w.organisation_id = p_organisation_id
    and w.is_active
    and w.environment = p_environment
    and p_event_type = any (w.event_types)
  on conflict (webhook_endpoint_id, dedupe_key) do nothing;

  get diagnostics v_queued = row_count;
  return v_queued;
end;
$$;

comment on function private.enqueue_integration_event(uuid, public.integration_event_type, jsonb, text, public.api_environment) is
  'Fan one business event out to every active, subscribed endpoint in the org (§33.10/§33.15). Idempotent on (endpoint, dedupe_key). Returns how many rows were queued; 0 means nobody subscribes, which is normal.';

revoke all on function private.enqueue_integration_event(uuid, public.integration_event_type, jsonb, text, public.api_environment) from public;

create or replace function private.claim_integration_outbound_batch(p_limit integer default 25)
returns table (
  id                uuid,
  event_id          uuid,
  event_type        public.integration_event_type,
  payload           jsonb,
  attempt_count     integer,
  max_attempts      integer,
  url               text,
  secret            text,
  endpoint_name     text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  with due as (
    select e.id
    from public.integration_outbound_events e
    where (
        (e.status in ('pending', 'failed') and e.next_attempt_at <= now())
        or (e.status = 'delivering' and e.last_attempt_at < now() - interval '10 minutes')
      )
    order by e.next_attempt_at
    limit greatest(p_limit, 1)
    for update skip locked
  )
  update public.integration_outbound_events e
  set status = 'delivering',
      attempt_count = e.attempt_count + 1,
      last_attempt_at = now()
  from due, public.partner_webhook_endpoints w
  where e.id = due.id and w.id = e.webhook_endpoint_id
  returning e.id, e.event_id, e.event_type, e.payload, e.attempt_count, e.max_attempts,
            w.url, w.secret, w.name;
end;
$$;

comment on function private.claim_integration_outbound_batch(integer) is
  'Atomically claim due deliveries for one worker pass (§33.10). FOR UPDATE SKIP LOCKED makes concurrent drainer runs safe; the 10-minute reclaim window recovers rows abandoned by a worker that died mid-delivery.';

revoke all on function private.claim_integration_outbound_batch(integer) from public;

create or replace function private.record_integration_delivery_result(
  p_outbound_event_id uuid,
  p_ok                boolean,
  p_status_code       integer,
  p_error             text,
  p_duration_ms       integer
)
returns public.integration_delivery_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event  record;
  v_status public.integration_delivery_status;
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
    where id = v_event.webhook_endpoint_id;

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
  end if;

  return v_status;
end;
$$;

comment on function private.record_integration_delivery_result(uuid, boolean, integer, text, integer) is
  'Close out one delivery attempt (§33.11): ledger row, then delivered / retry-with-jittered-backoff / dead-letter. Dead-lettering also writes an audit event so an exhausted clinical delivery is never known only to a log line.';

revoke all on function private.record_integration_delivery_result(uuid, boolean, integer, text, integer) from public;

create or replace function public.requeue_integration_event(p_outbound_event_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  select organisation_id into v_org
  from public.integration_outbound_events
  where id = p_outbound_event_id and status in ('dead_letter', 'cancelled');

  if v_org is null then
    raise exception 'event not found, or not in a requeueable state';
  end if;
  if v_org <> private.current_org_id()
     or not (private.is_admin() or private.has_permission('integrations.manage')) then
    raise exception 'not authorised';
  end if;

  update public.integration_outbound_events
  set status = 'pending',
      attempt_count = 0,
      next_attempt_at = now(),
      last_error = null
  where id = p_outbound_event_id;

  perform private.log_audit('integration.delivery.requeued', 'integration_outbound_events',
    p_outbound_event_id, '{}'::jsonb);
end;
$$;

revoke all on function public.requeue_integration_event(uuid) from public;
grant execute on function public.requeue_integration_event(uuid) to authenticated;
revoke execute on function public.requeue_integration_event(uuid) from anon;

create or replace function public.cancel_integration_event(p_outbound_event_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  select organisation_id into v_org
  from public.integration_outbound_events
  where id = p_outbound_event_id and status <> 'delivered';

  if v_org is null then
    raise exception 'event not found, or already delivered';
  end if;
  if v_org <> private.current_org_id()
     or not (private.is_admin() or private.has_permission('integrations.manage')) then
    raise exception 'not authorised';
  end if;

  update public.integration_outbound_events
  set status = 'cancelled'
  where id = p_outbound_event_id;

  perform private.log_audit('integration.delivery.cancelled', 'integration_outbound_events',
    p_outbound_event_id, '{}'::jsonb);
end;
$$;

revoke all on function public.cancel_integration_event(uuid) from public;
grant execute on function public.cancel_integration_event(uuid) to authenticated;
revoke execute on function public.cancel_integration_event(uuid) from anon;

create or replace function private.prune_integration_logs(p_request_log_days integer default 90)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_requests integer;
  v_idempotency integer;
  v_delivered integer;
begin
  delete from public.api_requests
  where called_at < now() - make_interval(days => greatest(p_request_log_days, 7));
  get diagnostics v_requests = row_count;

  delete from public.api_idempotency_records where expires_at < now();
  get diagnostics v_idempotency = row_count;

  delete from public.integration_outbound_events
  where status = 'delivered'
    and delivered_at < now() - make_interval(days => greatest(p_request_log_days, 7));
  get diagnostics v_delivered = row_count;

  return jsonb_build_object(
    'api_requests_pruned', v_requests,
    'idempotency_pruned', v_idempotency,
    'delivered_events_pruned', v_delivered
  );
end;
$$;

revoke all on function private.prune_integration_logs(integer) from public;

do $$
begin
  if not has_table_privilege('authenticated', 'public.partner_webhook_endpoints', 'SELECT')
     or not has_table_privilege('authenticated', 'public.integration_outbound_events', 'SELECT')
     or not has_table_privilege('authenticated', 'public.integration_delivery_attempts', 'SELECT') then
    raise exception 'outbound queue: an authenticated table grant did not take';
  end if;

  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'integration_outbound_events' and cmd <> 'SELECT'
  ) then
    raise exception 'integration_outbound_events must expose SELECT only';
  end if;

  if has_function_privilege('anon', 'public.requeue_integration_event(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.cancel_integration_event(uuid)', 'EXECUTE') then
    raise exception 'integration recovery RPCs: anon is still EXECUTE-able';
  end if;

  if private.integration_backoff_seconds(1) <> 30
     or private.integration_backoff_seconds(2) <> 60
     or private.integration_backoff_seconds(3) <> 120
     or private.integration_backoff_seconds(8) <> 3600
     or private.integration_backoff_seconds(20) <> 3600 then
    raise exception 'integration_backoff_seconds is not the documented 30s-doubling-to-1h ladder';
  end if;
end $$;

do $$
declare
  v_org      uuid;
  v_partner  uuid;
  v_endpoint uuid;
  v_queued   integer;
  v_again    integer;
  v_rejected boolean := false;
begin
  select id into v_org from public.organisations limit 1;
  if v_org is null then
    return;
  end if;

  insert into public.partner_integrations (organisation_id, name, base_url)
  values (v_org, 'queue self-test', 'https://example.invalid')
  returning id into v_partner;

  insert into public.partner_webhook_endpoints (
    organisation_id, partner_integration_id, name, url, secret, event_types
  ) values (
    v_org, v_partner, 'self-test', 'https://example.invalid/hook',
    repeat('0', 40), array['result.available']::public.integration_event_type[]
  ) returning id into v_endpoint;

  v_queued := private.enqueue_integration_event(
    v_org, 'result.available', '{"probe":true}'::jsonb, 'self-test-dedupe');
  if v_queued <> 1 then
    raise exception 'enqueue_integration_event did not fan out to the subscribed endpoint (got %)', v_queued;
  end if;

  v_again := private.enqueue_integration_event(
    v_org, 'result.available', '{"probe":true}'::jsonb, 'self-test-dedupe');
  if v_again <> 0 then
    raise exception 'enqueue_integration_event is not idempotent on dedupe_key (got %)', v_again;
  end if;

  if private.enqueue_integration_event(
       v_org, 'payment.settled', '{"probe":true}'::jsonb, 'self-test-unsubscribed') <> 0 then
    raise exception 'enqueue_integration_event queued an event the endpoint does not subscribe to';
  end if;

  begin
    update public.integration_outbound_events
    set status = 'delivered'
    where dedupe_key = 'self-test-dedupe';
  exception when check_violation then
    v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'integration_outbound_delivered_is_stamped allowed a delivered row with no delivered_at';
  end if;

  delete from public.integration_outbound_events where webhook_endpoint_id = v_endpoint;
  delete from public.partner_webhook_endpoints where id = v_endpoint;
  delete from public.partner_integrations where id = v_partner;
end $$;
