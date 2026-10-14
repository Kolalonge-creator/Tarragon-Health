-- S10x-a: event bus operations (see it, trust it).
--
-- Adds, on top of the live S10 bus (no existing column or function signature a deployed caller uses is changed):
--   1. A per-attempt record (domain_event_delivery_attempts) written by complete/fail, so an admin can see what each try did.
--   2. Optional ordering: event_types.ordered (default false, nothing opts in here). For an ordered type, a delivery is not claimed
--      while an EARLIER delivery of the same subscriber for the same patient + aggregate is still pending or processing.
--      Events with neither a patient nor an aggregate form no chain and are never held back. Ties on time are broken by emission order (seq).
--      A dead earlier delivery does not block (a patient's chain must never freeze silently; the dead letter is already an incident
--      for urgent events and is counted in event_bus_health()).
--   3. A lag alert: public.event_bus_lag_sweep() opens ONE ops_incidents row per subscriber (no duplicate while open) when the oldest
--      due, unclaimed delivery is older than (urgent ones: a tenth of it, at least 30 s) event_bus_config.lag_alert_seconds (PROPOSED 600, floor 120). Cron every 2 minutes.
--   4. Admin read RPCs for the event explorer and the per-subscriber heartbeat view. Payload is returned as ids only (keys ending _id
--      or _ids), never the neutral facts, and never patient_id.
--
-- Config: event_bus_config gains lag_alert_seconds; version 2 becomes the active row (version 1 stays as history).
-- Row counts at writing (live): 17 domain_events, 0 deliveries, 0 attempts (new table). No data conversion.

-- ---------------------------------------------------------------------------
-- Config version 2
-- ---------------------------------------------------------------------------
alter table public.event_bus_config
  add column lag_alert_seconds integer not null default 600 check (lag_alert_seconds >= 120);

update public.event_bus_config set is_active = false where is_active;
insert into public.event_bus_config
  (version, is_active, batch_size, lease_seconds, max_attempts, backoff_base_seconds, backoff_max_seconds, jitter_percent, lag_alert_seconds, note)
values (2, true, 50, 60, 8, 15, 900, 20, 600, 'PROPOSED: S10x adds lag_alert_seconds (10 minutes, floor 120), other values as version 1');

-- ---------------------------------------------------------------------------
-- Ordering is opt-in per event type (data)
-- ---------------------------------------------------------------------------
alter table public.event_types add column ordered boolean not null default false;
comment on column public.event_types.ordered is
  'S10x: when true, deliveries of this type are claimed in order per subscriber, patient and aggregate (occurred_at, created_at, id). Off for every type until a person opts one in; it trades throughput for order.';

-- A tie-breaker for events that share occurred_at and created_at (two events emitted in one transaction): emission order.
alter table public.domain_events add column seq bigint generated always as identity;
create index domain_event_deliveries_done_by_sub_idx
  on public.domain_event_deliveries (subscriber_key, done_at desc) where status = 'done';
create index domain_events_chain_idx on public.domain_events (patient_id, aggregate_type, aggregate_id, occurred_at);
create index domain_event_deliveries_open_by_sub_idx
  on public.domain_event_deliveries (subscriber_key) where status in ('pending', 'processing');

-- ---------------------------------------------------------------------------
-- Attempt history
-- ---------------------------------------------------------------------------
create table public.domain_event_delivery_attempts (
  id              uuid primary key default gen_random_uuid(),
  delivery_id     uuid not null references public.domain_event_deliveries(id) on delete cascade,
  subscriber_key  text not null,
  organisation_id uuid not null references public.organisations(id),
  attempt_no      integer not null,
  outcome         text not null check (outcome in ('done', 'retry', 'dead')),
  error           text,
  created_at      timestamptz not null default now()
);
create index domain_event_delivery_attempts_delivery_idx on public.domain_event_delivery_attempts (delivery_id, attempt_no);
create index domain_event_delivery_attempts_created_idx on public.domain_event_delivery_attempts (created_at);
create index domain_event_delivery_attempts_sub_idx on public.domain_event_delivery_attempts (subscriber_key, created_at desc);

alter table public.domain_event_delivery_attempts enable row level security;
create policy domain_event_delivery_attempts_admin_read on public.domain_event_delivery_attempts
  for select to authenticated using (private.is_admin());
revoke all on public.domain_event_delivery_attempts from public, anon, authenticated;
grant select on public.domain_event_delivery_attempts to authenticated;
comment on table public.domain_event_delivery_attempts is 'S10x: one row per processing attempt (done, retry or dead), written by complete/fail. Pruned after 30 days by event_bus_lag_sweep().';

-- ---------------------------------------------------------------------------
-- Claim: same as S10 plus the ordering rule
-- ---------------------------------------------------------------------------
create or replace function public.claim_event_deliveries(p_limit integer default null, p_urgent_only boolean default false)
returns table (
  delivery_id uuid, lease_token uuid, attempt_count integer, event_id uuid, event_type text, event_version integer,
  organisation_id uuid, patient_id uuid, aggregate_type text, aggregate_id uuid, payload jsonb, priority text,
  is_test boolean, occurred_at timestamptz, subscriber_key text, handler_key text
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  c public.event_bus_config%rowtype := private.event_bus_setting();
  v_limit integer := least(coalesce(p_limit, c.batch_size), c.batch_size);
  v_dead uuid[];
  v_id uuid;
begin
  with dead as (
    update public.domain_event_deliveries d
       set status = 'dead', locked_until = null, lease_token = null,
           last_error = coalesce(d.last_error, 'lease expired at the attempt limit'), updated_at = now()
     where d.status = 'processing' and d.locked_until < now() and d.attempt_count >= c.max_attempts
    returning d.id, d.subscriber_key, d.organisation_id, d.attempt_count
  ), rec as (
    insert into public.domain_event_delivery_attempts (delivery_id, subscriber_key, organisation_id, attempt_no, outcome, error)
    select id, subscriber_key, organisation_id, attempt_count, 'dead', 'lease expired at the attempt limit' from dead
  )
  select array_agg(id) into v_dead from dead;
  foreach v_id in array coalesce(v_dead, '{}') loop
    perform private.raise_dead_urgent_incident(v_id);
  end loop;

  return query
  with picked as (
    select d.id, d.status as old_status
      from public.domain_event_deliveries d
      join public.domain_events e on e.id = d.event_id
      join public.event_types et on et.event_type = e.event_type
     where ((d.status = 'pending' and d.next_attempt_at <= now())
         or (d.status = 'processing' and d.locked_until < now()))
       and (not p_urgent_only or e.priority = 'urgent')
       and (not et.ordered or (e.patient_id is null and e.aggregate_id is null) or not exists (
             select 1
               from public.domain_event_deliveries d2
               join public.domain_events e2 on e2.id = d2.event_id
              where d2.subscriber_key = d.subscriber_key
                and d2.id <> d.id
                and d2.status in ('pending', 'processing')
                and e2.patient_id is not distinct from e.patient_id
                and e2.aggregate_type is not distinct from e.aggregate_type
                and e2.aggregate_id is not distinct from e.aggregate_id
                and (e2.occurred_at, e2.created_at, e2.seq) < (e.occurred_at, e.created_at, e.seq)))
     order by (e.priority = 'urgent') desc, d.next_attempt_at, d.created_at
     limit v_limit
     for update of d skip locked
  ), upd as (
    update public.domain_event_deliveries d
       set status = 'processing',
           locked_until = now() + make_interval(secs => c.lease_seconds),
           lease_token = gen_random_uuid(),
           attempt_count = d.attempt_count + 1,
           updated_at = now()
      from picked
     where d.id = picked.id
    returning d.*
  ), rec as (
    -- an attempt whose lease expired (crash or timeout) never reported back: record it as a lost try
    insert into public.domain_event_delivery_attempts (delivery_id, subscriber_key, organisation_id, attempt_no, outcome, error)
    select u.id, u.subscriber_key, u.organisation_id, u.attempt_count - 1, 'retry', 'lease expired before the handler reported'
      from upd u join picked p on p.id = u.id where p.old_status = 'processing'
  )
  select u.id, u.lease_token, u.attempt_count, e.id, e.event_type, e.event_version, e.organisation_id, e.patient_id,
         e.aggregate_type, e.aggregate_id, e.payload, e.priority, e.is_test, e.occurred_at, u.subscriber_key, s.handler_key
    from upd u
    join public.domain_events e on e.id = u.event_id
    join public.event_subscribers s on s.subscriber_key = u.subscriber_key
   order by (e.priority = 'urgent') desc, e.occurred_at;
end;
$$;

-- ---------------------------------------------------------------------------
-- Complete / fail: same as S10 plus the attempt record
-- ---------------------------------------------------------------------------
create or replace function public.complete_event_delivery(p_delivery_id uuid, p_lease_token uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare d public.domain_event_deliveries%rowtype;
begin
  update public.domain_event_deliveries
     set status = 'done', done_at = now(), locked_until = null, lease_token = null, last_error = null, updated_at = now()
   where id = p_delivery_id and lease_token = p_lease_token and status = 'processing'
  returning * into d;
  if not found then
    return false;
  end if;
  insert into public.domain_event_delivery_attempts (delivery_id, subscriber_key, organisation_id, attempt_no, outcome)
  values (d.id, d.subscriber_key, d.organisation_id, d.attempt_count, 'done');
  return true;
end;
$$;

create or replace function public.fail_event_delivery(
  p_delivery_id uuid, p_lease_token uuid, p_error text, p_permanent boolean default false
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.event_bus_config%rowtype := private.event_bus_setting();
  d public.domain_event_deliveries%rowtype;
  v_delay numeric;
  v_status text;
  v_err text := left(coalesce(p_error, 'failed'), 1000);
begin
  select * into d from public.domain_event_deliveries
   where id = p_delivery_id and lease_token = p_lease_token and status = 'processing'
   for update;
  if not found then
    return 'stale';
  end if;

  if p_permanent or d.attempt_count >= c.max_attempts then
    v_status := 'dead';
    update public.domain_event_deliveries
       set status = 'dead', locked_until = null, lease_token = null, last_error = v_err, updated_at = now()
     where id = d.id;
    perform private.raise_dead_urgent_incident(d.id);
  else
    v_status := 'pending';
    v_delay := least(c.backoff_base_seconds * power(2, d.attempt_count - 1), c.backoff_max_seconds)
               * (1 + random() * c.jitter_percent / 100.0);
    update public.domain_event_deliveries
       set status = 'pending', locked_until = null, lease_token = null,
           next_attempt_at = now() + make_interval(secs => v_delay),
           last_error = v_err, updated_at = now()
     where id = d.id;
  end if;
  insert into public.domain_event_delivery_attempts (delivery_id, subscriber_key, organisation_id, attempt_no, outcome, error)
  values (d.id, d.subscriber_key, d.organisation_id, d.attempt_count, case when v_status = 'dead' then 'dead' else 'retry' end, v_err);
  return v_status;
end;
$$;

-- ---------------------------------------------------------------------------
-- Lag alert: one open incident per lagging subscriber
-- ---------------------------------------------------------------------------
create or replace function public.event_bus_lag_sweep(p_include_test boolean default false)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.event_bus_config%rowtype := private.event_bus_setting();
  v_threshold integer := greatest(c.lag_alert_seconds, 120);
  v_urgent integer := greatest(c.lag_alert_seconds / 10, 30);   -- an urgent delivery waiting is far worse: one tenth of the limit, at least 30 s
  r record;
  v_ref text;
  v_n integer := 0;
begin
  if not pg_try_advisory_xact_lock(hashtext('event_bus_lag_sweep')) then
    return 0;
  end if;

  for r in
    select d.subscriber_key,
           (array_agg(d.organisation_id order by x.started))[1] as organisation_id,
           min(x.started) as oldest,
           count(*) as waiting
      from public.domain_event_deliveries d
      join public.domain_events e on e.id = d.event_id
      join public.event_types et on et.event_type = e.event_type
      cross join lateral (select case when d.status = 'pending' then d.next_attempt_at else d.locked_until end as started) x
     where (p_include_test or not e.is_test)
       and ((d.status = 'pending' and d.next_attempt_at <= now())
         or (d.status = 'processing' and d.locked_until < now()))
       and now() - x.started > make_interval(secs => case when e.priority = 'urgent' then v_urgent else v_threshold end)
       -- a follower held behind an earlier delivery of its chain is waiting its turn, not lagging
       and (not et.ordered or (e.patient_id is null and e.aggregate_id is null) or not exists (
             select 1 from public.domain_event_deliveries d2 join public.domain_events e2 on e2.id = d2.event_id
              where d2.subscriber_key = d.subscriber_key and d2.id <> d.id and d2.status in ('pending', 'processing')
                and e2.patient_id is not distinct from e.patient_id and e2.aggregate_type is not distinct from e.aggregate_type
                and e2.aggregate_id is not distinct from e.aggregate_id
                and (e2.occurred_at, e2.created_at, e2.seq) < (e.occurred_at, e.created_at, e.seq)))
     group by d.subscriber_key
  loop
    v_ref := 'event_bus_lag:' || r.subscriber_key;
    if exists (select 1 from public.ops_incidents where external_reference = v_ref and status not in ('resolved', 'closed')) then
      continue;
    end if;
    begin
    insert into public.ops_incidents
      (organisation_id, category, severity, title, summary, external_reference, ack_due_at, resolve_due_at)
    values
      (r.organisation_id, 'technical', 'sev3', 'Event bus subscriber is falling behind',
       format('Subscriber %s has %s delivery(ies) waiting, the oldest for %s minutes (limit %s). Check that process-events is deployed and its secrets are set, then open the event explorer in the admin console.',
              r.subscriber_key, r.waiting, round(extract(epoch from now() - r.oldest) / 60.0), round(v_threshold / 60.0)),
       v_ref, now() + interval '4 hours', now() + interval '24 hours');
    v_n := v_n + 1;
    exception when others then
      -- one bad insert must not stop the other subscribers' alerts or the prune
      raise warning 'event bus lag incident for % failed: %', r.subscriber_key, sqlerrm;
    end;
  end loop;

  delete from public.domain_event_delivery_attempts where created_at < now() - interval '30 days';
  return v_n;
end;
$$;

-- ---------------------------------------------------------------------------
-- Admin reads (ids only)
-- ---------------------------------------------------------------------------
create or replace function private.event_payload_ids(p_payload jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(k, v), '{}'::jsonb)
    from jsonb_each(coalesce(p_payload, '{}'::jsonb)) as t(k, v)
   where (k ~ '(_id|_ids)$' or k = 'id')
     and k not in ('patient_id', 'profile_id', 'user_id', 'member_id', 'person_id', 'clinician_id', 'staff_id', 'caregiver_id')
     and jsonb_typeof(v) in ('string', 'number', 'array')
     and (jsonb_typeof(v) <> 'array' or not exists (select 1 from jsonb_array_elements(v) a where jsonb_typeof(a) not in ('string', 'number')));
$$;

create or replace function public.event_bus_explorer(
  p_status text default null,
  p_subscriber text default null,
  p_event_type text default null,
  p_limit integer default 50,
  p_before timestamptz default null,
  p_before_id uuid default null
)
returns table (
  delivery_id uuid, event_id uuid, event_type text, event_version integer, priority text, is_test boolean,
  aggregate_type text, aggregate_id uuid, payload_ids jsonb, subscriber_key text, status text, attempt_count integer,
  next_attempt_at timestamptz, last_error text, replay_count integer, created_at timestamptz, done_at timestamptz,
  lag_seconds bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if not private.is_admin() then
    raise exception 'only an admin may read the event explorer' using errcode = '42501';
  end if;
  if p_status is not null and p_status not in ('pending', 'processing', 'done', 'dead') then
    raise exception 'unknown status %', p_status using errcode = '22023';
  end if;
  return query
  select d.id, e.id, e.event_type, e.event_version, e.priority, e.is_test, e.aggregate_type, e.aggregate_id,
         private.event_payload_ids(e.payload), d.subscriber_key, d.status, d.attempt_count, d.next_attempt_at, d.last_error,
         d.replay_count, d.created_at, d.done_at,
         case when d.status = 'done' then extract(epoch from d.done_at - e.created_at)::bigint
              else extract(epoch from now() - e.created_at)::bigint end
    from public.domain_event_deliveries d
    join public.domain_events e on e.id = d.event_id
   where (p_status is null or d.status = p_status)
     and (p_subscriber is null or d.subscriber_key = p_subscriber)
     and (p_event_type is null or e.event_type = p_event_type)
     and (p_before is null or (d.created_at, d.id) < (p_before, coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
   order by d.created_at desc, d.id desc
   limit least(greatest(coalesce(p_limit, 50), 1), 200);
end;
$$;

create or replace function public.event_bus_delivery_attempts(p_delivery_id uuid)
returns table (attempt_no integer, outcome text, error text, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if not private.is_admin() then
    raise exception 'only an admin may read delivery attempts' using errcode = '42501';
  end if;
  return query
  select a.attempt_no, a.outcome, a.error, a.created_at
    from public.domain_event_delivery_attempts a
   where a.delivery_id = p_delivery_id
   order by a.created_at, a.attempt_no;
end;
$$;

create or replace function public.event_bus_subscriber_status()
returns table (
  subscriber_key text, event_type text, handler_key text, is_active boolean,
  pending bigint, processing bigint, dead bigint, done_24h bigint, oldest_due_seconds bigint,
  last_success_at timestamptz, last_failure_at timestamptz, lag_incident_open boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if not private.is_admin() then
    raise exception 'only an admin may read subscriber status' using errcode = '42501';
  end if;
  return query
  select s.subscriber_key, s.event_type, s.handler_key, s.is_active,
         coalesce(agg.pending, 0), coalesce(agg.processing, 0), coalesce(agg.dead, 0),
         (select count(*) from public.domain_event_deliveries d3 where d3.subscriber_key = s.subscriber_key and d3.status = 'done' and d3.done_at > now() - interval '24 hours'),
         coalesce(agg.oldest_due_seconds, 0),
         (select max(d.done_at) from public.domain_event_deliveries d where d.subscriber_key = s.subscriber_key and d.status = 'done'),
         (select max(a.created_at) from public.domain_event_delivery_attempts a where a.subscriber_key = s.subscriber_key and a.outcome <> 'done'),
         exists (select 1 from public.ops_incidents i
                  where i.external_reference = 'event_bus_lag:' || s.subscriber_key and i.status not in ('resolved', 'closed'))
    from public.event_subscribers s
    left join lateral (
      select count(*) filter (where d.status = 'pending') as pending,
             count(*) filter (where d.status = 'processing') as processing,
             count(*) filter (where d.status = 'dead') as dead,
             coalesce(extract(epoch from now() - min(case when d.status = 'pending' and d.next_attempt_at <= now() then d.next_attempt_at
                                                          when d.status = 'processing' and d.locked_until < now() then d.locked_until end))::bigint, 0) as oldest_due_seconds
        from public.domain_event_deliveries d
       where d.subscriber_key = s.subscriber_key and d.status in ('pending', 'processing', 'dead')
    ) agg on true
   order by s.subscriber_key;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants (revoke from public, which is where anon's execute comes from)
-- ---------------------------------------------------------------------------
revoke all on function private.event_payload_ids(jsonb) from public, anon, authenticated;
revoke all on function public.claim_event_deliveries(integer, boolean) from public, anon, authenticated;
revoke all on function public.complete_event_delivery(uuid, uuid) from public, anon, authenticated;
revoke all on function public.fail_event_delivery(uuid, uuid, text, boolean) from public, anon, authenticated;
revoke all on function public.event_bus_lag_sweep(boolean) from public, anon, authenticated;
revoke all on function public.event_bus_explorer(text, text, text, integer, timestamptz, uuid) from public, anon;
revoke all on function public.event_bus_delivery_attempts(uuid) from public, anon;
revoke all on function public.event_bus_subscriber_status() from public, anon;
grant execute on function public.claim_event_deliveries(integer, boolean) to service_role;
grant execute on function public.complete_event_delivery(uuid, uuid) to service_role;
grant execute on function public.fail_event_delivery(uuid, uuid, text, boolean) to service_role;
grant execute on function public.event_bus_lag_sweep(boolean) to service_role;
grant execute on function public.event_bus_explorer(text, text, text, integer, timestamptz, uuid) to authenticated, service_role;
grant execute on function public.event_bus_delivery_attempts(uuid) to authenticated, service_role;
grant execute on function public.event_bus_subscriber_status() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Schedule: every 2 minutes, straight SQL (no edge function in the path, so the alert still fires when the processor is down)
-- ---------------------------------------------------------------------------
select cron.schedule('event-bus-lag-sweep', '*/2 * * * *', $$select public.event_bus_lag_sweep();$$);

do $$
begin
  if has_function_privilege('anon', 'public.event_bus_lag_sweep(boolean)', 'EXECUTE')
     or has_function_privilege('anon', 'public.event_bus_explorer(text, text, text, integer, timestamptz, uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.event_bus_subscriber_status()', 'EXECUTE')
     or has_function_privilege('anon', 'public.event_bus_delivery_attempts(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.event_bus_lag_sweep(boolean)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.claim_event_deliveries(integer, boolean)', 'EXECUTE') then
    raise exception 'S10x-a: a bus operations function is executable by a role that must not run it';
  end if;
  if (select count(*) from public.event_bus_config where is_active) <> 1 then
    raise exception 'S10x-a: exactly one active event_bus_config row expected';
  end if;
end $$;
