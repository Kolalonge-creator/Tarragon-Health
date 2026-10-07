-- S74 part 2: partner settlement (spec 21.6, decision S74-2 / D11 / OQ-326). Design: docs/design/S74.md.
--
-- WHAT THIS IS, AND WHAT IT IS NOT
--   A monthly statement of what Tarragon owes a PARTNER, computed only from money Tarragon itself collected on a paid order (the S25 `orders` /
--   `payments` rows, INV-09: every payment is a checkout for a specific item). It exists for the two cases the founder named: an item a sponsor paid
--   for and a partner delivered, and any pharmacy margin. Nothing here sends money. No Paystack transfer is called from this migration or from the
--   code that goes with it. A person pays outside the system and records the bank reference; the guard `partner_settlement_enabled` is OFF.
--   * LABORATORIES ARE OWED NOTHING (D-06: the patient pays the laboratory directly). partner_kind on terms and settlements is `pharmacy` or `clinic`;
--     a laboratory value is refused by a CHECK, not by a convention.
--   * STRICTLY SEPARATE FROM S31 CLINICIAN PAYOUTS (earnings_ledger -> payouts, contracted clinicians). The two systems share no row: a payable points at
--     an order, an earnings line points at a task or consultation. A payable is refused for any order that already appears as the reference of an
--     earnings line, and `partner_double_payment_findings()` reports any overlap in either direction, so nothing is paid twice.
--   * Nothing is assumed to exist at launch. Today no order has a delivering partner with an agreed share (OQ-283 hides pharmacy prices, S72 sponsor
--     checkout is not built), so the first run produces no rows. That is the correct result, not a gap to fill with invented terms.
-- Live counts before this migration (2026-10-07): no table with these names existed; public.orders has 0 paid rows with a partner share. Nothing converts.

-- ---------------------------------------------------------------------------
-- 1. Configuration (versioned, PROPOSED, finance owned; mirrored as `partner.settlement` in packages/shared)
-- ---------------------------------------------------------------------------
create table public.partner_settlement_config (
  id             uuid primary key default gen_random_uuid(),
  version        integer not null unique,
  is_active      boolean not null default false,
  effective_from date not null,
  rules          jsonb not null,
  created_at     timestamptz not null default now()
);
create unique index partner_settlement_config_one_active on public.partner_settlement_config (is_active) where is_active;
alter table public.partner_settlement_config enable row level security;
revoke all on public.partner_settlement_config from public, anon, authenticated;

-- partner-settlement-begin
insert into public.partner_settlement_config (version, is_active, effective_from, rules) values (1, true, '2026-10-07', $json$
{
  "period": "calendar_month_lagos",
  "close_after_days": 5,
  "four_eyes": true,
  "source_kinds": ["sponsor_paid_item", "pharmacy_margin"],
  "partner_kinds": ["pharmacy", "clinic"],
  "basis_points_max": 10000,
  "reason_min_chars": 20
}
$json$::jsonb);
-- partner-settlement-end

create function private.partner_settlement_setting(p_key text) returns jsonb
language sql stable security definer set search_path = ''
as $$ select rules -> p_key from public.partner_settlement_config where is_active; $$;
revoke all on function private.partner_settlement_setting(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Events and notices
-- ---------------------------------------------------------------------------
insert into public.event_types (event_type, description, owner_section, is_urgent) values
  ('partner.settlement_due', 'A monthly settlement was built for a partner (an amount Tarragon owes from money it collected); a person issues it', 'S74', false);
insert into public.event_type_versions (event_type, version, required_keys) values
  ('partner.settlement_due', 1, array['settlement_id', 'partner_kind', 'partner_id', 'period_month', 'amount_kobo']);

insert into public.notification_templates (key, category, business_priority, audience, default_channels, timing, description) values
  ('partner_statement_ready', 'operational', 'routine', 'partner', array['in_app']::public.notification_channel[], 'immediate',
   'S74: a new statement is ready in the partner portal. Names no patient, amount or item (INV-07).')
on conflict (key) do nothing;
insert into public.notification_template_locales (template_key, locale, channel, subject, body) values
  ('partner_statement_ready', 'en', 'in_app', 'A new statement is ready', 'A new statement is ready in your partner portal.')
on conflict (template_key, locale, channel) do nothing;

-- ---------------------------------------------------------------------------
-- 3. The go-live guard (INV-14), off. Conditions are read from the data or given by the act of switching; nothing is attested.
--    private.go_live_conditions() is a long function other sessions also replace; this migration renames the live one and puts a thin wrapper in
--    front of it, so it does not copy anyone's body. If a later migration replaces go_live_conditions() whole, this guard fails CLOSED (an unknown
--    guard is never satisfied) until the wrapper is restored.
-- ---------------------------------------------------------------------------
create table public.partner_settlement_terms (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete restrict,
  partner_kind     text not null check (partner_kind in ('pharmacy', 'clinic')),          -- D-06: never 'lab'
  partner_id       uuid not null,
  catalog_item_id  uuid not null references public.catalog_items (id) on delete restrict,
  source_kind      text not null check (source_kind in ('sponsor_paid_item', 'pharmacy_margin')),
  basis            text not null check (basis in ('fixed_kobo', 'basis_points')),
  value            bigint not null check (value > 0),
  sponsor_paid_only boolean not null default true,
  valid_from       timestamptz not null default now(),
  valid_to         timestamptz,
  reason           text not null check (length(btrim(reason)) >= 20),
  created_by       uuid not null references public.profiles (id) on delete restrict,
  approved_by      uuid references public.profiles (id) on delete restrict,
  approved_at      timestamptz,
  is_test          boolean not null default false,
  created_at       timestamptz not null default now(),
  check (basis <> 'basis_points' or value <= 10000),
  check (valid_to is null or valid_to > valid_from),
  check ((approved_by is null) = (approved_at is null))
);
create index partner_settlement_terms_partner_idx on public.partner_settlement_terms (partner_kind, partner_id);
alter table public.partner_settlement_terms enable row level security;
revoke all on public.partner_settlement_terms from public, anon, authenticated;
grant select on public.partner_settlement_terms to authenticated;
create policy partner_settlement_terms_admin_read on public.partner_settlement_terms for select to authenticated
  using (private.is_admin() and organisation_id = private.caller_org());
comment on table public.partner_settlement_terms is
  'S74 (21.6): the agreed share a partner earns on a catalogue item Tarragon collected money for. A row counts only after approval (a second person when four_eyes is on). Only its end can change. No laboratory row can exist (D-06).';

create function private.guard_partner_settlement_terms() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare v_four boolean := coalesce((private.partner_settlement_setting('four_eyes'))::boolean, true);
begin
  if tg_op = 'DELETE' then raise exception 'settlement terms are never deleted' using errcode = '42501'; end if;
  if tg_op = 'INSERT' then
    if new.approved_by is not null then raise exception 'terms are created unapproved' using errcode = '42501'; end if;
    if not private.partner_exists(new.partner_kind, new.partner_id) then raise exception 'partner_not_found' using errcode = '22023'; end if;
    return new;
  end if;
  if (new.organisation_id, new.partner_kind, new.partner_id, new.catalog_item_id, new.source_kind, new.basis, new.value, new.sponsor_paid_only,
      new.valid_from, new.reason, new.created_by)
     is distinct from
     (old.organisation_id, old.partner_kind, old.partner_id, old.catalog_item_id, old.source_kind, old.basis, old.value, old.sponsor_paid_only,
      old.valid_from, old.reason, old.created_by) then
    raise exception 'settlement terms are immutable: end them and write new ones' using errcode = '42501';
  end if;
  if new.approved_by is distinct from old.approved_by then
    if old.approved_by is not null then raise exception 'terms are approved once' using errcode = '42501'; end if;
    if v_four and new.approved_by = old.created_by then raise exception 'four_eyes: a second person approves' using errcode = '42501'; end if;
  end if;
  if new.valid_to is distinct from old.valid_to and old.valid_to is not null then raise exception 'terms already ended' using errcode = '42501'; end if;
  return new;
end $$;
revoke all on function private.guard_partner_settlement_terms() from public, anon, authenticated;
create trigger partner_settlement_terms_guard before insert or update or delete on public.partner_settlement_terms
  for each row execute function private.guard_partner_settlement_terms();

create table public.settlements (
  id                 uuid primary key default gen_random_uuid(),
  organisation_id    uuid not null references public.organisations (id) on delete restrict,
  partner_kind       text not null check (partner_kind in ('pharmacy', 'clinic')),            -- D-06: never 'lab'
  partner_id         uuid not null,
  period_month       date not null check (period_month = date_trunc('month', period_month)::date),
  amount_kobo        bigint not null check (amount_kobo >= 0),
  item_count         integer not null default 0 check (item_count >= 0),
  state              text not null default 'draft' check (state in ('draft', 'issued', 'disputed', 'settled', 'void')),
  config_version     integer not null,
  issued_at          timestamptz,
  issued_by          uuid references public.profiles (id) on delete restrict,
  disputed_at        timestamptz,
  dispute_note       text,
  settled_at         timestamptz,
  settled_by         uuid references public.profiles (id) on delete restrict,
  external_reference text,
  void_reason        text,
  is_test            boolean not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  check (state not in ('issued', 'disputed', 'settled') or (issued_at is not null and issued_by is not null)),
  check (state <> 'settled' or (settled_at is not null and settled_by is not null and length(btrim(coalesce(external_reference, ''))) >= 4)),
  check (state <> 'void' or length(btrim(coalesce(void_reason, ''))) >= 10),
  check (state <> 'disputed' or length(btrim(coalesce(dispute_note, ''))) >= 10)
);
create unique index settlements_one_live_per_partner_period on public.settlements (partner_kind, partner_id, period_month, is_test) where state <> 'void';
create index settlements_state_idx on public.settlements (organisation_id, state, period_month desc);
alter table public.settlements enable row level security;
revoke all on public.settlements from public, anon, authenticated;
grant select on public.settlements to authenticated;
create policy settlements_admin_read on public.settlements for select to authenticated
  using (private.is_admin() and organisation_id = private.caller_org());
comment on table public.settlements is
  'S74 (21.6): what Tarragon owes one partner for one month, from payables only. Integer kobo (INV-15). draft -> issued -> settled (a person records the outside payment reference). Nothing here moves money.';

create table public.partner_payables (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete restrict,
  term_id          uuid not null references public.partner_settlement_terms (id) on delete restrict,
  order_id         uuid not null references public.orders (id) on delete restrict,
  partner_kind     text not null check (partner_kind in ('pharmacy', 'clinic')),
  partner_id       uuid not null,
  source_kind       text not null check (source_kind in ('sponsor_paid_item', 'pharmacy_margin')),
  basis_amount_kobo bigint not null check (basis_amount_kobo > 0),
  amount_kobo      bigint not null check (amount_kobo >= 0),
  period_month     date not null,
  settlement_id    uuid references public.settlements (id) on delete restrict,
  is_test          boolean not null default false,
  created_at       timestamptz not null default now(),
  unique (order_id, term_id)
);
create index partner_payables_period_idx on public.partner_payables (partner_kind, partner_id, period_month);
create index partner_payables_settlement_idx on public.partner_payables (settlement_id) where settlement_id is not null;
alter table public.partner_payables enable row level security;
revoke all on public.partner_payables from public, anon, authenticated;
grant select on public.partner_payables to authenticated;
create policy partner_payables_admin_read on public.partner_payables for select to authenticated
  using (private.is_admin() and organisation_id = private.caller_org());
comment on table public.partner_payables is
  'S74 (21.6): one accrual per (paid order, term): the partner share of money Tarragon collected. Unique per order and term, so a replay of the run cannot accrue twice. Frozen once its settlement is issued.';

-- A payable is real only when Tarragon collected: a paid, non-test order, not already reached by a clinician earnings line (S31), term approved.
create function private.guard_partner_payable() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare o public.orders%rowtype; t public.partner_settlement_terms%rowtype; s public.settlements%rowtype;
begin
  if tg_op = 'DELETE' then
    if old.settlement_id is not null then
      select * into s from public.settlements where id = old.settlement_id;
      if s.state in ('issued', 'disputed', 'settled') then raise exception 'payable_frozen' using errcode = '42501'; end if;
    end if;
    return old;
  end if;
  if tg_op = 'INSERT' then
    select * into o from public.orders where id = new.order_id;
    if not found or o.state <> 'paid' then raise exception 'payable_needs_a_paid_order' using errcode = '23514'; end if;
    if o.is_test <> new.is_test then raise exception 'payable_test_flag_must_follow_the_order' using errcode = '23514'; end if;
    select * into t from public.partner_settlement_terms where id = new.term_id;
    if not found or t.approved_at is null or t.partner_kind <> new.partner_kind or t.partner_id <> new.partner_id or t.organisation_id <> new.organisation_id then
      raise exception 'payable_needs_approved_matching_terms' using errcode = '23514';
    end if;
    if exists (select 1 from public.earnings_ledger e where e.reference_id = new.order_id) then
      raise exception 'order_already_paid_through_clinician_earnings' using errcode = '23514';
    end if;
    return new;
  end if;
  -- update: only the settlement link may change, and only while the settlement it is leaving or joining is a draft
  if (to_jsonb(new) - 'settlement_id') is distinct from (to_jsonb(old) - 'settlement_id') then raise exception 'payable_immutable' using errcode = '42501'; end if;
  if old.settlement_id is not null then
    select * into s from public.settlements where id = old.settlement_id;
    if s.state in ('issued', 'disputed') and new.settlement_id is null and coalesce(current_setting('tarragon.settlement_void', true), '') = 'on' then
      return new;   -- void_settlement() hands an unpaid statement's payables back to the pool, nothing else may
    end if;
    if s.state in ('issued', 'disputed', 'settled') then raise exception 'payable_frozen' using errcode = '42501'; end if;
  end if;
  if new.settlement_id is not null and new.settlement_id is distinct from old.settlement_id then
    select * into s from public.settlements where id = new.settlement_id;
    if s.state <> 'draft' or s.partner_kind <> new.partner_kind or s.partner_id <> new.partner_id or s.period_month <> new.period_month then
      raise exception 'payable_joins_only_a_matching_draft' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
revoke all on function private.guard_partner_payable() from public, anon, authenticated;
create trigger partner_payables_guard before insert or update or delete on public.partner_payables
  for each row execute function private.guard_partner_payable();

-- Settlement rows: the state machine and the total check. A total can never differ from its payables once issued.
create function private.guard_settlement() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare v_sum bigint; v_n integer;
begin
  if tg_op = 'DELETE' then raise exception 'a settlement is voided, never deleted' using errcode = '42501'; end if;
  if tg_op = 'INSERT' then
    if new.state <> 'draft' then raise exception 'a settlement is created as a draft' using errcode = '42501'; end if;
    return new;
  end if;
  if (new.organisation_id, new.partner_kind, new.partner_id, new.period_month, new.config_version, new.is_test)
     is distinct from (old.organisation_id, old.partner_kind, old.partner_id, old.period_month, old.config_version, old.is_test) then
    raise exception 'settlement_identity_immutable' using errcode = '42501';
  end if;
  if old.state in ('settled', 'void') then raise exception 'settlement_final' using errcode = '42501'; end if;
  if new.state is distinct from old.state and not (
       (old.state = 'draft' and new.state in ('issued', 'void'))
    or (old.state = 'issued' and new.state in ('disputed', 'settled', 'void'))
    or (old.state = 'disputed' and new.state in ('issued', 'void'))) then
    raise exception 'settlement_bad_transition % to %', old.state, new.state using errcode = '42501';
  end if;
  if new.state in ('issued', 'settled') or (old.state <> 'draft' and new.state <> 'void') then
    select coalesce(sum(amount_kobo), 0), count(*) into v_sum, v_n from public.partner_payables where settlement_id = new.id;
    if v_sum <> new.amount_kobo or v_n <> new.item_count then raise exception 'settlement_total_does_not_match_payables' using errcode = '23514'; end if;
  end if;
  if old.state <> 'draft' and (new.amount_kobo <> old.amount_kobo or new.item_count <> old.item_count) then
    raise exception 'settlement_amount_frozen' using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end $$;
revoke all on function private.guard_settlement() from public, anon, authenticated;
create trigger settlements_guard before insert or update or delete on public.settlements
  for each row execute function private.guard_settlement();

-- ---------------------------------------------------------------------------
-- 4. Guard registration (off) and the conditions wrapper
-- ---------------------------------------------------------------------------
insert into public.go_live_guards (key, label, blocks, condition_text, switch_role, enforced_in, not_enforced_in) values
  ('partner_settlement_enabled', 'Partner settlement', 'Building, issuing and recording partner settlements',
   'At least one approved settlement term; admin confirmation. Nothing moves money: a person pays outside the system and records the reference.', 'admin',
   array['partner_settlement_run', 'issue_settlement', 'record_settlement_paid'], 'Terms can be drafted and previewed with the guard off; nothing is accrued, issued or recorded.');

alter function private.go_live_conditions(text, uuid) rename to go_live_conditions_s74_base;
create function private.go_live_conditions(p_key text, p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_n integer;
begin
  if p_key = 'partner_settlement_enabled' then
    select count(*) into v_n from public.partner_settlement_terms where approved_at is not null and (valid_to is null or valid_to > now());
    return jsonb_build_array(
      private.go_live_cond('settlement_terms_approved', 'At least one approved settlement term', v_n > 0, 'data', v_n || ' approved'),
      private.go_live_cond('admin_confirmation', 'Admin confirmation', true, 'switch', 'Given by an admin pressing the switch'));
  end if;
  return private.go_live_conditions_s74_base(p_key, p_org);
end $$;

-- ---------------------------------------------------------------------------
-- 5. Terms: draft, approve, end (admin; every step audited)
-- ---------------------------------------------------------------------------
create function public.create_partner_settlement_terms(p_kind text, p_partner uuid, p_catalog_code text, p_source text, p_basis text, p_value bigint,
                                                       p_sponsor_paid_only boolean, p_reason text) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := (select auth.uid()); v_org uuid := private.caller_org(); v_id uuid; v_item uuid;
begin
  if not private.is_admin() or v_org is null then raise exception 'only an admin can draft settlement terms' using errcode = '42501'; end if;
  if p_kind = 'lab' then raise exception 'laboratories are owed nothing (D-06)' using errcode = '23514'; end if;
  select id into v_item from public.catalog_items where code = p_catalog_code and organisation_id = v_org;
  if v_item is null then raise exception 'catalogue item not found' using errcode = '22023'; end if;
  insert into public.partner_settlement_terms (organisation_id, partner_kind, partner_id, catalog_item_id, source_kind, basis, value, sponsor_paid_only, reason, created_by, is_test)
  values (v_org, p_kind, p_partner, v_item, p_source, p_basis, p_value, coalesce(p_sponsor_paid_only, true), p_reason, v_uid,
          coalesce((select is_test from public.profiles where id = v_uid), false))
  returning id into v_id;
  perform private.log_audit('partner.settlement_terms_drafted', 'partner_settlement_terms', v_id, jsonb_build_object('partner_kind', p_kind, 'partner_id', p_partner, 'basis', p_basis));
  return v_id;
end $$;

create function public.approve_partner_settlement_terms(p_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := (select auth.uid());
begin
  if not private.is_admin() then raise exception 'only an admin can approve settlement terms' using errcode = '42501'; end if;
  update public.partner_settlement_terms set approved_by = v_uid, approved_at = now() where id = p_id and organisation_id = private.caller_org() and approved_at is null;
  if not found then raise exception 'terms not found or already approved' using errcode = '22023'; end if;
  perform private.log_audit('partner.settlement_terms_approved', 'partner_settlement_terms', p_id, '{}'::jsonb);
end $$;

create function public.end_partner_settlement_terms(p_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not private.is_admin() then raise exception 'only an admin can end settlement terms' using errcode = '42501'; end if;
  update public.partner_settlement_terms set valid_to = greatest(now(), valid_from + interval '1 second') where id = p_id and organisation_id = private.caller_org() and valid_to is null;
  if not found then raise exception 'terms not found or already ended' using errcode = '22023'; end if;
  perform private.log_audit('partner.settlement_terms_ended', 'partner_settlement_terms', p_id, '{}'::jsonb);
end $$;

-- ---------------------------------------------------------------------------
-- 6. The share of one order under one term (pure). Basis points round DOWN to the kobo; the remainder stays with Tarragon.
-- ---------------------------------------------------------------------------
create function private.partner_share_kobo(p_basis text, p_value bigint, p_amount_kobo bigint) returns bigint
language sql immutable set search_path = ''
as $$ select case p_basis when 'fixed_kobo' then least(p_value, p_amount_kobo) when 'basis_points' then (p_amount_kobo * p_value) / 10000 end $$;
revoke all on function private.partner_share_kobo(text, bigint, bigint) from public, anon, authenticated;

-- The orders a term reaches in a month: paid, not a test, in the term's window, sponsor paid when the term says so, not refunded, and not already
-- reached by a clinician earnings line (S31). Used by both the preview and the run so they can never disagree.
create function private.partner_term_orders(p_term uuid, p_month date)
returns table (order_id uuid, basis_amount_kobo bigint, share_kobo bigint, is_test boolean)
language sql stable security definer set search_path = ''
as $$
  select o.id, o.amount_kobo, private.partner_share_kobo(t.basis, t.value, o.amount_kobo), o.is_test
    from public.partner_settlement_terms t
    join public.orders o on o.organisation_id = t.organisation_id and o.catalog_item_id = t.catalog_item_id
   where t.id = p_term and t.approved_at is not null
     and o.state = 'paid' and private.lagos_month(o.paid_at) = p_month
     and o.paid_at >= t.valid_from and (t.valid_to is null or o.paid_at < t.valid_to)
     and (not t.sponsor_paid_only or o.buyer_profile_id <> o.beneficiary_patient_id)
     and not exists (select 1 from public.earnings_ledger e where e.reference_id = o.id)
$$;
revoke all on function private.partner_term_orders(uuid, date) from public, anon, authenticated;

-- Any order that would be paid through both systems, or a refund after an issued statement. Empty is the only good answer.
create function private.partner_double_payment_findings()
returns table (finding text, order_id uuid, detail text)
language sql stable security definer set search_path = ''
as $$
  select 'in_payables_and_clinician_earnings', p.order_id, 'payable ' || p.id
    from public.partner_payables p join public.earnings_ledger e on e.reference_id = p.order_id
  union all
  select 'payable_on_unpaid_order', p.order_id, 'order state ' || o.state
    from public.partner_payables p join public.orders o on o.id = p.order_id
   where o.state <> 'paid' and p.settlement_id is not null
     and exists (select 1 from public.settlements s where s.id = p.settlement_id and s.state in ('issued', 'disputed', 'settled'))
$$;
revoke all on function private.partner_double_payment_findings() from public, anon, authenticated;

create function public.partner_double_payment_check() returns table (finding text, order_id uuid, detail text)
language sql stable security definer set search_path = ''
as $$ select * from private.partner_double_payment_findings() where private.is_admin() $$;

-- ---------------------------------------------------------------------------
-- 7. Preview (always allowed to an admin, writes nothing) and the run (guarded)
-- ---------------------------------------------------------------------------
create function public.partner_settlement_preview(p_month date default null) returns table (
  term_id uuid, partner_kind text, partner_id uuid, partner_name text, orders integer, amount_kobo bigint)
language sql stable security definer set search_path = ''
as $$
  select t.id, t.partner_kind, t.partner_id, private.partner_name(t.partner_kind, t.partner_id), count(x.order_id)::integer, coalesce(sum(x.share_kobo), 0)::bigint
    from public.partner_settlement_terms t
    left join lateral private.partner_term_orders(t.id, coalesce(p_month, private.lagos_month(now() - interval '1 month'))) x on not x.is_test
   where private.is_admin() and t.organisation_id = private.caller_org() and t.approved_at is not null and (t.valid_to is null or t.valid_to > now())
   group by t.id
$$;

create function private.partner_settlement_run(p_month date default null, p_org uuid default null, p_include_test boolean default false) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_month date := coalesce(p_month, private.lagos_month(now() - interval '1 month'));
  v_cfg integer; t record; x record; s record; v_pay integer := 0; v_set integer := 0; v_removed integer := 0; v_id uuid; v_amount bigint; v_n integer; v_findings integer;
begin
  if not private.go_live_guard_on('partner_settlement_enabled') then return jsonb_build_object('skipped', 'guard_off', 'month', v_month); end if;
  select version into v_cfg from public.partner_settlement_config where is_active;

  -- 1. accrue (idempotent: unique per order and term)
  for t in select * from public.partner_settlement_terms
            where approved_at is not null and (p_org is null or organisation_id = p_org) and valid_from < (v_month + interval '1 month') loop
    for x in select * from private.partner_term_orders(t.id, v_month) loop
      if x.is_test and not p_include_test then continue; end if;   -- INV-13: a test order never accrues, except in the proofs
      insert into public.partner_payables (organisation_id, term_id, order_id, partner_kind, partner_id, source_kind, basis_amount_kobo, amount_kobo, period_month, is_test)
      values (t.organisation_id, t.id, x.order_id, t.partner_kind, t.partner_id, t.source_kind, x.basis_amount_kobo, x.share_kobo, v_month, x.is_test)
      on conflict (order_id, term_id) do nothing;
      if found then v_pay := v_pay + 1; end if;
    end loop;
  end loop;

  -- 2. draft payables whose order was refunded since leave the draft (an issued statement is never touched; the findings list shows it)
  delete from public.partner_payables p using public.orders o
   where p.order_id = o.id and o.state <> 'paid' and p.period_month = v_month
     and (p.settlement_id is null or exists (select 1 from public.settlements d where d.id = p.settlement_id and d.state = 'draft'));
  get diagnostics v_removed = row_count;
  update public.settlements d set amount_kobo = coalesce((select sum(p.amount_kobo) from public.partner_payables p where p.settlement_id = d.id), 0),
         item_count = (select count(*) from public.partner_payables p where p.settlement_id = d.id)
   where d.state = 'draft' and d.period_month = v_month and (p_org is null or d.organisation_id = p_org);

  -- 3. one draft settlement per partner for the month, from real (non-test) payables only; a test partner pair is built too but flagged
  for s in select organisation_id, partner_kind, partner_id, is_test, sum(amount_kobo)::bigint as amt, count(*)::integer as n
             from public.partner_payables
            where period_month = v_month and (p_org is null or organisation_id = p_org) and (p_include_test or not is_test)
              and (settlement_id is null or settlement_id in (select id from public.settlements where state = 'draft'))
            group by organisation_id, partner_kind, partner_id, is_test loop
    select id into v_id from public.settlements where partner_kind = s.partner_kind and partner_id = s.partner_id and period_month = v_month and is_test = s.is_test and state <> 'void';
    if v_id is null then
      insert into public.settlements (organisation_id, partner_kind, partner_id, period_month, amount_kobo, item_count, config_version, is_test)
      values (s.organisation_id, s.partner_kind, s.partner_id, v_month, s.amt, s.n, v_cfg, s.is_test) returning id into v_id;
      v_set := v_set + 1;
    elsif (select state from public.settlements where id = v_id) = 'draft' then
      update public.settlements set amount_kobo = s.amt, item_count = s.n where id = v_id;
    else
      continue;   -- already issued: late payables wait for the next run, they never change an issued statement
    end if;
    update public.partner_payables set settlement_id = v_id
     where partner_kind = s.partner_kind and partner_id = s.partner_id and period_month = v_month and is_test = s.is_test and settlement_id is distinct from v_id
       and (settlement_id is null or settlement_id in (select id from public.settlements where state = 'draft'));
    if not s.is_test then
      perform private.emit_domain_event('partner.settlement_due', s.organisation_id,
        jsonb_build_object('settlement_id', v_id, 'partner_kind', s.partner_kind, 'partner_id', s.partner_id, 'period_month', v_month, 'amount_kobo', s.amt),
        'partner_settlement_due:' || v_id || ':' || s.amt, null, 'settlement', v_id);
    end if;
  end loop;

  select count(*) into v_findings from private.partner_double_payment_findings();
  if v_findings > 0 and not exists (select 1 from public.ops_incidents where external_reference = 'partner_double_payment' and status not in ('resolved', 'closed')) then
    insert into public.ops_incidents (category, severity, title, summary, external_reference, ack_due_at, resolve_due_at)
    values ('financial', 'sev2', 'A partner payable overlaps another payment',
            format('%s finding(s) from private.partner_double_payment_findings(); open Partner settlements to review before anything is issued.', v_findings),
            'partner_double_payment', now(), now());
  end if;
  perform private.log_audit('partner.settlement_run', 'settlements', null,
    jsonb_build_object('month', v_month, 'payables_added', v_pay, 'payables_removed', v_removed, 'settlements_created', v_set, 'findings', v_findings));
  return jsonb_build_object('month', v_month, 'payables_added', v_pay, 'payables_removed', v_removed, 'settlements_created', v_set, 'findings', v_findings);
end $$;
revoke all on function private.partner_settlement_run(date, uuid, boolean) from public, anon, authenticated;

-- The monthly job: on or after day `close_after_days` (Lagos) it builds last month's drafts. Safe to run every day.
create function private.partner_settlement_job() returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  if extract(day from (now() at time zone 'Africa/Lagos'))::integer < (private.partner_settlement_setting('close_after_days'))::integer then
    return jsonb_build_object('skipped', 'before_close_day');
  end if;
  return private.partner_settlement_run(null, null, false);
end $$;
revoke all on function private.partner_settlement_job() from public, anon, authenticated;

do $$
begin
  perform cron.unschedule(jobname) from cron.job where jobname = 'partner-settlement-run';
  perform cron.schedule('partner-settlement-run', '10 6 * * *', $c$select private.partner_settlement_job()$c$);
end $$;

-- A person can run it for a month by hand (admin; guarded the same way).
create function public.run_partner_settlement(p_month date default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  if not private.is_admin() then raise exception 'only an admin can run a partner settlement' using errcode = '42501'; end if;
  return private.partner_settlement_run(case when p_month is null then null else date_trunc('month', p_month)::date end, private.caller_org(), false);
end $$;

-- ---------------------------------------------------------------------------
-- 8. Issue, dispute, void, record paid
-- ---------------------------------------------------------------------------
create function private.notify_partner_staff(p_kind text, p_id uuid, p_template text) returns void
language plpgsql security definer set search_path = ''
as $$
declare r record;
begin
  for r in
    select pr.id, pr.organisation_id from public.profiles pr where p_kind = 'pharmacy' and pr.role = 'pharmacist' and pr.is_active and pr.pharmacy_partner_id = p_id
    union
    select pr.id, pr.organisation_id from public.provider_org_members m join public.provider_organisations po on po.organisation_id = m.organisation_id
      join public.profiles pr on pr.id = m.profile_id
     where p_kind = 'clinic' and po.id = p_id and m.is_active and pr.is_active and m.org_role in ('owner', 'operations_manager', 'finance_manager')
  loop
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload) values (r.organisation_id, r.id, 'in_app', 'pending', p_template, '{}'::jsonb);
  end loop;
end $$;
revoke all on function private.notify_partner_staff(text, uuid, text) from public, anon, authenticated;

create function public.issue_settlement(p_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := (select auth.uid()); s public.settlements%rowtype;
begin
  if not private.is_admin() then raise exception 'only an admin can issue a settlement' using errcode = '42501'; end if;
  if not private.go_live_guard_on('partner_settlement_enabled') then raise exception 'settlement_guard_off' using errcode = '55000'; end if;
  select * into s from public.settlements where id = p_id and organisation_id = private.caller_org() for update;
  if not found then raise exception 'settlement_not_found' using errcode = '42501'; end if;
  if s.state not in ('draft', 'disputed') then raise exception 'settlement_not_issuable' using errcode = '22023'; end if;
  if s.is_test then raise exception 'a test settlement is never issued' using errcode = '22023'; end if;
  if s.amount_kobo <= 0 then raise exception 'nothing_to_issue' using errcode = '22023'; end if;
  update public.settlements set state = 'issued', issued_at = now(), issued_by = v_uid where id = p_id;
  perform private.notify_partner_staff(s.partner_kind, s.partner_id, 'partner_statement_ready');
  perform private.log_audit('partner.settlement_issued', 'settlements', p_id, jsonb_build_object('partner_kind', s.partner_kind, 'partner_id', s.partner_id, 'period_month', s.period_month));
end $$;

create function public.record_settlement_paid(p_id uuid, p_reference text) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := (select auth.uid()); s public.settlements%rowtype;
begin
  if not private.is_admin() then raise exception 'only an admin can record a settlement as paid' using errcode = '42501'; end if;
  if not private.go_live_guard_on('partner_settlement_enabled') then raise exception 'settlement_guard_off' using errcode = '55000'; end if;
  select * into s from public.settlements where id = p_id and organisation_id = private.caller_org() for update;
  if not found then raise exception 'settlement_not_found' using errcode = '42501'; end if;
  if s.state <> 'issued' then raise exception 'settlement_not_issued' using errcode = '22023'; end if;
  if length(btrim(coalesce(p_reference, ''))) < 4 then raise exception 'record the bank reference of the payment made outside the platform' using errcode = '22023'; end if;
  update public.settlements set state = 'settled', settled_at = now(), settled_by = v_uid, external_reference = btrim(p_reference) where id = p_id;
  perform private.log_audit('partner.settlement_recorded_paid', 'settlements', p_id, jsonb_build_object('partner_kind', s.partner_kind, 'partner_id', s.partner_id));
end $$;

create function public.void_settlement(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = ''
as $$
declare s public.settlements%rowtype;
begin
  if not private.is_admin() then raise exception 'only an admin can void a settlement' using errcode = '42501'; end if;
  select * into s from public.settlements where id = p_id and organisation_id = private.caller_org() for update;
  if not found then raise exception 'settlement_not_found' using errcode = '42501'; end if;
  if s.state not in ('draft', 'issued', 'disputed') then raise exception 'settlement_not_voidable' using errcode = '22023'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 10 then raise exception 'say why in at least 10 characters' using errcode = '22023'; end if;
  -- payables go back to the pool first (allowed while the statement is still a draft or is being voided), then the statement is final
  perform set_config('tarragon.settlement_void', 'on', true);
  update public.partner_payables set settlement_id = null where settlement_id = p_id;
  update public.settlements set state = 'void', void_reason = btrim(p_reason) where id = p_id;
  perform private.log_audit('partner.settlement_voided', 'settlements', p_id, jsonb_build_object('partner_kind', s.partner_kind, 'partner_id', s.partner_id));
end $$;

-- The partner disputes an issued statement (its own only). Never edits it.
create function public.partner_dispute_settlement(p_id uuid, p_note text) returns void
language plpgsql security definer set search_path = ''
as $$
declare p record; s public.settlements%rowtype;
begin
  select * into p from private.partner_of_caller() limit 1;
  if not found then raise exception 'This action is for partners' using errcode = '42501'; end if;
  select * into s from public.settlements where id = p_id and partner_kind = p.partner_kind and partner_id = p.partner_id for update;
  if not found then raise exception 'Statement not found' using errcode = '42501'; end if;
  if s.state <> 'issued' then raise exception 'settlement_not_disputable' using errcode = '22023'; end if;
  if length(btrim(coalesce(p_note, ''))) < 10 then raise exception 'say what is wrong in at least 10 characters' using errcode = '22023'; end if;
  update public.settlements set state = 'disputed', disputed_at = now(), dispute_note = btrim(p_note) where id = p_id;
  perform private.log_audit('partner.settlement_disputed', 'settlements', p_id, jsonb_build_object('partner_kind', s.partner_kind));
end $$;

-- ---------------------------------------------------------------------------
-- 9. Reads: the partner portal statement (own statements only, drafts never shown) and the admin list
-- ---------------------------------------------------------------------------
create function public.partner_my_statements() returns table (
  settlement_id uuid, period_month date, amount_kobo bigint, item_count integer, state text, issued_at timestamptz, settled_at timestamptz,
  external_reference text, disputed_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select s.id, s.period_month, s.amount_kobo, s.item_count, s.state, s.issued_at, s.settled_at, s.external_reference, s.disputed_at
    from public.settlements s join private.partner_of_caller() c on c.partner_kind = s.partner_kind and c.partner_id = s.partner_id
   where s.state in ('issued', 'disputed', 'settled') and not s.is_test
   order by s.period_month desc
$$;

-- Lines of one of the caller's own statements: the order's date and the amounts only. No patient, no item name beyond the catalogue code.
create function public.partner_my_statement_lines(p_settlement uuid) returns table (
  line_ref text, paid_on date, catalog_code text, basis_amount_kobo bigint, amount_kobo bigint)
language sql stable security definer set search_path = ''
as $$
  select 'PAY-' || upper(substr(replace(p.id::text, '-', ''), 1, 8)), (o.paid_at at time zone 'Africa/Lagos')::date, ci.code, p.basis_amount_kobo, p.amount_kobo
    from public.partner_payables p
    join public.settlements s on s.id = p.settlement_id
    join private.partner_of_caller() c on c.partner_kind = s.partner_kind and c.partner_id = s.partner_id
    join public.orders o on o.id = p.order_id
    join public.catalog_items ci on ci.id = o.catalog_item_id
   where s.id = p_settlement and s.state in ('issued', 'disputed', 'settled') and not s.is_test
   order by o.paid_at
$$;

create function public.admin_list_settlements(p_state text default null) returns table (
  settlement_id uuid, partner_kind text, partner_id uuid, partner_name text, period_month date, amount_kobo bigint, item_count integer, state text,
  issued_at timestamptz, settled_at timestamptz, dispute_note text)
language sql stable security definer set search_path = ''
as $$
  select s.id, s.partner_kind, s.partner_id, private.partner_name(s.partner_kind, s.partner_id), s.period_month, s.amount_kobo, s.item_count, s.state,
         s.issued_at, s.settled_at, s.dispute_note
    from public.settlements s
   where private.is_admin() and s.organisation_id = private.caller_org() and not s.is_test and (p_state is null or s.state = p_state)
   order by s.period_month desc, s.created_at desc
$$;

-- ---------------------------------------------------------------------------
-- 10. Grants and closing assertions
-- ---------------------------------------------------------------------------
revoke all on function public.create_partner_settlement_terms(text, uuid, text, text, text, bigint, boolean, text) from public, anon;
revoke all on function public.approve_partner_settlement_terms(uuid) from public, anon;
revoke all on function public.end_partner_settlement_terms(uuid) from public, anon;
revoke all on function public.partner_settlement_preview(date) from public, anon;
revoke all on function public.partner_double_payment_check() from public, anon;
revoke all on function public.run_partner_settlement(date) from public, anon;
revoke all on function public.issue_settlement(uuid) from public, anon;
revoke all on function public.record_settlement_paid(uuid, text) from public, anon;
revoke all on function public.void_settlement(uuid, text) from public, anon;
revoke all on function public.partner_dispute_settlement(uuid, text) from public, anon;
revoke all on function public.partner_my_statements() from public, anon;
revoke all on function public.partner_my_statement_lines(uuid) from public, anon;
revoke all on function public.admin_list_settlements(text) from public, anon;
grant execute on function public.create_partner_settlement_terms(text, uuid, text, text, text, bigint, boolean, text) to authenticated;
grant execute on function public.approve_partner_settlement_terms(uuid) to authenticated;
grant execute on function public.end_partner_settlement_terms(uuid) to authenticated;
grant execute on function public.partner_settlement_preview(date) to authenticated;
grant execute on function public.partner_double_payment_check() to authenticated;
grant execute on function public.run_partner_settlement(date) to authenticated;
grant execute on function public.issue_settlement(uuid) to authenticated;
grant execute on function public.record_settlement_paid(uuid, text) to authenticated;
grant execute on function public.void_settlement(uuid, text) to authenticated;
grant execute on function public.partner_dispute_settlement(uuid, text) to authenticated;
grant execute on function public.partner_my_statements() to authenticated;
grant execute on function public.partner_my_statement_lines(uuid) to authenticated;
grant execute on function public.admin_list_settlements(text) to authenticated;
revoke insert, update, delete, truncate on public.partner_settlement_terms, public.settlements, public.partner_payables from authenticated;

do $$
declare t text;
begin
  foreach t in array array['partner_settlement_config', 'partner_settlement_terms', 'settlements', 'partner_payables'] loop
    if not (select relrowsecurity from pg_class where oid = ('public.' || t)::regclass) then raise exception 'RLS is off on %', t; end if;
    if has_table_privilege('anon', 'public.' || t, 'SELECT') then raise exception 'anon can read %', t; end if;
    if has_table_privilege('authenticated', 'public.' || t, 'INSERT') or has_table_privilege('authenticated', 'public.' || t, 'UPDATE') then raise exception 'authenticated can write % directly', t; end if;
  end loop;
  if (select is_on from public.go_live_guards where key = 'partner_settlement_enabled') then raise exception 'the settlement guard must ship off'; end if;
  if has_function_privilege('anon', 'public.issue_settlement(uuid)', 'EXECUTE') then raise exception 'anon can call issue_settlement'; end if;
  if not exists (select 1 from cron.job where jobname = 'partner-settlement-run') then raise exception 'partner-settlement-run was not scheduled'; end if;
end $$;
