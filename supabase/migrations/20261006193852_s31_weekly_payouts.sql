-- S31: weekly payouts, approval, Paystack transfers, statements, bank verification (spec 7.7, D-09).
--
-- What this adds (design: docs/design/S31.md):
--   * payouts_config (PROPOSED, mirrored as `payouts.rules`): draft weekday/hour, minimum payout, carry-over.
--   * clinician_bank_accounts: bank, last four digits, the name the bank returned, the Paystack recipient code. The full account
--     number is never stored. bank_verified_at is set only when the returned name matches the credentialed name.
--   * clinician_tax_profiles: data only for withholding-tax reporting (D-09). No rate, no amount, nothing is calculated.
--   * payouts, payout_transfers (one row per attempt, the reference is the Paystack idempotency key), payout_events (append only).
--   * Functions: weekly draft builder, approve (re-reads the ledger, links the lines once), prepare/record send, transfer webhook
--     handler (keyed by event and reference), retry, statements. Money moves only after a person approves with `payouts_enabled` on.
--   * pg_cron job `payouts-weekly-draft` (hourly check, builds at the configured Lagos weekday and hour).
--
-- Counts before this migration (live, 2026-10-06): earnings_ledger has 0 lines and no fee schedule is approved, so there is
-- nothing to pay and nothing to convert or backfill. No migration here moves money by itself.

-- ---------------------------------------------------------------------------
-- 1. payouts_config (PROPOSED, mirrored as `payouts.rules`)
-- ---------------------------------------------------------------------------
create table public.payouts_config (
  id             uuid primary key default gen_random_uuid(),
  version        integer not null unique,
  is_active      boolean not null default false,
  effective_from date not null,
  rules          jsonb not null,
  created_at     timestamptz not null default now()
);
create unique index payouts_config_one_active on public.payouts_config (is_active) where is_active;

-- payouts-rules-begin
insert into public.payouts_config (version, is_active, effective_from, rules) values (1, true, '2026-10-06', $json$
{
  "cadence": { "weekday": 1, "hour_lagos": 6 },
  "minimum_payout_kobo": 100000,
  "carry_over_below_minimum": true
}
$json$::jsonb);
-- payouts-rules-end

create function private.payouts_setting(p_key text) returns jsonb
language sql stable security definer set search_path = ''
as $$ select rules -> p_key from public.payouts_config where is_active; $$;
revoke all on function private.payouts_setting(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Name matching (bank name against the credentialed name)
-- ---------------------------------------------------------------------------
create function private.payout_tokens(p_name text) returns text[]
language sql immutable set search_path = ''
as $$
  select coalesce(array_agg(t order by t), '{}')
    from (select distinct t from regexp_split_to_table(
            btrim(regexp_replace(lower(coalesce(p_name, '')), '[^a-z ]', ' ', 'g')), '\s+') as t
           where t <> '' and t not in ('dr', 'mr', 'mrs', 'ms', 'miss', 'prof', 'engr', 'chief', 'alhaji', 'alhaja')) s;
$$;

-- Every real name part of the credentialed name must appear in the bank's name (order and extra middle names are fine; a single
-- letter matches an initial). At least two parts are needed on the credentialed side, so a one-word name never matches.
create function private.payout_names_match(p_verified text, p_resolved text) returns boolean
language plpgsql immutable set search_path = ''
as $$
declare
  v text[] := private.payout_tokens(p_verified);
  r text[] := private.payout_tokens(p_resolved);
  t text;
begin
  if coalesce(array_length(v, 1), 0) < 2 or coalesce(array_length(r, 1), 0) < 2 then return false; end if;
  foreach t in array v loop
    if length(t) = 1 then
      if not exists (select 1 from unnest(r) x where left(x, 1) = t) then return false; end if;
    elsif not (t = any (r)) then
      return false;
    end if;
  end loop;
  return true;
end;
$$;
revoke all on function private.payout_tokens(text), private.payout_names_match(text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Tables
-- ---------------------------------------------------------------------------
create table public.clinician_bank_accounts (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete restrict,
  clinician_id     uuid not null references public.profiles (id) on delete restrict,
  bank_code        text not null check (bank_code ~ '^\d{3,6}$'),
  bank_name        text not null,
  account_last4    text not null check (account_last4 ~ '^\d{4}$'),
  resolved_name    text not null,
  verified_name    text not null,                -- the credentialed name it was compared with, kept as evidence
  name_match       text not null check (name_match in ('verified', 'mismatch')),
  recipient_code   text,
  bank_verified_at timestamptz,
  superseded_at    timestamptz,
  is_test          boolean not null default false,
  created_at       timestamptz not null default now(),
  check (bank_verified_at is null or (name_match = 'verified' and recipient_code is not null))
);
-- Only one VERIFIED current account: a failed or mismatched attempt never displaces the one that works.
create unique index clinician_bank_accounts_one_current on public.clinician_bank_accounts (clinician_id) where superseded_at is null and bank_verified_at is not null;
comment on table public.clinician_bank_accounts is
  'S31: where a contracted clinician is paid. Only the last four digits and the Paystack recipient code are kept. bank_verified_at needs the bank-returned name to match the credentialed name (spec 7.7).';

create table public.clinician_tax_profiles (
  clinician_id     uuid primary key references public.profiles (id) on delete restrict,
  organisation_id  uuid not null references public.organisations (id) on delete restrict,
  tin              text check (tin is null or tin ~ '^[0-9A-Za-z-]{6,20}$'),
  contractor_status text not null default 'unknown' check (contractor_status in ('unknown', 'individual', 'company')),
  registered_name  text,
  vat_registered   boolean not null default false,
  note             text,
  updated_at       timestamptz not null default now()
);
comment on table public.clinician_tax_profiles is
  'S31 / D-09: data needed for withholding tax reporting. Stored only. No rate, no deduction, no calculation anywhere (OQ-193).';

create table public.payouts (
  id                 uuid primary key default gen_random_uuid(),
  organisation_id    uuid not null references public.organisations (id) on delete restrict,
  clinician_id       uuid not null references public.profiles (id) on delete restrict,
  period_start       date not null,
  period_end         date not null check (period_end >= period_start),
  amount_kobo        bigint not null check (amount_kobo > 0),
  line_count         integer not null check (line_count > 0),
  state              text not null default 'draft' check (state in ('draft', 'approved', 'sent', 'succeeded', 'failed', 'reversed', 'cancelled')),
  bank_account_id    uuid references public.clinician_bank_accounts (id) on delete restrict,
  recipient_code     text,
  payouts_config_id  uuid not null references public.payouts_config (id) on delete restrict,   -- INV-16
  paystack_transfer_code text,
  approved_by        uuid references public.profiles (id) on delete restrict,
  approved_at        timestamptz,
  failure_reason     text,
  is_test            boolean not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  check (state in ('draft', 'cancelled') or (approved_by is not null and approved_at is not null and recipient_code is not null)),
  check (approved_by is null or approved_by <> clinician_id),
  check (is_test = false)                                                                     -- INV-13: a test account is never paid
);
create unique index payouts_one_per_period on public.payouts (clinician_id, period_end) where state <> 'cancelled';
create index payouts_state_idx on public.payouts (organisation_id, state, created_at desc);
comment on table public.payouts is
  'S31: one weekly payout per contracted clinician (spec 7.7). Lines are linked at approval only. State changes only through the payout functions.';

create table public.payout_transfers (
  id                     uuid primary key default gen_random_uuid(),
  payout_id              uuid not null references public.payouts (id) on delete restrict,
  attempt                integer not null check (attempt >= 1),
  reference              text not null unique check (reference ~ '^[a-z0-9_-]{16,50}$'),
  state                  text not null default 'pending' check (state in ('pending', 'sent', 'success', 'failed', 'reversed', 'needs_attention')),
  paystack_transfer_code text,
  reason                 text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (payout_id, attempt)
);

create table public.payout_events (
  id              bigint generated always as identity primary key,
  payout_id       uuid not null references public.payouts (id) on delete restrict,
  from_state      text,
  to_state        text not null,
  actor_id        uuid,
  source          text not null check (source in ('system', 'admin', 'webhook', 'edge')),
  detail          text,
  created_at      timestamptz not null default now()
);

-- Direct writes to payouts and its children are refused unless a payout function set the flag; deletes never.
create function private.guard_payout_tables() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'DELETE' or tg_op = 'TRUNCATE' then
    raise exception '% is never deleted', tg_table_name using errcode = '42501';
  end if;
  if tg_table_name = 'payout_events' then
    if tg_op = 'UPDATE' then raise exception 'payout_events is append only' using errcode = '42501'; end if;
    return new;
  end if;
  if coalesce(current_setting('tarragon.payout_write', true), '') <> 'on' then
    raise exception '% is written only by the payout functions', tg_table_name using errcode = '42501';
  end if;
  if tg_table_name = 'payouts' and tg_op = 'UPDATE' then
    if (old.state, new.state) not in (
         ('draft', 'draft'), ('draft', 'approved'), ('draft', 'cancelled'),
         ('approved', 'approved'), ('approved', 'sent'), ('approved', 'succeeded'), ('approved', 'failed'), ('approved', 'reversed'),
         ('sent', 'sent'), ('sent', 'succeeded'), ('sent', 'failed'), ('sent', 'reversed'),
         ('succeeded', 'succeeded'), ('succeeded', 'reversed'),
         ('failed', 'failed'), ('failed', 'approved'),
         ('reversed', 'reversed'), ('reversed', 'approved'),
         ('cancelled', 'cancelled')) then
      raise exception 'a payout cannot move from % to %', old.state, new.state using errcode = '23514';
    end if;
    if old.amount_kobo <> new.amount_kobo and old.state <> 'draft' then
      raise exception 'the amount of a payout never changes after approval' using errcode = '23514';
    end if;
    new.updated_at := now();
  end if;
  return new;
end;
$$;
revoke all on function private.guard_payout_tables() from public, anon, authenticated;
create trigger payouts_guard before insert or update or delete on public.payouts for each row execute function private.guard_payout_tables();
create trigger payout_transfers_guard before insert or update or delete on public.payout_transfers for each row execute function private.guard_payout_tables();
create trigger payout_events_guard before update or delete on public.payout_events for each row execute function private.guard_payout_tables();
create trigger clinician_bank_accounts_guard before insert or update or delete on public.clinician_bank_accounts for each row execute function private.guard_payout_tables();
create trigger payouts_no_truncate before truncate on public.payouts for each statement execute function private.guard_payout_tables();
create trigger payout_events_no_truncate before truncate on public.payout_events for each statement execute function private.guard_payout_tables();

-- ---------------------------------------------------------------------------
-- 4. Helpers
-- ---------------------------------------------------------------------------
create function private.payout_admin_org() returns uuid
language plpgsql stable security definer set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not private.is_admin() then raise exception 'payout_not_authorised' using errcode = '42501'; end if;
  return private.caller_org();
end;
$$;
revoke all on function private.payout_admin_org() from public, anon, authenticated;

create function private.payout_event(p_payout uuid, p_from text, p_to text, p_actor uuid, p_source text, p_detail text default null) returns void
language sql security definer set search_path = ''
as $$ insert into public.payout_events (payout_id, from_state, to_state, actor_id, source, detail) values (p_payout, p_from, p_to, p_actor, p_source, p_detail); $$;
revoke all on function private.payout_event(uuid, text, text, uuid, text, text) from public, anon, authenticated;

create function private.payout_cutoff(p_period_end date) returns timestamptz
language sql immutable set search_path = ''
as $$ select ((p_period_end + 1)::timestamp at time zone 'Africa/Lagos'); $$;
revoke all on function private.payout_cutoff(date) from public, anon, authenticated;

create function private.payout_notify(p_payout public.payouts, p_subject text, p_message text) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.credential_notify(p_payout.clinician_id, p_payout.organisation_id, p_subject, p_message,
    jsonb_build_object('payout_id', p_payout.id), false);
exception when others then
  null;   -- a notice never blocks a money state change
end;
$$;
revoke all on function private.payout_notify(public.payouts, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Weekly draft builder
-- ---------------------------------------------------------------------------
-- p_period_end is a Lagos date (a Sunday for the weekly job). p_force replaces a draft that already exists for the same period.
create function private.build_payout_drafts(p_org uuid, p_period_end date, p_force boolean default false) returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_cfg uuid;
  v_min bigint := coalesce((private.payouts_setting('minimum_payout_kobo'))::bigint, 0);
  v_cutoff timestamptz := private.payout_cutoff(p_period_end);
  v_built integer := 0;
  r record;
  v_id uuid;
begin
  select id into v_cfg from public.payouts_config where is_active;
  if v_cfg is null then raise exception 'payouts_config_missing' using errcode = '55000'; end if;
  perform set_config('tarragon.payout_write', 'on', true);
  for r in
    select l.clinician_id, sum(l.amount_kobo)::bigint as total, count(*)::integer as n, min(l.earned_at) as first_at
      from public.earnings_ledger l
      join public.profiles p on p.id = l.clinician_id
      join public.clinical_staff cs on cs.profile_id = l.clinician_id and cs.employment_type::text = 'contracted'
     where l.organisation_id = p_org and l.payout_id is null and not l.is_test and not p.is_test and not cs.is_test
       and l.earned_at < v_cutoff
     group by l.clinician_id
  loop
    if r.total <= 0 or r.total < v_min then continue; end if;   -- carried over to a later week
    if exists (select 1 from public.payouts where clinician_id = r.clinician_id and period_end = p_period_end and state <> 'cancelled') then
      if not p_force then continue; end if;
      if exists (select 1 from public.payouts where clinician_id = r.clinician_id and period_end = p_period_end and state <> 'draft' and state <> 'cancelled') then continue; end if;
    end if;
    update public.payouts set state = 'cancelled', failure_reason = 'replaced by a newer draft'
     where clinician_id = r.clinician_id and state = 'draft';
    insert into public.payouts (organisation_id, clinician_id, period_start, period_end, amount_kobo, line_count, state, payouts_config_id)
    values (p_org, r.clinician_id, (r.first_at at time zone 'Africa/Lagos')::date, p_period_end, r.total, r.n, 'draft', v_cfg)
    returning id into v_id;
    perform private.payout_event(v_id, null, 'draft', null, 'system', 'weekly draft');
    v_built := v_built + 1;
  end loop;
  perform set_config('tarragon.payout_write', 'off', true);
  return v_built;
end;
$$;
revoke all on function private.build_payout_drafts(uuid, date, boolean) from public, anon, authenticated;

-- The last full Lagos week ends on the most recent Sunday before today.
create function private.payout_last_period_end(p_now timestamptz default now()) returns date
language sql stable set search_path = ''
as $$ select ((p_now at time zone 'Africa/Lagos')::date - (extract(isodow from (p_now at time zone 'Africa/Lagos'))::int))::date; $$;
revoke all on function private.payout_last_period_end(timestamptz) from public, anon, authenticated;

create function private.payout_weekly_job() returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_local timestamp := (now() at time zone 'Africa/Lagos');
  v_cadence jsonb := private.payouts_setting('cadence');
  v_total integer := 0;
  o record;
begin
  if extract(isodow from v_local)::int <> coalesce((v_cadence ->> 'weekday')::int, 1)
     or extract(hour from v_local)::int <> coalesce((v_cadence ->> 'hour_lagos')::int, 6) then
    return 0;
  end if;
  for o in select distinct organisation_id from public.earnings_ledger where payout_id is null and not is_test loop
    v_total := v_total + private.build_payout_drafts(o.organisation_id, private.payout_last_period_end(), false);
  end loop;
  return v_total;
end;
$$;
revoke all on function private.payout_weekly_job() from public, anon, authenticated;
select cron.schedule('payouts-weekly-draft', '5 * * * *', $$ select private.payout_weekly_job(); $$);

create function public.build_payout_drafts_now(p_force boolean default false) returns integer
language plpgsql security definer set search_path = ''
as $$
declare v_org uuid := private.payout_admin_org();
begin
  return private.build_payout_drafts(v_org, private.payout_last_period_end(), p_force);
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Approve, discard, send, retry
-- ---------------------------------------------------------------------------
create function private.payout_ready(p_clinician uuid) returns public.clinician_bank_accounts
language sql stable security definer set search_path = ''
as $$
  select b.* from public.clinician_bank_accounts b
   where b.clinician_id = p_clinician and b.superseded_at is null and b.bank_verified_at is not null and b.recipient_code is not null;
$$;
revoke all on function private.payout_ready(uuid) from public, anon, authenticated;

create function private.payout_reference(p_payout uuid, p_attempt integer) returns text
language sql immutable set search_path = ''
as $$ select 'tpo-' || replace(p_payout::text, '-', '') || '-' || lpad(p_attempt::text, 2, '0'); $$;
revoke all on function private.payout_reference(uuid, integer) from public, anon, authenticated;

create function public.approve_payout(p_id uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_org uuid := private.payout_admin_org();
  v_uid uuid := (select auth.uid());
  p public.payouts%rowtype;
  b public.clinician_bank_accounts%rowtype;
  v_sum bigint;
  v_n integer;
  v_linked integer;
begin
  if not private.go_live_guard_on('payouts_enabled') then raise exception 'payout_guard_off' using errcode = '55000'; end if;
  select * into p from public.payouts where id = p_id and organisation_id = v_org for update;
  if not found then raise exception 'payout_unknown' using errcode = '22023'; end if;
  if p.state <> 'draft' then raise exception 'payout_not_a_draft' using errcode = '23514'; end if;
  if p.clinician_id = v_uid then raise exception 'payout_self_approval' using errcode = '42501'; end if;
  b := private.payout_ready(p.clinician_id);
  if b.id is null then raise exception 'payout_no_verified_bank' using errcode = '55000'; end if;
  -- The ledger is read again now. If it is not exactly what the draft showed, nothing is approved.
  select coalesce(sum(l.amount_kobo), 0)::bigint, count(*)::integer into v_sum, v_n
    from public.earnings_ledger l
   where l.clinician_id = p.clinician_id and l.organisation_id = p.organisation_id and l.payout_id is null and not l.is_test
     and l.earned_at < private.payout_cutoff(p.period_end);
  if v_sum <> p.amount_kobo or v_n <> p.line_count then raise exception 'payout_ledger_changed' using errcode = '55000'; end if;
  perform set_config('tarragon.payout_write', 'on', true);
  update public.payouts set state = 'approved', approved_by = v_uid, approved_at = now(), bank_account_id = b.id, recipient_code = b.recipient_code where id = p.id;
  perform set_config('tarragon.earnings_payout_link', 'on', true);
  update public.earnings_ledger set payout_id = p.id
   where clinician_id = p.clinician_id and organisation_id = p.organisation_id and payout_id is null and not is_test
     and earned_at < private.payout_cutoff(p.period_end);
  get diagnostics v_linked = row_count;
  perform set_config('tarragon.earnings_payout_link', 'off', true);
  if v_linked <> v_n then raise exception 'payout_link_mismatch' using errcode = '55000'; end if;
  insert into public.payout_transfers (payout_id, attempt, reference) values (p.id, 1, private.payout_reference(p.id, 1));
  perform private.payout_event(p.id, 'draft', 'approved', v_uid, 'admin', null);
  perform set_config('tarragon.payout_write', 'off', true);
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (v_org, v_uid, 'payout.approved', 'payout', p.id, jsonb_build_object('amount_kobo', p.amount_kobo, 'lines', v_n));
  return jsonb_build_object('payout_id', p.id, 'reference', private.payout_reference(p.id, 1), 'amount_kobo', p.amount_kobo);
end;
$$;

create function public.discard_payout_draft(p_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_org uuid := private.payout_admin_org(); p public.payouts%rowtype;
begin
  select * into p from public.payouts where id = p_id and organisation_id = v_org for update;
  if not found then raise exception 'payout_unknown' using errcode = '22023'; end if;
  if p.state <> 'draft' then raise exception 'payout_not_a_draft' using errcode = '23514'; end if;
  perform set_config('tarragon.payout_write', 'on', true);
  update public.payouts set state = 'cancelled', failure_reason = 'discarded by an admin' where id = p.id;
  perform private.payout_event(p.id, 'draft', 'cancelled', (select auth.uid()), 'admin', null);
  perform set_config('tarragon.payout_write', 'off', true);
end;
$$;

-- Step 1 of sending, run as the admin: checks everything and hands back what the edge function must send.
create function public.payout_prepare_send(p_id uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_org uuid := private.payout_admin_org();
  p public.payouts%rowtype;
  t public.payout_transfers%rowtype;
begin
  if not private.go_live_guard_on('payouts_enabled') then raise exception 'payout_guard_off' using errcode = '55000'; end if;
  select * into p from public.payouts where id = p_id and organisation_id = v_org for update;
  if not found then raise exception 'payout_unknown' using errcode = '22023'; end if;
  if p.state not in ('approved', 'sent') then raise exception 'payout_not_approved' using errcode = '23514'; end if;
  if p.is_test or exists (select 1 from public.profiles where id = p.clinician_id and is_test) then raise exception 'payout_test_account' using errcode = '55000'; end if;
  select * into t from public.payout_transfers where payout_id = p.id order by attempt desc limit 1;
  if t.state in ('success') then raise exception 'payout_already_paid' using errcode = '23514'; end if;
  return jsonb_build_object('payout_id', p.id, 'reference', t.reference, 'amount_kobo', p.amount_kobo, 'recipient_code', p.recipient_code,
    'reason', 'Tarragon weekly payout ' || to_char(p.period_end, 'YYYY-MM-DD'));
end;
$$;

-- Step 2, run with the service key by the edge function after Paystack answered.
create function public.payout_record_send(p_reference text, p_status text, p_transfer_code text, p_error text default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare t public.payout_transfers%rowtype; p public.payouts%rowtype;
begin
  select * into t from public.payout_transfers where reference = p_reference for update;
  if not found then raise exception 'payout_unknown_reference' using errcode = '22023'; end if;
  select * into p from public.payouts where id = t.payout_id for update;
  perform set_config('tarragon.payout_write', 'on', true);
  if p_status in ('pending', 'success') then
    update public.payout_transfers set state = case when t.state = 'success' then t.state else 'sent' end,
      paystack_transfer_code = coalesce(p_transfer_code, paystack_transfer_code), updated_at = now() where id = t.id;
    if p.state = 'approved' then
      update public.payouts set state = 'sent', paystack_transfer_code = coalesce(p_transfer_code, paystack_transfer_code) where id = p.id;
      perform private.payout_event(p.id, 'approved', 'sent', null, 'edge', null);
    end if;
  elsif p_status = 'needs_attention' then
    update public.payout_transfers set state = 'needs_attention', reason = left(p_error, 300), paystack_transfer_code = coalesce(p_transfer_code, paystack_transfer_code), updated_at = now() where id = t.id;
    perform private.payout_event(p.id, p.state, p.state, null, 'edge', 'needs attention: ' || coalesce(left(p_error, 200), ''));
  else
    -- Paystack refused the request (or we could not reach it). The payout stays approved so the same reference can be tried again.
    update public.payout_transfers set reason = left(p_error, 300), updated_at = now() where id = t.id;
    perform private.payout_event(p.id, p.state, p.state, null, 'edge', 'send did not go through: ' || coalesce(left(p_error, 200), ''));
  end if;
  perform set_config('tarragon.payout_write', 'off', true);
  return jsonb_build_object('payout_id', p.id, 'state', (select state from public.payouts where id = p.id));
end;
$$;

create function public.retry_payout(p_id uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_org uuid := private.payout_admin_org();
  p public.payouts%rowtype;
  b public.clinician_bank_accounts%rowtype;
  v_attempt integer;
begin
  if not private.go_live_guard_on('payouts_enabled') then raise exception 'payout_guard_off' using errcode = '55000'; end if;
  select * into p from public.payouts where id = p_id and organisation_id = v_org for update;
  if not found then raise exception 'payout_unknown' using errcode = '22023'; end if;
  if p.state not in ('failed', 'reversed') then raise exception 'payout_not_retryable' using errcode = '23514'; end if;
  b := private.payout_ready(p.clinician_id);
  if b.id is null then raise exception 'payout_no_verified_bank' using errcode = '55000'; end if;
  select coalesce(max(attempt), 0) + 1 into v_attempt from public.payout_transfers where payout_id = p.id;
  perform set_config('tarragon.payout_write', 'on', true);
  update public.payouts set state = 'approved', bank_account_id = b.id, recipient_code = b.recipient_code, failure_reason = null where id = p.id;
  insert into public.payout_transfers (payout_id, attempt, reference) values (p.id, v_attempt, private.payout_reference(p.id, v_attempt));
  perform private.payout_event(p.id, p.state, 'approved', (select auth.uid()), 'admin', 'retry, attempt ' || v_attempt);
  perform set_config('tarragon.payout_write', 'off', true);
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (v_org, (select auth.uid()), 'payout.retried', 'payout', p.id, jsonb_build_object('attempt', v_attempt));
  return jsonb_build_object('payout_id', p.id, 'reference', private.payout_reference(p.id, v_attempt));
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. The webhook handler (service role). Idempotent, order tolerant, never invents state.
-- ---------------------------------------------------------------------------
create function public.apply_payout_transfer_event(p_event text, p_reference text, p_transfer_code text, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  t public.payout_transfers%rowtype;
  p public.payouts%rowtype;
  v_to text;
  v_tstate text;
  v_current boolean;
begin
  v_to := case p_event when 'transfer.success' then 'succeeded' when 'transfer.failed' then 'failed' when 'transfer.reversed' then 'reversed' else null end;
  if v_to is null then return jsonb_build_object('result', 'ignored_event'); end if;
  select * into t from public.payout_transfers where reference = p_reference for update;
  if not found then return jsonb_build_object('result', 'not_ours'); end if;
  select * into p from public.payouts where id = t.payout_id for update;
  v_tstate := case v_to when 'succeeded' then 'success' else v_to end;
  v_current := t.attempt = (select max(attempt) from public.payout_transfers where payout_id = p.id);
  perform set_config('tarragon.payout_write', 'on', true);
  update public.payout_transfers set state = v_tstate, paystack_transfer_code = coalesce(p_transfer_code, paystack_transfer_code),
    reason = coalesce(left(p_reason, 300), reason), updated_at = now() where id = t.id;
  if not v_current then
    perform private.payout_event(p.id, p.state, p.state, null, 'webhook', 'older attempt ' || t.attempt || ': ' || p_event);
    perform set_config('tarragon.payout_write', 'off', true);
    return jsonb_build_object('result', 'older_attempt');
  end if;
  if p.state = v_to then
    perform set_config('tarragon.payout_write', 'off', true);
    return jsonb_build_object('result', 'duplicate');
  end if;
  if (p.state, v_to) in (('approved', 'succeeded'), ('sent', 'succeeded'), ('succeeded', 'reversed'),
                         ('approved', 'failed'), ('sent', 'failed'), ('approved', 'reversed'), ('sent', 'reversed')) then
    update public.payouts set state = v_to, paystack_transfer_code = coalesce(p_transfer_code, paystack_transfer_code),
      failure_reason = case when v_to = 'succeeded' then null else left(coalesce(p_reason, p_event), 300) end where id = p.id;
    perform private.payout_event(p.id, p.state, v_to, null, 'webhook', p_event);
    perform set_config('tarragon.payout_write', 'off', true);
    if v_to = 'succeeded' then
      perform private.payout_notify(p, 'Your payout has been sent', 'Your weekly payout is on its way to your bank account. The statement is under Earnings in your console.');
    else
      perform private.payout_notify(p, 'Your payout needs attention', 'We could not complete your weekly payout. The finance team has been told and will sort it out; there is nothing for you to do.');
    end if;
    return jsonb_build_object('result', 'applied', 'state', v_to);
  end if;
  -- An event that does not fit the state (a success after a failure, for example) is recorded and left for a person.
  perform private.payout_event(p.id, p.state, p.state, null, 'webhook', 'out of order, ignored: ' || p_event);
  perform set_config('tarragon.payout_write', 'off', true);
  return jsonb_build_object('result', 'out_of_order');
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Bank verification (service role writes; the edge function calls Paystack)
-- ---------------------------------------------------------------------------
create function public.record_bank_resolution(p_clinician uuid, p_bank_code text, p_bank_name text, p_last4 text, p_resolved_name text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  cs public.clinical_staff%rowtype;
  v_match boolean;
  v_id uuid;
begin
  select * into cs from public.clinical_staff where profile_id = p_clinician and active and employment_type::text = 'contracted';
  if not found then raise exception 'bank_not_a_contracted_clinician' using errcode = '22023'; end if;
  v_match := private.payout_names_match(cs.full_name, p_resolved_name);
  perform set_config('tarragon.payout_write', 'on', true);
  update public.clinician_bank_accounts set superseded_at = now() where clinician_id = p_clinician and superseded_at is null and bank_verified_at is null;
  insert into public.clinician_bank_accounts (organisation_id, clinician_id, bank_code, bank_name, account_last4, resolved_name, verified_name, name_match, is_test)
  values (cs.organisation_id, p_clinician, p_bank_code, p_bank_name, p_last4, p_resolved_name, cs.full_name,
          case when v_match then 'verified' else 'mismatch' end, cs.is_test)
  returning id into v_id;
  perform set_config('tarragon.payout_write', 'off', true);
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (cs.organisation_id, p_clinician, 'bank_account.resolved', 'clinician_bank_account', v_id, jsonb_build_object('name_match', v_match, 'bank_code', p_bank_code));
  return jsonb_build_object('id', v_id, 'name_match', case when v_match then 'verified' else 'mismatch' end);
end;
$$;

create function public.attach_bank_recipient(p_account uuid, p_recipient_code text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare b public.clinician_bank_accounts%rowtype;
begin
  select * into b from public.clinician_bank_accounts where id = p_account for update;
  if not found or b.superseded_at is not null then raise exception 'bank_unknown_account' using errcode = '22023'; end if;
  if b.name_match <> 'verified' then raise exception 'bank_name_does_not_match' using errcode = '23514'; end if;
  if p_recipient_code is null or length(btrim(p_recipient_code)) < 4 then raise exception 'bank_recipient_missing' using errcode = '22023'; end if;
  perform set_config('tarragon.payout_write', 'on', true);
  update public.clinician_bank_accounts set superseded_at = now() where clinician_id = b.clinician_id and id <> b.id and superseded_at is null and bank_verified_at is not null;
  update public.clinician_bank_accounts set recipient_code = btrim(p_recipient_code), bank_verified_at = now() where id = b.id;
  perform set_config('tarragon.payout_write', 'off', true);
  return jsonb_build_object('id', b.id, 'bank_verified_at', now());
end;
$$;

-- Run as the clinician BEFORE the edge function asks Paystack who owns an account number: only a contracted clinician may look
-- an account up, and only a few times a day, so the lookup cannot be used to learn the owner of arbitrary account numbers.
create function public.payout_bank_check_allowed() returns void
language plpgsql security definer set search_path = ''
as $$
declare v_org uuid := private.my_contracted_org(); v_uid uuid := (select auth.uid());
begin
  if v_org is null then raise exception 'payout_not_a_contracted_clinician' using errcode = '42501'; end if;
  if (select count(*) from public.audit_log where actor_id = v_uid and action = 'bank_account.lookup' and created_at > now() - interval '24 hours') >= 10 then
    raise exception 'payout_bank_too_many_lookups' using errcode = '54000';
  end if;
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (v_org, v_uid, 'bank_account.lookup', 'clinician_bank_account', v_uid, '{}'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. Tax data (D-09) and reads
-- ---------------------------------------------------------------------------
create function public.save_my_tax_profile(p_tin text, p_status text, p_registered_name text, p_vat boolean, p_note text default null) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_org uuid := private.my_contracted_org(); v_uid uuid := (select auth.uid());
begin
  if v_org is null then raise exception 'tax_not_a_contracted_clinician' using errcode = '42501'; end if;
  insert into public.clinician_tax_profiles (clinician_id, organisation_id, tin, contractor_status, registered_name, vat_registered, note, updated_at)
  values (v_uid, v_org, nullif(btrim(p_tin), ''), coalesce(p_status, 'unknown'), nullif(btrim(p_registered_name), ''), coalesce(p_vat, false), nullif(btrim(p_note), ''), now())
  on conflict (clinician_id) do update set tin = excluded.tin, contractor_status = excluded.contractor_status, registered_name = excluded.registered_name,
    vat_registered = excluded.vat_registered, note = excluded.note, updated_at = now();
end;
$$;

create function public.my_payout_overview() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_uid uuid := (select auth.uid());
begin
  if private.my_contracted_org() is null then raise exception 'payout_not_a_contracted_clinician' using errcode = '42501'; end if;
  return jsonb_build_object(
    'bank', (select jsonb_build_object('bank_name', b.bank_name, 'account_last4', b.account_last4, 'resolved_name', b.resolved_name,
                'name_match', b.name_match, 'verified', b.bank_verified_at is not null, 'bank_verified_at', b.bank_verified_at)
               from public.clinician_bank_accounts b where b.clinician_id = v_uid and b.superseded_at is null order by (b.bank_verified_at is not null) desc, b.created_at desc limit 1),
    'tax', (select to_jsonb(t) - 'organisation_id' from public.clinician_tax_profiles t where t.clinician_id = v_uid),
    'payouts', coalesce((select jsonb_agg(jsonb_build_object(
        'id', p.id, 'period_start', p.period_start, 'period_end', p.period_end, 'amount_kobo', p.amount_kobo, 'line_count', p.line_count,
        'state', p.state, 'approved_at', p.approved_at,
        'reference', (select t.reference from public.payout_transfers t where t.payout_id = p.id order by t.attempt desc limit 1),
        'lines', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'kind', l.kind, 'earned_at', l.earned_at, 'amount_kobo', l.amount_kobo,
                   'task_type', l.calculation ->> 'task_type') order by l.earned_at)
                   from public.earnings_ledger l where l.payout_id = p.id), '[]'::jsonb)) order by p.period_end desc)
        from public.payouts p where p.clinician_id = v_uid and p.state not in ('draft', 'cancelled')), '[]'::jsonb),
    'next_payout_kobo', coalesce((select sum(l.amount_kobo) from public.earnings_ledger l where l.clinician_id = v_uid and l.payout_id is null and not l.is_test), 0),
    'minimum_payout_kobo', private.payouts_setting('minimum_payout_kobo'));
end;
$$;

create function public.list_payouts(p_state text default null) returns table (
  id uuid, clinician_id uuid, clinician_name text, period_start date, period_end date, amount_kobo bigint, line_count integer, state text,
  approved_at timestamptz, failure_reason text, bank_ready boolean, reference text, created_at timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
declare v_org uuid := private.payout_admin_org();
begin
  return query
    select p.id, p.clinician_id, (select cs.full_name from public.clinical_staff cs where cs.profile_id = p.clinician_id), p.period_start, p.period_end,
           p.amount_kobo, p.line_count, p.state, p.approved_at, p.failure_reason,
           (private.payout_ready(p.clinician_id)).id is not null,
           (select t.reference from public.payout_transfers t where t.payout_id = p.id order by t.attempt desc limit 1), p.created_at
      from public.payouts p
     where p.organisation_id = v_org and (p_state is null or p.state = p_state)
     order by p.created_at desc limit 200;
end;
$$;

-- ---------------------------------------------------------------------------
-- 10. RLS and grants
-- ---------------------------------------------------------------------------
alter table public.payouts_config enable row level security;
alter table public.clinician_bank_accounts enable row level security;
alter table public.clinician_tax_profiles enable row level security;
alter table public.payouts enable row level security;
alter table public.payout_transfers enable row level security;
alter table public.payout_events enable row level security;

create policy payouts_config_select on public.payouts_config for select to authenticated using (private.is_admin());
create policy bank_accounts_select on public.clinician_bank_accounts for select to authenticated
  using (clinician_id = (select auth.uid()) or (private.is_admin() and organisation_id = private.caller_org()));
create policy tax_profiles_select on public.clinician_tax_profiles for select to authenticated
  using (clinician_id = (select auth.uid()) or (private.is_admin() and organisation_id = private.caller_org()));
create policy payouts_select on public.payouts for select to authenticated
  using (clinician_id = (select auth.uid()) or (private.is_admin() and organisation_id = private.caller_org()));
create policy payout_transfers_select on public.payout_transfers for select to authenticated
  using (exists (select 1 from public.payouts p where p.id = payout_id and (p.clinician_id = (select auth.uid()) or (private.is_admin() and p.organisation_id = private.caller_org()))));
create policy payout_events_select on public.payout_events for select to authenticated
  using (private.is_admin() and exists (select 1 from public.payouts p where p.id = payout_id and p.organisation_id = private.caller_org()));

revoke all on public.payouts_config, public.clinician_bank_accounts, public.clinician_tax_profiles, public.payouts, public.payout_transfers, public.payout_events
  from anon, public, authenticated;
grant select on public.payouts_config, public.clinician_bank_accounts, public.clinician_tax_profiles, public.payouts, public.payout_transfers, public.payout_events to authenticated;

revoke all on function
  public.build_payout_drafts_now(boolean), public.approve_payout(uuid), public.discard_payout_draft(uuid), public.payout_prepare_send(uuid),
  public.retry_payout(uuid), public.list_payouts(text), public.save_my_tax_profile(text, text, text, boolean, text), public.my_payout_overview(),
  public.payout_bank_check_allowed(),
  public.payout_record_send(text, text, text, text), public.apply_payout_transfer_event(text, text, text, text),
  public.record_bank_resolution(uuid, text, text, text, text), public.attach_bank_recipient(uuid, text)
  from public, anon, authenticated;
grant execute on function
  public.build_payout_drafts_now(boolean), public.approve_payout(uuid), public.discard_payout_draft(uuid), public.payout_prepare_send(uuid),
  public.retry_payout(uuid), public.list_payouts(text), public.save_my_tax_profile(text, text, text, boolean, text), public.my_payout_overview(),
  public.payout_bank_check_allowed()
  to authenticated;
grant execute on function
  public.payout_record_send(text, text, text, text), public.apply_payout_transfer_event(text, text, text, text),
  public.record_bank_resolution(uuid, text, text, text, text), public.attach_bank_recipient(uuid, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- 11. Self-check (the migration fails if any of this is wrong)
-- ---------------------------------------------------------------------------
do $$
declare v_fn text;
begin
  foreach v_fn in array array['public.build_payout_drafts_now(boolean)', 'public.approve_payout(uuid)', 'public.discard_payout_draft(uuid)',
    'public.payout_prepare_send(uuid)', 'public.retry_payout(uuid)', 'public.list_payouts(text)', 'public.save_my_tax_profile(text,text,text,boolean,text)',
    'public.my_payout_overview()', 'public.payout_bank_check_allowed()'] loop
    if has_function_privilege('anon', v_fn, 'EXECUTE') then raise exception 'S31 assertion: anon can execute %', v_fn; end if;
    if not has_function_privilege('authenticated', v_fn, 'EXECUTE') then raise exception 'S31 assertion: authenticated cannot execute %', v_fn; end if;
  end loop;
  foreach v_fn in array array['public.payout_record_send(text,text,text,text)', 'public.apply_payout_transfer_event(text,text,text,text)',
    'public.record_bank_resolution(uuid,text,text,text,text)', 'public.attach_bank_recipient(uuid,text)'] loop
    if has_function_privilege('anon', v_fn, 'EXECUTE') or has_function_privilege('authenticated', v_fn, 'EXECUTE') then
      raise exception 'S31 assertion: % is callable by a client', v_fn;
    end if;
  end loop;
  if not (private.payout_names_match('Dr Ada Okafor', 'OKAFOR ADA CHINWE') and not private.payout_names_match('Ada Okafor', 'Okafor Chidi')
          and not private.payout_names_match('Ada', 'Ada Okafor')) then
    raise exception 'S31 assertion: name matching is wrong';
  end if;
end $$;
