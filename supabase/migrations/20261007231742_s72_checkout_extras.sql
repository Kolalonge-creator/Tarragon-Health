-- S72: checkout and payments, part 2 (Module 19, functions 19.8 to 19.13).
--
-- What this migration does
--   1. REMOVES the Health Points kobo conversion (19.9; decision S72-1; OQ-08, OQ-321, OQ-330): redeem_wellness_points, wellness_points_config.points_to_kobo_rate
--      and the wellness_points_redemptions table. Points stay what S73 made them: a single-use reduction on Tarragon's own service fee, tied to one order,
--      never a balance, never turned into a voucher. COUNT FIRST (CLAUDE.md removal pattern). The counts below come from docs/BUILD-PROGRESS.md and the OQ
--      evidence (S73 recorded zero real redemptions); production could NOT be queried while writing this, so the counts MUST be re-verified before this
--      is applied. The migration therefore FAILS SAFE: it aborts with a clear message if any redemption belongs to a non-test person.
--        wellness_points_redemptions rows for real (non-test) patients : expected 0, checked below, abort if above 0
--        wellness_points_redemptions rows for test patients             : dropped with the table (INV-13: test data)
--        wellness_points_ledger rows with reason 'redeemed_to_voucher'  : KEPT as history (a ledger is never rewritten); no function can add another
--   2. THE COMMUNITY ACCESS FUND (19.11; decision S72-3, OQ-323): donations (restricted gifts, never a balance, INV-09), access_fund_grants (an
--      order-bound sponsor entitlement through an S71 sponsor_programme with a budget ceiling), published criteria (versioned PROPOSED config), an audited
--      operations approval function (a reason is required, a second approver is not), a public transparent report with one minimum-cell rule, the events
--      donation.received (registered) and sponsor_entitlement.granted (S71's trigger; a grant is just another programme). Behind a go-live guard that is
--      born OFF. NO Paystack call exists in this feature: a donation is a PLEDGE that operations confirm when the bank transfer arrives.
--   3. PAYMENT REQUESTS (19.13): a person asks a supporter to pay for one specific item from a link. The link code is unguessable and stored only as an
--      HMAC under a Vault pepper (the OQ-223 pattern); the page shows only a generic item name and the amount (INV-07); the request expires, can be cancelled,
--      is single use, rate limited, and cannot be used to pay for any other item or person (a trigger on orders refuses it).
--   4. ENTITLEMENTS (19.12): my_entitlements() adds where each entitlement came from (paid, supporter, sponsor, Community Access Fund) and days left.
--   5. my_orders() gains is_buyer and refund_state so a refund request can be made from the phone (19.8).
--
-- Decisions made here that the founder should read (see docs/design/S72.md)
--   * A grant is realised through the SPONSOR slot of the S73 quote (a programme with eligibility 'access_grant'), not through private.hardship_reduction().
--     The hardship slot stays 0 on purpose: a reduction there could not be bound to one order, reserved against the grant's ceiling, ledgered, or
--     reversed on a refund. Two paths for the same money would double count (OQ-329 is answered, not skipped).
--   * Payment requests accept only what a supporter may buy for someone else (private.gift_item_allowed: the full yearly Membership), because founder
--     decision S29c (2026-10-06) says nothing smaller can be a gift. If one-off items ever return, this follows without a change here.
--   * No ledger posting for a donation or a grant yet: restricted-fund accounting needs a finance and counsel decision (OQ-421). Nothing is real until the
--     guard is on, and the guard has the counsel opinion as an attestation condition.
--
-- Timestamp: this stamp is deliberately ahead of the clock so it sorts after S71's 20261007223107 (OQ-334); it is not a round number.
-- Merge order: after S71, S73, S70, S74. It replaces ONLY private.sponsor_match (the S71 body plus one branch), public.my_orders and public.admin_sponsor_programmes,
-- and WRAPS (renames, never replaces) private.go_live_conditions and public.attest_go_live_condition as S71 did, so every older guard keeps its conditions.

-- ---------------------------------------------------------------------------
-- 0. Count first, then remove the kobo conversion (19.9)
-- ---------------------------------------------------------------------------
do $$
declare v_real bigint; v_test bigint;
begin
  select count(*) into v_real from public.wellness_points_redemptions r join public.profiles p on p.id = r.patient_id where not coalesce(p.is_test, false);
  select count(*) into v_test from public.wellness_points_redemptions r join public.profiles p on p.id = r.patient_id where coalesce(p.is_test, false);
  if v_real > 0 then
    raise exception 'S72: % real wellness point redemption(s) exist. Dropping wellness_points_redemptions would lose them. Reconcile the issued reward vouchers with the founder (OQ-321) first, then re-run.', v_real
      using errcode = 'P0001';
  end if;
  raise notice 'S72 removal count: real redemptions % (must be 0), test redemptions % (dropped with the table)', v_real, v_test;
end $$;

drop function if exists public.redeem_wellness_points(integer);
drop table public.wellness_points_redemptions;
-- The registries that list patient tables must not keep a row for a table that no longer exists (the patient-data export walks data_registry and would fail on it).
delete from public.data_registry where table_name = 'wellness_points_redemptions';
delete from public.staff_read_scope where table_name = 'wellness_points_redemptions';
alter table public.wellness_points_config drop column points_to_kobo_rate;

-- ---------------------------------------------------------------------------
-- 1. Versioned rules (PROPOSED, owner Founder and counsel; mirrored in the code registry as access_fund.rules and payment_requests.rules)
-- ---------------------------------------------------------------------------
create table public.checkout_extras_config (
  id             uuid primary key default gen_random_uuid(),
  version        integer not null unique check (version >= 1),
  is_active      boolean not null default false,
  effective_from date not null,
  rules          jsonb not null,
  created_at     timestamptz not null default now()
);
create unique index checkout_extras_config_one_active on public.checkout_extras_config ((true)) where is_active;
alter table public.checkout_extras_config add constraint checkout_extras_config_rules_valid check (
  jsonb_typeof(rules) = 'object'
  and jsonb_typeof(rules -> 'access_fund') = 'object' and jsonb_typeof(rules -> 'payment_requests') = 'object'
  and (rules #>> '{access_fund,min_donation_kobo}') ~ '^[0-9]+$' and (rules #>> '{access_fund,min_donation_kobo}')::bigint between 1 and 100000000
  and (rules #>> '{access_fund,max_grant_kobo}') ~ '^[0-9]+$' and (rules #>> '{access_fund,max_grant_kobo}')::bigint between 1 and 100000000000
  and (rules #>> '{access_fund,grant_valid_days}') ~ '^[0-9]+$' and (rules #>> '{access_fund,grant_valid_days}')::integer between 1 and 365
  and (rules #>> '{access_fund,pledge_valid_days}') ~ '^[0-9]+$' and (rules #>> '{access_fund,pledge_valid_days}')::integer between 1 and 90
  and (rules #>> '{access_fund,max_open_pledges}') ~ '^[0-9]+$' and (rules #>> '{access_fund,max_open_pledges}')::integer between 1 and 20
  and jsonb_typeof(rules #> '{access_fund,criteria}') = 'array' and jsonb_array_length(rules #> '{access_fund,criteria}') between 1 and 12
  and (rules #>> '{payment_requests,expiry_days}') ~ '^[0-9]+$' and (rules #>> '{payment_requests,expiry_days}')::integer between 1 and 30
  and (rules #>> '{payment_requests,max_open_per_person}') ~ '^[0-9]+$' and (rules #>> '{payment_requests,max_open_per_person}')::integer between 1 and 50
  and (rules #>> '{payment_requests,creates_per_day}') ~ '^[0-9]+$' and (rules #>> '{payment_requests,creates_per_day}')::integer between 1 and 100
  and (rules #>> '{payment_requests,lookups_per_hour}') ~ '^[0-9]+$' and (rules #>> '{payment_requests,lookups_per_hour}')::integer between 1 and 1000
  and (rules #>> '{payment_requests,payments_per_hour}') ~ '^[0-9]+$' and (rules #>> '{payment_requests,payments_per_hour}')::integer between 1 and 100);

-- checkout-extras-rules-v1-begin (the code registry entries access_fund.rules and payment_requests.rules must equal this; a test fails if they drift)
insert into public.checkout_extras_config (version, is_active, effective_from, rules) values (1, true, '2026-10-07', $json$
{"access_fund":{"min_donation_kobo":100000,"max_grant_kobo":10000000,"grant_valid_days":60,"pledge_valid_days":14,"max_open_pledges":3,"criteria":["care_cost_is_a_barrier","recent_loss_of_income","supporting_a_dependant","referred_by_the_care_team"]},"payment_requests":{"expiry_days":7,"max_open_per_person":5,"creates_per_day":10,"lookups_per_hour":30,"payments_per_hour":10}}
$json$::jsonb);
-- checkout-extras-rules-v1-end
alter table public.checkout_extras_config enable row level security;
revoke all on public.checkout_extras_config from public, anon, authenticated;

create function private.extras_rules() returns jsonb
language sql stable security definer set search_path = ''
as $$ select rules from public.checkout_extras_config where is_active $$;
revoke all on function private.extras_rules() from public, anon, authenticated;

-- The one minimum-cell rule for the Fund's public report. S75's private.suppress_cell is NOT merged into this branch, so this reads the same platform
-- value (outcome_config min_cell, S38b) the other reports read. SWAP THIS BODY for private.suppress_cell when S75 lands (OQ-422).
create function private.fund_min_cell() returns integer
language sql stable security definer set search_path = ''
as $$ select greatest((private.outcome_rule('min_cell') #>> '{}')::integer, 2) $$;
revoke all on function private.fund_min_cell() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Go-live guard for the Fund (born OFF). The two shared functions are WRAPPED, not replaced.
-- ---------------------------------------------------------------------------
insert into public.go_live_guards (key, label, blocks, condition_text, switch_role, enforced_in, not_enforced_in) values
  ('access_fund_enabled', 'Community Access Fund', 'A real person pledging a donation, operations approving a grant, and a grant paying part of an order',
   'Nigerian counsel has given an opinion on the fund holder, tax and charity status (OQ-323); the grant criteria were reviewed and signed off; finance has decided how restricted gifts are accounted for (OQ-421); admin confirmation', 'admin',
   array['pledge_donation (public)', 'ops_approve_access_fund_grant (public)', 'private.sponsor_match (grant programmes)', 'access_fund_public_report (figures)'],
   'A test person passes (the S37 pair rule) so the flow can be proved. No Paystack call exists for donations: a pledge is confirmed by operations when a bank transfer arrives. Nothing here moves money.');

alter function private.go_live_conditions(text, uuid) rename to go_live_conditions_s71;
revoke all on function private.go_live_conditions_s71(text, uuid) from public, anon, authenticated;
create function private.go_live_conditions(p_key text, p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_key = 'access_fund_enabled' then
    return jsonb_build_array(
      private.go_live_cond('counsel_opinion_recorded', 'Nigerian counsel has given an opinion on the fund holder, tax and charity status (OQ-323)', private.go_live_attested(p_key, 'counsel_opinion_recorded'), 'attestation', null),
      private.go_live_cond('grant_criteria_signed_off', 'The published grant criteria were reviewed and signed off', private.go_live_attested(p_key, 'grant_criteria_signed_off'), 'attestation', null),
      private.go_live_cond('restricted_gift_accounting_decided', 'Finance has decided how restricted gifts are accounted for (OQ-421)', private.go_live_attested(p_key, 'restricted_gift_accounting_decided'), 'attestation', null),
      private.go_live_cond('admin_confirmation', 'Admin confirmation', true, 'switch', 'Given by an admin pressing the switch'));
  end if;
  -- An unknown key has no conditions here: ask the function this one wraps. (This exact comment is the anchor that later migrations on main-dev look for when they
  -- add their own branch to private.go_live_conditions in place. Do not reword it.)
  return private.go_live_conditions_s71(p_key, p_org);
end $$;
revoke all on function private.go_live_conditions(text, uuid) from public;

-- S72: add its (guard, condition) pairs to the list of conditions a person may record. Patched in place from the CURRENT definition, so every pair other migrations
-- added is kept (re-creating the function whole would discard them). It raises if the anchor is not found. Idempotent.
do $patch$
declare
  v_def text := pg_get_functiondef('public.attest_go_live_condition(text,text,boolean,text)'::regprocedure);
  v_anchor text := E'\')) then\n    raise exception \'that condition is read from the data';
begin
  if position('access_fund_enabled' in v_def) > 0 and position('restricted_gift_accounting_decided' in v_def) > 0 then return; end if;
  if position(v_anchor in v_def) = 0 then
    raise exception 'attest_go_live_condition: anchor not found, refusing to rewrite';
  end if;
  execute replace(v_def, v_anchor,
    E'\'),\n       (\'access_fund_enabled\', \'counsel_opinion_recorded\'),
       (\'access_fund_enabled\', \'grant_criteria_signed_off\'),
       (\'access_fund_enabled\', \'restricted_gift_accounting_decided\')) then\n    raise exception \'that condition is read from the data');
end $patch$;
revoke all on function public.attest_go_live_condition(text, text, boolean, text) from public, anon;
grant execute on function public.attest_go_live_condition(text, text, boolean, text) to authenticated;


-- ---------------------------------------------------------------------------
-- 3. Donations: restricted gifts, never a balance (INV-09). Operations confirm a bank transfer; there is no Paystack call.
-- ---------------------------------------------------------------------------
create table public.donations (
  id                  uuid primary key default gen_random_uuid(),
  organisation_id     uuid not null references public.organisations (id) on delete restrict,
  donor_profile_id    uuid references public.profiles (id) on delete set null,
  reference           text not null unique check (reference ~ '^CAF-[A-Z0-9]{8}$'),
  amount_kobo         bigint not null check (amount_kobo > 0 and amount_kobo <= 100000000000),
  restricted_item_code text check (restricted_item_code is null or restricted_item_code ~ '^[a-z][a-z0-9_]{2,63}$'),
  state               text not null default 'pledged' check (state in ('pledged', 'received', 'cancelled', 'lapsed')),
  pledge_expires_at   timestamptz not null,
  bank_reference      text check (bank_reference is null or char_length(btrim(bank_reference)) between 4 and 80),
  received_at         timestamptz,
  received_by         uuid references public.profiles (id) on delete set null,
  created_at          timestamptz not null default now(),
  is_test             boolean not null default false,
  check ((state = 'received') = (received_at is not null and bank_reference is not null))
);
create index donations_donor_idx on public.donations (donor_profile_id, created_at desc);
create index donations_pool_idx on public.donations (organisation_id, is_test, state);
alter table public.donations enable row level security;
revoke all on public.donations from public, anon, authenticated;

-- A donation is a fact about money received. What it IS never changes; its state moves forward once. Nothing here lets anyone spend it.
create function private.donations_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'donation_immutable' using errcode = 'P0001'; end if;
  if new.organisation_id is distinct from old.organisation_id or new.donor_profile_id is distinct from old.donor_profile_id and new.donor_profile_id is not null
     or new.reference is distinct from old.reference or new.amount_kobo is distinct from old.amount_kobo
     or new.restricted_item_code is distinct from old.restricted_item_code or new.is_test is distinct from old.is_test
     or new.created_at is distinct from old.created_at then
    raise exception 'donation_immutable' using errcode = 'P0001';
  end if;
  if new.state is distinct from old.state and not ((old.state = 'pledged' and new.state in ('received', 'cancelled', 'lapsed'))
                                                   or (old.state = 'lapsed' and new.state = 'received')) then
    raise exception 'donation_bad_transition % to %', old.state, new.state using errcode = 'P0001';
  end if;
  if old.state = 'received' and (new.bank_reference is distinct from old.bank_reference or new.received_at is distinct from old.received_at) then
    raise exception 'donation_immutable' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all on function private.donations_guard() from public, anon, authenticated;
create trigger donations_guard before update or delete on public.donations for each row execute function private.donations_guard();

insert into public.event_types (event_type, description, owner_section, is_urgent)
values ('donation.received', 'Operations confirmed that a donation to the Community Access Fund arrived (a restricted gift, never a balance)', 'S72', false);
insert into public.event_type_versions (event_type, version, required_keys) values ('donation.received', 1, array['donation_id', 'amount_kobo']);

-- ---------------------------------------------------------------------------
-- 4. Grants: an order-bound sponsor entitlement with a ceiling. The money it can cover is held by the Fund; the person holds no value (INV-09).
-- ---------------------------------------------------------------------------
-- A grant is a sponsor programme of its own (one person, one item, a ceiling), so the S71 reservation, ledger, refund and event machinery apply unchanged.
alter table public.sponsor_programmes drop constraint sponsor_programmes_eligibility_check;
alter table public.sponsor_programmes add constraint sponsor_programmes_eligibility_check check (eligibility in ('cohort', 'hmo_eligibility', 'access_grant'));

create table public.access_fund_grants (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  patient_id      uuid not null references public.profiles (id) on delete restrict,
  item_code       text not null check (item_code ~ '^[a-z][a-z0-9_]{2,63}$'),
  ceiling_kobo    bigint not null check (ceiling_kobo > 0 and ceiling_kobo <= 100000000000),
  criterion_key   text not null check (criterion_key ~ '^[a-z][a-z0-9_]{2,63}$'),
  decision_note   text not null check (char_length(btrim(decision_note)) >= 10),
  status          text not null default 'approved' check (status in ('approved', 'used', 'expired', 'cancelled')),
  approved_by     uuid references public.profiles (id) on delete set null,
  approved_at     timestamptz not null default now(),
  expires_at      timestamptz not null,
  programme_id    uuid not null unique references public.sponsor_programmes (id) on delete restrict,
  order_id        uuid references public.orders (id) on delete restrict,
  used_kobo       bigint check (used_kobo is null or used_kobo >= 0),
  is_test         boolean not null default false,
  created_at      timestamptz not null default now(),
  check ((status = 'used') = (order_id is not null)),
  check (expires_at > approved_at)
);
create unique index access_fund_grants_one_open on public.access_fund_grants (patient_id, item_code) where status in ('approved', 'used');
create index access_fund_grants_pool_idx on public.access_fund_grants (organisation_id, is_test, status);
alter table public.access_fund_grants enable row level security;
revoke all on public.access_fund_grants from public, anon, authenticated;

create function private.access_fund_grants_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'grant_immutable' using errcode = 'P0001'; end if;
  if new.organisation_id is distinct from old.organisation_id or new.patient_id is distinct from old.patient_id or new.item_code is distinct from old.item_code
     or new.ceiling_kobo is distinct from old.ceiling_kobo or new.criterion_key is distinct from old.criterion_key or new.decision_note is distinct from old.decision_note
     or new.programme_id is distinct from old.programme_id or new.expires_at is distinct from old.expires_at or new.is_test is distinct from old.is_test
     or new.approved_at is distinct from old.approved_at then
    raise exception 'grant_immutable' using errcode = 'P0001';
  end if;
  if new.status is distinct from old.status and not ((old.status = 'approved' and new.status in ('used', 'expired', 'cancelled'))
                                                     or (old.status = 'used' and new.status = 'approved')) then   -- a refund of the covered order returns the grant
    raise exception 'grant_bad_transition % to %', old.status, new.status using errcode = 'P0001';
  end if;
  if new.used_kobo is not null and new.used_kobo > new.ceiling_kobo then raise exception 'grant_over_ceiling' using errcode = 'P0001'; end if;
  return new;
end $$;
revoke all on function private.access_fund_grants_guard() from public, anon, authenticated;
create trigger access_fund_grants_guard before update or delete on public.access_fund_grants for each row execute function private.access_fund_grants_guard();

-- The sponsor a grant is booked under: one organisation per Tarragon organisation, created on first use. Its name is what the person sees: "Covered by Community Access Fund".
create function private.fund_sponsor_org(p_org uuid) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v uuid;
begin
  select id into v from public.organisations where type = 'ngo' and name = 'Community Access Fund' and metadata ->> 'access_fund_for' = p_org::text;
  if v is null then
    insert into public.organisations (name, type, metadata) values ('Community Access Fund', 'ngo', jsonb_build_object('access_fund_for', p_org)) returning id into v;
  end if;
  return v;
end $$;
revoke all on function private.fund_sponsor_org(uuid) from public, anon, authenticated;

-- What the Fund has received (general and restricted) and what it has promised, in one organisation and one data class (test never mixes with real, INV-13).
-- A restricted gift can only fund its own item; a general gift funds anything not already funded by a restricted one.
create function private.fund_general_received(p_org uuid, p_test boolean) returns bigint
language sql stable security definer set search_path = ''
as $$ select coalesce(sum(amount_kobo), 0) from public.donations where organisation_id = p_org and is_test = p_test and state = 'received' and restricted_item_code is null $$;
revoke all on function private.fund_general_received(uuid, boolean) from public, anon, authenticated;

create function private.fund_restricted_received(p_org uuid, p_test boolean, p_item text) returns bigint
language sql stable security definer set search_path = ''
as $$ select coalesce(sum(amount_kobo), 0) from public.donations where organisation_id = p_org and is_test = p_test and state = 'received' and restricted_item_code = p_item $$;
revoke all on function private.fund_restricted_received(uuid, boolean, text) from public, anon, authenticated;

-- What the open and used grants hold of the Fund: the ceiling while approved, the amount actually used once used, nothing once expired or cancelled.
create function private.fund_committed(p_org uuid, p_test boolean, p_item text default null) returns bigint
language sql stable security definer set search_path = ''
as $$
  select coalesce(sum(case g.status when 'approved' then g.ceiling_kobo when 'used' then coalesce(g.used_kobo, g.ceiling_kobo) else 0 end), 0)
    from public.access_fund_grants g where g.organisation_id = p_org and g.is_test = p_test and (p_item is null or g.item_code = p_item)
$$;
revoke all on function private.fund_committed(uuid, boolean, text) from public, anon, authenticated;

-- How much of the GENERAL gifts the grants (plus one more, p_add of p_item) would need: each item is first funded from gifts restricted to it.
create function private.fund_general_needed(p_org uuid, p_test boolean, p_item text, p_add bigint) returns bigint
language sql stable security definer set search_path = ''
as $$
  with c as (
    select g.item_code, sum(case g.status when 'approved' then g.ceiling_kobo when 'used' then coalesce(g.used_kobo, g.ceiling_kobo) else 0 end) as amt
      from public.access_fund_grants g where g.organisation_id = p_org and g.is_test = p_test group by g.item_code
    union all select p_item, p_add where p_item is not null and p_add > 0),
  per as (select item_code, sum(amt) as amt from c group by item_code)
  select coalesce(sum(greatest(per.amt - private.fund_restricted_received(p_org, p_test, per.item_code), 0)), 0)::bigint from per
$$;
revoke all on function private.fund_general_needed(uuid, boolean, text, bigint) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. The sponsor match, with one more branch: a grant programme matches only the person it was approved for, only while the grant is approved and unexpired,
--    and only while the Fund's own guard is open. The S71 body is otherwise unchanged (ordering, HMO and cohort rules, the test-pair rule).
-- ---------------------------------------------------------------------------
create or replace function private.sponsor_match(p_beneficiary uuid, p_item uuid, p_sponsor_org uuid default null, p_check_eligibility boolean default true)
returns public.sponsor_programmes
language plpgsql stable security definer set search_path = ''
as $$
declare bn public.profiles%rowtype; it public.catalog_items%rowtype; r public.sponsor_programmes%rowtype; v_sp_open boolean; v_fund_open boolean;
begin
  select * into bn from public.profiles where id = p_beneficiary;
  select * into it from public.catalog_items where id = p_item;
  if bn.id is null or it.id is null then return null; end if;
  v_sp_open := private.go_live_open_patient('sponsor_payment_enabled', p_beneficiary);
  v_fund_open := private.go_live_open_patient('access_fund_enabled', p_beneficiary);
  if not v_sp_open and not v_fund_open then return null; end if;
  select p.* into r from public.sponsor_programmes p
   where p.organisation_id = bn.organisation_id and p.status = 'active' and p.is_test = coalesce(bn.is_test, false)
     and (now() at time zone 'Africa/Lagos')::date between p.valid_from and p.valid_to
     and it.code = any (p.item_codes)
     and (p_sponsor_org is null or p.sponsor_org_id = p_sponsor_org)
     and ((p.eligibility = 'access_grant' and v_fund_open) or (p.eligibility <> 'access_grant' and v_sp_open))
     and (not p_check_eligibility or
          (p.eligibility = 'cohort' and exists (select 1 from public.profile_cohorts pc join public.sponsor_cohorts sc on sc.id = pc.cohort_id
                                                 where pc.patient_id = p_beneficiary and pc.cohort_id = p.cohort_id and pc.left_at is null and sc.status = 'active'
                                                   and (now() at time zone 'Africa/Lagos')::date between sc.valid_from and sc.valid_to))
          or (p.eligibility = 'hmo_eligibility' and exists (select 1 from public.hmo_eligibility_checks h
                                                             where h.patient_id = p_beneficiary and h.hmo_org_id = p.sponsor_org_id and h.result = 'eligible'
                                                               and h.decided_at > now() - make_interval(days => (p.rules ->> 'hmo_check_valid_days')::integer)))
          or (p.eligibility = 'access_grant' and exists (select 1 from public.access_fund_grants g
                                                          where g.programme_id = p.id and g.patient_id = p_beneficiary and g.status = 'approved' and g.expires_at > now())))
     -- a grant programme can never be reached without proving eligibility, even from the price-book path that skips the eligibility check
     and (p.eligibility <> 'access_grant' or exists (select 1 from public.access_fund_grants g
                                                      where g.programme_id = p.id and g.patient_id = p_beneficiary and g.status = 'approved' and g.expires_at > now()))
   order by private.sponsor_budget_left(p.id) desc, p.share_percent desc, p.id
   limit 1;
  if not found then return null; end if;
  return r;
end $$;
revoke all on function private.sponsor_match(uuid, uuid, uuid, boolean) from public, anon, authenticated;

-- A grant's programmes are not "sponsor programmes" to administer by hand; the admin list shows the real ones (the grant list shows the rest).
create or replace function public.admin_sponsor_programmes() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_org uuid := (select organisation_id from public.profiles where id = (select auth.uid())); v jsonb;
begin
  if not private.is_admin() then raise exception 'sponsor_not_authorised' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'sponsor', so.name, 'status', p.status, 'eligibility', p.eligibility, 'share_percent', p.share_percent,
         'budget_kobo', p.budget_kobo,
         'reserved_kobo', coalesce((select sum(r.amount_kobo) from public.sponsor_reservations r where r.programme_id = p.id and r.state = 'reserved'), 0),
         'committed_kobo', coalesce((select sum(r.amount_kobo) from public.sponsor_reservations r where r.programme_id = p.id and r.state = 'committed'), 0),
         'left_kobo', private.sponsor_budget_left(p.id), 'item_codes', p.item_codes, 'valid_from', p.valid_from, 'valid_to', p.valid_to, 'is_test', p.is_test) order by p.created_at desc), '[]'::jsonb)
    into v from public.sponsor_programmes p join public.organisations so on so.id = p.sponsor_org_id
   where p.organisation_id = v_org and p.eligibility <> 'access_grant';
  return v;
end $$;

-- What a state change of the reservation does to its grant: paid -> used; the order ended or refunded -> the grant is available again (until it expires).
create function private.access_grant_reservation_effects() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare g public.access_fund_grants%rowtype;
begin
  if new.state is not distinct from old.state then return new; end if;
  select * into g from public.access_fund_grants where programme_id = new.programme_id for update;
  if not found then return new; end if;
  if new.state = 'committed' and g.status = 'approved' then
    update public.access_fund_grants set status = 'used', order_id = new.order_id, used_kobo = new.amount_kobo where id = g.id;
  elsif new.state = 'released' and g.status = 'used' and g.order_id = new.order_id then
    update public.access_fund_grants set status = 'approved', order_id = null, used_kobo = null where id = g.id;
  end if;
  return new;
end $$;
revoke all on function private.access_grant_reservation_effects() from public, anon, authenticated;
create trigger access_grant_reservation_effects after update of state on public.sponsor_reservations for each row execute function private.access_grant_reservation_effects();

-- ---------------------------------------------------------------------------
-- 6. Operations: confirm a donation, approve and cancel a grant. Admin only; a reason is required; every step is audited. No second approver (decision S72-3).
-- ---------------------------------------------------------------------------
create function public.pledge_donation(p_amount_kobo bigint, p_item_code text default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid()); pr public.profiles%rowtype; r jsonb := private.extras_rules() -> 'access_fund'; v_id uuid; v_ref text; v_exp timestamptz;
begin
  if v_uid is null then raise exception 'donation_not_authorised' using errcode = '42501'; end if;
  select * into pr from public.profiles where id = v_uid and role = 'patient' and is_active;
  if not found then raise exception 'donation_not_authorised' using errcode = '42501'; end if;
  if not private.go_live_open_patient('access_fund_enabled', v_uid) then raise exception 'access_fund_not_open' using errcode = 'P0001'; end if;
  if p_amount_kobo is null or p_amount_kobo < (r ->> 'min_donation_kobo')::bigint or p_amount_kobo > 100000000000 then raise exception 'donation_amount_invalid' using errcode = '22023'; end if;
  if p_item_code is not null and not exists (select 1 from public.catalog_items where organisation_id = pr.organisation_id and code = p_item_code and audience = 'patient' and active) then
    raise exception 'item_not_available' using errcode = 'P0001';
  end if;
  if (select count(*) from public.donations where donor_profile_id = v_uid and state = 'pledged' and pledge_expires_at > now()) >= (r ->> 'max_open_pledges')::integer then
    raise exception 'too_many_open_pledges' using errcode = 'P0001';
  end if;
  v_exp := now() + make_interval(days => (r ->> 'pledge_valid_days')::integer);
  loop
    v_ref := 'CAF-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
    exit when not exists (select 1 from public.donations where reference = v_ref);
  end loop;
  insert into public.donations (organisation_id, donor_profile_id, reference, amount_kobo, restricted_item_code, pledge_expires_at, is_test)
  values (pr.organisation_id, v_uid, v_ref, p_amount_kobo, p_item_code, v_exp, coalesce(pr.is_test, false)) returning id into v_id;
  return jsonb_build_object('donation_id', v_id, 'reference', v_ref, 'amount_kobo', p_amount_kobo, 'pledge_expires_at', v_exp);
end $$;

create function public.cancel_my_donation(p_id uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := (select auth.uid()); d public.donations%rowtype;
begin
  if v_uid is null then raise exception 'donation_not_authorised' using errcode = '42501'; end if;
  select * into d from public.donations where id = p_id and donor_profile_id = v_uid for update;
  if not found then return jsonb_build_object('result', 'not_found'); end if;
  if d.state <> 'pledged' then return jsonb_build_object('result', 'not_pledged', 'state', d.state); end if;
  update public.donations set state = 'cancelled' where id = d.id;
  return jsonb_build_object('result', 'cancelled');
end $$;

-- A donor sees their own gifts and nothing about the pool or any grant: no figure here could be read as something they can spend.
create function public.my_donations() returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'reference', d.reference, 'amount_kobo', d.amount_kobo, 'state',
         case when d.state = 'pledged' and d.pledge_expires_at <= now() then 'lapsed' else d.state end,
         'item_name_key', (select i.name_key from public.catalog_items i where i.organisation_id = d.organisation_id and i.code = d.restricted_item_code),
         'created_at', d.created_at, 'pledge_expires_at', d.pledge_expires_at, 'received_at', d.received_at) order by d.created_at desc), '[]'::jsonb)
    from public.donations d where d.donor_profile_id = (select auth.uid())
$$;

create function public.ops_confirm_donation_received(p_id uuid, p_bank_reference text, p_note text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := (select auth.uid()); v_org uuid := (select organisation_id from public.profiles where id = (select auth.uid())); d public.donations%rowtype;
begin
  if not private.is_admin() then raise exception 'access_fund_not_authorised' using errcode = '42501'; end if;
  if char_length(btrim(coalesce(p_note, ''))) < 10 then raise exception 'access_fund_reason_needed' using errcode = '22023'; end if;
  if char_length(btrim(coalesce(p_bank_reference, ''))) < 4 then raise exception 'bank_reference_needed' using errcode = '22023'; end if;
  select * into d from public.donations where id = p_id and organisation_id = v_org for update;
  if not found then raise exception 'unknown_donation' using errcode = '22023'; end if;
  if d.state not in ('pledged', 'lapsed') then return jsonb_build_object('result', 'not_waiting', 'state', d.state); end if;
  if not d.is_test and not private.go_live_guard_on('access_fund_enabled') then raise exception 'access_fund_not_open' using errcode = 'P0001'; end if;
  update public.donations set state = 'received', received_at = now(), received_by = v_uid, bank_reference = btrim(p_bank_reference) where id = d.id;
  perform private.emit_domain_event('donation.received', d.organisation_id,
    jsonb_build_object('donation_id', d.id, 'amount_kobo', d.amount_kobo, 'restricted', d.restricted_item_code is not null),
    'donation:' || d.id, null, 'donation', d.id);
  perform private.log_audit('access_fund.donation_received', 'donations', d.id, jsonb_build_object('amount_kobo', d.amount_kobo, 'note', p_note));
  return jsonb_build_object('result', 'received');
end $$;

create function public.ops_approve_access_fund_grant(p_patient uuid, p_item_code text, p_ceiling_kobo bigint, p_criterion text, p_note text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid()); v_org uuid := (select organisation_id from public.profiles where id = (select auth.uid()));
  r jsonb := private.extras_rules() -> 'access_fund'; pt public.profiles%rowtype; it public.catalog_items%rowtype; px public.prices%rowtype;
  v_fund uuid; v_prog uuid; v_grant uuid; v_exp timestamptz; v_general bigint;
begin
  if not private.is_admin() then raise exception 'access_fund_not_authorised' using errcode = '42501'; end if;
  if char_length(btrim(coalesce(p_note, ''))) < 10 then raise exception 'access_fund_reason_needed' using errcode = '22023'; end if;
  select * into pt from public.profiles where id = p_patient and role = 'patient' and is_active and organisation_id = v_org;
  if not found or not pt.receives_care then raise exception 'unknown_patient' using errcode = '22023'; end if;
  if not private.go_live_open_patient('access_fund_enabled', p_patient) then raise exception 'access_fund_not_open' using errcode = 'P0001'; end if;
  if not (r -> 'criteria') ? p_criterion then raise exception 'criterion_not_published' using errcode = '22023'; end if;
  select * into it from public.catalog_items where organisation_id = v_org and code = p_item_code and audience = 'patient' and active;
  if not found then raise exception 'item_not_available' using errcode = 'P0001'; end if;
  px := private.current_price(it.id);
  if px.id is null then raise exception 'item_not_available' using errcode = 'P0001'; end if;
  if p_ceiling_kobo is null or p_ceiling_kobo <= 0 or p_ceiling_kobo > (r ->> 'max_grant_kobo')::bigint or p_ceiling_kobo > px.amount_kobo then
    raise exception 'grant_amount_invalid' using errcode = '22023';
  end if;
  if exists (select 1 from public.access_fund_grants where patient_id = p_patient and item_code = p_item_code and status in ('approved', 'used')) then
    raise exception 'grant_already_open' using errcode = 'P0001';
  end if;
  -- the Fund must hold the money: gifts restricted to this item first, then general gifts not already needed by other items
  perform pg_advisory_xact_lock(hashtextextended('access_fund:' || v_org::text, 0));
  v_general := private.fund_general_needed(v_org, coalesce(pt.is_test, false), p_item_code, p_ceiling_kobo);
  if v_general > private.fund_general_received(v_org, coalesce(pt.is_test, false)) then raise exception 'fund_pool_short' using errcode = 'P0001'; end if;

  v_exp := now() + make_interval(days => (r ->> 'grant_valid_days')::integer);
  v_fund := private.fund_sponsor_org(v_org);
  insert into public.sponsor_programmes (organisation_id, sponsor_org_id, name, item_codes, share_percent, budget_kobo, per_person_cap_kobo, eligibility, rules,
                                         valid_from, valid_to, status, created_by, is_test)
  values (v_org, v_fund, 'Community Access Fund grant', array[p_item_code], 100, p_ceiling_kobo, p_ceiling_kobo, 'access_grant', '{}'::jsonb,
          (now() at time zone 'Africa/Lagos')::date, (v_exp at time zone 'Africa/Lagos')::date, 'active', v_uid, coalesce(pt.is_test, false))
  returning id into v_prog;
  insert into public.access_fund_grants (organisation_id, patient_id, item_code, ceiling_kobo, criterion_key, decision_note, approved_by, expires_at, programme_id, is_test)
  values (v_org, p_patient, p_item_code, p_ceiling_kobo, p_criterion, btrim(p_note), v_uid, v_exp, v_prog, coalesce(pt.is_test, false)) returning id into v_grant;
  perform private.log_audit('access_fund.grant_approved', 'access_fund_grants', v_grant,
    jsonb_build_object('item_code', p_item_code, 'ceiling_kobo', p_ceiling_kobo, 'criterion', p_criterion, 'note', p_note));
  return jsonb_build_object('grant_id', v_grant, 'programme_id', v_prog, 'expires_at', v_exp);
end $$;

create function public.ops_cancel_access_fund_grant(p_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_org uuid := (select organisation_id from public.profiles where id = (select auth.uid())); g public.access_fund_grants%rowtype;
begin
  if not private.is_admin() then raise exception 'access_fund_not_authorised' using errcode = '42501'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 10 then raise exception 'access_fund_reason_needed' using errcode = '22023'; end if;
  select * into g from public.access_fund_grants where id = p_id and organisation_id = v_org for update;
  if not found then raise exception 'unknown_grant' using errcode = '22023'; end if;
  if g.status <> 'approved' then return jsonb_build_object('result', 'not_open', 'status', g.status); end if;
  if exists (select 1 from public.sponsor_reservations where programme_id = g.programme_id and state = 'reserved') then
    return jsonb_build_object('result', 'order_in_progress');
  end if;
  update public.access_fund_grants set status = 'cancelled' where id = g.id;
  update public.sponsor_programmes set status = 'closed' where id = g.programme_id;
  perform private.log_audit('access_fund.grant_cancelled', 'access_fund_grants', g.id, jsonb_build_object('reason', p_reason));
  return jsonb_build_object('result', 'cancelled');
end $$;

-- Pledges that were never matched by a transfer lapse, and grants that were never used expire (their programme closes). Safe to call often; admin or the service role.
create function public.expire_access_fund() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_pl integer; v_gr integer; g record;
begin
  if not (private.is_admin() or coalesce((select auth.role()), '') = 'service_role') then raise exception 'access_fund_not_authorised' using errcode = '42501'; end if;
  update public.donations set state = 'lapsed' where state = 'pledged' and pledge_expires_at <= now();
  get diagnostics v_pl = row_count;
  v_gr := 0;
  for g in select * from public.access_fund_grants where status = 'approved' and expires_at <= now()
           and not exists (select 1 from public.sponsor_reservations r where r.programme_id = access_fund_grants.programme_id and r.state = 'reserved') for update loop
    update public.access_fund_grants set status = 'expired' where id = g.id;
    update public.sponsor_programmes set status = 'closed' where id = g.programme_id;
    v_gr := v_gr + 1;
  end loop;
  return jsonb_build_object('pledges_lapsed', v_pl, 'grants_expired', v_gr);
end $$;

-- What operations see: the pool, waiting pledges and open grants. Figures are for staff only.
create function public.admin_access_fund_overview() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_org uuid := (select organisation_id from public.profiles where id = (select auth.uid())); v jsonb;
begin
  if not private.is_admin() then raise exception 'access_fund_not_authorised' using errcode = '42501'; end if;
  select jsonb_build_object(
    'open', private.go_live_guard_on('access_fund_enabled'),
    'criteria', private.extras_rules() #> '{access_fund,criteria}',
    'max_grant_kobo', (private.extras_rules() #>> '{access_fund,max_grant_kobo}')::bigint,
    'real', jsonb_build_object('received_kobo', coalesce((select sum(amount_kobo) from public.donations where organisation_id = v_org and not is_test and state = 'received'), 0),
                               'committed_kobo', private.fund_committed(v_org, false)),
    'test', jsonb_build_object('received_kobo', coalesce((select sum(amount_kobo) from public.donations where organisation_id = v_org and is_test and state = 'received'), 0),
                               'committed_kobo', private.fund_committed(v_org, true)),
    'pledges', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'reference', d.reference, 'amount_kobo', d.amount_kobo, 'restricted_item_code', d.restricted_item_code,
         'state', d.state, 'pledge_expires_at', d.pledge_expires_at, 'created_at', d.created_at, 'is_test', d.is_test) order by d.created_at)
         from public.donations d where d.organisation_id = v_org and (d.state = 'pledged' or (d.state = 'lapsed' and d.created_at > now() - interval '60 days'))), '[]'::jsonb),
    'grants', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'patient_id', g.patient_id, 'item_code', g.item_code, 'ceiling_kobo', g.ceiling_kobo, 'status', g.status,
         'criterion', g.criterion_key, 'expires_at', g.expires_at, 'used_kobo', g.used_kobo, 'is_test', g.is_test) order by g.created_at desc)
         from public.access_fund_grants g where g.organisation_id = v_org), '[]'::jsonb))
    into v;
  return v;
end $$;

-- The person sees only that support exists for an item, when it ends, and its state. Never the reason, the criterion or who approved it.
create function public.my_access_fund_support() returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('item_code', g.item_code, 'item_name_key', (select i.name_key from public.catalog_items i where i.organisation_id = g.organisation_id and i.code = g.item_code),
         'status', case when g.status = 'approved' and g.expires_at <= now() then 'expired' else g.status end, 'expires_at', g.expires_at) order by g.created_at desc), '[]'::jsonb)
    from public.access_fund_grants g where g.patient_id = (select auth.uid())
$$;

-- ---------------------------------------------------------------------------
-- 7. The public transparent report: aggregate only, test data never, small cells withheld whole, no figure that a subtraction could reverse.
--    Reachable only through the server (service role); the website page calls it. The single minimum-cell value is private.fund_min_cell().
-- ---------------------------------------------------------------------------
create function public.access_fund_public_report() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_min integer := private.fund_min_cell(); v_open boolean := private.go_live_guard_on('access_fund_enabled');
  v_dn bigint; v_dk bigint; v_gn bigint; v_gk bigint; v_other_n bigint := 0; v_other_k bigint := 0; v_cells jsonb := '[]'::jsonb; k record;
  v_donations jsonb; v_grants jsonb; v_withheld boolean := false;
begin
  if not v_open then return jsonb_build_object('open', false, 'criteria', private.extras_rules() #> '{access_fund,criteria}', 'min_cell', v_min); end if;
  select count(*), coalesce(sum(amount_kobo), 0) into v_dn, v_dk from public.donations where state = 'received' and not is_test;
  select count(*), coalesce(sum(used_kobo), 0) into v_gn, v_gk from public.access_fund_grants where status = 'used' and not is_test;
  v_donations := case when v_dn >= v_min then jsonb_build_object('count', v_dn, 'total_kobo', v_dk) else jsonb_build_object('withheld', true) end;
  for k in select i.kind::text as kind, count(*) as n, coalesce(sum(g.used_kobo), 0) as kobo
             from public.access_fund_grants g join public.catalog_items i on i.organisation_id = g.organisation_id and i.code = g.item_code
            where g.status = 'used' and not g.is_test group by i.kind order by 1 loop
    if k.n >= v_min then v_cells := v_cells || jsonb_build_object('kind', k.kind, 'count', k.n, 'total_kobo', k.kobo);
    else v_other_n := v_other_n + k.n; v_other_k := v_other_k + k.kobo; end if;
  end loop;
  -- small cells are folded together; if the fold is still small it is dropped AND the totals are withheld, so it cannot be recovered by subtraction
  if v_other_n >= v_min then v_cells := v_cells || jsonb_build_object('kind', 'other', 'count', v_other_n, 'total_kobo', v_other_k);
  elsif v_other_n > 0 then v_withheld := true; end if;
  v_grants := case when v_gn >= v_min and not v_withheld then jsonb_build_object('count', v_gn, 'total_kobo', v_gk, 'by_kind', v_cells)
                   when v_gn >= v_min then jsonb_build_object('by_kind', v_cells, 'totals_withheld', true)
                   else jsonb_build_object('withheld', true) end;
  return jsonb_build_object('open', true, 'min_cell', v_min, 'criteria', private.extras_rules() #> '{access_fund,criteria}', 'donations', v_donations, 'grants', v_grants);
end $$;

-- ---------------------------------------------------------------------------
-- 8. Payment requests (19.13)
-- ---------------------------------------------------------------------------
create table public.payment_requests (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  requester_id    uuid not null references public.profiles (id) on delete restrict,
  beneficiary_id  uuid not null references public.profiles (id) on delete restrict,
  catalog_item_id uuid not null references public.catalog_items (id) on delete restrict,
  code_hash       text not null unique check (code_hash ~ '^[0-9a-f]{64}$'),
  status          text not null default 'open' check (status in ('open', 'pending_payment', 'paid', 'cancelled', 'expired')),
  expires_at      timestamptz not null,
  order_id        uuid unique references public.orders (id) on delete restrict,
  payer_id        uuid references public.profiles (id) on delete set null,
  paid_at         timestamptz,
  cancelled_at    timestamptz,
  created_at      timestamptz not null default now(),
  is_test         boolean not null default false,
  check ((status = 'pending_payment') = (order_id is not null) or status in ('paid', 'cancelled', 'expired')),
  check ((status = 'paid') = (paid_at is not null))
);
create index payment_requests_requester_idx on public.payment_requests (requester_id, created_at desc);
alter table public.payment_requests enable row level security;
revoke all on public.payment_requests from public, anon, authenticated;

create table public.payment_request_attempts (
  id      bigint generated always as identity primary key,
  visitor text not null check (char_length(visitor) between 3 and 80),
  at      timestamptz not null default now()
);
create index payment_request_attempts_idx on public.payment_request_attempts (visitor, at desc);
alter table public.payment_request_attempts enable row level security;
revoke all on public.payment_request_attempts from public, anon, authenticated;

create function private.payment_request_hash(p_code text) returns text
language plpgsql stable security definer set search_path = ''
as $$
declare k text;
begin
  select decrypted_secret into k from vault.decrypted_secrets where name = 'payment_request_pepper';
  -- fail closed: without the secret there is no safe way to look a code up
  if k is null or k = '' then raise exception 'payment_requests_not_configured' using errcode = 'P0001'; end if;
  return encode(extensions.hmac(p_code, k, 'sha256'), 'hex');
end $$;
revoke all on function private.payment_request_hash(text) from public, anon, authenticated;

create function private.payment_request_rate_ok(p_visitor text, p_limit integer) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare v_n integer;
begin
  delete from public.payment_request_attempts where at < now() - interval '1 day' and random() < 0.05;
  insert into public.payment_request_attempts (visitor) values (left(p_visitor, 80));
  select count(*) into v_n from public.payment_request_attempts where visitor = left(p_visitor, 80) and at > now() - interval '1 hour';
  return v_n <= p_limit;
end $$;
revoke all on function private.payment_request_rate_ok(text, integer) from public, anon, authenticated;

alter table public.orders add column payment_request_id uuid references public.payment_requests (id) on delete restrict;
create index orders_payment_request_idx on public.orders (payment_request_id) where payment_request_id is not null;

-- An order made from a request can be nothing but the requested item for the requested person, paid by someone else, while the request is open.
create function private.orders_payment_request_guard() returns trigger language plpgsql security definer set search_path = '' as $$
declare pr public.payment_requests%rowtype;
begin
  if tg_op = 'UPDATE' then
    if new.payment_request_id is distinct from old.payment_request_id then raise exception 'order_immutable' using errcode = 'P0001'; end if;
    return new;
  end if;
  if new.payment_request_id is null then return new; end if;
  select * into pr from public.payment_requests where id = new.payment_request_id for update;
  if not found or pr.status <> 'open' or pr.expires_at <= now() or pr.catalog_item_id <> new.catalog_item_id
     or pr.beneficiary_id <> new.beneficiary_patient_id or new.buyer_profile_id = pr.beneficiary_id or pr.is_test <> new.is_test then
    raise exception 'request_order_mismatch' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all on function private.orders_payment_request_guard() from public, anon, authenticated;
create trigger orders_payment_request_guard before insert or update of payment_request_id on public.orders for each row execute function private.orders_payment_request_guard();

create function private.payment_request_order_effects() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.payment_request_id is null or new.state is not distinct from old.state then return new; end if;
  if new.state = 'paid' then
    update public.payment_requests set status = 'paid', paid_at = now(), payer_id = new.buyer_profile_id, order_id = new.id
     where id = new.payment_request_id and status in ('open', 'pending_payment', 'expired', 'cancelled');
  elsif new.state in ('cancelled', 'failed') then
    -- the attempt ended unpaid: the link works again until it expires
    update public.payment_requests set status = case when expires_at > now() then 'open' else 'expired' end, order_id = null
     where id = new.payment_request_id and status = 'pending_payment' and order_id = new.id;
  end if;
  return new;
end $$;
revoke all on function private.payment_request_order_effects() from public, anon, authenticated;
create trigger payment_request_order_effects after update of state on public.orders for each row execute function private.payment_request_order_effects();

create function public.create_payment_request(p_item_code text, p_beneficiary uuid default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid()); v_ben uuid; pr public.profiles%rowtype; it public.catalog_items%rowtype; r jsonb := private.extras_rules() -> 'payment_requests';
  v_code text; v_id uuid; v_exp timestamptz;
begin
  if v_uid is null then raise exception 'request_not_authorised' using errcode = '42501'; end if;
  select * into pr from public.profiles where id = v_uid and role = 'patient' and is_active;
  if not found then raise exception 'request_not_authorised' using errcode = '42501'; end if;
  v_ben := coalesce(p_beneficiary, v_uid);
  if v_ben <> v_uid and not private.can_act_for(v_ben, 'manage_payments'::public.caregiver_permission) then raise exception 'request_not_authorised' using errcode = '42501'; end if;
  if not coalesce((select is_enabled from public.platform_modules where key = 'v5_checkout'), false) or not private.go_live_open_patient('checkout_enabled', v_ben) then
    raise exception 'checkout_not_open' using errcode = 'P0001';
  end if;
  select * into it from public.catalog_items where organisation_id = pr.organisation_id and code = p_item_code and audience = 'patient' and active;
  if not found or private.current_price(it.id) is null then raise exception 'item_not_available' using errcode = 'P0001'; end if;
  -- what a supporter may buy for someone else (S29c): only the full yearly Membership
  if not private.gift_item_allowed(it.kind::text, it.duration_days) then raise exception 'gift_item_not_allowed' using errcode = 'P0001'; end if;
  if it.kind = 'membership' and exists (select 1 from public.patient_memberships m where m.patient_id = v_ben and m.state = 'active' and (m.ends_at is null or m.ends_at > now())) then
    raise exception 'already_member' using errcode = 'P0001';
  end if;
  if (select count(*) from public.payment_requests where requester_id = v_uid and status in ('open', 'pending_payment') and expires_at > now()) >= (r ->> 'max_open_per_person')::integer
     or (select count(*) from public.payment_requests where requester_id = v_uid and created_at > now() - interval '1 day') >= (r ->> 'creates_per_day')::integer then
    raise exception 'too_many_requests' using errcode = 'P0001';
  end if;
  v_code := 'pr_' || translate(encode(extensions.gen_random_bytes(18), 'base64'), '+/=', '-_');
  v_code := left(v_code, 27);
  v_exp := now() + make_interval(days => (r ->> 'expiry_days')::integer);
  insert into public.payment_requests (organisation_id, requester_id, beneficiary_id, catalog_item_id, code_hash, expires_at, is_test)
  values (pr.organisation_id, v_uid, v_ben, it.id, private.payment_request_hash(v_code), v_exp, coalesce(pr.is_test, false)) returning id into v_id;
  -- the code is returned ONCE; only its hash is stored
  return jsonb_build_object('request_id', v_id, 'code', v_code, 'expires_at', v_exp);
end $$;

create function public.cancel_payment_request(p_id uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := (select auth.uid()); pr public.payment_requests%rowtype;
begin
  if v_uid is null then raise exception 'request_not_authorised' using errcode = '42501'; end if;
  select * into pr from public.payment_requests where id = p_id and requester_id = v_uid for update;
  if not found then return jsonb_build_object('result', 'not_found'); end if;
  if pr.status = 'pending_payment' then return jsonb_build_object('result', 'payment_in_progress'); end if;
  if pr.status <> 'open' then return jsonb_build_object('result', 'not_open', 'status', pr.status); end if;
  update public.payment_requests set status = 'cancelled', cancelled_at = now() where id = pr.id;
  return jsonb_build_object('result', 'cancelled');
end $$;

create function public.my_payment_requests() returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'item_code', i.code, 'name_key', i.name_key,
         'status', case when p.status = 'open' and p.expires_at <= now() then 'expired' else p.status end,
         'created_at', p.created_at, 'expires_at', p.expires_at, 'paid_at', p.paid_at) order by p.created_at desc), '[]'::jsonb)
    from public.payment_requests p join public.catalog_items i on i.id = p.catalog_item_id where p.requester_id = (select auth.uid())
$$;

-- What the link page shows: a generic item name key and the price components. No name, no condition, no reason, nothing about the requester (INV-07).
-- Server only (service role). A visitor id (a hash made by the website) is rate limited; unknown, expired, cancelled and used links all answer in the same shape.
create function public.payment_request_preview(p_code text, p_visitor text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare pr public.payment_requests%rowtype; it public.catalog_items%rowtype; px public.prices%rowtype; r jsonb := private.extras_rules() -> 'payment_requests'; v_status text;
begin
  if p_visitor is null or char_length(p_visitor) < 8 then raise exception 'visitor_needed' using errcode = '22023'; end if;
  if not private.payment_request_rate_ok('v:' || p_visitor, (r ->> 'lookups_per_hour')::integer) then return jsonb_build_object('status', 'rate_limited'); end if;
  if p_code is null or p_code !~ '^pr_[A-Za-z0-9_-]{24}$' then return jsonb_build_object('status', 'unknown'); end if;
  select * into pr from public.payment_requests where code_hash = private.payment_request_hash(p_code);
  if not found then return jsonb_build_object('status', 'unknown'); end if;
  v_status := case when pr.status = 'open' and pr.expires_at <= now() then 'expired' else pr.status end;
  if v_status <> 'open' then return jsonb_build_object('status', v_status); end if;
  select * into it from public.catalog_items where id = pr.catalog_item_id;
  px := private.current_price(it.id);
  if px.id is null or not it.active then return jsonb_build_object('status', 'unavailable'); end if;
  return jsonb_build_object('status', 'open', 'name_key', it.name_key, 'amount_kobo', px.amount_kobo, 'components', px.components, 'expires_at', pr.expires_at);
end $$;

-- The payer (a signed-in patient) turns an open request into an order. The item and the person come from the request, never from the caller. The reply has the
-- same shape as create_order, so the existing checkout edge function can start the payment from it.
create function public.create_request_order(p_code text, p_client_key uuid default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid()); payer public.profiles%rowtype; pr public.payment_requests%rowtype; it public.catalog_items%rowtype; o public.orders%rowtype;
  r jsonb := private.extras_rules() -> 'payment_requests'; q jsonb; v_due bigint;
begin
  if v_uid is null then raise exception 'order_not_authorised' using errcode = '42501'; end if;
  select * into payer from public.profiles where id = v_uid and role = 'patient' and is_active;
  if not found then raise exception 'order_not_authorised' using errcode = '42501'; end if;
  if p_client_key is not null then
    select * into o from public.orders where buyer_profile_id = v_uid and client_key = p_client_key;
    if found then return private.order_replay_reply(o); end if;
  end if;
  if not private.payment_request_rate_ok('u:' || v_uid::text, (r ->> 'payments_per_hour')::integer) then raise exception 'too_many_open_orders' using errcode = 'P0001'; end if;
  if p_code is null or p_code !~ '^pr_[A-Za-z0-9_-]{24}$' then raise exception 'request_not_found' using errcode = 'P0001'; end if;
  select * into pr from public.payment_requests where code_hash = private.payment_request_hash(p_code) for update;
  if not found then raise exception 'request_not_found' using errcode = 'P0001'; end if;
  if pr.status = 'pending_payment' then
    select * into o from public.orders where id = pr.order_id;
    if found and o.buyer_profile_id = v_uid and o.state = 'created' then return private.order_replay_reply(o); end if;
    raise exception 'request_in_use' using errcode = 'P0001';
  end if;
  if pr.status = 'cancelled' then raise exception 'request_cancelled' using errcode = 'P0001'; end if;
  if pr.status = 'paid' then raise exception 'request_used' using errcode = 'P0001'; end if;
  if pr.status = 'expired' or pr.expires_at <= now() then raise exception 'request_expired' using errcode = 'P0001'; end if;
  if pr.beneficiary_id = v_uid then raise exception 'request_own' using errcode = 'P0001'; end if;
  if payer.organisation_id is distinct from pr.organisation_id or coalesce(payer.is_test, false) is distinct from pr.is_test then raise exception 'request_not_payable' using errcode = 'P0001'; end if;
  if not coalesce((select is_enabled from public.platform_modules where key = 'v5_checkout'), false) or not private.go_live_open_patient('checkout_enabled', pr.beneficiary_id) then
    raise exception 'checkout_not_open' using errcode = 'P0001';
  end if;
  select * into it from public.catalog_items where id = pr.catalog_item_id;
  if not it.active or it.audience <> 'patient' or private.current_price(it.id) is null then raise exception 'item_not_available' using errcode = 'P0001'; end if;
  if it.kind = 'membership' and exists (select 1 from public.patient_memberships m where m.patient_id = pr.beneficiary_id and m.state = 'active' and (m.ends_at is null or m.ends_at > now())) then
    raise exception 'already_member' using errcode = 'P0001';
  end if;
  -- the price the supporter pays is the ordinary quote for the person being paid for; cover by a sponsor is theirs to claim, not a supporter's
  q := private.price_quote_calc(v_uid, pr.beneficiary_id, it.code, null, false);
  v_due := (q ->> 'amount_due_kobo')::bigint;
  if (q ->> 'sponsor_share_kobo')::bigint > 0 or v_due <= 0 then raise exception 'request_not_payable' using errcode = 'P0001'; end if;

  insert into public.orders (organisation_id, buyer_profile_id, beneficiary_patient_id, catalog_item_id, price_id, amount_kobo, components,
                             paystack_reference, client_key, is_test,
                             list_amount_kobo, sponsor_share_kobo, discount_code_id, discount_kobo, points_applied, points_reduction_kobo,
                             price_book_entry_id, pricing_rules_version, quote, payment_request_id)
  values (pr.organisation_id, v_uid, pr.beneficiary_id, it.id, (q ->> 'price_id')::uuid, v_due,
          (select components from public.prices where id = (q ->> 'price_id')::uuid),
          'tho_' || replace(gen_random_uuid()::text, '-', ''), p_client_key, pr.is_test,
          (q ->> 'list_kobo')::bigint, 0, null, 0, 0, 0, (q ->> 'price_book_entry_id')::uuid, (q ->> 'pricing_rules_version')::integer, q, pr.id)
  returning * into o;
  update public.payment_requests set status = 'pending_payment', order_id = o.id where id = pr.id;
  return jsonb_build_object('order_id', o.id, 'reference', o.paystack_reference, 'amount_kobo', o.amount_kobo, 'state', o.state, 'checkout_url', null, 'replay', false);
end $$;

-- Idle links and unfinished orders are tidied by this; harmless to call often (admin or the service role).
create function public.expire_payment_requests() returns integer
language plpgsql security definer set search_path = ''
as $$
declare n integer;
begin
  if not (private.is_admin() or coalesce((select auth.role()), '') = 'service_role') then raise exception 'request_not_authorised' using errcode = '42501'; end if;
  update public.payment_requests set status = 'expired' where status = 'open' and expires_at <= now();
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------------------------------------------------------------------------
-- 9. Entitlements with their source and days left (19.12), and orders with who paid and any refund (19.8)
-- ---------------------------------------------------------------------------
create function public.my_entitlements() returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', e.id, 'kind', e.kind, 'state', e.state, 'starts_at', e.starts_at, 'ends_at', e.ends_at, 'remaining_uses', e.remaining_uses, 'name_key', i.name_key,
    'days_left', case when e.state = 'active' and e.ends_at is not null then greatest(ceil(extract(epoch from (e.ends_at - now())) / 86400.0), 0)::integer end,
    'source', case
        when o.sponsor_share_kobo > 0 and exists (select 1 from public.sponsor_reservations sr join public.sponsor_programmes sp on sp.id = sr.programme_id
                                                   where sr.order_id = o.id and sp.eligibility = 'access_grant') then 'access_fund'
        when o.sponsor_share_kobo > 0 then 'sponsor'
        when o.buyer_profile_id <> o.beneficiary_patient_id then 'supporter'
        else 'paid' end,
    'sponsor_name', case when o.sponsor_share_kobo > 0 and not exists (select 1 from public.sponsor_reservations sr join public.sponsor_programmes sp on sp.id = sr.programme_id
                                                                         where sr.order_id = o.id and sp.eligibility = 'access_grant')
                         then (select so.name from public.sponsor_reservations sr join public.sponsor_programmes sp on sp.id = sr.programme_id
                                 join public.organisations so on so.id = sp.sponsor_org_id where sr.order_id = o.id) end,
    'part_covered', o.sponsor_share_kobo > 0 and o.amount_kobo > 0) order by e.created_at desc), '[]'::jsonb)
    from public.entitlements e join public.orders o on o.id = e.order_id join public.catalog_items i on i.id = o.catalog_item_id
   where e.patient_id = (select auth.uid())
$$;

create or replace function public.my_orders() returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('order_id', o.id, 'state', o.state, 'amount_kobo', o.amount_kobo, 'fee_kobo', o.fee_kobo,
         'total_kobo', o.total_kobo, 'code', i.code, 'name_key', i.name_key, 'created_at', o.created_at, 'paid_at', o.paid_at,
         'sponsor_share_kobo', o.sponsor_share_kobo,
         'sponsor_name', (select so.name from public.sponsor_reservations sr join public.sponsor_programmes sp on sp.id = sr.programme_id
                           join public.organisations so on so.id = sp.sponsor_org_id where sr.order_id = o.id),
         'is_buyer', o.buyer_profile_id = (select auth.uid()),
         'refund_state', (select rf.state from public.refunds rf where rf.order_id = o.id order by rf.created_at desc limit 1)) order by o.created_at desc), '[]'::jsonb)
    from public.orders o join public.catalog_items i on i.id = o.catalog_item_id
   where o.buyer_profile_id = (select auth.uid()) or o.beneficiary_patient_id = (select auth.uid())
$$;

-- ---------------------------------------------------------------------------
-- 10. Grants: functions only. New tables are reached through audited functions, never directly.
-- ---------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'public.pledge_donation(bigint,text)', 'public.cancel_my_donation(uuid)', 'public.my_donations()', 'public.my_access_fund_support()',
    'public.ops_confirm_donation_received(uuid,text,text)', 'public.ops_approve_access_fund_grant(uuid,text,bigint,text,text)', 'public.ops_cancel_access_fund_grant(uuid,text)',
    'public.admin_access_fund_overview()', 'public.expire_access_fund()',
    'public.create_payment_request(text,uuid)', 'public.cancel_payment_request(uuid)', 'public.my_payment_requests()', 'public.create_request_order(text,uuid)',
    'public.expire_payment_requests()', 'public.my_entitlements()', 'public.my_orders()', 'public.admin_sponsor_programmes()', 'public.attest_go_live_condition(text,text,boolean,text)']
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  -- server only: the public report and the link preview are called by the website with the service role, never by a browser
  revoke all on function public.access_fund_public_report() from public, anon, authenticated;
  grant execute on function public.access_fund_public_report() to service_role;
  revoke all on function public.payment_request_preview(text, text) from public, anon, authenticated;
  grant execute on function public.payment_request_preview(text, text) to service_role;
  grant execute on function public.expire_access_fund() to service_role;
  grant execute on function public.expire_payment_requests() to service_role;
end $$;

-- ---------------------------------------------------------------------------
-- 11. The migration proves what it claims
-- ---------------------------------------------------------------------------
do $$
declare f text; t text;
begin
  if to_regprocedure('public.redeem_wellness_points(integer)') is not null then raise exception 'S72: redeem_wellness_points still exists'; end if;
  if to_regclass('public.wellness_points_redemptions') is not null then raise exception 'S72: wellness_points_redemptions still exists'; end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'wellness_points_config' and column_name = 'points_to_kobo_rate') then
    raise exception 'S72: points_to_kobo_rate still exists';
  end if;
  foreach t in array array['checkout_extras_config', 'donations', 'access_fund_grants', 'payment_requests', 'payment_request_attempts'] loop
    if has_table_privilege('anon', 'public.' || t, 'SELECT') or has_table_privilege('authenticated', 'public.' || t, 'SELECT')
       or has_table_privilege('authenticated', 'public.' || t, 'INSERT') or has_table_privilege('authenticated', 'public.' || t, 'UPDATE')
       or has_table_privilege('authenticated', 'public.' || t, 'DELETE') then
      raise exception 'S72: % is reachable by anon or authenticated', t;
    end if;
    if not (select relrowsecurity from pg_class where oid = ('public.' || t)::regclass) then raise exception 'S72: % has no RLS', t; end if;
  end loop;
  foreach f in array array[
    'public.pledge_donation(bigint,text)', 'public.my_donations()', 'public.ops_confirm_donation_received(uuid,text,text)', 'public.ops_approve_access_fund_grant(uuid,text,bigint,text,text)',
    'public.access_fund_public_report()', 'public.payment_request_preview(text,text)', 'public.create_payment_request(text,uuid)', 'public.create_request_order(text,uuid)',
    'public.my_entitlements()', 'public.my_orders()', 'public.expire_access_fund()', 'public.expire_payment_requests()', 'public.attest_go_live_condition(text,text,boolean,text)',
    'private.sponsor_match(uuid,uuid,uuid,boolean)', 'private.fund_general_needed(uuid,boolean,text,bigint)', 'private.payment_request_hash(text)', 'private.go_live_conditions(text,uuid)']
  loop
    if has_function_privilege('anon', f, 'EXECUTE') then raise exception 'S72: anon can execute %', f; end if;
  end loop;
  foreach f in array array['public.access_fund_public_report()', 'public.payment_request_preview(text,text)', 'private.sponsor_match(uuid,uuid,uuid,boolean)', 'private.payment_request_hash(text)',
                           'private.fund_general_needed(uuid,boolean,text,bigint)', 'private.go_live_conditions_s71(text,uuid)'] loop
    if has_function_privilege('authenticated', f, 'EXECUTE') then raise exception 'S72: authenticated can execute %', f; end if;
  end loop;
  if not exists (select 1 from public.event_type_versions where event_type = 'donation.received' and version = 1) then raise exception 'S72: donation.received is not registered'; end if;
  if (select count(*) from public.go_live_guards where key = 'access_fund_enabled' and not is_on) <> 1 then raise exception 'S72: the access_fund_enabled guard must exist and be off'; end if;
  if jsonb_array_length(private.go_live_conditions('access_fund_enabled', null)) <> 4 or jsonb_array_length(private.go_live_conditions('checkout_enabled', null)) < 4
     or jsonb_array_length(private.go_live_conditions('sponsor_payment_enabled', null)) < 3 or jsonb_array_length(private.go_live_conditions('membership_billing_enabled', null)) < 4 then
    raise exception 'S72: a guard lost its conditions through the wrapper';
  end if;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'create_order') <> 1 then raise exception 'S72: create_order must have exactly one signature'; end if;
  if exists (select 1 from public.donations) or exists (select 1 from public.access_fund_grants) or exists (select 1 from public.payment_requests) then raise exception 'S72: no row may exist at migration time'; end if;
end $$;
