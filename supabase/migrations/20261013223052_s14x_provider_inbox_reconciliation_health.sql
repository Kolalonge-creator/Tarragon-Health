-- S14x (S11-S15 package P4): provider event inbox, settlement reconciliation break queue, provider circuit breaker health.
-- Design: docs/design/S11-S15-p4-providers.md. Research: docs/research/S11-S15-p4-providers.md.
--
-- What this adds (all additive; every behaviour change sits behind a feature flag that defaults OFF):
--   * provider_events: one inbox for Paystack, Zoom and Resend webhooks. The raw body is stored as received and never changes
--     (trigger), the signature result is stored, the idempotency key is unique per provider. A bad signature is stored as
--     'rejected' and is never dispatched. Claim / complete / fail mirror the S10 event bus (SKIP LOCKED, lease, backoff).
--     replay_provider_event is admin only and writes the audit log.
--   * settlement_reports / settlement_lines / reconciliation_breaks: Paystack's settlement report against our ledger
--     (public.payments for v5 orders, payment_transactions for the legacy path). The comparison only opens breaks. It
--     NEVER posts or corrects anything; a person explains or resolves each break (note required, audited).
--   * provider_health + provider_health_v: consecutive-failure circuit breaker state per provider operation.
--   * provider_layer_config (PROPOSED, mirrored as `providers.layer`): lease, attempts, backoff, breaker and ageing values.
--   * Four feature flags, all off: provider_inbox_paystack, provider_circuit_breaker, payout_batch_maker_checker, payout_gl_posting
--     (the last two are used by the next migration).
--
-- Counts before this migration (live, 2026-10-13): no provider_events, settlement or health tables exist; payments has no
-- settlement history to compare against, so there is nothing to convert or backfill. Nothing here moves money.
--
-- Table scope note: these tables are platform level (a webhook arrives before any organisation is known), so they carry no
-- organisation_id. Access is admin only (RLS) and the raw body can hold a customer email, so it is never returned by the
-- list function, only by the single-event read an admin makes on purpose.

-- ---------------------------------------------------------------------------
-- 1. Flags (off) and config (PROPOSED)
-- ---------------------------------------------------------------------------
insert into public.feature_flags (key, label, description, category, status) values
  ('provider_inbox_paystack', 'Provider event inbox for Paystack', 'When on, every Paystack webhook is first stored in provider_events (raw body, signature result, idempotency key) and then handed to the existing handler. Off keeps the old path alone.', 'payments', 'off'),
  ('provider_circuit_breaker', 'Provider circuit breaker', 'When on, payment initialise and email sends consult provider_health and stop calling a provider that has failed repeatedly.', 'payments', 'off'),
  ('payout_batch_maker_checker', 'Payout batch maker-checker', 'When on, a payout can be sent only from a released batch: one person proposes it, a different person releases it, and per-payout, per-clinician and per-batch limits apply (OQ-97 compensating controls).', 'payments', 'off'),
  ('payout_gl_posting', 'Payout general ledger posting', 'When on, a successful clinician payout posts to the general ledger and a later reversal posts the exact opposite entry.', 'finance', 'off')
on conflict (key) do nothing;

create table public.provider_layer_config (
  id             uuid primary key default gen_random_uuid(),
  version        integer not null unique,
  is_active      boolean not null default false,
  effective_from date not null,
  rules          jsonb not null,
  created_at     timestamptz not null default now()
);
create unique index provider_layer_config_one_active on public.provider_layer_config (is_active) where is_active;

-- providers-layer-rules-begin
insert into public.provider_layer_config (version, is_active, effective_from, rules) values (1, true, '2026-10-13', $json$
{
  "inbox": { "leaseSeconds": 120, "maxAttempts": 8, "backoffBaseSeconds": 30, "backoffMaxSeconds": 3600, "maxBodyBytes": 262144 },
  "circuit": { "failureThreshold": 5, "openSeconds": 60 },
  "reconciliation": { "unsettledAfterHours": 72, "ageingBucketsHours": [24, 72, 168], "lookbackDays": 7 }
}
$json$::jsonb);
-- providers-layer-rules-end

create function private.provider_layer_setting(p_group text, p_key text) returns jsonb
language sql stable security definer set search_path = ''
as $$ select rules -> p_group -> p_key from public.provider_layer_config where is_active; $$;
revoke all on function private.provider_layer_setting(text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. provider_events
-- ---------------------------------------------------------------------------
create table public.provider_events (
  id                 uuid primary key default gen_random_uuid(),
  provider           text not null check (provider in ('paystack', 'zoom', 'resend')),
  event_type         text not null check (char_length(event_type) between 1 and 200),
  idempotency_key    text not null check (char_length(idempotency_key) between 1 and 400),
  raw_body           text not null,
  content_sha256     text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  signature_verified boolean not null,
  status             text not null default 'received' check (status in ('received', 'processing', 'processed', 'failed', 'dead', 'rejected')),
  attempt_count      integer not null default 0 check (attempt_count >= 0),
  delivery_count     integer not null default 1 check (delivery_count >= 1),
  last_error         text,
  linked_entity_type text,
  linked_entity_id   text,
  lease_token        uuid,
  locked_until       timestamptz,
  next_attempt_at    timestamptz not null default now(),
  replay_count       integer not null default 0,
  received_at        timestamptz not null default now(),
  last_delivery_at   timestamptz not null default now(),
  processed_at       timestamptz,
  -- A rejected row is exactly an unverified one; a verified row is never rejected.
  check ((status = 'rejected') = (not signature_verified)),
  unique (provider, idempotency_key)
);
create index provider_events_open_idx on public.provider_events (next_attempt_at) where status in ('received', 'failed', 'processing');
create index provider_events_provider_received_idx on public.provider_events (provider, received_at desc);
comment on table public.provider_events is
  'S14x: provider webhook inbox. raw_body is stored as received and never changes. rejected = signature did not verify: stored for forensics, never dispatched, never replayable. Written only by the SECURITY DEFINER functions below (service role).';

create function private.guard_provider_events() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'TRUNCATE' then
    raise exception 'provider_events is append only: rows are never deleted' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    -- The one exception: a REJECTED (bad signature) row older than the retention window, removed by purge_rejected_provider_events().
    if old.status = 'rejected' and coalesce(current_setting('tarragon.provider_purge', true), '') = 'on' then return old; end if;
    raise exception 'provider_events is append only: rows are never deleted' using errcode = '42501';
  end if;
  if new.provider is distinct from old.provider or new.raw_body is distinct from old.raw_body
     or new.content_sha256 is distinct from old.content_sha256 or new.idempotency_key is distinct from old.idempotency_key
     or new.signature_verified is distinct from old.signature_verified or new.event_type is distinct from old.event_type
     or new.received_at is distinct from old.received_at then
    raise exception 'the raw body, signature result and key of a provider event never change' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_provider_events() from public, anon, authenticated;
create trigger provider_events_guard before update or delete on public.provider_events for each row execute function private.guard_provider_events();
create trigger provider_events_no_truncate before truncate on public.provider_events for each statement execute function private.guard_provider_events();

-- RLS on, and NO table grant to any client: the raw body can hold a customer email, so an admin reads the inbox only through
-- list_provider_events (no body) and get_provider_event (the body, audited). A direct table read is refused.
alter table public.provider_events enable row level security;
revoke all on public.provider_events from public, anon, authenticated;

-- Record (service role). New verified key -> 'received'. Same key again -> the first body is kept, the delivery count goes up.
-- Not verified -> stored as 'rejected' under a key made from the body hash, so a flood of the same forged body is one row.
create function public.record_provider_event(
  p_provider text, p_event_type text, p_idempotency_key text, p_raw_body text, p_verified boolean
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_max integer := coalesce((private.provider_layer_setting('inbox', 'maxBodyBytes'))::integer, 262144);
  v_sha text;
  v_key text;
  v_id uuid;
  v_status text;
  v_verified boolean;
  v_stored_sha text;
  v_inserted boolean;
begin
  if p_provider is null or p_provider not in ('paystack', 'zoom', 'resend') then raise exception 'provider_event_unknown_provider' using errcode = '22023'; end if;
  if p_raw_body is null or octet_length(p_raw_body) > v_max then raise exception 'provider_event_body_too_large' using errcode = '22023'; end if;
  v_sha := encode(sha256(convert_to(p_raw_body, 'utf8')), 'hex');
  v_key := case when p_verified then p_idempotency_key else 'unverified:' || v_sha end;
  insert into public.provider_events (provider, event_type, idempotency_key, raw_body, content_sha256, signature_verified, status)
  values (p_provider, left(coalesce(nullif(p_event_type, ''), 'unknown'), 200), v_key, p_raw_body, v_sha, coalesce(p_verified, false),
          case when p_verified then 'received' else 'rejected' end)
  on conflict (provider, idempotency_key) do update
    set delivery_count = public.provider_events.delivery_count + 1, last_delivery_at = now()
  returning public.provider_events.id, public.provider_events.status, public.provider_events.signature_verified, public.provider_events.content_sha256, (xmax = 0)
       into v_id, v_status, v_verified, v_stored_sha, v_inserted;
  return jsonb_build_object('id', v_id, 'status', v_status, 'duplicate', not v_inserted, 'verified', v_verified, 'body_differs', v_stored_sha <> v_sha);
end;
$$;

-- Claim one event the caller just recorded (or a provider redelivery of a failed one). Returns the lease token, or null when
-- there is nothing to do: already processed, rejected, being processed under a live lease, dead.
create function public.claim_provider_event(p_id uuid) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_max integer := coalesce((private.provider_layer_setting('inbox', 'maxAttempts'))::integer, 8);
  v_lease integer := coalesce((private.provider_layer_setting('inbox', 'leaseSeconds'))::integer, 120);
  e public.provider_events%rowtype;
  v_token uuid := gen_random_uuid();
begin
  select * into e from public.provider_events where id = p_id for update skip locked;
  if not found then return null; end if;
  if not e.signature_verified or e.status in ('processed', 'rejected', 'dead') then return null; end if;
  if e.status = 'processing' and e.locked_until >= now() then return null; end if;
  if e.attempt_count >= v_max then
    update public.provider_events set status = 'dead', locked_until = null, lease_token = null,
      last_error = coalesce(last_error, 'attempt limit reached') where id = e.id;
    return null;
  end if;
  update public.provider_events set status = 'processing', lease_token = v_token, locked_until = now() + make_interval(secs => v_lease),
    attempt_count = attempt_count + 1 where id = e.id;
  return v_token;
end;
$$;

-- The sweeper's claim: due events, oldest first. Same lease rules as claim_provider_event.
create function public.claim_provider_events(p_limit integer default 20)
returns table (id uuid, lease_token uuid, provider text, event_type text, idempotency_key text, raw_body text, attempt_count integer)
language plpgsql security definer set search_path = ''
as $$
declare
  v_max integer := coalesce((private.provider_layer_setting('inbox', 'maxAttempts'))::integer, 8);
  v_lease integer := coalesce((private.provider_layer_setting('inbox', 'leaseSeconds'))::integer, 120);
begin
  update public.provider_events e set status = 'dead', locked_until = null, lease_token = null, last_error = coalesce(e.last_error, 'attempt limit reached')
   where e.signature_verified and e.attempt_count >= v_max and (e.status = 'failed' or (e.status = 'processing' and e.locked_until < now()));
  return query
  with picked as (
    select pe.id from public.provider_events pe
     where pe.signature_verified and pe.attempt_count < v_max
       and ((pe.status in ('received', 'failed') and pe.next_attempt_at <= now()) or (pe.status = 'processing' and pe.locked_until < now()))
     order by pe.next_attempt_at, pe.received_at
     limit least(greatest(coalesce(p_limit, 20), 1), 100)
     for update of pe skip locked
  ), upd as (
    update public.provider_events pe set status = 'processing', lease_token = gen_random_uuid(),
      locked_until = now() + make_interval(secs => v_lease), attempt_count = pe.attempt_count + 1
     from picked where pe.id = picked.id
    returning pe.*
  )
  select u.id, u.lease_token, u.provider, u.event_type, u.idempotency_key, u.raw_body, u.attempt_count from upd u order by u.received_at;
end;
$$;

create function public.complete_provider_event(p_id uuid, p_lease uuid, p_entity_type text default null, p_entity_id text default null) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare v_rows integer;
begin
  update public.provider_events set status = 'processed', processed_at = now(), locked_until = null, lease_token = null, last_error = null,
    linked_entity_type = coalesce(left(p_entity_type, 100), linked_entity_type), linked_entity_id = coalesce(left(p_entity_id, 200), linked_entity_id)
   where id = p_id and lease_token = p_lease and status = 'processing';
  get diagnostics v_rows = row_count;
  return v_rows = 1;
end;
$$;

create function public.fail_provider_event(p_id uuid, p_lease uuid, p_error text, p_permanent boolean default false) returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_max integer := coalesce((private.provider_layer_setting('inbox', 'maxAttempts'))::integer, 8);
  v_base numeric := coalesce((private.provider_layer_setting('inbox', 'backoffBaseSeconds'))::numeric, 30);
  v_cap numeric := coalesce((private.provider_layer_setting('inbox', 'backoffMaxSeconds'))::numeric, 3600);
  e public.provider_events%rowtype;
begin
  select * into e from public.provider_events where id = p_id and lease_token = p_lease and status = 'processing' for update;
  if not found then return 'stale'; end if;
  if p_permanent or e.attempt_count >= v_max then
    update public.provider_events set status = 'dead', locked_until = null, lease_token = null, last_error = left(coalesce(p_error, 'failed'), 1000) where id = e.id;
    return 'dead';
  end if;
  update public.provider_events set status = 'failed', locked_until = null, lease_token = null, last_error = left(coalesce(p_error, 'failed'), 1000),
    next_attempt_at = now() + make_interval(secs => least(v_base * power(2, e.attempt_count - 1), v_cap) * (1 + random() * 0.2))
   where id = e.id;
  return 'failed';
end;
$$;

-- Forged bodies are unauthenticated input and cannot be deleted by anything else, so they are purged by age (service role, not scheduled yet).
-- A verified event is never purged here.
create function public.purge_rejected_provider_events(p_older_than_days integer default 30) returns integer
language plpgsql security definer set search_path = ''
as $$
declare v_n integer;
begin
  if p_older_than_days is null or p_older_than_days < 7 then raise exception 'provider_event_purge_window_too_short' using errcode = '22023'; end if;
  perform set_config('tarragon.provider_purge', 'on', true);
  delete from public.provider_events where status = 'rejected' and not signature_verified and received_at < now() - make_interval(days => p_older_than_days);
  get diagnostics v_n = row_count;
  perform set_config('tarragon.provider_purge', 'off', true);
  return v_n;
end;
$$;

-- Admin replay. Only a verified event can be replayed; the handler it reaches must be idempotent (the inbox cannot make it so).
create function public.replay_provider_event(p_id uuid, p_reason text) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare e public.provider_events%rowtype;
begin
  if (select auth.uid()) is null or not private.is_admin() then raise exception 'only an admin may replay a provider event' using errcode = '42501'; end if;
  if p_reason is null or char_length(btrim(p_reason)) < 10 then raise exception 'provider_event_replay_needs_reason' using errcode = '22023'; end if;
  select * into e from public.provider_events where id = p_id for update;
  if not found then return false; end if;
  if not e.signature_verified or e.status = 'rejected' then raise exception 'provider_event_unverified_never_replayed' using errcode = '23514'; end if;
  if e.status = 'processing' and e.locked_until >= now() then raise exception 'provider_event_in_flight' using errcode = '55P03'; end if;
  update public.provider_events set status = 'received', attempt_count = 0, next_attempt_at = now(), locked_until = null, lease_token = null,
    last_error = null, processed_at = null, replay_count = replay_count + 1 where id = e.id;
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (private.caller_org(), (select auth.uid()), 'provider_event.replay', 'provider_events', e.id,
          jsonb_build_object('provider', e.provider, 'event_type', e.event_type, 'was_status', e.status, 'reason', left(btrim(p_reason), 300)));
  return true;
end;
$$;

-- Admin list: no raw body (it can hold a customer email). get_provider_event is the deliberate single read.
create function public.list_provider_events(p_provider text default null, p_status text default null, p_limit integer default 100)
returns table (id uuid, provider text, event_type text, idempotency_key text, signature_verified boolean, status text, attempt_count integer,
               delivery_count integer, replay_count integer, last_error text, linked_entity_type text, linked_entity_id text, received_at timestamptz, processed_at timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not private.is_admin() then raise exception 'only an admin may read the provider inbox' using errcode = '42501'; end if;
  return query
    select e.id, e.provider, e.event_type, e.idempotency_key, e.signature_verified, e.status, e.attempt_count, e.delivery_count, e.replay_count,
           e.last_error, e.linked_entity_type, e.linked_entity_id, e.received_at, e.processed_at
      from public.provider_events e
     where (p_provider is null or e.provider = p_provider) and (p_status is null or e.status = p_status)
     order by e.received_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500);
end;
$$;

create function public.get_provider_event(p_id uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare e public.provider_events%rowtype;
begin
  if (select auth.uid()) is null or not private.is_admin() then raise exception 'only an admin may read the provider inbox' using errcode = '42501'; end if;
  select * into e from public.provider_events where id = p_id;
  if not found then return null; end if;
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (private.caller_org(), (select auth.uid()), 'provider_event.read_raw', 'provider_events', e.id, jsonb_build_object('provider', e.provider));
  return to_jsonb(e);
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Settlement reconciliation (read only against Paystack; opens breaks, never corrects)
-- ---------------------------------------------------------------------------
create table public.settlement_reports (
  id                     uuid primary key default gen_random_uuid(),
  provider               text not null default 'paystack' check (provider = 'paystack'),
  provider_settlement_id text not null,
  status                 text not null,
  currency               text not null default 'NGN' check (currency = 'NGN'),
  total_kobo             bigint not null check (total_kobo >= 0),
  fees_kobo              bigint not null check (fees_kobo >= 0),
  settled_at             timestamptz,
  lines_complete         boolean not null default false,
  fetched_at             timestamptz not null default now(),
  reconciled_at          timestamptz,
  unique (provider, provider_settlement_id)
);
create table public.settlement_lines (
  id                 uuid primary key default gen_random_uuid(),
  report_id          uuid not null references public.settlement_reports (id) on delete restrict,
  provider_reference text not null,
  amount_kobo        bigint not null check (amount_kobo >= 0),
  fees_kobo          bigint not null default 0 check (fees_kobo >= 0),
  status             text not null,
  paid_at            timestamptz,
  unique (report_id, provider_reference)
);
create index settlement_lines_reference_idx on public.settlement_lines (provider_reference);

create table public.reconciliation_breaks (
  id                    uuid primary key default gen_random_uuid(),
  provider              text not null default 'paystack',
  break_type            text not null check (break_type in ('missing_in_ledger', 'amount_mismatch', 'missing_at_provider', 'settlement_total_mismatch', 'reversal_unmatched')),
  provider_reference    text not null,
  report_id             uuid references public.settlement_reports (id) on delete restrict,
  provider_amount_kobo  bigint,
  ledger_amount_kobo    bigint,
  difference_kobo       bigint,
  detail                text,
  status                text not null default 'open' check (status in ('open', 'explained', 'resolved', 'cleared')),
  first_seen_at         timestamptz not null default now(),
  last_seen_at          timestamptz not null default now(),
  closed_by             uuid references public.profiles (id) on delete set null,
  closed_at             timestamptz,
  closing_note          text,
  check (status = 'open' or closed_at is not null),
  check (status in ('open', 'cleared') or char_length(btrim(coalesce(closing_note, ''))) >= 10)
);
-- one open break per kind per reference: a later run refreshes it instead of stacking duplicates
create unique index reconciliation_breaks_one_open on public.reconciliation_breaks (provider, break_type, provider_reference) where status = 'open';
create index reconciliation_breaks_queue_idx on public.reconciliation_breaks (first_seen_at) where status = 'open';

alter table public.settlement_reports enable row level security;
alter table public.settlement_lines enable row level security;
alter table public.reconciliation_breaks enable row level security;
create policy settlement_reports_admin_read on public.settlement_reports for select to authenticated using (private.is_admin());
create policy settlement_lines_admin_read on public.settlement_lines for select to authenticated using (private.is_admin());
create policy reconciliation_breaks_admin_read on public.reconciliation_breaks for select to authenticated using (private.is_admin());
revoke all on public.settlement_reports, public.settlement_lines, public.reconciliation_breaks from public, anon, authenticated;
grant select on public.settlement_reports, public.settlement_lines, public.reconciliation_breaks to authenticated;

-- Service role: store one settlement and its lines. Idempotent on the settlement id and (settlement, reference).
create function public.record_settlement_report(
  p_settlement_id text, p_status text, p_total_kobo bigint, p_fees_kobo bigint, p_settled_at timestamptz, p_lines jsonb, p_lines_complete boolean
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_id uuid; l jsonb;
begin
  if p_settlement_id is null or btrim(p_settlement_id) = '' then raise exception 'settlement_id_required' using errcode = '22023'; end if;
  if jsonb_typeof(coalesce(p_lines, '[]'::jsonb)) <> 'array' then raise exception 'settlement_lines_must_be_an_array' using errcode = '22023'; end if;
  insert into public.settlement_reports (provider_settlement_id, status, total_kobo, fees_kobo, settled_at, lines_complete)
  values (p_settlement_id, coalesce(p_status, 'unknown'), p_total_kobo, p_fees_kobo, p_settled_at, coalesce(p_lines_complete, false))
  on conflict (provider, provider_settlement_id) do update
    set status = excluded.status, total_kobo = excluded.total_kobo, fees_kobo = excluded.fees_kobo, settled_at = excluded.settled_at,
        lines_complete = excluded.lines_complete or public.settlement_reports.lines_complete, fetched_at = now()
  returning id into v_id;
  for l in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    insert into public.settlement_lines (report_id, provider_reference, amount_kobo, fees_kobo, status, paid_at)
    values (v_id, l ->> 'reference', (l ->> 'amount_kobo')::bigint, coalesce((l ->> 'fees_kobo')::bigint, 0), coalesce(l ->> 'status', 'unknown'), nullif(l ->> 'paid_at', '')::timestamptz)
    on conflict (report_id, provider_reference) do update set amount_kobo = excluded.amount_kobo, fees_kobo = excluded.fees_kobo, status = excluded.status, paid_at = excluded.paid_at;
  end loop;
  return v_id;
end;
$$;

create function private.open_reconciliation_break(
  p_type text, p_reference text, p_report uuid, p_provider_kobo bigint, p_ledger_kobo bigint, p_detail text
) returns void
language sql security definer set search_path = ''
as $$
  insert into public.reconciliation_breaks (break_type, provider_reference, report_id, provider_amount_kobo, ledger_amount_kobo, difference_kobo, detail)
  values (p_type, p_reference, p_report, p_provider_kobo, p_ledger_kobo, coalesce(p_provider_kobo, 0) - coalesce(p_ledger_kobo, 0), left(p_detail, 500))
  on conflict (provider, break_type, provider_reference) where status = 'open'
  do update set last_seen_at = now(), report_id = excluded.report_id, provider_amount_kobo = excluded.provider_amount_kobo,
                ledger_amount_kobo = excluded.ledger_amount_kobo, difference_kobo = excluded.difference_kobo, detail = excluded.detail;
$$;
revoke all on function private.open_reconciliation_break(text, text, uuid, bigint, bigint, text) from public, anon, authenticated;

-- Our side of one charge: the v5 payments row, else the legacy charge.success row. Test data never counts.
create function private.ledger_charge_kobo(p_reference text) returns bigint
language sql stable security definer set search_path = ''
as $$
  select coalesce(
    (select p.total_kobo from public.payments p where p.provider = 'paystack' and p.provider_reference = p_reference and p.status = 'success' and not p.is_test limit 1),
    (select t.amount_minor from public.payment_transactions t where t.provider = 'paystack' and t.event_type = 'charge.success' and t.provider_event_id = p_reference limit 1));
$$;
revoke all on function private.ledger_charge_kobo(text) from public, anon, authenticated;

-- Compare one stored report with our ledger. Opens breaks only. Returns how many lines matched and how many breaks are open for it.
create function public.reconcile_settlement_report(p_report_id uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  r public.settlement_reports%rowtype;
  l public.settlement_lines%rowtype;
  v_ledger bigint;
  v_matched integer := 0;
  v_sum bigint;
  v_open integer;
begin
  select * into r from public.settlement_reports where id = p_report_id for update;
  if not found then raise exception 'settlement_report_unknown' using errcode = '22023'; end if;
  for l in select * from public.settlement_lines where report_id = r.id loop
    v_ledger := private.ledger_charge_kobo(l.provider_reference);
    if v_ledger is null then
      perform private.open_reconciliation_break('missing_in_ledger', l.provider_reference, r.id, l.amount_kobo, null, 'Paystack settled this charge but our ledger has no record of it');
    elsif v_ledger <> l.amount_kobo then
      perform private.open_reconciliation_break('amount_mismatch', l.provider_reference, r.id, l.amount_kobo, v_ledger, 'Paystack and our ledger disagree on the amount charged');
    else
      v_matched := v_matched + 1;
      update public.reconciliation_breaks set status = 'cleared', closed_at = now(), closing_note = 'cleared: a later settlement report matches the ledger'
       where provider = 'paystack' and provider_reference = l.provider_reference and status = 'open' and break_type in ('missing_in_ledger', 'amount_mismatch', 'missing_at_provider');
    end if;
  end loop;
  if r.lines_complete then
    select coalesce(sum(amount_kobo), 0) into v_sum from public.settlement_lines where report_id = r.id;
    if v_sum <> r.total_kobo then
      perform private.open_reconciliation_break('settlement_total_mismatch', r.provider_settlement_id, r.id, r.total_kobo, v_sum, 'The settlement total is not the sum of its own lines');
    end if;
  end if;
  update public.settlement_reports set reconciled_at = now() where id = r.id;
  select count(*) into v_open from public.reconciliation_breaks where report_id = r.id and status = 'open';
  return jsonb_build_object('report_id', r.id, 'matched', v_matched, 'open_breaks', v_open);
end;
$$;

-- The other direction: a paid charge of ours that no settlement has listed after the configured time (T+1 is normal; 72h is not).
create function public.reconcile_unsettled_charges(p_now timestamptz default now()) returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_after integer := coalesce((private.provider_layer_setting('reconciliation', 'unsettledAfterHours'))::integer, 72);
  v_look integer := coalesce((private.provider_layer_setting('reconciliation', 'lookbackDays'))::integer, 7);
  r record;
  v_n integer := 0;
begin
  for r in
    select p.provider_reference, p.total_kobo from public.payments p
     where p.provider = 'paystack' and p.status = 'success' and not p.is_test
       and p.verified_at < p_now - make_interval(hours => v_after) and p.verified_at >= p_now - make_interval(days => v_look + (v_after / 24) + 1)
       and not exists (select 1 from public.settlement_lines s where s.provider_reference = p.provider_reference)
  loop
    perform private.open_reconciliation_break('missing_at_provider', r.provider_reference, null, null, r.total_kobo, 'No settlement report lists this paid charge yet');
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

-- Admin: the break queue with ageing, and the (only) way to close a break by hand. No journal entry is ever posted from here.
create function public.reconciliation_break_queue(p_status text default 'open', p_limit integer default 200)
returns table (id uuid, break_type text, provider_reference text, provider_amount_kobo bigint, ledger_amount_kobo bigint, difference_kobo bigint,
               detail text, status text, first_seen_at timestamptz, last_seen_at timestamptz, age_hours integer, ageing_bucket text, closing_note text)
language plpgsql stable security definer set search_path = ''
as $$
declare v_b jsonb := coalesce(private.provider_layer_setting('reconciliation', 'ageingBucketsHours'), '[24,72,168]'::jsonb);
begin
  if (select auth.uid()) is null or not private.is_admin() then raise exception 'only an admin may read the reconciliation queue' using errcode = '42501'; end if;
  return query
    select b.id, b.break_type, b.provider_reference, b.provider_amount_kobo, b.ledger_amount_kobo, b.difference_kobo, b.detail, b.status,
           b.first_seen_at, b.last_seen_at,
           (extract(epoch from (now() - b.first_seen_at)) / 3600)::integer,
           case when extract(epoch from (now() - b.first_seen_at)) / 3600 < (v_b ->> 0)::numeric then 'under_' || (v_b ->> 0) || 'h'
                when extract(epoch from (now() - b.first_seen_at)) / 3600 < (v_b ->> 1)::numeric then 'under_' || (v_b ->> 1) || 'h'
                when extract(epoch from (now() - b.first_seen_at)) / 3600 < (v_b ->> 2)::numeric then 'under_' || (v_b ->> 2) || 'h'
                else 'over_' || (v_b ->> 2) || 'h' end,
           b.closing_note
      from public.reconciliation_breaks b
     where (p_status is null or b.status = p_status)
     order by b.first_seen_at limit least(greatest(coalesce(p_limit, 200), 1), 500);
end;
$$;

create function public.close_reconciliation_break(p_id uuid, p_status text, p_note text) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare b public.reconciliation_breaks%rowtype;
begin
  if (select auth.uid()) is null or not private.is_admin() then raise exception 'only an admin may close a reconciliation break' using errcode = '42501'; end if;
  if coalesce(p_status, '') not in ('explained', 'resolved') then raise exception 'reconciliation_break_status_invalid' using errcode = '22023'; end if;
  if p_note is null or char_length(btrim(p_note)) < 10 then raise exception 'reconciliation_break_needs_note' using errcode = '22023'; end if;
  select * into b from public.reconciliation_breaks where id = p_id for update;
  if not found or b.status <> 'open' then return false; end if;
  update public.reconciliation_breaks set status = p_status, closed_by = (select auth.uid()), closed_at = now(), closing_note = left(btrim(p_note), 500) where id = b.id;
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (private.caller_org(), (select auth.uid()), 'reconciliation_break.' || p_status, 'reconciliation_breaks', b.id,
          jsonb_build_object('break_type', b.break_type, 'difference_kobo', b.difference_kobo));
  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Provider health (circuit breaker state)
-- ---------------------------------------------------------------------------
create table public.provider_health (
  provider             text not null check (provider in ('paystack', 'zoom', 'resend')),
  operation            text not null check (operation ~ '^[a-z_]{1,40}$'),
  state                text not null default 'closed' check (state in ('closed', 'open', 'half_open')),
  consecutive_failures integer not null default 0 check (consecutive_failures >= 0),
  opened_at            timestamptz,
  last_probe_at        timestamptz,
  last_failure_at      timestamptz,
  last_success_at      timestamptz,
  last_error_code      text,
  updated_at           timestamptz not null default now(),
  primary key (provider, operation)
);
alter table public.provider_health enable row level security;
create policy provider_health_admin_read on public.provider_health for select to authenticated using (private.is_admin());
revoke all on public.provider_health from public, anon, authenticated;
grant select on public.provider_health to authenticated;

-- The one thing the chain-health page (P1) reads. security_invoker so the admin-only policy above applies to the caller.
create view public.provider_health_v with (security_invoker = true) as
  select h.provider, h.operation, h.state, h.consecutive_failures, h.opened_at, h.last_failure_at, h.last_success_at, h.last_error_code, h.updated_at,
         case when h.state = 'open' then 'down'
              when h.state = 'half_open' or h.consecutive_failures > 0 then 'degraded'
              else 'healthy' end as status
    from public.provider_health h;
revoke all on public.provider_health_v from public, anon, authenticated;
grant select on public.provider_health_v to authenticated;

-- Is a call allowed? closed: yes. open: no, until openSeconds have passed, then one probe (half_open). half_open: only one probe per window.
create function public.provider_call_allowed(p_provider text, p_operation text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_open integer := coalesce((private.provider_layer_setting('circuit', 'openSeconds'))::integer, 60);
  h public.provider_health%rowtype;
begin
  select * into h from public.provider_health where provider = p_provider and operation = p_operation for update;
  if not found or h.state = 'closed' then return jsonb_build_object('allowed', true, 'state', 'closed'); end if;
  if h.state = 'open' and h.opened_at + make_interval(secs => v_open) <= now() then
    update public.provider_health set state = 'half_open', last_probe_at = now(), updated_at = now() where provider = h.provider and operation = h.operation;
    return jsonb_build_object('allowed', true, 'state', 'half_open');
  end if;
  if h.state = 'half_open' and coalesce(h.last_probe_at, h.opened_at) + make_interval(secs => v_open) <= now() then
    update public.provider_health set last_probe_at = now(), updated_at = now() where provider = h.provider and operation = h.operation;
    return jsonb_build_object('allowed', true, 'state', 'half_open');
  end if;
  return jsonb_build_object('allowed', false, 'state', h.state);
end;
$$;

create function public.provider_record_result(p_provider text, p_operation text, p_ok boolean, p_error_code text default null) returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_threshold integer := coalesce((private.provider_layer_setting('circuit', 'failureThreshold'))::integer, 5);
  h public.provider_health%rowtype;
  v_state text;
begin
  insert into public.provider_health (provider, operation) values (p_provider, p_operation) on conflict do nothing;
  select * into h from public.provider_health where provider = p_provider and operation = p_operation for update;
  if p_ok then
    update public.provider_health set state = 'closed', consecutive_failures = 0, opened_at = null, last_success_at = now(), updated_at = now()
     where provider = h.provider and operation = h.operation;
    return 'closed';
  end if;
  v_state := case when h.state = 'half_open' or h.consecutive_failures + 1 >= v_threshold then 'open' else h.state end;
  update public.provider_health set consecutive_failures = h.consecutive_failures + 1, state = v_state,
    opened_at = case when v_state = 'open' and (h.state <> 'open' or h.state = 'half_open') then now() else h.opened_at end,
    last_failure_at = now(), last_error_code = left(p_error_code, 60), updated_at = now()
   where provider = h.provider and operation = h.operation;
  return v_state;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Grants (revoke from PUBLIC, which is where anon's execute comes from)
-- ---------------------------------------------------------------------------
revoke all on function
  public.record_provider_event(text, text, text, text, boolean), public.claim_provider_event(uuid), public.claim_provider_events(integer),
  public.complete_provider_event(uuid, uuid, text, text), public.fail_provider_event(uuid, uuid, text, boolean),
  public.replay_provider_event(uuid, text), public.list_provider_events(text, text, integer), public.get_provider_event(uuid),
  public.record_settlement_report(text, text, bigint, bigint, timestamptz, jsonb, boolean), public.reconcile_settlement_report(uuid),
  public.reconcile_unsettled_charges(timestamptz), public.reconciliation_break_queue(text, integer), public.close_reconciliation_break(uuid, text, text),
  public.purge_rejected_provider_events(integer),
  public.provider_call_allowed(text, text), public.provider_record_result(text, text, boolean, text)
  from public, anon, authenticated;
grant execute on function
  public.record_provider_event(text, text, text, text, boolean), public.claim_provider_event(uuid), public.claim_provider_events(integer),
  public.complete_provider_event(uuid, uuid, text, text), public.fail_provider_event(uuid, uuid, text, boolean),
  public.record_settlement_report(text, text, bigint, bigint, timestamptz, jsonb, boolean), public.reconcile_settlement_report(uuid),
  public.reconcile_unsettled_charges(timestamptz), public.provider_call_allowed(text, text), public.provider_record_result(text, text, boolean, text),
  public.purge_rejected_provider_events(integer)
  to service_role;
grant execute on function
  public.replay_provider_event(uuid, text), public.list_provider_events(text, text, integer), public.get_provider_event(uuid),
  public.reconciliation_break_queue(text, integer), public.close_reconciliation_break(uuid, text, text)
  to authenticated, service_role;
alter table public.provider_layer_config enable row level security;
create policy provider_layer_config_admin_read on public.provider_layer_config for select to authenticated using (private.is_admin());
revoke all on public.provider_layer_config from public, anon, authenticated;
grant select on public.provider_layer_config to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Self-check
-- ---------------------------------------------------------------------------
do $$
declare v_fn text;
begin
  foreach v_fn in array array[
    'public.record_provider_event(text,text,text,text,boolean)', 'public.claim_provider_event(uuid)', 'public.claim_provider_events(integer)',
    'public.complete_provider_event(uuid,uuid,text,text)', 'public.fail_provider_event(uuid,uuid,text,boolean)',
    'public.record_settlement_report(text,text,bigint,bigint,timestamptz,jsonb,boolean)', 'public.reconcile_settlement_report(uuid)',
    'public.reconcile_unsettled_charges(timestamptz)', 'public.purge_rejected_provider_events(integer)', 'public.provider_call_allowed(text,text)', 'public.provider_record_result(text,text,boolean,text)'] loop
    if has_function_privilege('anon', v_fn, 'EXECUTE') or has_function_privilege('authenticated', v_fn, 'EXECUTE') then
      raise exception 'S14x assertion: % is callable by a client', v_fn;
    end if;
  end loop;
  foreach v_fn in array array['public.replay_provider_event(uuid,text)', 'public.list_provider_events(text,text,integer)', 'public.get_provider_event(uuid)',
    'public.reconciliation_break_queue(text,integer)', 'public.close_reconciliation_break(uuid,text,text)'] loop
    if has_function_privilege('anon', v_fn, 'EXECUTE') then raise exception 'S14x assertion: anon can execute %', v_fn; end if;
    if not has_function_privilege('authenticated', v_fn, 'EXECUTE') then raise exception 'S14x assertion: authenticated cannot execute %', v_fn; end if;
  end loop;
  if (select count(*) from public.provider_layer_config where is_active) <> 1 then raise exception 'S14x assertion: one active provider_layer_config row expected'; end if;
  if exists (select 1 from public.feature_flags where key in ('provider_inbox_paystack', 'provider_circuit_breaker', 'payout_batch_maker_checker', 'payout_gl_posting') and status <> 'off') then
    raise exception 'S14x assertion: a new flag is not off';
  end if;
end $$;
