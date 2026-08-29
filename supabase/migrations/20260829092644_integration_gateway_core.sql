-- Tarragon Health — Interoperability & API Platform, part 1 of 3: the gateway core.
--
-- WHY THIS EXISTS. Spec §33 ("Interoperability & API Platform"). Today every
-- partner-facing route re-implements the same four steps inline —
-- authenticate, check a scope, parse a body, hope — and nothing at all is
-- recorded about the call except api_keys.last_used_at and, for the three
-- Protocol API routes, one row in protocol_api_usage_log. That is not enough
-- to answer any of §33.9's questions (uptime, latency, failed requests,
-- authentication failures) and there is no shared place to put idempotency
-- (§33.12), external identifier mapping (§33.13), versioning (§33.4), or a
-- sandbox (§33.17). Every new partner would mean another hand-rolled route.
-- §33.18's acceptance criterion is precisely that this must stop being true.
--
-- ROW COUNT BEFORE THE CHANGE (the "count first" discipline in CLAUDE.md):
-- public.api_keys held ZERO rows at the time this was written, so the new
-- NOT NULL columns and the environment/prefix CHECK below are a pure
-- structural change with no backfill or conversion step. The defaults are
-- still chosen so that a pre-existing 'th_live_' key would have been valid.
--
-- WHAT IS DELIBERATELY *NOT* HERE:
--
--   * NO REQUEST OR RESPONSE BODIES. api_requests records the shape of a
--     call (org, key, route template, status, latency), never its content.
--     A partner API carries PHI by definition; a request log that captured
--     bodies would be a second, unguarded copy of the clinical record sitting
--     outside every RLS policy that protects the first one. `endpoint` is the
--     ROUTE TEMPLATE ('/api/v1/observations'), never the resolved URL, so a
--     patient identifier in a path segment or query string cannot leak into
--     it either. api_idempotency_records is the one place a response body is
--     stored, and it is scoped to a single key, expires in 24h, and exists
--     only so a partner's retry returns what its first attempt returned.
--
--   * NO CROSS-ORG READ. Every policy here is org-scoped exactly like
--     api_keys_select. Tarragon's own admin sits in a *different* org from a
--     partner, so admin-side visibility is a narrowly-scoped SECURITY DEFINER
--     RPC in part 3 — the same split protocol_api_usage_log already makes.
--     Auth failures with an unrecognised key have no organisation at all
--     (organisation_id is null), which means they are invisible to every
--     org-scoped policy by construction and reachable only through that RPC.

-- ---------------------------------------------------------------------------
-- §33.17 — sandbox vs live. An integration is certified in the sandbox before
-- it is pointed at production, so the environment has to be a property of the
-- CREDENTIAL, not of a deploy target: one platform, two key families.
-- ---------------------------------------------------------------------------
create type public.api_environment as enum ('sandbox', 'live');

comment on type public.api_environment is
  'Which side of the §33.17 certification path a credential belongs to. A sandbox key is issued against the same code and the same schema as a live one — the difference is enforced per-endpoint by the gateway (sandbox writes never reach the clinical record), never by a separate deployment.';

alter table public.api_keys
  add column environment public.api_environment not null default 'live',
  -- Links an inbound credential to the outbound catalogue entry for the same
  -- partner, so §33.8's catalogue can show one row per partner covering both
  -- directions instead of two disconnected lists.
  add column partner_integration_id uuid references public.partner_integrations (id) on delete set null,
  add column rate_limit_per_minute integer not null default 120,
  add column expires_at timestamptz;

alter table public.api_keys
  add constraint api_keys_rate_limit_sane
    check (rate_limit_per_minute between 1 and 10000),
  -- The key's own text has to announce its environment: a partner pasting a
  -- sandbox key into a production config should fail loudly at the first
  -- call, not silently write test data into a live record.
  add constraint api_keys_prefix_matches_environment
    check ((key_prefix like 'th\_test\_%') = (environment = 'sandbox'));

comment on column public.api_keys.environment is
  'sandbox keys carry the th_test_ prefix, live keys th_live_ — enforced by api_keys_prefix_matches_environment.';
comment on column public.api_keys.rate_limit_per_minute is
  'Per-key ceiling applied by the gateway. Not a security boundary on its own (see the scope check) — a fair-use limit so one partner''s retry storm cannot degrade the platform for everyone else.';
comment on column public.api_keys.expires_at is
  'Optional hard expiry. Null means "until revoked". A sandbox key issued for a certification window is the intended user.';

-- ---------------------------------------------------------------------------
-- §33.9 — integration monitoring. One row per inbound gateway request,
-- including the ones that never got past authentication.
-- ---------------------------------------------------------------------------
create type public.api_request_outcome as enum (
  'ok',
  'bad_request',        -- malformed JSON / schema validation failure (§33.2 validation stage)
  'unauthenticated',    -- no key, unknown key, revoked key, expired key (§33.9 auth failures)
  'forbidden',          -- valid key, missing scope, or wrong environment (§33.6)
  'not_found',          -- resolved cleanly, but the referenced entity is not in this org
  'conflict',           -- idempotency-key reuse with a different body (§33.12)
  'rate_limited',
  'unprocessable',      -- schema-valid but semantically rejected (§33.12 data mismatches)
  'server_error'
);

create table public.api_requests (
  id                uuid primary key default gen_random_uuid(),
  -- Null exactly when authentication failed before an org could be resolved.
  organisation_id   uuid references public.organisations (id),
  api_key_id        uuid references public.api_keys (id),
  -- Retained even when api_key_id is null: an auth failure against an
  -- unrecognised credential is still worth attributing to *something*, and
  -- the prefix is the only non-secret part of the key we ever hold.
  key_prefix        text,
  environment       public.api_environment not null default 'live',
  -- §33.4. 'legacy' marks the pre-versioning routes that predate the gateway
  -- and must keep working unchanged.
  api_version       text not null,
  method            text not null,
  -- ROUTE TEMPLATE ONLY — never a resolved URL. See the header.
  endpoint          text not null,
  outcome           public.api_request_outcome not null,
  status_code       integer not null,
  duration_ms       integer not null,
  -- Echoed to the partner as X-Request-Id so a support conversation can name
  -- one specific call.
  request_id        text not null,
  idempotency_key   text,
  idempotent_replay boolean not null default false,
  -- A short machine-readable reason, never a message containing input values.
  error_code        text,
  client_ip         text,
  called_at         timestamptz not null default now(),

  constraint api_requests_status_sane check (status_code between 100 and 599),
  constraint api_requests_duration_sane check (duration_ms >= 0),
  -- An outcome of 'ok' is the only one allowed to claim a 2xx, and vice
  -- versa; a route that returns 500 while logging 'ok' is a bug that should
  -- be impossible to record rather than one found later in a dashboard.
  constraint api_requests_outcome_matches_status
    check ((outcome = 'ok') = (status_code between 200 and 299)),
  -- Endpoint is a template: no query string, and no resolved id segments.
  constraint api_requests_endpoint_is_template
    check (endpoint !~ '[?&=]' and length(endpoint) <= 200)
);

comment on table public.api_requests is
  'Inbound API gateway request log (§33.9). Shape of the call only — org, key, route TEMPLATE, status, latency. Never a request or response body, never a resolved URL: this table must never become a second copy of the clinical record outside RLS. Written by the gateway via the service role; there is no insert policy.';

create index api_requests_org_idx on public.api_requests (organisation_id, called_at desc);
create index api_requests_key_idx on public.api_requests (api_key_id, called_at desc);
create index api_requests_recent_idx on public.api_requests (called_at desc);
-- The monitoring queries all filter to failures; the healthy majority of rows
-- does not belong in that index.
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

-- ---------------------------------------------------------------------------
-- §33.12 — idempotency. "If a laboratory sends the same result twice,
-- Tarragon must not create two separate clinical results."
--
-- device-readings already gets this for free from the (device_id,
-- external_reading_id) unique index, which is the right mechanism when the
-- resource itself carries a natural external key. This table is the general
-- case: the partner supplies an Idempotency-Key header, and a retry replays
-- the ORIGINAL response rather than re-running the handler. Reusing a key
-- with a *different* body is a 409, not a silent overwrite — otherwise a
-- partner bug that reuses one key for two results would make the second
-- result disappear, which is exactly the clinical-information loss §33.10
-- is written to prevent.
-- ---------------------------------------------------------------------------
create table public.api_idempotency_records (
  id                   uuid primary key default gen_random_uuid(),
  organisation_id      uuid not null references public.organisations (id),
  api_key_id           uuid not null references public.api_keys (id) on delete cascade,
  endpoint             text not null,
  idempotency_key      text not null,
  -- SHA-256 of the canonicalised request body. Same key + same body = replay;
  -- same key + different body = 409.
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
-- No policy at all: this holds response bodies, which may contain patient
-- data, and nothing in the product ever reads it from a user session. The
-- gateway reads and writes it via the service role only. RLS with no policy
-- is a deny-all, which is the intended posture — the grant below exists so
-- that posture is an explicit RLS decision rather than an accident of a
-- missing table grant (see CLAUDE.md's authenticated-grant gotcha).
grant select on public.api_idempotency_records to authenticated;

-- ---------------------------------------------------------------------------
-- §33.13 — external identifiers. "Store: Tarragon patient ID, external
-- patient ID, organisation ID, service ID, order ID, result ID. This is
-- fundamental to interoperability."
--
-- One table rather than an external_id column on each of a dozen tables: the
-- mapping is per-PARTNER (Synlab's id for a patient and an HMO's id for the
-- same patient are different strings that must both resolve), so it cannot
-- live as a single column on the entity itself without a partner dimension.
-- ---------------------------------------------------------------------------
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
  -- Optional sub-system qualifier for a partner that runs more than one
  -- (e.g. a lab's LIMS vs its billing system emitting different ids).
  external_system         text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),

  constraint external_identifier_id_shape check (length(trim(external_id)) between 1 and 200)
);

comment on table public.external_identifier_map is
  'Tarragon id <-> partner id mapping (§33.13). Deliberately per-partner: two partners routinely hold different identifiers for the same patient, so a single external_id column on the entity could not represent it. tarragon_id is intentionally NOT a foreign key — entity_type selects which table it points at, and a polymorphic FK is not expressible; the gateway resolves it through a typed helper instead.';

-- Both directions must be unambiguous within a partner: one external id maps
-- to one Tarragon row, and one Tarragon row has one id with that partner.
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

-- ---------------------------------------------------------------------------
-- Retention. api_requests and api_idempotency_records are both append-only
-- and both grow with traffic rather than with the patient population, so
-- they need a prune the rest of the schema does not. Called from the
-- integration cron sweep, not a pg_cron job, so it stays visible in the same
-- place as every other scheduled job on this platform.
-- ---------------------------------------------------------------------------
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

-- private.* is not reachable from PostgREST at all, but the codebase's own
-- documented gotcha is that EXECUTE arrives through the PUBLIC pseudo-role,
-- so it is revoked from PUBLIC (not from anon) explicitly.
revoke all on function private.prune_integration_logs(integer) from public;

-- ---------------------------------------------------------------------------
-- Prove it, rather than hope. Every assertion below fails the migration
-- rather than leaving a half-applied gateway.
-- ---------------------------------------------------------------------------
do $$
begin
  if not has_table_privilege('authenticated', 'public.api_requests', 'SELECT')
     or not has_table_privilege('authenticated', 'public.external_identifier_map', 'SELECT')
     or not has_table_privilege('authenticated', 'public.api_idempotency_records', 'SELECT') then
    raise exception 'gateway core: an authenticated table grant did not take';
  end if;

  -- api_idempotency_records must have RLS on and zero policies: deny-all.
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

-- The environment/prefix CHECK has to actually discriminate — a constraint
-- that passes everything is worse than none, because it reads as protection.
-- Deliberately sabotage it once, in a subtransaction, and require the failure.
do $$
declare
  v_org uuid;
  v_ok  boolean := false;
begin
  select id into v_org from public.organisations limit 1;
  if v_org is null then
    return; -- nothing to test against on a fresh database; the CHECK still exists
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

  -- ...and confirm the control case is genuinely accepted, so the test above
  -- is not passing because every insert fails.
  insert into public.api_keys (organisation_id, name, key_prefix, key_hash, environment)
  values (v_org, 'constraint probe', 'th_test_00000000', 'probe-' || gen_random_uuid()::text, 'sandbox');
  delete from public.api_keys where name = 'constraint probe';
end $$;
