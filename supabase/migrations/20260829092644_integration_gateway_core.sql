-- Tarragon Health — Interoperability & API Platform, part 1 of 3: the gateway core.
-- (Header and full rationale live in the committed migration file.)

create type public.api_environment as enum ('sandbox', 'live');

comment on type public.api_environment is
  'Which side of the §33.17 certification path a credential belongs to. A sandbox key is issued against the same code and the same schema as a live one — the difference is enforced per-endpoint by the gateway (sandbox writes never reach the clinical record), never by a separate deployment.';

alter table public.api_keys
  add column environment public.api_environment not null default 'live',
  add column partner_integration_id uuid references public.partner_integrations (id) on delete set null,
  add column rate_limit_per_minute integer not null default 120,
  add column expires_at timestamptz;

alter table public.api_keys
  add constraint api_keys_rate_limit_sane
    check (rate_limit_per_minute between 1 and 10000),
  add constraint api_keys_prefix_matches_environment
    check ((key_prefix like 'th\_test\_%') = (environment = 'sandbox'));

comment on column public.api_keys.environment is
  'sandbox keys carry the th_test_ prefix, live keys th_live_ — enforced by api_keys_prefix_matches_environment.';
comment on column public.api_keys.rate_limit_per_minute is
  'Per-key ceiling applied by the gateway. Not a security boundary on its own (see the scope check) — a fair-use limit so one partner''s retry storm cannot degrade the platform for everyone else.';
comment on column public.api_keys.expires_at is
  'Optional hard expiry. Null means "until revoked". A sandbox key issued for a certification window is the intended user.';

create type public.api_request_outcome as enum (
  'ok',
  'bad_request',
  'unauthenticated',
  'forbidden',
  'not_found',
  'conflict',
  'rate_limited',
  'unprocessable',
  'server_error'
);

create table public.api_requests (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid references public.organisations (id),
  api_key_id        uuid references public.api_keys (id),
  key_prefix        text,
  environment       public.api_environment not null default 'live',
  api_version       text not null,
  method            text not null,
  endpoint          text not null,
  outcome           public.api_request_outcome not null,
  status_code       integer not null,
  duration_ms       integer not null,
  request_id        text not null,
  idempotency_key   text,
  idempotent_replay boolean not null default false,
  error_code        text,
  client_ip         text,
  called_at         timestamptz not null default now(),

  constraint api_requests_status_sane check (status_code between 100 and 599),
  constraint api_requests_duration_sane check (duration_ms >= 0),
  constraint api_requests_outcome_matches_status
    check ((outcome = 'ok') = (status_code between 200 and 299)),
  constraint api_requests_endpoint_is_template
    check (endpoint !~ '[?&=]' and length(endpoint) <= 200)
);

comment on table public.api_requests is
  'Inbound API gateway request log (§33.9). Shape of the call only — org, key, route TEMPLATE, status, latency. Never a request or response body, never a resolved URL: this table must never become a second copy of the clinical record outside RLS. Written by the gateway via the service role; there is no insert policy.';

create index api_requests_org_idx on public.api_requests (organisation_id, called_at desc);
create index api_requests_key_idx on public.api_requests (api_key_id, called_at desc);
create index api_requests_recent_idx on public.api_requests (called_at desc);
create index api_requests_failures_idx on public.api_requests (called_at desc)
  where outcome <> 'ok';

alter table public.api_requests enable row level security;

create policy api_requests_select on public.api_requests
  for select to authenticated
  using (
    organisation_id = private.current_org_id()
    and (private.is_admin() or private.has_permission('integrations.manage'))
  );

grant select on public.api_requests to authenticated;

create table public.api_idempotency_records (
  id                   uuid primary key default gen_random_uuid(),
  organisation_id      uuid not null references public.organisations (id),
  api_key_id           uuid not null references public.api_keys (id) on delete cascade,
  endpoint             text not null,
  idempotency_key      text not null,
  request_fingerprint  text not null,
  response_status      integer not null,
  response_body        jsonb not null,
  created_at           timestamptz not null default now(),
  expires_at           timestamptz not null default now() + interval '24 hours',

  constraint api_idempotency_key_shape check (length(idempotency_key) between 8 and 200)
);

comment on table public.api_idempotency_records is
  'Replay cache for Idempotency-Key (§33.12). Scoped to one api_key, expires after 24h, and holds the response body only so a retry returns what the first attempt returned. Pruned by private.prune_integration_logs().';

create unique index api_idempotency_unique
  on public.api_idempotency_records (api_key_id, endpoint, idempotency_key);
create index api_idempotency_expiry_idx
  on public.api_idempotency_records (expires_at);

alter table public.api_idempotency_records enable row level security;
grant select on public.api_idempotency_records to authenticated;

create type public.external_entity_type as enum (
  'patient',
  'practitioner',
  'organisation',
  'encounter',
  'appointment',
  'lab_order',
  'lab_result',
  'prescription',
  'dispense',
  'invoice',
  'payment',
  'claim',
  'service'
);

create table public.external_identifier_map (
  id                      uuid primary key default gen_random_uuid(),
  organisation_id         uuid not null references public.organisations (id),
  partner_integration_id  uuid not null references public.partner_integrations (id) on delete cascade,
  entity_type             public.external_entity_type not null,
  tarragon_id             uuid not null,
  external_id             text not null,
  external_system         text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),

  constraint external_identifier_id_shape check (length(trim(external_id)) between 1 and 200)
);

comment on table public.external_identifier_map is
  'Tarragon id <-> partner id mapping (§33.13). Deliberately per-partner: two partners routinely hold different identifiers for the same patient, so a single external_id column on the entity could not represent it. tarragon_id is intentionally NOT a foreign key — entity_type selects which table it points at, and a polymorphic FK is not expressible; the gateway resolves it through a typed helper instead.';

create unique index external_identifier_by_external
  on public.external_identifier_map (partner_integration_id, entity_type, external_id);
create unique index external_identifier_by_tarragon
  on public.external_identifier_map (partner_integration_id, entity_type, tarragon_id);
create index external_identifier_org_idx
  on public.external_identifier_map (organisation_id, entity_type);

alter table public.external_identifier_map enable row level security;

create policy external_identifier_map_select on public.external_identifier_map
  for select to authenticated
  using (
    organisation_id = private.current_org_id()
    and (private.is_admin() or private.has_permission('integrations.manage'))
  );

grant select on public.external_identifier_map to authenticated;

create trigger external_identifier_map_updated_at
  before update on public.external_identifier_map
  for each row execute function private.set_updated_at();

create or replace function private.prune_integration_logs(p_request_log_days integer default 90)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_requests integer;
  v_idempotency integer;
begin
  delete from public.api_requests
  where called_at < now() - make_interval(days => greatest(p_request_log_days, 7));
  get diagnostics v_requests = row_count;

  delete from public.api_idempotency_records where expires_at < now();
  get diagnostics v_idempotency = row_count;

  return jsonb_build_object('api_requests_pruned', v_requests, 'idempotency_pruned', v_idempotency);
end;
$$;

comment on function private.prune_integration_logs(integer) is
  'Retention sweep for the two append-only gateway tables. 90 days of request log is enough for §33.9 trend reporting and short enough that the table stays cheap; the floor of 7 days stops a bad argument from erasing the log entirely.';

revoke all on function private.prune_integration_logs(integer) from public;
revoke all on function private.prune_integration_logs(integer) from anon;

do $$
begin
  if not has_table_privilege('authenticated', 'public.api_requests', 'SELECT')
     or not has_table_privilege('authenticated', 'public.external_identifier_map', 'SELECT')
     or not has_table_privilege('authenticated', 'public.api_idempotency_records', 'SELECT') then
    raise exception 'gateway core: an authenticated table grant did not take';
  end if;

  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'api_idempotency_records') then
    raise exception 'api_idempotency_records must have no RLS policy — it holds response bodies and is service-role only';
  end if;

  if (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname in ('api_requests', 'api_idempotency_records', 'external_identifier_map')
        and c.relrowsecurity) <> 3 then
    raise exception 'gateway core: RLS is not enabled on all three new tables';
  end if;

  if has_function_privilege('anon', 'private.prune_integration_logs(integer)', 'EXECUTE') then
    raise exception 'prune_integration_logs: anon is still EXECUTE-able';
  end if;
end $$;

do $$
declare
  v_org uuid;
  v_ok  boolean := false;
begin
  select id into v_org from public.organisations limit 1;
  if v_org is null then
    return;
  end if;

  begin
    insert into public.api_keys (organisation_id, name, key_prefix, key_hash, environment)
    values (v_org, 'constraint probe', 'th_live_00000000', 'probe-' || gen_random_uuid()::text, 'sandbox');
  exception when check_violation then
    v_ok := true;
  end;

  if not v_ok then
    raise exception 'api_keys_prefix_matches_environment did not reject a live prefix on a sandbox key';
  end if;

  insert into public.api_keys (organisation_id, name, key_prefix, key_hash, environment)
  values (v_org, 'constraint probe', 'th_test_00000000', 'probe-' || gen_random_uuid()::text, 'sandbox');
  delete from public.api_keys where name = 'constraint probe';
end $$;
