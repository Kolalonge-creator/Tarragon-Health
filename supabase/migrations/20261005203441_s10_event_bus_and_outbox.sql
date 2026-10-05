-- S10: event bus and transactional outbox (spec Section 5).
--
-- Any write that matters inserts a domain_events row in the same transaction.
-- A trigger on that row creates one delivery per matching subscriber in the same
-- transaction, so a subscriber that exists when the event is written never misses
-- it. A processor (edge function `process-events`) claims deliveries, runs the
-- handler, and completes or fails them. Delivery is at least once; handlers record
-- side effects through event_effects so a repeat or a replay is safe.
--
-- Event types, versions and subscribers are DATA, so a new event type or subscriber
-- is an insert, not a schema change (Section 18).
-- Retry and lease values are PROPOSED and live in event_bus_config (versioned).
--
-- Row counts at writing: none of these tables exist, no data conversion.
-- No spec subscriber is registered here; S11 onward add them.

-- ---------------------------------------------------------------------------
-- Catalogue: types and versions
-- ---------------------------------------------------------------------------
create table public.event_types (
  event_type      text primary key check (event_type ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),
  description     text not null,
  owner_section   text,
  is_urgent       boolean not null default false,
  current_version integer not null default 1 check (current_version >= 1),
  is_active       boolean not null default true,
  created_at      timestamptz not null default now()
);

create table public.event_type_versions (
  event_type    text not null references public.event_types(event_type),
  version       integer not null check (version >= 1),
  required_keys text[] not null default '{}',
  deprecated_at timestamptz,
  created_at    timestamptz not null default now(),
  primary key (event_type, version)
);

-- ---------------------------------------------------------------------------
-- Events (append only) and subscribers
-- ---------------------------------------------------------------------------
create table public.domain_events (
  id              uuid primary key default gen_random_uuid(),
  event_type      text not null,
  event_version   integer not null,
  organisation_id uuid not null references public.organisations(id),
  patient_id      uuid references public.profiles(id) on delete set null,
  aggregate_type  text,
  aggregate_id    uuid,
  payload         jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object' and pg_column_size(payload) <= 8192),
  priority        text not null default 'normal' check (priority in ('normal', 'urgent')),
  idempotency_key text not null check (length(idempotency_key) between 1 and 200),
  causation_id    uuid references public.domain_events(id),
  is_test         boolean not null default false,
  occurred_at     timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  foreign key (event_type, event_version) references public.event_type_versions(event_type, version),
  unique (event_type, idempotency_key)
);
create index domain_events_patient_idx on public.domain_events (patient_id, occurred_at desc) where patient_id is not null;
create index domain_events_type_idx on public.domain_events (event_type, occurred_at desc);

create table public.event_subscribers (
  subscriber_key text primary key check (subscriber_key ~ '^[a-z][a-z0-9_.]*$'),
  event_type     text not null references public.event_types(event_type),
  handler_key    text not null check (handler_key ~ '^[a-z][a-z0-9_.]*$'),
  min_version    integer not null default 1 check (min_version >= 1),
  max_version    integer check (max_version is null or max_version >= min_version),
  is_active      boolean not null default true,
  note           text,
  created_at     timestamptz not null default now()
);

create table public.domain_event_deliveries (
  id              uuid primary key default gen_random_uuid(),
  event_id        uuid not null references public.domain_events(id),
  subscriber_key  text not null references public.event_subscribers(subscriber_key),
  organisation_id uuid not null references public.organisations(id),
  status          text not null default 'pending' check (status in ('pending', 'processing', 'done', 'dead')),
  attempt_count   integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz not null default now(),
  locked_until    timestamptz,
  lease_token     uuid,
  last_error      text,
  replay_count    integer not null default 0,
  done_at         timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (event_id, subscriber_key)
);
create index domain_event_deliveries_due_idx on public.domain_event_deliveries (next_attempt_at) where status = 'pending';
create index domain_event_deliveries_lease_idx on public.domain_event_deliveries (locked_until) where status = 'processing';
create index domain_event_deliveries_dead_idx on public.domain_event_deliveries (subscriber_key) where status = 'dead';

create table public.event_effects (
  effect_key  text primary key check (length(effect_key) between 1 and 300),
  delivery_id uuid not null references public.domain_event_deliveries(id),
  created_at  timestamptz not null default now()
);
create index event_effects_delivery_idx on public.event_effects (delivery_id);

-- ---------------------------------------------------------------------------
-- Versioned configuration (PROPOSED values, INV-16)
-- ---------------------------------------------------------------------------
create table public.event_bus_config (
  version              integer primary key,
  is_active            boolean not null default false,
  batch_size           integer not null check (batch_size between 1 and 500),
  lease_seconds        integer not null check (lease_seconds between 5 and 900),
  max_attempts         integer not null check (max_attempts between 1 and 50),
  backoff_base_seconds integer not null check (backoff_base_seconds between 1 and 3600),
  backoff_max_seconds  integer not null check (backoff_max_seconds >= 1),
  jitter_percent       integer not null check (jitter_percent between 0 and 100),
  note                 text,
  created_at           timestamptz not null default now(),
  check (backoff_max_seconds >= backoff_base_seconds)
);
create unique index event_bus_config_one_active on public.event_bus_config (is_active) where is_active;

insert into public.event_bus_config
  (version, is_active, batch_size, lease_seconds, max_attempts, backoff_base_seconds, backoff_max_seconds, jitter_percent, note)
values (1, true, 50, 60, 8, 15, 900, 20, 'PROPOSED: S10 defaults, to be confirmed by the founder');

-- ---------------------------------------------------------------------------
-- Row security: only an admin may read, nobody writes through the API
-- ---------------------------------------------------------------------------
alter table public.event_types enable row level security;
alter table public.event_type_versions enable row level security;
alter table public.domain_events enable row level security;
alter table public.event_subscribers enable row level security;
alter table public.domain_event_deliveries enable row level security;
alter table public.event_effects enable row level security;
alter table public.event_bus_config enable row level security;

create policy event_types_admin_read on public.event_types for select to authenticated using (private.is_admin());
create policy event_type_versions_admin_read on public.event_type_versions for select to authenticated using (private.is_admin());
create policy domain_events_admin_read on public.domain_events for select to authenticated using (private.is_admin());
create policy event_subscribers_admin_read on public.event_subscribers for select to authenticated using (private.is_admin());
create policy domain_event_deliveries_admin_read on public.domain_event_deliveries for select to authenticated using (private.is_admin());
create policy event_effects_admin_read on public.event_effects for select to authenticated using (private.is_admin());
create policy event_bus_config_admin_read on public.event_bus_config for select to authenticated using (private.is_admin());

revoke all on public.event_types, public.event_type_versions, public.domain_events, public.event_subscribers,
  public.domain_event_deliveries, public.event_effects, public.event_bus_config from public, anon, authenticated;
grant select on public.event_types, public.event_type_versions, public.domain_events, public.event_subscribers,
  public.domain_event_deliveries, public.event_effects, public.event_bus_config to authenticated;

comment on table public.domain_events is 'S10 transactional outbox. Append only. Payload holds ids and neutral facts, never a reading or a condition; handlers read the record through the audited path (INV-10).';
comment on table public.domain_event_deliveries is 'S10: one row per event and subscriber. At least once delivery; claim uses a lease token, completion needs the token.';
comment on table public.event_effects is 'S10: a handler records each side effect once by key, so a repeat or a replay skips it.';

-- ---------------------------------------------------------------------------
-- Events are append only
-- ---------------------------------------------------------------------------
create or replace function private.domain_events_append_only()
returns trigger language plpgsql set search_path = '' as $$
begin
  -- The one allowed change: the foreign key's ON DELETE SET NULL when a profile is erased
  -- (account purge, data erasure). Nothing else about an event may change.
  if tg_op = 'UPDATE' and old.patient_id is not null and new.patient_id is null
     and (to_jsonb(new) - 'patient_id') = (to_jsonb(old) - 'patient_id') then
    return new;
  end if;
  raise exception 'domain_events is append only' using errcode = '55000';
end;
$$;
create trigger domain_events_no_update before update or delete on public.domain_events
  for each row execute function private.domain_events_append_only();
create trigger domain_events_no_truncate before truncate on public.domain_events
  for each statement execute function private.domain_events_append_only();

-- ---------------------------------------------------------------------------
-- Fan-out (same transaction as the event) and urgent nudge
-- ---------------------------------------------------------------------------
create or replace function private.domain_events_fan_out()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.domain_event_deliveries (event_id, subscriber_key, organisation_id)
  select new.id, s.subscriber_key, new.organisation_id
  from public.event_subscribers s
  where s.is_active
    and s.event_type = new.event_type
    and new.event_version >= s.min_version
    and new.event_version <= coalesce(s.max_version, 2147483647)
  on conflict (event_id, subscriber_key) do nothing;
  return null;
end;
$$;
create trigger domain_events_fan_out after insert on public.domain_events
  for each row execute function private.domain_events_fan_out();

-- pg_net queues the request in this transaction and sends it after commit, so a
-- rolled back write sends nothing. Best effort only: the cron job is the guarantee.
create or replace function private.domain_events_urgent_nudge()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  begin
    perform net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
        || '/functions/v1/process-events',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'edge_function_publishable_key'),
        'Content-Type', 'application/json'
      ),
      body := jsonb_build_object('urgent_only', true),
      timeout_milliseconds := 25000
    );
  exception when others then
    -- Best effort by design (cron is the guarantee), but not silent in the database log.
    raise warning 'process-events nudge failed: %', sqlerrm;
  end;
  return null;
end;
$$;
create trigger domain_events_urgent_nudge after insert on public.domain_events
  for each row when (new.priority = 'urgent') execute function private.domain_events_urgent_nudge();

-- ---------------------------------------------------------------------------
-- Emit
-- ---------------------------------------------------------------------------
create or replace function private.emit_domain_event(
  p_event_type      text,
  p_organisation_id uuid,
  p_payload         jsonb,
  p_idempotency_key text,
  p_patient_id      uuid default null,
  p_aggregate_type  text default null,
  p_aggregate_id    uuid default null,
  p_priority        text default 'normal',
  p_version         integer default null,
  p_causation_id    uuid default null,
  p_occurred_at     timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_type    public.event_types%rowtype;
  v_version integer;
  v_ver     public.event_type_versions%rowtype;
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_test    boolean := false;
  v_pat_org uuid;
  v_id      uuid;
begin
  select * into v_type from public.event_types where event_type = p_event_type;
  if not found or not v_type.is_active then
    raise exception 'emit_domain_event: unknown or inactive event type %', p_event_type using errcode = '22023';
  end if;
  v_version := coalesce(p_version, v_type.current_version);
  select * into v_ver from public.event_type_versions where event_type = p_event_type and version = v_version;
  if not found or v_ver.deprecated_at is not null then
    raise exception 'emit_domain_event: version % of % is unknown or deprecated', v_version, p_event_type using errcode = '22023';
  end if;
  if jsonb_typeof(v_payload) <> 'object' then
    raise exception 'emit_domain_event: payload must be an object' using errcode = '22023';
  end if;
  if not (v_payload ?& v_ver.required_keys) then
    raise exception 'emit_domain_event: payload for % v% is missing a required key (%)', p_event_type, v_version, array_to_string(v_ver.required_keys, ', ') using errcode = '22023';
  end if;
  if p_priority not in ('normal', 'urgent') then
    raise exception 'emit_domain_event: priority must be normal or urgent' using errcode = '22023';
  end if;
  if p_patient_id is not null then
    select coalesce(is_test, false), organisation_id into v_test, v_pat_org from public.profiles where id = p_patient_id;
    if v_pat_org is distinct from p_organisation_id then
      raise exception 'emit_domain_event: patient does not belong to organisation %', p_organisation_id using errcode = '22023';
    end if;
  end if;

  insert into public.domain_events
    (event_type, event_version, organisation_id, patient_id, aggregate_type, aggregate_id, payload,
     priority, idempotency_key, causation_id, is_test, occurred_at)
  values
    (p_event_type, v_version, p_organisation_id, p_patient_id, p_aggregate_type, p_aggregate_id, v_payload,
     case when v_type.is_urgent or p_priority = 'urgent' then 'urgent' else 'normal' end,
     p_idempotency_key, p_causation_id, coalesce(v_test, false), coalesce(p_occurred_at, now()))
  on conflict (event_type, idempotency_key) do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from public.domain_events where event_type = p_event_type and idempotency_key = p_idempotency_key;
  end if;
  return v_id;
end;
$$;

create or replace function public.emit_domain_event(
  p_event_type      text,
  p_organisation_id uuid,
  p_payload         jsonb,
  p_idempotency_key text,
  p_patient_id      uuid default null,
  p_aggregate_type  text default null,
  p_aggregate_id    uuid default null,
  p_priority        text default 'normal',
  p_version         integer default null,
  p_causation_id    uuid default null,
  p_occurred_at     timestamptz default null
)
returns uuid
language sql
security definer
set search_path = ''
as $$
  select private.emit_domain_event(p_event_type, p_organisation_id, p_payload, p_idempotency_key, p_patient_id,
    p_aggregate_type, p_aggregate_id, p_priority, p_version, p_causation_id, p_occurred_at);
$$;

-- ---------------------------------------------------------------------------
-- Processor RPCs (service role only)
-- ---------------------------------------------------------------------------
create or replace function private.event_bus_setting()
returns public.event_bus_config
language plpgsql stable security definer set search_path = '' as $$
declare c public.event_bus_config%rowtype;
begin
  select * into c from public.event_bus_config where is_active;
  if not found then
    raise exception 'event_bus_config has no active row' using errcode = '55000';
  end if;
  return c;
end;
$$;

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
begin
  -- A lease that expired on a delivery already at its attempt limit is a crashed
  -- final attempt: it goes to the dead letter instead of running again.
  update public.domain_event_deliveries d
     set status = 'dead', locked_until = null, lease_token = null,
         last_error = coalesce(d.last_error, 'lease expired at the attempt limit'), updated_at = now()
   where d.status = 'processing' and d.locked_until < now() and d.attempt_count >= c.max_attempts;

  return query
  with picked as (
    select d.id
      from public.domain_event_deliveries d
      join public.domain_events e on e.id = d.event_id
     where ((d.status = 'pending' and d.next_attempt_at <= now())
         or (d.status = 'processing' and d.locked_until < now()))
       and (not p_urgent_only or e.priority = 'urgent')
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
  )
  select u.id, u.lease_token, u.attempt_count, e.id, e.event_type, e.event_version, e.organisation_id, e.patient_id,
         e.aggregate_type, e.aggregate_id, e.payload, e.priority, e.is_test, e.occurred_at, u.subscriber_key, s.handler_key
    from upd u
    join public.domain_events e on e.id = u.event_id
    join public.event_subscribers s on s.subscriber_key = u.subscriber_key
   order by (e.priority = 'urgent') desc, e.occurred_at;
end;
$$;

create or replace function public.complete_event_delivery(p_delivery_id uuid, p_lease_token uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v_rows integer;
begin
  update public.domain_event_deliveries
     set status = 'done', done_at = now(), locked_until = null, lease_token = null, last_error = null, updated_at = now()
   where id = p_delivery_id and lease_token = p_lease_token and status = 'processing';
  get diagnostics v_rows = row_count;
  return v_rows = 1;
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
       set status = 'dead', locked_until = null, lease_token = null, last_error = left(coalesce(p_error, 'failed'), 1000), updated_at = now()
     where id = d.id;
  else
    v_status := 'pending';
    v_delay := least(c.backoff_base_seconds * power(2, d.attempt_count - 1), c.backoff_max_seconds)
               * (1 + random() * c.jitter_percent / 100.0);
    update public.domain_event_deliveries
       set status = 'pending', locked_until = null, lease_token = null,
           next_attempt_at = now() + make_interval(secs => v_delay),
           last_error = left(coalesce(p_error, 'failed'), 1000), updated_at = now()
     where id = d.id;
  end if;
  return v_status;
end;
$$;

-- True the first time a key is recorded, false on a repeat or a replay.
create or replace function public.record_event_effect(p_delivery_id uuid, p_effect_key text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v_rows integer;
begin
  insert into public.event_effects (effect_key, delivery_id) values (p_effect_key, p_delivery_id)
  on conflict (effect_key) do nothing;
  get diagnostics v_rows = row_count;
  return v_rows = 1;
end;
$$;

-- Undo an effect record when the side effect itself threw, so the retry runs it again.
create or replace function public.release_event_effect(p_delivery_id uuid, p_effect_key text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v_rows integer;
begin
  delete from public.event_effects where effect_key = p_effect_key and delivery_id = p_delivery_id;
  get diagnostics v_rows = row_count;
  return v_rows = 1;
end;
$$;

-- ---------------------------------------------------------------------------
-- Admin: replay, requeue dead letters, health
-- ---------------------------------------------------------------------------
create or replace function public.replay_event_delivery(p_delivery_id uuid, p_redo_effects boolean default false)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare d public.domain_event_deliveries%rowtype;
begin
  if not private.is_admin() then
    raise exception 'only an admin may replay a delivery' using errcode = '42501';
  end if;
  select * into d from public.domain_event_deliveries where id = p_delivery_id for update;
  if not found then
    return false;
  end if;
  if d.status = 'processing' and d.locked_until >= now() then
    raise exception 'delivery is being processed right now' using errcode = '55P03';
  end if;
  if p_redo_effects then
    delete from public.event_effects where delivery_id = d.id;
  end if;
  update public.domain_event_deliveries
     set status = 'pending', attempt_count = 0, next_attempt_at = now(), locked_until = null, lease_token = null,
         last_error = null, done_at = null, replay_count = replay_count + 1, updated_at = now()
   where id = d.id;
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (d.organisation_id, (select auth.uid()), 'event_bus.replay', 'domain_event_deliveries', d.id,
          jsonb_build_object('subscriber_key', d.subscriber_key, 'event_id', d.event_id, 'redo_effects', p_redo_effects));
  return true;
end;
$$;

create or replace function public.requeue_dead_event_deliveries(p_subscriber_key text, p_limit integer default 100)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare v_ids uuid[]; v_org uuid;
begin
  if not private.is_admin() then
    raise exception 'only an admin may requeue dead deliveries' using errcode = '42501';
  end if;
  select array_agg(id) into v_ids from (
    select id from public.domain_event_deliveries
     where status = 'dead' and subscriber_key = p_subscriber_key
     order by created_at limit least(greatest(coalesce(p_limit, 100), 1), 1000) for update
  ) q;
  if v_ids is null then
    return 0;
  end if;
  update public.domain_event_deliveries
     set status = 'pending', attempt_count = 0, next_attempt_at = now(), last_error = null,
         replay_count = replay_count + 1, updated_at = now()
   where id = any (v_ids);
  select organisation_id into v_org from public.profiles where id = (select auth.uid());
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (v_org, (select auth.uid()), 'event_bus.requeue_dead', 'event_subscribers', null,
          jsonb_build_object('subscriber_key', p_subscriber_key, 'count', cardinality(v_ids)));
  return cardinality(v_ids);
end;
$$;

create or replace function public.event_bus_health()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'only an admin may read event bus health' using errcode = '42501';
  end if;
  return (
    select jsonb_build_object(
      'pending', count(*) filter (where d.status = 'pending'),
      'processing', count(*) filter (where d.status = 'processing'),
      'dead', count(*) filter (where d.status = 'dead'),
      'dead_urgent', count(*) filter (where d.status = 'dead' and e.priority = 'urgent'),
      'done_24h', count(*) filter (where d.status = 'done' and d.done_at > now() - interval '24 hours'),
      'oldest_pending_seconds', coalesce(extract(epoch from now() - min(d.next_attempt_at) filter (where d.status = 'pending'))::bigint, 0)
    )
    from public.domain_event_deliveries d
    join public.domain_events e on e.id = d.event_id
    where d.status in ('pending', 'processing', 'dead') or d.done_at > now() - interval '24 hours'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Execute grants: emit/claim/complete/fail/effect are service role only
-- ---------------------------------------------------------------------------
revoke all on function private.emit_domain_event(text, uuid, jsonb, text, uuid, text, uuid, text, integer, uuid, timestamptz) from public, anon, authenticated;
revoke all on function private.event_bus_setting() from public, anon, authenticated;
revoke all on function public.emit_domain_event(text, uuid, jsonb, text, uuid, text, uuid, text, integer, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.claim_event_deliveries(integer, boolean) from public, anon, authenticated;
revoke all on function public.complete_event_delivery(uuid, uuid) from public, anon, authenticated;
revoke all on function public.fail_event_delivery(uuid, uuid, text, boolean) from public, anon, authenticated;
revoke all on function public.record_event_effect(uuid, text) from public, anon, authenticated;
revoke all on function public.release_event_effect(uuid, text) from public, anon, authenticated;
revoke all on function public.replay_event_delivery(uuid, boolean) from public, anon;
revoke all on function public.requeue_dead_event_deliveries(text, integer) from public, anon;
revoke all on function public.event_bus_health() from public, anon;
grant execute on function public.emit_domain_event(text, uuid, jsonb, text, uuid, text, uuid, text, integer, uuid, timestamptz) to service_role;
grant execute on function public.claim_event_deliveries(integer, boolean) to service_role;
grant execute on function public.complete_event_delivery(uuid, uuid) to service_role;
grant execute on function public.fail_event_delivery(uuid, uuid, text, boolean) to service_role;
grant execute on function public.record_event_effect(uuid, text) to service_role;
grant execute on function public.release_event_effect(uuid, text) to service_role;
grant execute on function public.replay_event_delivery(uuid, boolean) to authenticated, service_role;
grant execute on function public.requeue_dead_event_deliveries(text, integer) to authenticated, service_role;
grant execute on function public.event_bus_health() to authenticated, service_role;
grant execute on function private.emit_domain_event(text, uuid, jsonb, text, uuid, text, uuid, text, integer, uuid, timestamptz) to service_role;

-- ---------------------------------------------------------------------------
-- Seed: the 13 events in spec Section 5 (version 1). Required keys are ids only.
-- Nothing emits these yet; the owning session may add a version 2 before first use.
-- ---------------------------------------------------------------------------
insert into public.event_types (event_type, description, owner_section, is_urgent) values
  ('observation.recorded', 'A patient observation (reading) was recorded', 'S11', false),
  ('triage.graded', 'A triage grade (green, amber or red) was produced', 'S12', false),
  ('dose.recorded', 'A dose was taken, skipped or snoozed', 'S08', false),
  ('dose.missed', 'A dose passed its window unanswered', 'S08', false),
  ('silence.detected', 'A care-pack patient has sent no readings for the configured days', 'S12', false),
  ('lab_result.received', 'A lab result arrived', 'S27', false),
  ('lab_result.released', 'A lab result was released to the patient', 'S27', false),
  ('encounter.completed', 'A consultation was completed', 'S21', false),
  ('care_plan_change.signed', 'A clinician signed a care plan change', 'S24', false),
  ('order.paid', 'An order was paid', 'S25', false),
  ('entitlement.expiring', 'An entitlement is close to expiry', 'S26', false),
  ('clinician.task_completed', 'A clinician completed a task', 'S30', false),
  ('page.unacknowledged', 'A clinician page was not acknowledged in time', 'S19', true);

insert into public.event_type_versions (event_type, version, required_keys) values
  ('observation.recorded', 1, array['observation_id']),
  ('triage.graded', 1, array['grade', 'triage_event_id']),
  ('dose.recorded', 1, array['medication_id']),
  ('dose.missed', 1, array['medication_id']),
  ('silence.detected', 1, array['days']),
  ('lab_result.received', 1, array['lab_result_id']),
  ('lab_result.released', 1, array['lab_result_id']),
  ('encounter.completed', 1, array['encounter_id']),
  ('care_plan_change.signed', 1, array['care_plan_change_id']),
  ('order.paid', 1, array['order_id']),
  ('entitlement.expiring', 1, array['entitlement_id']),
  ('clinician.task_completed', 1, array['task_id']),
  ('page.unacknowledged', 1, array['page_id']);

-- ---------------------------------------------------------------------------
-- Schedule: every 15 seconds. Fails closed until the two Vault secrets exist
-- (the same secrets the notification sender and the partner webhook drain use).
-- ---------------------------------------------------------------------------
select cron.schedule(
  'process-events',
  '15 seconds',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
      || '/functions/v1/process-events',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'edge_function_publishable_key'),
      'Content-Type', 'application/json'
    ),
    timeout_milliseconds := 25000
  ) as request_id;
  $$
);
