-- S73: pricing engine (Module 20). Founder decisions: docs/DECISIONS.md "S70 to S75 planning" (S73-1), OQ-324, OQ-321, OQ-08. Design: docs/design/S73.md.
--
-- What this adds, on top of S25's catalogue and orders (nothing there is rebuilt):
--   * public.price_quote(): ONE function decides what a buyer pays for an item, in a fixed order of rules (list price, institutional price
--     book, hardship, sponsor coverage, discount code, points), never below zero and never below the third-party (clinician or partner)
--     cost, and returns a line-by-line explanation. create_order calls the same private.price_quote_calc(), stores its result and the price
--     version used on the order (INV-16), and refuses a charge that differs from the amount the client was shown.
--   * discount_codes and discount_redemptions: order-linked, capped in total and per person, expiring, rate-limited on failed tries, audited.
--   * price_books and price_book_entries: institutional per-covered-life rates, effective-dated and immutable (a new entry closes the old one).
--   * pricing_config: versioned PROPOSED rules (mirrored as pricing.rules in packages/shared/src/proposed-config).
--   * price.changed: registered in the S10 event registry and emitted by set_item_price and by price book entries.
--   * Subscription decision S73-1: NO subscription_plans table. Membership stays a one-off yearly purchase with an end date. Enabling it is an
--     admin-only, audited act that needs the new go-live guard membership_billing_enabled (OQ-324).
--   * Two institutional catalogue kinds (module 20.7): institutional_protocol (per covered life) and concierge_coordinator (OFF behind its own
--     guard). They are audience 'institution': priced only by a price book entry and never sold through patient checkout.
--
-- Counted first (local replay, and the production counts recorded in docs/BUILD-PROGRESS.md for S25 to S29): catalog_items 1 row (Membership,
-- inactive), orders 0 real rows, discount/price book tables new. Nothing is converted. The columns added to orders are nullable or default 0,
-- so existing rows stay valid.
--
-- NOT done here, on purpose (each is recorded in docs/OPEN-QUESTIONS.md):
--   * Sponsor coverage is computed by the quote (price book entry carries the sponsor's share) but create_order REFUSES an order with a sponsor
--     share above zero ('sponsor_billing_not_open') until S71 builds the sponsor entitlement that bills the sponsor and posts the receivable.
--     Without it the sponsor's share would be revenue that is never collected.
--   * Hardship pricing is a seam (private.hardship_reduction returns 0) because it exists only through Access Fund grants (S72, OQ-323).
--   * The leftover kobo conversion for wellness points (redeem_wellness_points, points_to_kobo_rate) is documented, not removed (OQ-321): the points
--     here are a different, fee-only, order-bound reduction that is OFF until the founder signs its values.
--
-- Standing lessons applied: no hand-typed round timestamp; every new table has RLS on and NO grant to authenticated or anon (admins read and
-- write through audited security-definer functions); every function is revoked from public (anon inherits execute through PUBLIC) and re-checked
-- at the end; create_order is DROPPED and re-created because adding defaulted parameters to a second overload would make every 3-argument call
-- ambiguous (42725); pgvector not used.

-- ---------------------------------------------------------------------------
-- 1. Versioned rules (PROPOSED, owner Founder; mirrored in the code registry as pricing.rules)
-- ---------------------------------------------------------------------------
create table public.pricing_config (
  id             uuid primary key default gen_random_uuid(),
  version        integer not null unique check (version >= 1),
  is_active      boolean not null default false,
  effective_from date not null,
  rules          jsonb not null,
  created_at     timestamptz not null default now()
);
create unique index pricing_config_one_active on public.pricing_config ((true)) where is_active;

create function private.pricing_rules_valid(r jsonb) returns boolean
language plpgsql immutable set search_path = ''
as $$
declare p jsonb; k text;
begin
  if jsonb_typeof(r) <> 'object' then return false; end if;
  p := r -> 'points';
  if jsonb_typeof(p) <> 'object' or jsonb_typeof(p -> 'enabled') <> 'boolean' then return false; end if;
  foreach k in array array['points_per_step', 'reduction_per_step_kobo', 'max_steps_per_order', 'max_percent_of_service_fee'] loop
    if jsonb_typeof(p -> k) <> 'number' or (p ->> k) !~ '^[0-9]+$' or (p ->> k)::bigint < 1 then return false; end if;
  end loop;
  if (p ->> 'max_percent_of_service_fee')::integer > 100 then return false; end if;
  if jsonb_typeof(r -> 'third_party_component_keys') <> 'array' or jsonb_typeof(r -> 'service_fee_component_key') <> 'string' then return false; end if;
  if (r ->> 'min_payable_kobo') is null or (r ->> 'min_payable_kobo') !~ '^[0-9]+$' then return false; end if;
  if (r ->> 'code_failed_tries_per_hour') is null or (r ->> 'code_failed_tries_per_hour') !~ '^[0-9]+$' or (r ->> 'code_failed_tries_per_hour')::integer < 1 then return false; end if;
  return true;
end $$;
revoke all on function private.pricing_rules_valid(jsonb) from public, anon, authenticated;
alter table public.pricing_config add constraint pricing_config_rules_valid check (private.pricing_rules_valid(rules));

-- pricing-rules-v1-begin (the code registry entry pricing.rules must equal this; a test fails if they drift)
insert into public.pricing_config (version, is_active, effective_from, rules) values (1, true, '2026-10-07', $json$
{"points":{"enabled":false,"points_per_step":100,"reduction_per_step_kobo":5000,"max_steps_per_order":5,"max_percent_of_service_fee":50},"third_party_component_keys":["clinician_fee","partner_fee"],"service_fee_component_key":"tarragon_service_fee","min_payable_kobo":10000,"code_failed_tries_per_hour":10}
$json$::jsonb);
-- pricing-rules-v1-end

alter table public.pricing_config enable row level security;
revoke all on public.pricing_config from public, anon, authenticated;

create function private.pricing_rules() returns jsonb
language sql stable security definer set search_path = ''
as $$ select rules from public.pricing_config where is_active $$;
revoke all on function private.pricing_rules() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Catalogue: audience, and the two institutional kinds
-- ---------------------------------------------------------------------------
alter table public.catalog_items add column audience text not null default 'patient' check (audience in ('patient', 'institution'));

do $$
declare c text;
begin
  select conname into c from pg_constraint
   where conrelid = 'public.catalog_items'::regclass and contype = 'c'
     and pg_get_constraintdef(oid) like '%consultation%care_pack%lab_panel%membership%';
  if c is null then raise exception 'S73: the catalog_items kind check was not found'; end if;
  execute format('alter table public.catalog_items drop constraint %I', c);
end $$;
alter table public.catalog_items add constraint catalog_items_kind_check
  check (kind in ('consultation', 'care_pack', 'lab_panel', 'membership', 'institutional_protocol', 'concierge_coordinator'));
alter table public.catalog_items add constraint catalog_items_audience_matches_kind
  check ((kind in ('institutional_protocol', 'concierge_coordinator')) = (audience = 'institution'));

-- ---------------------------------------------------------------------------
-- 3. Institutional price books (module 20.5): per covered life, effective-dated, immutable
-- ---------------------------------------------------------------------------
create table public.price_books (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  sponsor_org_id  uuid not null references public.organisations (id) on delete restrict,
  name            text not null check (char_length(btrim(name)) between 3 and 80),
  status          text not null default 'draft' check (status in ('draft', 'active', 'closed')),
  created_by      uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  is_test         boolean not null default false,
  unique (organisation_id, sponsor_org_id, name)
);
alter table public.price_books enable row level security;
revoke all on public.price_books from public, anon, authenticated;

create function private.price_books_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'price_book_immutable' using errcode = 'P0001'; end if;
  if new.organisation_id is distinct from old.organisation_id or new.sponsor_org_id is distinct from old.sponsor_org_id
     or new.name is distinct from old.name or new.is_test is distinct from old.is_test then
    raise exception 'price_book_immutable' using errcode = 'P0001';
  end if;
  if new.status is distinct from old.status and not ((old.status = 'draft' and new.status = 'active') or (old.status = 'active' and new.status = 'closed')) then
    raise exception 'price_book_bad_transition % to %', old.status, new.status using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger price_books_guard before update or delete on public.price_books for each row execute function private.price_books_guard();

create table public.price_book_entries (
  id                    uuid primary key default gen_random_uuid(),
  organisation_id       uuid not null references public.organisations (id) on delete restrict,
  price_book_id         uuid not null references public.price_books (id) on delete restrict,
  catalog_item_id       uuid not null references public.catalog_items (id) on delete restrict,
  rate_kobo             bigint not null check (rate_kobo > 0 and rate_kobo <= 100000000000),
  sponsor_share_percent integer not null default 0 check (sponsor_share_percent between 0 and 100),
  valid_from            timestamptz not null default now(),
  valid_to              timestamptz,
  created_by            uuid references public.profiles (id) on delete set null,
  reason                text not null check (char_length(btrim(reason)) >= 10),
  created_at            timestamptz not null default now(),
  check (valid_to is null or valid_to > valid_from),
  exclude using gist (price_book_id with =, catalog_item_id with =, tstzrange(valid_from, coalesce(valid_to, 'infinity'::timestamptz)) with &&)
);
create index price_book_entries_item_idx on public.price_book_entries (catalog_item_id, valid_from desc);
alter table public.price_book_entries enable row level security;
revoke all on public.price_book_entries from public, anon, authenticated;

-- Same rule as prices: a rate is a fact about a time range. Only its end can be set, once. Nothing deletes one (INV-16).
create function private.price_book_entries_immutable() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'price_book_entry_immutable' using errcode = 'P0001'; end if;
  if new.rate_kobo is distinct from old.rate_kobo or new.sponsor_share_percent is distinct from old.sponsor_share_percent
     or new.catalog_item_id is distinct from old.catalog_item_id or new.price_book_id is distinct from old.price_book_id
     or new.valid_from is distinct from old.valid_from or new.organisation_id is distinct from old.organisation_id or old.valid_to is not null then
    raise exception 'price_book_entry_immutable' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger price_book_entries_immutable before update or delete on public.price_book_entries
  for each row execute function private.price_book_entries_immutable();

-- ---------------------------------------------------------------------------
-- 4. Discount codes (module 20.4): order-linked, capped, expiring, audited
-- ---------------------------------------------------------------------------
create table public.discount_codes (
  id                 uuid primary key default gen_random_uuid(),
  organisation_id    uuid not null references public.organisations (id) on delete restrict,
  code               text not null check (code ~ '^[A-Z0-9]{4,24}$'),
  kind               text not null check (kind in ('percent', 'fixed')),
  percent            integer check (percent between 1 and 100),
  fixed_kobo         bigint check (fixed_kobo > 0 and fixed_kobo <= 100000000000),
  max_discount_kobo  bigint check (max_discount_kobo > 0),
  item_codes         text[] not null default '{}',
  cohort_id          uuid references public.sponsor_cohorts (id) on delete restrict,
  max_total_uses     integer not null check (max_total_uses between 1 and 1000000),
  max_uses_per_person integer not null default 1 check (max_uses_per_person between 1 and 100),
  valid_from         timestamptz not null,
  valid_to           timestamptz not null,
  status             text not null default 'active' check (status in ('active', 'paused', 'ended')),
  note               text,
  created_by         uuid references public.profiles (id) on delete set null,
  created_at         timestamptz not null default now(),
  is_test            boolean not null default false,
  unique (organisation_id, code),
  check (valid_to > valid_from),
  check ((kind = 'percent' and percent is not null and fixed_kobo is null) or (kind = 'fixed' and fixed_kobo is not null and percent is null))
);
alter table public.discount_codes enable row level security;
revoke all on public.discount_codes from public, anon, authenticated;

-- What a code gives is fixed at creation. Only its status can move, and its end can only be brought forward (INV-16 in spirit: an order names the code row it used).
create function private.discount_codes_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'discount_code_immutable' using errcode = 'P0001'; end if;
  if new.code is distinct from old.code or new.kind is distinct from old.kind or new.percent is distinct from old.percent
     or new.fixed_kobo is distinct from old.fixed_kobo or new.max_discount_kobo is distinct from old.max_discount_kobo
     or new.item_codes is distinct from old.item_codes or new.cohort_id is distinct from old.cohort_id
     or new.max_total_uses is distinct from old.max_total_uses or new.max_uses_per_person is distinct from old.max_uses_per_person
     or new.valid_from is distinct from old.valid_from or new.organisation_id is distinct from old.organisation_id
     or new.is_test is distinct from old.is_test or new.valid_to > old.valid_to then
    raise exception 'discount_code_immutable' using errcode = 'P0001';
  end if;
  if old.status = 'ended' and new.status <> 'ended' then raise exception 'discount_code_ended' using errcode = 'P0001'; end if;
  return new;
end $$;
create trigger discount_codes_guard before update or delete on public.discount_codes for each row execute function private.discount_codes_guard();

-- Failed tries, so guessing is slow (code_failed_tries_per_hour per person).
create table public.discount_code_attempts (
  id              bigint generated always as identity primary key,
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  patient_id      uuid not null references public.profiles (id) on delete cascade,
  at              timestamptz not null default now()
);
create index discount_code_attempts_idx on public.discount_code_attempts (patient_id, at desc);
alter table public.discount_code_attempts enable row level security;
revoke all on public.discount_code_attempts from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Orders record the whole pricing decision (INV-16) and are immutable afterwards
-- ---------------------------------------------------------------------------
alter table public.orders
  add column list_amount_kobo       bigint check (list_amount_kobo is null or list_amount_kobo > 0),
  add column sponsor_share_kobo     bigint not null default 0 check (sponsor_share_kobo >= 0),
  add column discount_code_id       uuid references public.discount_codes (id) on delete restrict,
  add column discount_kobo          bigint not null default 0 check (discount_kobo >= 0),
  add column points_applied         integer not null default 0 check (points_applied >= 0),
  add column points_reduction_kobo  bigint not null default 0 check (points_reduction_kobo >= 0),
  add column price_book_entry_id    uuid references public.price_book_entries (id) on delete restrict,
  add column pricing_rules_version  integer,
  add column quote                  jsonb;
alter table public.orders add constraint orders_pricing_adds_up
  check (list_amount_kobo is null or amount_kobo + sponsor_share_kobo + discount_kobo + points_reduction_kobo <= list_amount_kobo);
alter table public.orders add constraint orders_points_pair
  check ((points_applied > 0) = (points_reduction_kobo > 0));

create or replace function private.orders_state_machine() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'order_immutable' using errcode = 'P0001'; end if;
  if new.amount_kobo is distinct from old.amount_kobo or new.price_id is distinct from old.price_id
     or new.buyer_profile_id is distinct from old.buyer_profile_id or new.beneficiary_patient_id is distinct from old.beneficiary_patient_id
     or new.catalog_item_id is distinct from old.catalog_item_id or new.paystack_reference is distinct from old.paystack_reference
     -- S73: the pricing decision is part of what the order IS
     or new.list_amount_kobo is distinct from old.list_amount_kobo or new.sponsor_share_kobo is distinct from old.sponsor_share_kobo
     or new.discount_code_id is distinct from old.discount_code_id or new.discount_kobo is distinct from old.discount_kobo
     or new.points_applied is distinct from old.points_applied or new.points_reduction_kobo is distinct from old.points_reduction_kobo
     or new.price_book_entry_id is distinct from old.price_book_entry_id or new.pricing_rules_version is distinct from old.pricing_rules_version
     or new.quote is distinct from old.quote then
    raise exception 'order_immutable' using errcode = 'P0001';
  end if;
  if new.state is distinct from old.state and not (
       (old.state = 'created'   and new.state in ('paid', 'failed', 'cancelled'))
    or (old.state in ('failed', 'cancelled') and new.state = 'paid')   -- a verified late payment is never ignored
    or (old.state = 'paid'      and new.state = 'refunded')) then
    raise exception 'order_bad_transition % to %', old.state, new.state using errcode = 'P0001';
  end if;
  new.updated_at := now();
  return new;
end $$;

create table public.discount_redemptions (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete restrict,
  discount_code_id uuid not null references public.discount_codes (id) on delete restrict,
  order_id         uuid not null unique references public.orders (id) on delete restrict,
  beneficiary_id   uuid not null references public.profiles (id) on delete cascade,
  reduction_kobo   bigint not null check (reduction_kobo >= 0),
  state            text not null default 'reserved' check (state in ('reserved', 'redeemed', 'released')),
  created_at       timestamptz not null default now(),
  settled_at       timestamptz,
  is_test          boolean not null default false
);
create index discount_redemptions_code_idx on public.discount_redemptions (discount_code_id, beneficiary_id) where state in ('reserved', 'redeemed');
alter table public.discount_redemptions enable row level security;
revoke all on public.discount_redemptions from public, anon, authenticated;

-- What a state change on an order does to its code and its points. A cancelled or failed order gives the code use back; a paid one (even a
-- late payment on a released order: money received is never ignored) makes it redeemed and spends the points, once.
create function private.orders_pricing_effects() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare v_bal public.wellness_points_balances%rowtype; v_spend integer;
begin
  if new.state is not distinct from old.state then return new; end if;
  if new.state in ('cancelled', 'failed') then
    update public.discount_redemptions set state = 'released', settled_at = now() where order_id = new.id and state = 'reserved';
  elsif new.state = 'paid' then
    update public.discount_redemptions set state = 'redeemed', settled_at = now() where order_id = new.id and state <> 'redeemed';
    if new.points_applied > 0 then
      select * into v_bal from public.wellness_points_balances where patient_id = new.buyer_profile_id for update;
      if found and v_bal.balance > 0 then
        v_spend := least(new.points_applied, v_bal.balance);
        update public.wellness_points_balances set balance = balance - v_spend, updated_at = now() where patient_id = new.buyer_profile_id;
        insert into public.wellness_points_ledger (organisation_id, patient_id, points, balance_after, reason, source_table, source_id)
        values (v_bal.organisation_id, new.buyer_profile_id, -v_spend, v_bal.balance - v_spend, 'applied_to_order', 'orders', new.id)
        on conflict (patient_id, source_table, source_id, reason) where source_table is not null and source_id is not null do nothing;
      end if;
    end if;
  end if;
  return new;
end $$;
revoke all on function private.orders_pricing_effects() from public, anon, authenticated;
create trigger orders_pricing_effects after update of state on public.orders for each row execute function private.orders_pricing_effects();

-- ---------------------------------------------------------------------------
-- 6. The price.changed event (versioned, S10 registry)
-- ---------------------------------------------------------------------------
insert into public.event_types (event_type, description, owner_section, is_urgent)
values ('price.changed', 'A catalogue price or an institutional price book rate changed', 'S73', false);
insert into public.event_type_versions (event_type, version, required_keys) values ('price.changed', 1, array['scope', 'catalog_item_code', 'price_id']);

-- ---------------------------------------------------------------------------
-- 7. The quote
-- ---------------------------------------------------------------------------
-- Hardship pricing exists only through Access Fund grants (S72, OQ-323). Until that session lands this returns nothing, so the rule slot is
-- real (it sits in the right place in the order and in the explanation) and cannot be used for a self-declared discount.
create function private.hardship_reduction(p_beneficiary uuid, p_item uuid, p_due bigint) returns bigint
language sql stable security definer set search_path = ''
as $$ select 0::bigint $$;
revoke all on function private.hardship_reduction(uuid, uuid, bigint) from public, anon, authenticated;

create function private.quote_line(p_rule text, p_label_key text, p_amount bigint, p_running bigint, p_applied boolean default true, p_reason_key text default null)
returns jsonb language sql immutable set search_path = ''
as $$ select jsonb_build_object('rule', p_rule, 'label_key', p_label_key, 'amount_kobo', p_amount, 'running_kobo', p_running, 'applied', p_applied, 'reason_key', p_reason_key) $$;
revoke all on function private.quote_line(text, text, bigint, bigint, boolean, text) from public, anon, authenticated;

create function private.normalise_discount_code(p text) returns text
language sql immutable set search_path = ''
as $$ select nullif(regexp_replace(upper(coalesce(p, '')), '[^A-Z0-9]', '', 'g'), '') $$;
revoke all on function private.normalise_discount_code(text) from public, anon, authenticated;

-- Buyer and beneficiary rules, exactly as create_order had them (S29c), in one place so the quote and the order cannot disagree.
create function private.order_beneficiary_check(p_buyer uuid, p_beneficiary uuid) returns void
language plpgsql stable security definer set search_path = ''
as $$
declare pr public.profiles%rowtype; bp public.profiles%rowtype; v_ben uuid := coalesce(p_beneficiary, p_buyer);
begin
  select * into pr from public.profiles where id = p_buyer and role = 'patient' and is_active;
  if not found then raise exception 'order_not_authorised' using errcode = '42501'; end if;
  if v_ben = p_buyer and not pr.receives_care then raise exception 'order_not_authorised' using errcode = '42501'; end if;
  if v_ben <> p_buyer then
    select * into bp from public.profiles where id = v_ben and role = 'patient' and is_active;
    if not found or bp.organisation_id is distinct from pr.organisation_id or bp.is_test is distinct from pr.is_test
       or not (private.circle_can_pay_for(v_ben)
               or exists (select 1 from public.profile_access pa where pa.grantee_user_id = p_buyer and pa.profile_id = v_ben)) then
      raise exception 'order_beneficiary_not_allowed' using errcode = '42501';
    end if;
  end if;
end $$;
revoke all on function private.order_beneficiary_check(uuid, uuid) from public, anon, authenticated;

-- THE rule order (documented in docs/design/S73.md), each step working on what the buyer would still pay:
--   1 list price   2 institutional price book (a rate that can only lower the price, never below third-party cost)   3 hardship (seam)
--   4 sponsor coverage (the sponsor's share of the rate; moves cost to the sponsor, does not reduce the rate)   5 discount code (one per order)
--   6 points (Tarragon service fee only, in whole steps).
-- Stacking: price book, hardship, code and points are all "Tarragon-funded" reductions. Together they can never take what the buyer and the
-- sponsor owe below the third-party cost, and never leave the buyer with less than min_payable_kobo (except through sponsor coverage or an
-- approved hardship grant, which are not Tarragon discounts). Rounding is always down. Everything is integer kobo (INV-15).
create function private.price_quote_calc(p_buyer uuid, p_beneficiary uuid, p_code text, p_discount text, p_use_points boolean)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_rules  jsonb := private.pricing_rules();
  v_ver    integer := (select version from public.pricing_config where is_active);
  v_min    bigint := (v_rules ->> 'min_payable_kobo')::bigint;
  v_pc     jsonb := v_rules -> 'points';
  b        public.profiles%rowtype;
  bn       public.profiles%rowtype;
  v_ben    uuid := coalesce(p_beneficiary, p_buyer);
  it       public.catalog_items%rowtype;
  px       public.prices%rowtype;
  pbe      public.price_book_entries%rowtype;
  dc       public.discount_codes%rowtype;
  v_lines  jsonb := '[]'::jsonb;
  v_flags  jsonb := '[]'::jsonb;
  v_list   bigint; v_cur bigint; v_third bigint := 0; v_svc bigint := 0; v_k text;
  v_contract bigint; v_h bigint; v_spons bigint := 0; v_due bigint; v_room bigint; v_tfunded bigint := 0;
  v_norm text; v_code_ok boolean; v_total_used integer; v_person_used integer; v_disc bigint := 0; v_raw bigint;
  v_bal integer := 0; v_res integer := 0; v_steps integer; v_points integer := 0; v_pred bigint := 0; v_svc_left bigint;
begin
  select * into b from public.profiles where id = p_buyer;
  select * into bn from public.profiles where id = v_ben;
  select * into it from public.catalog_items where organisation_id = b.organisation_id and code = p_code;
  if not found or not it.active or it.audience <> 'patient' then raise exception 'item_not_available' using errcode = 'P0001'; end if;
  px := private.current_price(it.id);
  if px.id is null then raise exception 'item_not_available' using errcode = 'P0001'; end if;
  -- the Membership is sold only behind its go-live guard (OQ-324). A test pair passes, as in S37 (a test patient is never a real sale).
  if it.kind = 'membership' and not private.go_live_open_patient('membership_billing_enabled', v_ben) then
    raise exception 'membership_not_open' using errcode = 'P0001';
  end if;

  -- third-party cost and Tarragon's own service fee come from the price's components (empty components: no split is known, so no floor and no points)
  for v_k in select jsonb_array_elements_text(v_rules -> 'third_party_component_keys') loop
    v_third := v_third + coalesce((px.components ->> v_k)::bigint, 0);
  end loop;
  v_svc := coalesce((px.components ->> (v_rules ->> 'service_fee_component_key'))::bigint, 0);

  -- 1 list price
  v_list := px.amount_kobo; v_cur := v_list;
  v_lines := v_lines || private.quote_line('list', 'quote.line.list', v_list, v_cur);

  -- 2 institutional price book: the beneficiary is a member when they are in an active cohort of the book's sponsor (S38e)
  select e.* into pbe
    from public.price_book_entries e join public.price_books pb on pb.id = e.price_book_id
   where e.catalog_item_id = it.id and e.valid_from <= now() and (e.valid_to is null or e.valid_to > now())
     and pb.status = 'active' and pb.organisation_id = b.organisation_id and pb.is_test = coalesce(bn.is_test, false)
     and exists (select 1 from public.profile_cohorts pc join public.sponsor_cohorts sc on sc.id = pc.cohort_id
                  where pc.patient_id = v_ben and pc.left_at is null and sc.status = 'active' and sc.sponsor_org_id = pb.sponsor_org_id
                    and (now() at time zone 'Africa/Lagos')::date between sc.valid_from and sc.valid_to)
   order by e.rate_kobo, e.id limit 1;
  if pbe.id is not null then
    v_contract := greatest(least(pbe.rate_kobo, v_list), v_third);
    if v_contract > pbe.rate_kobo then v_flags := v_flags || to_jsonb('price_book_floored_at_third_party_cost'::text); end if;
    v_tfunded := v_tfunded + (v_list - v_contract);
    v_cur := v_contract;
    v_lines := v_lines || private.quote_line('price_book', 'quote.line.price_book', v_contract - v_list, v_cur);
  end if;

  -- 3 hardship (seam, see above)
  v_h := least(coalesce(private.hardship_reduction(v_ben, it.id, v_cur), 0), greatest(v_cur - v_third, 0));
  if v_h > 0 then
    v_cur := v_cur - v_h;
    v_lines := v_lines || private.quote_line('hardship', 'quote.line.hardship', -v_h, v_cur);
  end if;

  -- 4 sponsor coverage: the sponsor's share of what is left
  if pbe.id is not null and pbe.sponsor_share_percent > 0 then
    v_spons := (v_cur * pbe.sponsor_share_percent) / 100;
  end if;
  v_due := v_cur - v_spons;
  if v_spons > 0 then v_lines := v_lines || private.quote_line('sponsor', 'quote.line.sponsor', -v_spons, v_due); end if;

  -- what Tarragon-funded reductions may still take off: never below third-party cost, never leaving the buyer under the minimum
  v_room := least(greatest(v_cur - v_third, 0), greatest(v_due - v_min, 0));

  -- 5 discount code (one per order)
  v_norm := private.normalise_discount_code(p_discount);
  if v_norm is not null then
    select * into dc from public.discount_codes d
     where d.organisation_id = b.organisation_id and d.code = v_norm and d.status = 'active'
       and d.valid_from <= now() and d.valid_to > now() and d.is_test = coalesce(bn.is_test, false)
       and (cardinality(d.item_codes) = 0 or it.code = any (d.item_codes))
       and (d.cohort_id is null or exists (select 1 from public.profile_cohorts pc where pc.patient_id = v_ben and pc.cohort_id = d.cohort_id and pc.left_at is null));
    v_code_ok := dc.id is not null;
    if v_code_ok then
      select count(*) into v_total_used from public.discount_redemptions r
       where r.discount_code_id = dc.id and r.state in ('reserved', 'redeemed') and r.is_test = coalesce(bn.is_test, false);
      select count(*) into v_person_used from public.discount_redemptions r
       where r.discount_code_id = dc.id and r.beneficiary_id = v_ben and r.state in ('reserved', 'redeemed');
      if v_total_used >= dc.max_total_uses or v_person_used >= dc.max_uses_per_person then v_code_ok := false; end if;
    end if;
    if v_code_ok then
      v_raw := case dc.kind when 'percent' then (v_due * dc.percent) / 100 else dc.fixed_kobo end;
      v_disc := greatest(least(v_raw, coalesce(dc.max_discount_kobo, v_raw), v_room), 0);
      v_due := v_due - v_disc; v_room := v_room - v_disc; v_tfunded := v_tfunded + v_disc;
      v_lines := v_lines || private.quote_line('discount_code', 'quote.line.discount_code', -v_disc, v_due, true,
                   case when v_disc < v_raw then 'quote.reason.limited' else null end);
    else
      v_lines := v_lines || private.quote_line('discount_code', 'quote.line.discount_code', 0, v_due, false, 'quote.reason.code_unusable');
    end if;
  end if;

  -- 6 points: a single-use reduction on Tarragon's own service fee only (S72-1, D2). Off until the rules say so.
  if coalesce(p_use_points, false) then
    if not (v_pc ->> 'enabled')::boolean then
      v_lines := v_lines || private.quote_line('points', 'quote.line.points', 0, v_due, false, 'quote.reason.points_off');
    elsif v_svc <= 0 then
      v_lines := v_lines || private.quote_line('points', 'quote.line.points', 0, v_due, false, 'quote.reason.points_not_for_item');
    else
      select coalesce(balance, 0) into v_bal from public.wellness_points_balances where patient_id = p_buyer;
      select coalesce(sum(points_applied), 0) into v_res from public.orders where buyer_profile_id = p_buyer and state = 'created' and expires_at > now();
      v_svc_left := greatest(v_svc - v_tfunded, 0);
      v_steps := least(
        greatest(coalesce(v_bal, 0) - v_res, 0) / (v_pc ->> 'points_per_step')::integer,
        (v_pc ->> 'max_steps_per_order')::integer,
        ((v_svc_left * (v_pc ->> 'max_percent_of_service_fee')::integer) / 100) / (v_pc ->> 'reduction_per_step_kobo')::bigint,
        v_room / (v_pc ->> 'reduction_per_step_kobo')::bigint);
      if v_steps >= 1 then
        v_points := v_steps * (v_pc ->> 'points_per_step')::integer;
        v_pred := v_steps * (v_pc ->> 'reduction_per_step_kobo')::bigint;
        v_due := v_due - v_pred; v_room := v_room - v_pred; v_tfunded := v_tfunded + v_pred;
        v_lines := v_lines || private.quote_line('points', 'quote.line.points', -v_pred, v_due);
      else
        v_lines := v_lines || private.quote_line('points', 'quote.line.points', 0, v_due, false, 'quote.reason.points_none_available');
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'item_code', it.code, 'item_kind', it.kind, 'currency', 'NGN',
    'price_id', px.id, 'price_valid_from', px.valid_from, 'pricing_rules_version', v_ver,
    'price_book_entry_id', pbe.id, 'list_kobo', v_list, 'sponsor_share_kobo', v_spons,
    'discount_code_id', case when coalesce(v_code_ok, false) then dc.id else null end, 'discount_code_ok', v_code_ok,
    'discount_kobo', v_disc, 'points_applied', v_points, 'points_reduction_kobo', v_pred,
    'floor_kobo', v_third, 'amount_due_kobo', v_due, 'lines', v_lines, 'flags', v_flags);
end $$;
revoke all on function private.price_quote_calc(uuid, uuid, text, text, boolean) from public, anon, authenticated;

-- failed tries in the last hour, for the guess limit
create function private.discount_tries_left(p_patient uuid) returns boolean
language sql stable security definer set search_path = ''
as $$ select (select count(*) from public.discount_code_attempts where patient_id = p_patient and at > now() - interval '1 hour')
            < (private.pricing_rules() ->> 'code_failed_tries_per_hour')::integer $$;
revoke all on function private.discount_tries_left(uuid) from public, anon, authenticated;

create function public.price_quote(p_code text, p_beneficiary uuid default null, p_discount_code text default null, p_use_points boolean default false)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_ben uuid;
  v_code text := nullif(btrim(coalesce(p_discount_code, '')), '');
  v_limited boolean := false;
  q jsonb;
  v_org uuid;
begin
  if v_uid is null then raise exception 'order_not_authorised' using errcode = '42501'; end if;
  select organisation_id into v_org from public.profiles where id = v_uid and role = 'patient' and is_active;
  if v_org is null then raise exception 'order_not_authorised' using errcode = '42501'; end if;
  v_ben := coalesce(p_beneficiary, v_uid);
  perform private.order_beneficiary_check(v_uid, v_ben);
  if not coalesce((select is_enabled from public.platform_modules where key = 'v5_checkout'), false) then
    raise exception 'checkout_not_open' using errcode = 'P0001';
  end if;
  if v_code is not null and not private.discount_tries_left(v_uid) then v_limited := true; v_code := null; end if;
  q := private.price_quote_calc(v_uid, v_ben, p_code, v_code, coalesce(p_use_points, false));
  if v_code is not null and not (q ->> 'discount_code_ok')::boolean then
    insert into public.discount_code_attempts (organisation_id, patient_id) values (v_org, v_uid);
  end if;
  if v_limited then q := q || jsonb_build_object('discount_code_ok', false, 'discount_error', 'rate_limited'); end if;
  -- the buyer sees the explanation, never the ids of another person's rows
  return q - 'discount_code_id' - 'price_book_entry_id';
end $$;

-- ---------------------------------------------------------------------------
-- 8. create_order calls the quote. DROPPED and re-created: a second overload with defaulted extras would make every 3-argument call ambiguous.
-- ---------------------------------------------------------------------------
drop function public.create_order(text, uuid, uuid);
create function public.create_order(
  p_code text, p_client_key uuid default null, p_beneficiary uuid default null,
  p_discount_code text default null, p_use_points boolean default false, p_expected_amount_kobo bigint default null)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_ben uuid;
  pr public.profiles%rowtype;
  it public.catalog_items%rowtype;
  o public.orders%rowtype;
  q jsonb;
  v_code text := nullif(btrim(coalesce(p_discount_code, '')), '');
  v_due bigint;
begin
  if v_uid is null then raise exception 'order_not_authorised' using errcode = '42501'; end if;
  select * into pr from public.profiles where id = v_uid and role = 'patient' and is_active;
  if not found then raise exception 'order_not_authorised' using errcode = '42501'; end if;
  v_ben := coalesce(p_beneficiary, v_uid);
  perform private.order_beneficiary_check(v_uid, v_ben);

  if p_client_key is not null then
    select * into o from public.orders where buyer_profile_id = v_uid and client_key = p_client_key;
    if found then
      return jsonb_build_object('order_id', o.id, 'reference', o.paystack_reference, 'amount_kobo', o.amount_kobo, 'state', o.state, 'checkout_url', o.checkout_url, 'replay', true);
    end if;
  end if;

  if not coalesce((select is_enabled from public.platform_modules where key = 'v5_checkout'), false) then
    raise exception 'checkout_not_open' using errcode = 'P0001';
  end if;
  select * into it from public.catalog_items where organisation_id = pr.organisation_id and code = p_code;
  if not found or not it.active or it.audience <> 'patient' then raise exception 'item_not_available' using errcode = 'P0001'; end if;
  -- S29c: for someone else, only the full yearly Membership (founder 2026-10-06). Nothing smaller, nothing per item.
  if v_ben <> v_uid and not private.gift_item_allowed(it.kind::text, it.duration_days) then
    raise exception 'gift_item_not_allowed' using errcode = 'P0001';
  end if;
  if private.current_price(it.id) is null then raise exception 'item_not_available' using errcode = 'P0001'; end if;

  if it.kind = 'membership' and exists (
       select 1 from public.patient_memberships m where m.patient_id = v_ben and m.state = 'active' and (m.ends_at is null or m.ends_at > now())) then
    raise exception 'already_member' using errcode = 'P0001';
  end if;
  if it.grants_lead and not exists (select 1 from private.lead_candidates(v_ben, '{}', true)) then
    raise exception 'no_capacity' using errcode = 'P0001';
  end if;
  if (select count(*) from public.orders where buyer_profile_id = v_uid and state = 'created' and created_at > now() - interval '1 hour') >= 5 then
    raise exception 'too_many_open_orders' using errcode = 'P0001';
  end if;

  -- a code that cannot be used is REPORTED, not raised, so the failed try is kept (a raise would roll it back) and guessing stays slow
  if v_code is not null and not private.discount_tries_left(v_uid) then
    return jsonb_build_object('order_id', null, 'error', 'discount_code_rate_limited');
  end if;
  q := private.price_quote_calc(v_uid, v_ben, p_code, v_code, coalesce(p_use_points, false));
  if v_code is not null and not (q ->> 'discount_code_ok')::boolean then
    insert into public.discount_code_attempts (organisation_id, patient_id) values (pr.organisation_id, v_uid);
    return jsonb_build_object('order_id', null, 'error', 'discount_code_invalid');
  end if;

  v_due := (q ->> 'amount_due_kobo')::bigint;
  -- quote == charge: the amount the person was shown is the amount charged, or nothing is charged
  if p_expected_amount_kobo is not null and p_expected_amount_kobo <> v_due then raise exception 'quote_changed' using errcode = 'P0001'; end if;
  if (q ->> 'sponsor_share_kobo')::bigint > 0 then raise exception 'sponsor_billing_not_open' using errcode = 'P0001'; end if;
  if v_due <= 0 then raise exception 'order_fully_covered' using errcode = 'P0001'; end if;

  insert into public.orders (organisation_id, buyer_profile_id, beneficiary_patient_id, catalog_item_id, price_id, amount_kobo, components,
                             paystack_reference, client_key, is_test,
                             list_amount_kobo, sponsor_share_kobo, discount_code_id, discount_kobo, points_applied, points_reduction_kobo,
                             price_book_entry_id, pricing_rules_version, quote)
  values (pr.organisation_id, v_uid, v_ben, it.id, (q ->> 'price_id')::uuid, v_due,
          (select components from public.prices where id = (q ->> 'price_id')::uuid),
          'tho_' || replace(gen_random_uuid()::text, '-', ''), p_client_key, coalesce(pr.is_test, false),
          (q ->> 'list_kobo')::bigint, (q ->> 'sponsor_share_kobo')::bigint, (q ->> 'discount_code_id')::uuid, (q ->> 'discount_kobo')::bigint,
          (q ->> 'points_applied')::integer, (q ->> 'points_reduction_kobo')::bigint,
          (q ->> 'price_book_entry_id')::uuid, (q ->> 'pricing_rules_version')::integer, q)
  on conflict (buyer_profile_id, client_key) where client_key is not null do nothing
  returning * into o;
  if o.id is null then
    select * into o from public.orders where buyer_profile_id = v_uid and client_key = p_client_key;
    return jsonb_build_object('order_id', o.id, 'reference', o.paystack_reference, 'amount_kobo', o.amount_kobo, 'state', o.state, 'checkout_url', o.checkout_url, 'replay', true);
  end if;
  if o.discount_code_id is not null then
    insert into public.discount_redemptions (organisation_id, discount_code_id, order_id, beneficiary_id, reduction_kobo, is_test)
    values (o.organisation_id, o.discount_code_id, o.id, o.beneficiary_patient_id, o.discount_kobo, o.is_test);
  end if;
  return jsonb_build_object('order_id', o.id, 'reference', o.paystack_reference, 'amount_kobo', o.amount_kobo, 'state', o.state, 'checkout_url', null, 'replay', false);
end $$;

-- ---------------------------------------------------------------------------
-- 9. Catalogue reads: patients see only patient items; one item by code for the "what is included" page
-- ---------------------------------------------------------------------------
create or replace function public.catalogue() returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('code', i.code, 'kind', i.kind, 'name_key', i.name_key, 'description_key', i.description_key,
         'included_keys', i.included_keys, 'duration_days', i.duration_days, 'uses', i.uses, 'amount_kobo', p.amount_kobo, 'components', p.components)
         order by i.kind, i.code), '[]'::jsonb)
    from public.catalog_items i
    cross join lateral (select * from private.current_price(i.id)) p
   where i.active and i.audience = 'patient' and p.id is not null
     and i.organisation_id = (select organisation_id from public.profiles where id = (select auth.uid()))
     and coalesce((select is_enabled from public.platform_modules where key = 'v5_checkout'), false)
$$;

-- One item, same shape and same visibility as catalogue(): an item that is not on sale shows nothing (no pre-launch price is leaked).
create function public.catalogue_item(p_code text) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select i.j from (
    select jsonb_build_object('code', i.code, 'kind', i.kind, 'name_key', i.name_key, 'description_key', i.description_key,
           'included_keys', i.included_keys, 'duration_days', i.duration_days, 'uses', i.uses, 'amount_kobo', p.amount_kobo, 'components', p.components) as j
      from public.catalog_items i
      cross join lateral (select * from private.current_price(i.id)) p
     where i.code = p_code and i.active and i.audience = 'patient' and p.id is not null
       and i.organisation_id = (select organisation_id from public.profiles where id = (select auth.uid()))
       and coalesce((select is_enabled from public.platform_modules where key = 'v5_checkout'), false)
  ) i
$$;

-- ---------------------------------------------------------------------------
-- 10. Staff: the toggle, the price (now with an event), price books, discount codes
-- ---------------------------------------------------------------------------
-- Enabling the Membership needs the go-live guard; the concierge service needs its own; an institutional item needs a price book rate.
create or replace function public.set_catalog_item_active(p_code text, p_active boolean, p_reason text) returns void
language plpgsql security definer set search_path = ''
as $$
declare it public.catalog_items%rowtype; v_org uuid := (select organisation_id from public.profiles where id = (select auth.uid()));
begin
  if not private.is_admin() then raise exception 'catalogue_not_authorised' using errcode = '42501'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 10 then raise exception 'catalogue_reason_needed' using errcode = '22023'; end if;
  select * into it from public.catalog_items where organisation_id = v_org and code = p_code for update;
  if not found then raise exception 'unknown_item' using errcode = '22023'; end if;
  if p_active then
    if it.audience = 'institution' then
      if not exists (select 1 from public.price_book_entries e join public.price_books pb on pb.id = e.price_book_id
                      where e.catalog_item_id = it.id and pb.status = 'active' and e.valid_from <= now() and (e.valid_to is null or e.valid_to > now())) then
        raise exception 'item_has_no_price' using errcode = 'P0001';
      end if;
    elsif private.current_price(it.id) is null then
      raise exception 'item_has_no_price' using errcode = 'P0001';
    end if;
    if it.kind = 'membership' and not private.go_live_guard_on('membership_billing_enabled') then
      raise exception 'go_live_guard_closed' using errcode = 'P0001';
    end if;
    if it.kind = 'concierge_coordinator' and not private.go_live_guard_on('concierge_coordinator_enabled') then
      raise exception 'go_live_guard_closed' using errcode = 'P0001';
    end if;
  end if;
  update public.catalog_items set active = p_active, updated_at = now() where id = it.id;
  perform private.log_audit('catalogue.item_active', 'catalog_items', it.id, jsonb_build_object('code', p_code, 'active', p_active, 'reason', p_reason));
end $$;

create or replace function public.set_item_price(p_code text, p_amount_kobo bigint, p_components jsonb, p_reason text, p_valid_from timestamptz default null)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare it public.catalog_items%rowtype; v_org uuid := (select organisation_id from public.profiles where id = (select auth.uid()));
        v_from timestamptz := coalesce(p_valid_from, now()); v_old public.prices%rowtype; v_id uuid;
begin
  if not private.is_admin() then raise exception 'catalogue_not_authorised' using errcode = '42501'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 10 then raise exception 'catalogue_reason_needed' using errcode = '22023'; end if;
  select * into it from public.catalog_items where organisation_id = v_org and code = p_code for update;
  if not found then raise exception 'unknown_item' using errcode = '22023'; end if;
  if it.audience = 'institution' then raise exception 'institutional_item_priced_by_book' using errcode = 'P0001'; end if;
  select * into v_old from public.prices where catalog_item_id = it.id and valid_to is null;
  if found then
    if v_from <= v_old.valid_from then raise exception 'price_start_before_current' using errcode = '22023'; end if;
    update public.prices set valid_to = v_from where id = v_old.id;
  end if;
  insert into public.prices (organisation_id, catalog_item_id, amount_kobo, components, valid_from, created_by, reason)
  values (v_org, it.id, p_amount_kobo, coalesce(p_components, '{}'), v_from, (select auth.uid()), p_reason) returning id into v_id;
  perform private.log_audit('catalogue.price_set', 'catalog_items', it.id, jsonb_build_object('code', p_code, 'amount_kobo', p_amount_kobo, 'reason', p_reason));
  -- S73: price.changed (version 1). Ids and amounts only; nothing about a person. Keyed on the new price row, so a replay emits nothing new.
  perform private.emit_domain_event('price.changed', v_org,
    jsonb_build_object('scope', 'list', 'catalog_item_code', p_code, 'price_id', v_id, 'previous_price_id', v_old.id, 'amount_kobo', p_amount_kobo, 'valid_from', v_from),
    'price:' || v_id, null, 'price', v_id);
  return v_id;
end $$;

create function public.admin_create_price_book(p_sponsor_org uuid, p_name text) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_org uuid := (select organisation_id from public.profiles where id = (select auth.uid())); v_type text; v_id uuid;
begin
  if (select auth.uid()) is null or not private.is_admin() then raise exception 'pricing_not_authorised' using errcode = '42501'; end if;
  select type::text into v_type from public.organisations where id = p_sponsor_org;
  if v_type is null or v_type not in ('hmo', 'corporate', 'ngo') then raise exception 'sponsor_org_invalid' using errcode = '22023'; end if;
  if char_length(btrim(coalesce(p_name, ''))) not between 3 and 80 then raise exception 'price_book_invalid' using errcode = '22023'; end if;
  insert into public.price_books (organisation_id, sponsor_org_id, name, created_by, is_test)
  values (v_org, p_sponsor_org, btrim(p_name), (select auth.uid()), coalesce((select is_test from public.profiles where id = (select auth.uid())), false))
  returning id into v_id;
  perform private.log_audit('pricing.price_book_created', 'price_book', v_id, jsonb_build_object('sponsor_org', p_sponsor_org));
  return v_id;
end $$;

create function public.admin_set_price_book_entry(p_book uuid, p_item_code text, p_rate_kobo bigint, p_sponsor_share_percent integer, p_reason text, p_valid_from timestamptz default null)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_org uuid := (select organisation_id from public.profiles where id = (select auth.uid()));
  pb public.price_books%rowtype; it public.catalog_items%rowtype; px public.prices%rowtype; v_old public.price_book_entries%rowtype;
  v_from timestamptz := coalesce(p_valid_from, now()); v_id uuid; v_third bigint := 0; v_k text; v_rules jsonb := private.pricing_rules();
begin
  if (select auth.uid()) is null or not private.is_admin() then raise exception 'pricing_not_authorised' using errcode = '42501'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 10 then raise exception 'catalogue_reason_needed' using errcode = '22023'; end if;
  select * into pb from public.price_books where id = p_book and organisation_id = v_org for update;
  if not found or pb.status = 'closed' then raise exception 'price_book_not_open' using errcode = 'P0001'; end if;
  select * into it from public.catalog_items where organisation_id = v_org and code = p_item_code;
  if not found then raise exception 'unknown_item' using errcode = '22023'; end if;
  if p_rate_kobo is null or p_rate_kobo <= 0 or p_sponsor_share_percent is null or p_sponsor_share_percent not between 0 and 100 then
    raise exception 'price_book_entry_invalid' using errcode = '22023';
  end if;
  -- a book can only lower a price, and never below what a clinician or partner is owed
  px := private.current_price(it.id);
  if px.id is not null then
    if p_rate_kobo > px.amount_kobo then raise exception 'price_book_rate_above_list' using errcode = 'P0001'; end if;
    for v_k in select jsonb_array_elements_text(v_rules -> 'third_party_component_keys') loop
      v_third := v_third + coalesce((px.components ->> v_k)::bigint, 0);
    end loop;
    if p_rate_kobo < v_third then raise exception 'price_book_rate_below_cost' using errcode = 'P0001'; end if;
  end if;
  select * into v_old from public.price_book_entries where price_book_id = p_book and catalog_item_id = it.id and valid_to is null;
  if found then
    if v_from <= v_old.valid_from then raise exception 'price_start_before_current' using errcode = '22023'; end if;
    update public.price_book_entries set valid_to = v_from where id = v_old.id;
  end if;
  insert into public.price_book_entries (organisation_id, price_book_id, catalog_item_id, rate_kobo, sponsor_share_percent, valid_from, created_by, reason)
  values (v_org, p_book, it.id, p_rate_kobo, p_sponsor_share_percent, v_from, (select auth.uid()), p_reason) returning id into v_id;
  perform private.log_audit('pricing.price_book_entry_set', 'price_book', p_book, jsonb_build_object('code', p_item_code, 'rate_kobo', p_rate_kobo, 'share', p_sponsor_share_percent, 'reason', p_reason));
  perform private.emit_domain_event('price.changed', v_org,
    jsonb_build_object('scope', 'price_book', 'catalog_item_code', p_item_code, 'price_id', v_id, 'previous_price_id', v_old.id, 'amount_kobo', p_rate_kobo, 'valid_from', v_from),
    'price:' || v_id, null, 'price', v_id);
  return v_id;
end $$;

create function public.admin_set_price_book_status(p_book uuid, p_status text, p_reason text) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_org uuid := (select organisation_id from public.profiles where id = (select auth.uid()));
begin
  if (select auth.uid()) is null or not private.is_admin() then raise exception 'pricing_not_authorised' using errcode = '42501'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 10 then raise exception 'catalogue_reason_needed' using errcode = '22023'; end if;
  if p_status not in ('active', 'closed') then raise exception 'price_book_invalid' using errcode = '22023'; end if;
  if not exists (select 1 from public.price_books where id = p_book and organisation_id = v_org) then raise exception 'price_book_not_open' using errcode = 'P0001'; end if;
  if p_status = 'active' and not exists (select 1 from public.price_book_entries where price_book_id = p_book) then raise exception 'price_book_empty' using errcode = 'P0001'; end if;
  update public.price_books set status = p_status where id = p_book;
  perform private.log_audit('pricing.price_book_status', 'price_book', p_book, jsonb_build_object('status', p_status, 'reason', p_reason));
end $$;

create function public.admin_create_discount_code(
  p_code text, p_kind text, p_percent integer, p_fixed_kobo bigint, p_max_discount_kobo bigint, p_item_codes text[], p_cohort_id uuid,
  p_max_total_uses integer, p_max_per_person integer, p_valid_from timestamptz, p_valid_to timestamptz, p_note text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_org uuid := (select organisation_id from public.profiles where id = (select auth.uid()));
  v_code text := private.normalise_discount_code(p_code); v_id uuid; v_try integer := 0;
begin
  if (select auth.uid()) is null or not private.is_admin() then raise exception 'pricing_not_authorised' using errcode = '42501'; end if;
  if p_cohort_id is not null and not exists (select 1 from public.sponsor_cohorts where id = p_cohort_id and organisation_id = v_org) then
    raise exception 'discount_code_invalid' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(coalesce(p_item_codes, '{}')) c where not exists (select 1 from public.catalog_items i where i.organisation_id = v_org and i.code = c)) then
    raise exception 'unknown_item' using errcode = '22023';
  end if;
  if p_code is not null and (v_code is null or char_length(v_code) not between 4 and 24) then raise exception 'discount_code_invalid' using errcode = '22023'; end if;
  loop
    v_try := v_try + 1;
    begin
      insert into public.discount_codes (organisation_id, code, kind, percent, fixed_kobo, max_discount_kobo, item_codes, cohort_id, max_total_uses,
                                         max_uses_per_person, valid_from, valid_to, note, created_by, is_test)
      values (v_org, coalesce(v_code, private.new_cohort_code()), p_kind, p_percent, p_fixed_kobo, p_max_discount_kobo, coalesce(p_item_codes, '{}'), p_cohort_id,
              p_max_total_uses, coalesce(p_max_per_person, 1), p_valid_from, p_valid_to, p_note, (select auth.uid()),
              coalesce((select is_test from public.profiles where id = (select auth.uid())), false))
      returning id, code into v_id, v_code;
      exit;
    exception when unique_violation then
      -- a chosen code that is taken is the admin's problem; a generated one is retried
      if p_code is not null or v_try >= 5 then raise exception 'discount_code_taken' using errcode = '22023'; end if;
    end;
  end loop;
  perform private.log_audit('pricing.discount_code_created', 'discount_code', v_id,
    jsonb_build_object('kind', p_kind, 'percent', p_percent, 'fixed_kobo', p_fixed_kobo, 'max_total_uses', p_max_total_uses, 'valid_to', p_valid_to));
  return jsonb_build_object('id', v_id, 'code', v_code);
end $$;

create function public.admin_set_discount_code_status(p_id uuid, p_status text, p_reason text) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_org uuid := (select organisation_id from public.profiles where id = (select auth.uid()));
begin
  if (select auth.uid()) is null or not private.is_admin() then raise exception 'pricing_not_authorised' using errcode = '42501'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 10 then raise exception 'catalogue_reason_needed' using errcode = '22023'; end if;
  if p_status not in ('active', 'paused', 'ended') then raise exception 'discount_code_invalid' using errcode = '22023'; end if;
  update public.discount_codes set status = p_status,
         valid_to = case when p_status = 'ended' then greatest(valid_from + interval '1 second', least(valid_to, now())) else valid_to end
   where id = p_id and organisation_id = v_org;
  if not found then raise exception 'discount_code_invalid' using errcode = '22023'; end if;
  perform private.log_audit('pricing.discount_code_status', 'discount_code', p_id, jsonb_build_object('status', p_status, 'reason', p_reason));
end $$;

-- Staff overview: books with their entries, codes with their use, the Membership guard. Real (non-test) use only.
create function public.admin_pricing_overview() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_org uuid := (select organisation_id from public.profiles where id = (select auth.uid()));
begin
  if (select auth.uid()) is null or not private.is_admin() then raise exception 'pricing_not_authorised' using errcode = '42501'; end if;
  return jsonb_build_object(
    'rules_version', (select version from public.pricing_config where is_active),
    'points_enabled', (private.pricing_rules() -> 'points' ->> 'enabled')::boolean,
    'membership_guard_on', private.go_live_guard_on('membership_billing_enabled'),
    'books', coalesce((select jsonb_agg(jsonb_build_object('id', pb.id, 'name', pb.name, 'status', pb.status, 'sponsor_org_id', pb.sponsor_org_id,
        'entries', coalesce((select jsonb_agg(jsonb_build_object('item_code', i.code, 'rate_kobo', e.rate_kobo, 'sponsor_share_percent', e.sponsor_share_percent,
            'valid_from', e.valid_from, 'valid_to', e.valid_to, 'reason', e.reason) order by e.valid_from desc)
          from public.price_book_entries e join public.catalog_items i on i.id = e.catalog_item_id where e.price_book_id = pb.id), '[]'::jsonb))
        order by pb.created_at desc) from public.price_books pb where pb.organisation_id = v_org), '[]'::jsonb),
    'codes', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'code', d.code, 'kind', d.kind, 'percent', d.percent, 'fixed_kobo', d.fixed_kobo,
        'status', d.status, 'valid_from', d.valid_from, 'valid_to', d.valid_to, 'max_total_uses', d.max_total_uses, 'max_uses_per_person', d.max_uses_per_person,
        'item_codes', to_jsonb(d.item_codes), 'cohort_id', d.cohort_id,
        'used', (select count(*) from public.discount_redemptions r where r.discount_code_id = d.id and r.state in ('reserved', 'redeemed') and not r.is_test))
        order by d.created_at desc) from public.discount_codes d where d.organisation_id = v_org and not d.is_test), '[]'::jsonb));
end $$;

-- admin_catalogue gains audience and the Membership guard (same shape otherwise)
create or replace function public.admin_catalogue() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_org uuid := (select organisation_id from public.profiles where id = (select auth.uid()));
begin
  if not private.is_admin() then raise exception 'catalogue_not_authorised' using errcode = '42501'; end if;
  return jsonb_build_object(
    'checkout_open', coalesce((select is_enabled from public.platform_modules where key = 'v5_checkout'), false),
    'membership_guard_on', private.go_live_guard_on('membership_billing_enabled'),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'code', i.code, 'kind', i.kind, 'audience', i.audience, 'name_key', i.name_key, 'active', i.active, 'note', i.note, 'duration_days', i.duration_days, 'uses', i.uses,
        'grants_lead', i.grants_lead,
        'paid_orders', (select count(*) from public.orders o where o.catalog_item_id = i.id and o.state = 'paid' and not o.is_test),
        'prices', coalesce((select jsonb_agg(jsonb_build_object('amount_kobo', p.amount_kobo, 'components', p.components, 'valid_from', p.valid_from,
                    'valid_to', p.valid_to, 'reason', p.reason) order by p.valid_from desc) from public.prices p where p.catalog_item_id = i.id), '[]'::jsonb))
        order by i.kind, i.code)
      from public.catalog_items i where i.organisation_id = v_org), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------------
-- 11. Two institutional products (20.7), both OFF, priced only by a price book
-- ---------------------------------------------------------------------------
insert into public.catalog_items (organisation_id, code, kind, audience, name_key, description_key, included_keys, duration_days, active, note)
select o.id, v.code, v.kind, 'institution', v.name_key, v.description_key, v.included, 365, false, v.note
  from (select id from public.organisations order by created_at limit 1) o
 cross join (values
   ('institutional_protocol_per_life', 'institutional_protocol', 'catalog.institutional_protocol_per_life.name', 'catalog.institutional_protocol_per_life.description',
     array['catalog.institutional_protocol_per_life.incl.1', 'catalog.institutional_protocol_per_life.incl.2', 'catalog.institutional_protocol_per_life.incl.3'],
     'Protocol-only programme sold per covered life to employers, HMOs and states (module 20.7). Priced only by a price book entry. Not sold through patient checkout.'),
   ('concierge_coordinator_per_life', 'concierge_coordinator', 'catalog.concierge_coordinator_per_life.name', 'catalog.concierge_coordinator_per_life.description',
     array['catalog.concierge_coordinator_per_life.incl.1', 'catalog.concierge_coordinator_per_life.incl.2'],
     'Human-heavy concierge coordinator service (module 20.7). OFF: cannot be switched on until the concierge_coordinator_enabled go-live guard is on.')
 ) as v(code, kind, name_key, description_key, included, note)
on conflict (organisation_id, code) do nothing;

-- ---------------------------------------------------------------------------
-- 12. Go-live guards (S37 pattern): two new, both born OFF. The conditions function and the attestation list are S28c's, with the new entries added.
--     If S37 changes these functions again, this migration must be rebased on the new definition.
-- ---------------------------------------------------------------------------
insert into public.go_live_guards (key, label, blocks, condition_text, switch_role, enforced_in, not_enforced_in) values
  ('membership_billing_enabled', 'Membership sales', 'Switching the Membership on for sale; creating a Membership order',
   'The Membership has a current price; catalogue checkout is open; the six leftover Paystack Plan codes are disabled; a Membership refund has been tested; admin confirmation', 'admin',
   array['set_catalog_item_active (membership)', 'private.price_quote_calc (membership; used by price_quote and create_order)'],
   'The Membership is a one-off yearly purchase with an end date. There is no automatic renewal anywhere, so there is no recurring charge for this guard to stop.'),
  ('concierge_coordinator_enabled', 'Concierge coordinator service', 'Switching the concierge coordinator service on', 'Named coordinators are in post and credentialed; clinical lead sign-off', 'cmo',
   array['set_catalog_item_active (concierge_coordinator)'],
   'Nothing sells the service through patient checkout. The guard stops the catalogue item being switched on.');

-- S73 adds two go-live guards' conditions to private.go_live_conditions by patching the CURRENT definition in place (re-creating the function whole would discard the branches
-- earlier migrations added, for example S74's settlement guard). It raises if the anchor is not found. Idempotent.
do $patch$
declare
  v_def text := pg_get_functiondef('private.go_live_conditions(text, uuid)'::regprocedure);
  v_anchor constant text := E'\n  end if;\n  -- An unknown key has no conditions';
  v_branches constant text := $b$
  elsif p_key = 'membership_billing_enabled' then
    -- S73 (OQ-324): the Membership is a one-off yearly purchase with an end date and no renewal. Selling it needs a price, an open checkout, the
    -- six leftover Paystack Plan codes disabled by the founder in the Paystack dashboard (the database cannot see Paystack) and a tested refund path.
    return jsonb_build_array(
      private.go_live_cond('membership_price_set', 'The Membership has a current price',
        exists (select 1 from public.catalog_items i where i.kind = 'membership' and i.organisation_id = p_org and (private.current_price(i.id)).id is not null), 'data', null),
      private.go_live_cond('checkout_module_open', 'Catalogue checkout (v5_checkout) is open',
        coalesce((select is_enabled from public.platform_modules where key = 'v5_checkout'), false), 'data', null),
      private.go_live_cond('paystack_plan_codes_disabled', 'The six leftover Paystack Plan codes are disabled in the Paystack dashboard', private.go_live_attested(p_key, 'paystack_plan_codes_disabled'), 'attestation', null),
      private.go_live_cond('refund_path_tested', 'A refund of a paid Membership has been tested end to end', private.go_live_attested(p_key, 'refund_path_tested'), 'attestation', null),
      private.go_live_cond('admin_confirmation', 'Admin confirmation', true, 'switch', 'Given by an admin pressing the switch'));
  elsif p_key = 'concierge_coordinator_enabled' then
    -- S73 (module 20.7): the human-heavy coordinator service is OFF until named, credentialed coordinators exist. A staffing decision, not a software one.
    return jsonb_build_array(
      private.go_live_cond('coordinator_staffing_in_place', 'Named coordinators are in post and credentialed for this service', private.go_live_attested(p_key, 'coordinator_staffing_in_place'), 'attestation', null),
      private.go_live_cond('clinical_lead_signoff', 'Clinical lead sign-off', true, 'switch', 'Given by the Chief Medical Officer pressing the switch'));$b$;
begin
  if v_def like '%membership_billing_enabled%' then return; end if;
  if position(v_anchor in v_def) = 0 then
    raise exception 'private.go_live_conditions no longer ends with the expected fall-through; add the S73 branches by hand' using errcode = '55000';
  end if;
  execute replace(v_def, v_anchor, v_branches || v_anchor);
end $patch$;


-- S73: add its (guard, condition) pairs to the list of conditions a person may record. Patched in place from the CURRENT definition, so every pair other migrations
-- added is kept (re-creating the function whole would discard them). It raises if the anchor is not found. Idempotent.
do $patch$
declare
  v_def text := pg_get_functiondef('public.attest_go_live_condition(text,text,boolean,text)'::regprocedure);
  v_anchor text := E'\')) then\n    raise exception \'that condition is read from the data';
begin
  if position('concierge_coordinator_enabled' in v_def) > 0 and position('coordinator_staffing_in_place' in v_def) > 0 then return; end if;
  if position(v_anchor in v_def) = 0 then
    raise exception 'attest_go_live_condition: anchor not found, refusing to rewrite';
  end if;
  execute replace(v_def, v_anchor,
    E'\'),\n       (\'membership_billing_enabled\', \'paystack_plan_codes_disabled\'),
       (\'membership_billing_enabled\', \'refund_path_tested\'),
       (\'concierge_coordinator_enabled\', \'coordinator_staffing_in_place\')) then\n    raise exception \'that condition is read from the data');
end $patch$;
revoke all on function public.attest_go_live_condition(text, text, boolean, text) from public, anon;
grant execute on function public.attest_go_live_condition(text, text, boolean, text) to authenticated;



-- ---------------------------------------------------------------------------
-- 13. Grants
-- ---------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'public.price_quote(text,uuid,text,boolean)', 'public.create_order(text,uuid,uuid,text,boolean,bigint)', 'public.catalogue()', 'public.catalogue_item(text)',
    'public.set_catalog_item_active(text,boolean,text)', 'public.set_item_price(text,bigint,jsonb,text,timestamptz)', 'public.admin_catalogue()',
    'public.admin_create_price_book(uuid,text)', 'public.admin_set_price_book_entry(uuid,text,bigint,integer,text,timestamptz)',
    'public.admin_set_price_book_status(uuid,text,text)',
    'public.admin_create_discount_code(text,text,integer,bigint,bigint,text[],uuid,integer,integer,timestamptz,timestamptz,text)',
    'public.admin_set_discount_code_status(uuid,text,text)', 'public.admin_pricing_overview()',
    'public.attest_go_live_condition(text,text,boolean,text)']
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
revoke all on function private.orders_state_machine(), private.price_books_guard(), private.price_book_entries_immutable(), private.discount_codes_guard() from public, anon, authenticated;
-- as S37b left it: not executable by PUBLIC (so not by anon); the dashboard functions that call it run as their owner, and the S37 proof calls it as a signed-in role
revoke all on function private.go_live_conditions(text, uuid) from public;

-- ---------------------------------------------------------------------------
-- 14. The migration proves what it claims
-- ---------------------------------------------------------------------------
do $$
declare f text; t text;
begin
  foreach f in array array[
    'public.price_quote(text,uuid,text,boolean)', 'public.create_order(text,uuid,uuid,text,boolean,bigint)', 'public.catalogue()', 'public.catalogue_item(text)',
    'public.set_catalog_item_active(text,boolean,text)', 'public.set_item_price(text,bigint,jsonb,text,timestamptz)', 'public.admin_catalogue()',
    'public.admin_create_price_book(uuid,text)', 'public.admin_set_price_book_entry(uuid,text,bigint,integer,text,timestamptz)',
    'public.admin_set_price_book_status(uuid,text,text)',
    'public.admin_create_discount_code(text,text,integer,bigint,bigint,text[],uuid,integer,integer,timestamptz,timestamptz,text)',
    'public.admin_set_discount_code_status(uuid,text,text)', 'public.admin_pricing_overview()', 'public.attest_go_live_condition(text,text,boolean,text)',
    'private.price_quote_calc(uuid,uuid,text,text,boolean)', 'private.pricing_rules()', 'private.orders_pricing_effects()', 'private.order_beneficiary_check(uuid,uuid)',
    'private.hardship_reduction(uuid,uuid,bigint)', 'private.discount_tries_left(uuid)', 'private.go_live_conditions(text,uuid)']
  loop
    if has_function_privilege('anon', f, 'EXECUTE') then raise exception 'S73: anon can execute %', f; end if;
  end loop;
  foreach f in array array['private.price_quote_calc(uuid,uuid,text,text,boolean)', 'private.pricing_rules()', 'private.orders_pricing_effects()', 'private.order_beneficiary_check(uuid,uuid)'] loop
    if has_function_privilege('authenticated', f, 'EXECUTE') then raise exception 'S73: authenticated can execute %', f; end if;
  end loop;
  foreach t in array array['pricing_config', 'price_books', 'price_book_entries', 'discount_codes', 'discount_redemptions', 'discount_code_attempts'] loop
    if has_table_privilege('anon', 'public.' || t, 'SELECT') or has_table_privilege('authenticated', 'public.' || t, 'SELECT')
       or has_table_privilege('authenticated', 'public.' || t, 'INSERT') or has_table_privilege('authenticated', 'public.' || t, 'UPDATE')
       or has_table_privilege('authenticated', 'public.' || t, 'DELETE') then
      raise exception 'S73: % is reachable by anon or authenticated', t;
    end if;
    if not (select relrowsecurity from pg_class where oid = ('public.' || t)::regclass) then raise exception 'S73: % has no RLS', t; end if;
  end loop;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'create_order') <> 1 then
    raise exception 'S73: create_order must have exactly one signature';
  end if;
  if not exists (select 1 from public.event_type_versions where event_type = 'price.changed' and version = 1) then raise exception 'S73: price.changed is not registered'; end if;
  if (select count(*) from public.go_live_guards where key in ('membership_billing_enabled', 'concierge_coordinator_enabled') and not is_on) <> 2 then
    raise exception 'S73: the two new guards must exist and be off';
  end if;
  if exists (select 1 from public.catalog_items where kind in ('institutional_protocol', 'concierge_coordinator') and (active or audience <> 'institution')) then
    raise exception 'S73: institutional items must be off and institutional';
  end if;
end $$;
