-- S71: Module 19, part 1 (functions 19.1 to 19.7): core checkout, sponsor-paid items, HMO eligibility.
-- Design: docs/design/S71.md. Research: docs/research/S71.md. Founder decisions: docs/DECISIONS.md S71-1 (HMO adapter + manual fallback, hashed
-- member number, no capitation), S72-2 (no instalments). Resolves OQ-328 (sponsor billing), OQ-192 (any profile_access grantee could pay and read),
-- extends OQ-223 (HMAC pattern), OQ-07 (order-linked sponsor checkout, counsel before live use), OQ-184 (checkout go-live condition).
--
-- Stamp 20261007223107: later than every stamp other branches use (S70/S74/S75 sit at 211347 to 220513). Ahead of the clock (OQ-334); pin the
-- version to the filename when applying. MERGE ORDER: this file REPLACES nothing wholesale that S70/S74 touch. go_live_conditions and
-- attest_go_live_condition are WRAPPED (renamed to *_base, the wrapper handles the two new guards and hands every other key to the base), so
-- whatever definition is live when this runs is kept. It must sort AFTER the S70 and S74 migrations; applied before them, their
-- create-or-replace of go_live_conditions would silently remove the new guards' conditions (the proof asserts the conditions exist).
-- The four older RLS policies (OQ-192) are rewritten from their LIVE text at run time (regexp on pg_policies), not from a copy, so a later
-- change to the rest of those policies (S39b) is kept.
--
-- Standing lessons applied: no hand-typed round timestamp; every new table has RLS on and NO grant to authenticated or anon (staff and patients
-- go through audited security-definer functions); every function is revoked from public (anon inherits execute through PUBLIC); create_order is
-- CREATE OR REPLACEd with the SAME six-argument signature (no new overload, so no 42725 ambiguity); explicit enum casts in every can_read_clinical
-- and can_act_for call; pgvector not used; no stored balance (INV-09): a sponsor's budget is a ceiling held at the sponsor, never value a person holds.

-- ---------------------------------------------------------------------------
-- 1. OQ-192: who may pay, who may read (profile_access without a permission check)
-- ---------------------------------------------------------------------------
-- An unexpired grant that carries at least one permission (NULL permissions is the full legacy grant). Used by the profile row policy only.
create function private.profile_access_active(p_profile uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profile_access pa
     where pa.profile_id = p_profile and pa.grantee_user_id = (select auth.uid())
       and (pa.expires_at is null or pa.expires_at > now())
       and (pa.permissions is null or cardinality(pa.permissions) > 0))
$$;
revoke all on function private.profile_access_active(uuid) from public, anon;
grant execute on function private.profile_access_active(uuid) to authenticated;

-- Rewrites the bare "any grantee" EXISTS clause of one SELECT policy to the permission-aware check, from the policy's LIVE text.
create function pg_temp.s71_tighten(p_table text, p_policy text, p_col text, p_replacement text) returns void
language plpgsql as $f$
declare v_qual text; v_new text; v_pat text;
begin
  select qual into v_qual from pg_policies where schemaname = 'public' and tablename = p_table and policyname = p_policy;
  if v_qual is null then raise exception 'S71: policy %.% not found', p_table, p_policy; end if;
  v_pat := 'EXISTS \( SELECT 1\s+FROM profile_access pa\s+WHERE \(\(pa\.profile_id = ' || p_table || '\.' || p_col
        || '\) AND \(pa\.grantee_user_id = \( SELECT auth\.uid\(\) AS uid\)\)\)\)';
  v_new := regexp_replace(v_qual, v_pat, p_replacement);
  if v_new = v_qual then raise exception 'S71: the bare profile_access clause was not found in %.% (merge order: check S39b and the live policy)', p_table, p_policy; end if;
  execute format('alter policy %I on public.%I using (%s)', p_policy, p_table, v_new);
end $f$;

select pg_temp.s71_tighten('profiles', 'profiles_select', 'id', 'private.profile_access_active(id)');
select pg_temp.s71_tighten('booking_requests', 'booking_requests_select', 'profile_id', $r$private.can_read_clinical(profile_id, 'view_appointments'::public.caregiver_permission)$r$);
select pg_temp.s71_tighten('vaccination_adverse_events', 'vaccination_adverse_events_select', 'patient_id', $r$private.can_read_clinical(patient_id, 'vaccinations'::public.care_access_category)$r$);
select pg_temp.s71_tighten('vaccination_card_extractions', 'vaccination_card_extractions_select', 'patient_id', $r$private.can_read_clinical(patient_id, 'vaccinations'::public.care_access_category)$r$);

-- The payer: a Care Circle member holding pay_for_care, or an older caregiver grant at manage level whose permissions include manage_payments
-- (the vocabulary the caregiver enforcement of 2026-09-02 already uses). A bare view grant, or a manage grant without that permission, is refused.
create or replace function private.order_beneficiary_check(p_buyer uuid, p_beneficiary uuid) returns void
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
               or private.can_act_for(v_ben, 'manage_payments'::public.caregiver_permission)) then
      raise exception 'order_beneficiary_not_allowed' using errcode = '42501';
    end if;
  end if;
end $$;
revoke all on function private.order_beneficiary_check(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Catalogue breadth (19.1): the home_kit kind, and three placeholders that are OFF and UNPRICED (no price is invented)
-- ---------------------------------------------------------------------------
do $$
declare c text;
begin
  select conname into c from pg_constraint
   where conrelid = 'public.catalog_items'::regclass and contype = 'c' and conname = 'catalog_items_kind_check';
  if c is null then raise exception 'S71: catalog_items_kind_check not found'; end if;
  alter table public.catalog_items drop constraint catalog_items_kind_check;
  alter table public.catalog_items add constraint catalog_items_kind_check
    check (kind in ('consultation', 'care_pack', 'lab_panel', 'membership', 'home_kit', 'institutional_protocol', 'concierge_coordinator'));
  select conname into c from pg_constraint
   where conrelid = 'public.entitlements'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%consultation_credit%care_pack%lab_panel%membership%';
  if c is null then raise exception 'S71: the entitlements kind check was not found'; end if;
  execute format('alter table public.entitlements drop constraint %I', c);
  alter table public.entitlements add constraint entitlements_kind_check
    check (kind in ('consultation_credit', 'care_pack', 'lab_panel', 'membership', 'home_kit'));
end $$;

insert into public.catalog_items (organisation_id, code, kind, name_key, description_key, included_keys, uses, active, note)
select org.organisation_id, v.code, v.kind, v.name_key, v.description_key, v.included, v.uses, false,
       'PLACEHOLDER (S71, OQ-400): no founder price exists, so there is no price row and the item cannot be switched on. The founder prices it with set_item_price, then switches it on.'
  from (select distinct organisation_id from public.catalog_items where code = 'membership_annual') org
 cross join (values
   ('consultation_single', 'consultation', 'catalog.consultation_single.name', 'catalog.consultation_single.description', array['catalog.consultation_single.incl.1', 'catalog.consultation_single.incl.2'], 1),
   ('lab_panel_standard', 'lab_panel', 'catalog.lab_panel_standard.name', 'catalog.lab_panel_standard.description', array['catalog.lab_panel_standard.incl.1', 'catalog.lab_panel_standard.incl.2'], null::integer),
   ('home_kit_sample', 'home_kit', 'catalog.home_kit_sample.name', 'catalog.home_kit_sample.description', array['catalog.home_kit_sample.incl.1', 'catalog.home_kit_sample.incl.2'], null::integer)
 ) as v(code, kind, name_key, description_key, included, uses)
on conflict (organisation_id, code) do nothing;

-- ---------------------------------------------------------------------------
-- 3. Versioned rules (PROPOSED, owner Founder; mirrored in the code registry as sponsor.rules)
-- ---------------------------------------------------------------------------
create table public.sponsor_config (
  id             uuid primary key default gen_random_uuid(),
  version        integer not null unique check (version >= 1),
  is_active      boolean not null default false,
  effective_from date not null,
  rules          jsonb not null,
  created_at     timestamptz not null default now()
);
create unique index sponsor_config_one_active on public.sponsor_config ((true)) where is_active;
alter table public.sponsor_config add constraint sponsor_config_rules_valid check (
  jsonb_typeof(rules) = 'object'
  and (rules ->> 'hmo_checks_per_day') ~ '^[0-9]+$' and (rules ->> 'hmo_checks_per_day')::integer between 1 and 50
  and (rules ->> 'member_number_min_length') ~ '^[0-9]+$' and (rules ->> 'member_number_max_length') ~ '^[0-9]+$'
  and (rules ->> 'member_number_min_length')::integer between 3 and 10
  and (rules ->> 'member_number_max_length')::integer between 10 and 60);

-- sponsor-rules-v1-begin (the code registry entry sponsor.rules must equal this; a test fails if they drift)
insert into public.sponsor_config (version, is_active, effective_from, rules) values (1, true, '2026-10-07', $json$
{"hmo_checks_per_day":5,"member_number_min_length":4,"member_number_max_length":40}
$json$::jsonb);
-- sponsor-rules-v1-end
alter table public.sponsor_config enable row level security;
revoke all on public.sponsor_config from public, anon, authenticated;

create function private.sponsor_rules() returns jsonb
language sql stable security definer set search_path = ''
as $$ select rules from public.sponsor_config where is_active $$;
revoke all on function private.sponsor_rules() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Sponsor programmes and their budget reservations (19.5; OQ-328)
-- ---------------------------------------------------------------------------
create table public.sponsor_programmes (
  id                   uuid primary key default gen_random_uuid(),
  organisation_id      uuid not null references public.organisations (id) on delete restrict,
  sponsor_org_id       uuid not null references public.organisations (id) on delete restrict,
  name                 text not null check (char_length(btrim(name)) between 3 and 80),
  item_codes           text[] not null check (cardinality(item_codes) between 1 and 40),
  share_percent        integer not null check (share_percent between 1 and 100),
  budget_kobo          bigint not null check (budget_kobo > 0 and budget_kobo <= 100000000000),
  per_person_cap_kobo  bigint check (per_person_cap_kobo is null or per_person_cap_kobo > 0),
  eligibility          text not null check (eligibility in ('cohort', 'hmo_eligibility')),
  cohort_id            uuid references public.sponsor_cohorts (id) on delete restrict,
  rules                jsonb not null default '{}'::jsonb check (jsonb_typeof(rules) = 'object'),
  valid_from           date not null,
  valid_to             date not null,
  status               text not null default 'draft' check (status in ('draft', 'active', 'closed')),
  created_by           uuid references public.profiles (id) on delete set null,
  created_at           timestamptz not null default now(),
  is_test              boolean not null default false,
  check (valid_to >= valid_from),
  check ((eligibility = 'cohort') = (cohort_id is not null)),
  check (eligibility <> 'hmo_eligibility' or (coalesce((rules ->> 'hmo_check_valid_days') ~ '^[0-9]+$', false) and (rules ->> 'hmo_check_valid_days')::integer between 1 and 365))
);
create index sponsor_programmes_sponsor_idx on public.sponsor_programmes (sponsor_org_id, status);
alter table public.sponsor_programmes enable row level security;
revoke all on public.sponsor_programmes from public, anon, authenticated;

-- What a programme IS cannot change after it is created (the same rule as discount codes and price books). Only its status moves forward, and its
-- budget moves through admin_set_sponsor_programme_budget (which sets a transaction-local flag this trigger reads).
create function private.sponsor_programmes_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'sponsor_programme_immutable' using errcode = 'P0001'; end if;
  if new.organisation_id is distinct from old.organisation_id or new.sponsor_org_id is distinct from old.sponsor_org_id or new.name is distinct from old.name
     or new.item_codes is distinct from old.item_codes or new.share_percent is distinct from old.share_percent
     or new.per_person_cap_kobo is distinct from old.per_person_cap_kobo or new.eligibility is distinct from old.eligibility
     or new.cohort_id is distinct from old.cohort_id or new.rules is distinct from old.rules or new.valid_from is distinct from old.valid_from
     or new.valid_to > old.valid_to or new.is_test is distinct from old.is_test then
    raise exception 'sponsor_programme_immutable' using errcode = 'P0001';
  end if;
  if new.budget_kobo is distinct from old.budget_kobo and coalesce(current_setting('tarragon.sponsor_budget_edit', true), '') <> '1' then
    raise exception 'sponsor_programme_immutable' using errcode = 'P0001';
  end if;
  if old.status = 'closed' and new.status <> 'closed' then raise exception 'sponsor_programme_closed' using errcode = 'P0001'; end if;
  return new;
end $$;
revoke all on function private.sponsor_programmes_guard() from public, anon, authenticated;
create trigger sponsor_programmes_guard before update or delete on public.sponsor_programmes for each row execute function private.sponsor_programmes_guard();

create table public.sponsor_reservations (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  programme_id    uuid not null references public.sponsor_programmes (id) on delete restrict,
  order_id        uuid not null unique references public.orders (id) on delete restrict,
  beneficiary_id  uuid not null references public.profiles (id) on delete restrict,
  amount_kobo     bigint not null check (amount_kobo > 0),
  state           text not null default 'reserved' check (state in ('reserved', 'committed', 'released')),
  created_at      timestamptz not null default now(),
  settled_at      timestamptz,
  is_test         boolean not null default false,
  check ((state = 'reserved') = (settled_at is null))
);
create index sponsor_reservations_programme_idx on public.sponsor_reservations (programme_id, state);
create index sponsor_reservations_person_idx on public.sponsor_reservations (programme_id, beneficiary_id) where state in ('reserved', 'committed');
alter table public.sponsor_reservations enable row level security;
revoke all on public.sponsor_reservations from public, anon, authenticated;

create function private.sponsor_reservations_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'sponsor_reservation_immutable' using errcode = 'P0001'; end if;
  if new.programme_id is distinct from old.programme_id or new.order_id is distinct from old.order_id or new.amount_kobo is distinct from old.amount_kobo
     or new.beneficiary_id is distinct from old.beneficiary_id or new.is_test is distinct from old.is_test then
    raise exception 'sponsor_reservation_immutable' using errcode = 'P0001';
  end if;
  if new.state is distinct from old.state and not ((old.state = 'reserved' and new.state in ('committed', 'released')) or (old.state = 'committed' and new.state = 'released')) then
    raise exception 'sponsor_reservation_bad_transition' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all on function private.sponsor_reservations_guard() from public, anon, authenticated;
create trigger sponsor_reservations_guard before update or delete on public.sponsor_reservations for each row execute function private.sponsor_reservations_guard();

-- budget left = the ceiling minus what is reserved or committed. Never negative in practice (reserve locks the programme row), clamped anyway.
create function private.sponsor_budget_left(p_programme uuid) returns bigint
language sql stable security definer set search_path = ''
as $$
  select greatest(p.budget_kobo - coalesce((select sum(r.amount_kobo) from public.sponsor_reservations r where r.programme_id = p.id and r.state in ('reserved', 'committed')), 0), 0)
    from public.sponsor_programmes p where p.id = p_programme
$$;
revoke all on function private.sponsor_budget_left(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. HMO eligibility (19.6): a hashed member number, an adapter result or a manual operations result. No capitation, no HMO billing (I8).
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'hmo_member_pepper') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'hmo_member_pepper',
                                'HMAC key for HMO member number hashes (S71). Rotating it makes every stored eligibility hash unmatchable.');
  end if;
end $$;

create function private.hmo_member_normalise(p text) returns text
language sql immutable set search_path = ''
as $$ select upper(regexp_replace(coalesce(p, ''), '[\s-]', '', 'g')) $$;
revoke all on function private.hmo_member_normalise(text) from public, anon, authenticated;

create function private.hmo_member_hash(p_number text) returns text
language plpgsql stable security definer set search_path = ''
as $$
declare k text; n text := private.hmo_member_normalise(p_number); r jsonb := private.sponsor_rules();
begin
  if n !~ '^[A-Z0-9/]+$' or char_length(n) < (r ->> 'member_number_min_length')::integer or char_length(n) > (r ->> 'member_number_max_length')::integer then
    raise exception 'member_number_invalid' using errcode = '22023';
  end if;
  select decrypted_secret into k from vault.decrypted_secrets where name = 'hmo_member_pepper';
  -- fail closed: without the secret there is no safe way to hash a member number
  if k is null or k = '' then raise exception 'hmo_not_configured' using errcode = 'P0001'; end if;
  return encode(extensions.hmac(n, k, 'sha256'), 'hex');
end $$;
revoke all on function private.hmo_member_hash(text) from public, anon, authenticated;

create table public.hmo_eligibility_checks (
  id                 uuid primary key default gen_random_uuid(),
  organisation_id    uuid not null references public.organisations (id) on delete restrict,
  patient_id         uuid not null references public.profiles (id) on delete restrict,
  hmo_org_id         uuid not null references public.organisations (id) on delete restrict,
  member_number_hash text not null check (member_number_hash ~ '^[0-9a-f]{64}$'),
  result             text not null default 'pending_manual' check (result in ('pending_manual', 'eligible', 'not_eligible')),
  decided_via        text check (decided_via in ('adapter', 'manual')),
  adapter            text check (adapter is null or adapter ~ '^[a-z][a-z0-9_]{1,40}$'),
  checked_at         timestamptz not null default now(),
  decided_at         timestamptz,
  verified_by        uuid references public.profiles (id) on delete set null,
  note               text check (note is null or char_length(note) <= 500),
  is_test            boolean not null default false,
  check ((result = 'pending_manual') = (decided_via is null)),
  check ((result = 'pending_manual') = (decided_at is null)),
  check (decided_via is distinct from 'manual' or verified_by is not null)
);
create index hmo_eligibility_checks_patient_idx on public.hmo_eligibility_checks (patient_id, hmo_org_id, checked_at desc);
create index hmo_eligibility_checks_pending_idx on public.hmo_eligibility_checks (checked_at) where result = 'pending_manual';
alter table public.hmo_eligibility_checks enable row level security;
revoke all on public.hmo_eligibility_checks from public, anon, authenticated;

create function private.hmo_checks_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'hmo_check_immutable' using errcode = 'P0001'; end if;
  if new.patient_id is distinct from old.patient_id or new.hmo_org_id is distinct from old.hmo_org_id
     or new.member_number_hash is distinct from old.member_number_hash or new.checked_at is distinct from old.checked_at
     or new.is_test is distinct from old.is_test or new.organisation_id is distinct from old.organisation_id then
    raise exception 'hmo_check_immutable' using errcode = 'P0001';
  end if;
  if old.result <> 'pending_manual' then raise exception 'hmo_check_decided' using errcode = 'P0001'; end if;
  return new;
end $$;
revoke all on function private.hmo_checks_guard() from public, anon, authenticated;
create trigger hmo_checks_guard before update or delete on public.hmo_eligibility_checks for each row execute function private.hmo_checks_guard();

-- ---------------------------------------------------------------------------
-- 6. Which programme covers this person for this item (used by the quote)
-- ---------------------------------------------------------------------------
-- p_sponsor_org: restrict to one sponsor (the price-book path already proved cohort membership, so it passes p_check_eligibility false).
-- The person must be eligible: a member of the programme's cohort, or holding a passing HMO check for the programme's sponsor that is still valid.
-- A real (non-test) programme sells only while the sponsor_payment_enabled guard is on; a test pair passes, as in S37.
create function private.sponsor_match(p_beneficiary uuid, p_item uuid, p_sponsor_org uuid default null, p_check_eligibility boolean default true)
returns public.sponsor_programmes
language plpgsql stable security definer set search_path = ''
as $$
declare bn public.profiles%rowtype; it public.catalog_items%rowtype; r public.sponsor_programmes%rowtype;
begin
  select * into bn from public.profiles where id = p_beneficiary;
  select * into it from public.catalog_items where id = p_item;
  if bn.id is null or it.id is null then return null; end if;
  if not private.go_live_open_patient('sponsor_payment_enabled', p_beneficiary) then return null; end if;
  select p.* into r from public.sponsor_programmes p
   where p.organisation_id = bn.organisation_id and p.status = 'active' and p.is_test = coalesce(bn.is_test, false)
     and (now() at time zone 'Africa/Lagos')::date between p.valid_from and p.valid_to
     and it.code = any (p.item_codes)
     and (p_sponsor_org is null or p.sponsor_org_id = p_sponsor_org)
     and (not p_check_eligibility or
          (p.eligibility = 'cohort' and exists (select 1 from public.profile_cohorts pc join public.sponsor_cohorts sc on sc.id = pc.cohort_id
                                                 where pc.patient_id = p_beneficiary and pc.cohort_id = p.cohort_id and pc.left_at is null and sc.status = 'active'
                                                   and (now() at time zone 'Africa/Lagos')::date between sc.valid_from and sc.valid_to))
          or (p.eligibility = 'hmo_eligibility' and exists (select 1 from public.hmo_eligibility_checks h
                                                             where h.patient_id = p_beneficiary and h.hmo_org_id = p.sponsor_org_id and h.result = 'eligible'
                                                               and h.decided_at > now() - make_interval(days => (p.rules ->> 'hmo_check_valid_days')::integer))))
   order by private.sponsor_budget_left(p.id) desc, p.share_percent desc, p.id
   limit 1;
  if not found then return null; end if;
  return r;
end $$;
revoke all on function private.sponsor_match(uuid, uuid, uuid, boolean) from public, anon, authenticated;

-- What this person has already used of one programme (reserved or committed), for the per-person cap.
create function private.sponsor_person_used(p_programme uuid, p_beneficiary uuid) returns bigint
language sql stable security definer set search_path = ''
as $$ select coalesce(sum(amount_kobo), 0) from public.sponsor_reservations where programme_id = p_programme and beneficiary_id = p_beneficiary and state in ('reserved', 'committed') $$;
revoke all on function private.sponsor_person_used(uuid, uuid) from public, anon, authenticated;

-- Reserve budget for one order. The programme row is locked first, so two orders at the same moment cannot both take the last of the budget.
create function private.sponsor_reserve(p_order uuid, p_programme uuid, p_amount bigint) returns void
language plpgsql security definer set search_path = ''
as $$
declare o public.orders%rowtype; p public.sponsor_programmes%rowtype;
begin
  select * into o from public.orders where id = p_order;
  select * into p from public.sponsor_programmes where id = p_programme for update;
  if not found or p.status <> 'active' then raise exception 'sponsor_billing_not_open' using errcode = 'P0001'; end if;
  if p_amount > private.sponsor_budget_left(p.id) then raise exception 'sponsor_budget_exhausted' using errcode = 'P0001'; end if;
  if p.per_person_cap_kobo is not null and private.sponsor_person_used(p.id, o.beneficiary_patient_id) + p_amount > p.per_person_cap_kobo then
    raise exception 'sponsor_budget_exhausted' using errcode = 'P0001';
  end if;
  insert into public.sponsor_reservations (organisation_id, programme_id, order_id, beneficiary_id, amount_kobo, is_test)
  values (o.organisation_id, p.id, o.id, o.beneficiary_patient_id, p_amount, o.is_test);
end $$;
revoke all on function private.sponsor_reserve(uuid, uuid, bigint) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The quote and the order (S73's functions, with the sponsor programme step and the checkout guard added; same signatures)
-- ---------------------------------------------------------------------------
create or replace function private.price_quote_calc(p_buyer uuid, p_beneficiary uuid, p_code text, p_discount text, p_use_points boolean)
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
  v_pb_sponsor uuid; v_prog public.sponsor_programmes; v_sp_name text; v_sp_short boolean := false; v_prog_id uuid;
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
    select pb.sponsor_org_id into v_pb_sponsor from public.price_books pb where pb.id = pbe.price_book_id;
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

  -- 4 sponsor coverage: the sponsor's share of what is left. It exists only when a sponsor programme with budget stands behind it (S71, OQ-328):
  --   a price-book share is the book's percentage; a programme-only share (cohort or HMO eligibility) is the programme's percentage, capped by the
  --   person's remaining allowance. A share with no programme behind it is still quoted, and create_order refuses it (sponsor_billing_not_open).
  if pbe.id is not null and pbe.sponsor_share_percent > 0 then
    v_spons := (v_cur * pbe.sponsor_share_percent) / 100;
    v_prog := private.sponsor_match(v_ben, it.id, v_pb_sponsor, false);
  elsif pbe.id is null and v_cur > 0 and p_buyer = v_ben then
    -- a programme covers the person themselves; a supporter paying for them neither gets the cover nor learns that they have one (OQ-223)
    v_prog := private.sponsor_match(v_ben, it.id, null, true);
    if v_prog.id is not null then
      v_spons := (v_cur * v_prog.share_percent) / 100;
      if v_prog.per_person_cap_kobo is not null then
        v_spons := least(v_spons, greatest(v_prog.per_person_cap_kobo - private.sponsor_person_used(v_prog.id, v_ben), 0));
      end if;
      if v_spons > private.sponsor_budget_left(v_prog.id) then v_spons := 0; v_sp_short := true; v_prog := null; end if;
    end if;
  end if;
  if v_prog.id is not null then
    v_prog_id := v_prog.id;
    select o.name into v_sp_name from public.organisations o where o.id = v_prog.sponsor_org_id;
    if pbe.id is not null and v_spons > private.sponsor_budget_left(v_prog.id) then v_sp_short := true; end if;
  elsif pbe.id is not null and v_spons > 0 then
    select o.name into v_sp_name from public.organisations o where o.id = v_pb_sponsor;
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
    'price_book_entry_id', pbe.id, 'list_kobo', v_list, 'sponsor_share_kobo', v_spons, 'sponsor_programme_id', v_prog_id, 'sponsor_name', v_sp_name,
    'sponsor_budget_short', v_sp_short, 'covered_in_full', (v_spons > 0 and v_due = 0),
    'discount_code_id', case when coalesce(v_code_ok, false) then dc.id else null end, 'discount_code_ok', v_code_ok,
    'discount_kobo', v_disc, 'points_applied', v_points, 'points_reduction_kobo', v_pred,
    'floor_kobo', v_third, 'amount_due_kobo', v_due, 'lines', v_lines, 'flags', v_flags);
end $$;
revoke all on function private.price_quote_calc(uuid, uuid, text, text, boolean) from public, anon, authenticated;
revoke all on function private.price_quote_calc(uuid, uuid, text, text, boolean) from public, anon, authenticated;

create or replace function public.price_quote(p_code text, p_beneficiary uuid default null, p_discount_code text default null, p_use_points boolean default false)
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
  -- S71 (OQ-184): the go-live guard. A test pair passes, as in S37; a real person is refused while it is off.
  if not private.go_live_open_patient('checkout_enabled', v_ben) then raise exception 'checkout_not_open' using errcode = 'P0001'; end if;
  if v_code is not null and not private.discount_tries_left(v_uid) then v_limited := true; v_code := null; end if;
  q := private.price_quote_calc(v_uid, v_ben, p_code, v_code, coalesce(p_use_points, false));
  if v_code is not null and not (q ->> 'discount_code_ok')::boolean then
    insert into public.discount_code_attempts (organisation_id, patient_id) values (v_org, v_uid);
  end if;
  if v_limited then q := q || jsonb_build_object('discount_code_ok', false, 'discount_error', 'rate_limited'); end if;
  -- the buyer sees the explanation, never the ids of another person's rows
  return q - 'discount_code_id' - 'price_book_entry_id' - 'sponsor_programme_id';
end $$;

-- The reply for a repeat of the same tap. A fully covered order says so (and who covers it), so the app shows "covered" again instead of "already paid".
create function private.order_replay_reply(o public.orders) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('order_id', o.id, 'reference', o.paystack_reference, 'amount_kobo', o.amount_kobo, 'state', o.state, 'checkout_url', o.checkout_url, 'replay', true)
         || case when o.amount_kobo = 0 and o.state = 'paid' and o.sponsor_share_kobo > 0
                 then jsonb_build_object('covered', true, 'sponsor_name', (select so.name from public.sponsor_reservations sr join public.sponsor_programmes sp on sp.id = sr.programme_id
                                                                              join public.organisations so on so.id = sp.sponsor_org_id where sr.order_id = o.id))
                 else '{}'::jsonb end
$$;
revoke all on function private.order_replay_reply(public.orders) from public, anon, authenticated;

create or replace function public.create_order(
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
  v_spons bigint;
  v_prog uuid;
begin
  if v_uid is null then raise exception 'order_not_authorised' using errcode = '42501'; end if;
  select * into pr from public.profiles where id = v_uid and role = 'patient' and is_active;
  if not found then raise exception 'order_not_authorised' using errcode = '42501'; end if;
  v_ben := coalesce(p_beneficiary, v_uid);
  perform private.order_beneficiary_check(v_uid, v_ben);

  if p_client_key is not null then
    select * into o from public.orders where buyer_profile_id = v_uid and client_key = p_client_key;
    if found then
      return private.order_replay_reply(o);
    end if;
  end if;

  if not coalesce((select is_enabled from public.platform_modules where key = 'v5_checkout'), false) then
    raise exception 'checkout_not_open' using errcode = 'P0001';
  end if;
  if not private.go_live_open_patient('checkout_enabled', v_ben) then raise exception 'checkout_not_open' using errcode = 'P0001'; end if;
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
  v_spons := (q ->> 'sponsor_share_kobo')::bigint;
  -- OQ-328: a sponsor's share is accepted only when a sponsor programme with enough budget stands behind it; the budget is reserved below
  if v_spons > 0 and (q ->> 'sponsor_programme_id') is null then
    raise exception '%', case when coalesce((q ->> 'sponsor_budget_short')::boolean, false) then 'sponsor_budget_exhausted' else 'sponsor_billing_not_open' end using errcode = 'P0001';
  end if;
  if v_spons > 0 and coalesce((q ->> 'sponsor_budget_short')::boolean, false) then raise exception 'sponsor_budget_exhausted' using errcode = 'P0001'; end if;
  if v_due <= 0 and v_spons <= 0 then raise exception 'order_fully_covered' using errcode = 'P0001'; end if;

  insert into public.orders (organisation_id, buyer_profile_id, beneficiary_patient_id, catalog_item_id, price_id, amount_kobo, components,
                             paystack_reference, client_key, is_test,
                             list_amount_kobo, sponsor_share_kobo, discount_code_id, discount_kobo, points_applied, points_reduction_kobo,
                             price_book_entry_id, pricing_rules_version, quote)
  values (pr.organisation_id, v_uid, v_ben, it.id, (q ->> 'price_id')::uuid, v_due,
          (select components from public.prices where id = (q ->> 'price_id')::uuid),
          case when v_due = 0 then 'spo_' else 'tho_' end || replace(gen_random_uuid()::text, '-', ''), p_client_key, coalesce(pr.is_test, false),
          (q ->> 'list_kobo')::bigint, (q ->> 'sponsor_share_kobo')::bigint, (q ->> 'discount_code_id')::uuid, (q ->> 'discount_kobo')::bigint,
          (q ->> 'points_applied')::integer, (q ->> 'points_reduction_kobo')::bigint,
          (q ->> 'price_book_entry_id')::uuid, (q ->> 'pricing_rules_version')::integer, q)
  on conflict (buyer_profile_id, client_key) where client_key is not null do nothing
  returning * into o;
  if o.id is null then
    select * into o from public.orders where buyer_profile_id = v_uid and client_key = p_client_key;
    return private.order_replay_reply(o);
  end if;
  if o.discount_code_id is not null then
    insert into public.discount_redemptions (organisation_id, discount_code_id, order_id, beneficiary_id, reduction_kobo, is_test)
    values (o.organisation_id, o.discount_code_id, o.id, o.beneficiary_patient_id, o.discount_kobo, o.is_test);
  end if;
  if v_spons > 0 then
    v_prog := (q ->> 'sponsor_programme_id')::uuid;
    perform private.sponsor_reserve(o.id, v_prog, v_spons);   -- raises sponsor_budget_exhausted, which rolls the whole order back
  end if;
  -- fully covered by a sponsor: no payment step at all. The reservation pays the order and the person gets the entitlement now.
  if o.amount_kobo = 0 then
    perform private.settle_sponsor_order(o.id);
    return jsonb_build_object('order_id', o.id, 'reference', o.paystack_reference, 'amount_kobo', 0, 'state', 'paid', 'checkout_url', null, 'replay', false,
                              'covered', true, 'sponsor_name', q ->> 'sponsor_name');
  end if;
  return jsonb_build_object('order_id', o.id, 'reference', o.paystack_reference, 'amount_kobo', o.amount_kobo, 'state', o.state, 'checkout_url', null, 'replay', false);
end $$;

-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 7. Orders may be fully covered (amount 0 with a sponsor share); the event; the ledger
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.orders'::regclass and conname = 'orders_amount_kobo_check') then
    raise exception 'S71: orders_amount_kobo_check not found';
  end if;
  alter table public.orders drop constraint orders_amount_kobo_check;
  alter table public.orders add constraint orders_amount_kobo_check
    check (amount_kobo >= 0 and amount_kobo <= 100000000000 and (amount_kobo > 0 or sponsor_share_kobo > 0));
end $$;

insert into public.event_types (event_type, description, owner_section, is_urgent)
values ('sponsor_entitlement.granted', 'An order that a sponsor programme pays for, in whole or in part, was paid and its entitlement exists', 'S71', false);
insert into public.event_type_versions (event_type, version, required_keys) values ('sponsor_entitlement.granted', 1, array['order_id', 'programme_id']);

insert into public.finance_accounts (code, name, account_type, normal_balance, vat_treatment, sort_order, description) values
  ('1210', 'Sponsor receivable', 'asset', 'debit', 'exempt', 21, 'The part of a sponsor-covered order that a sponsor owes Tarragon (S71). Collection and invoicing are not built; a finance decision (OQ-403).')
on conflict (code) do nothing;

-- The ledger for a paid order, from the LIVE body (the S25b/S25c period fallback and refunded-unposted rules kept): what the buyer paid (clearing) plus what
-- the sponsor owes (receivable) against one deferred-revenue or revenue credit for the whole price. A fully covered order has no clearing line. Test orders are never posted (INV-13).
create or replace function private.post_order_to_ledger(p_order uuid, p_include_test boolean default false) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  o public.orders%rowtype;
  it public.catalog_items%rowtype;
  v_date date;
  v_ref text;
  v_entry uuid;
  v_gross bigint;
  v_lines jsonb := '[]'::jsonb;
begin
  select * into o from public.orders where id = p_order;
  if not found or o.state not in ('paid', 'refunded') then return null; end if;
  if o.is_test and not p_include_test then return null; end if;
  v_ref := 'order:' || o.id;
  if o.state = 'refunded' and not exists (select 1 from public.finance_journal_entries where source = 'payment' and source_ref = v_ref) then
    return null;
  end if;
  select * into it from public.catalog_items where id = o.catalog_item_id;
  v_date := (coalesce(o.paid_at, now()) at time zone 'Africa/Lagos')::date;
  if exists (select 1 from public.finance_periods where period_month = date_trunc('month', v_date)::date and status <> 'open') then
    v_date := (now() at time zone 'Africa/Lagos')::date;
  end if;
  v_gross := o.amount_kobo + o.sponsor_share_kobo;
  if v_gross <= 0 then return null; end if;

  if o.amount_kobo > 0 then
    v_lines := v_lines || jsonb_build_object('account_code', '1020', 'debit_minor', o.amount_kobo, 'credit_minor', 0, 'organisation_id', o.organisation_id);
  end if;
  if o.sponsor_share_kobo > 0 then
    v_lines := v_lines || jsonb_build_object('account_code', '1210', 'debit_minor', o.sponsor_share_kobo, 'credit_minor', 0, 'organisation_id', o.organisation_id);
  end if;
  v_lines := v_lines || jsonb_build_object('account_code', case when it.duration_days is null then '4100' else '2000' end, 'debit_minor', 0, 'credit_minor', v_gross, 'organisation_id', o.organisation_id);
  v_entry := private.finance_post_journal(v_date, 'NGN', 'payment', v_ref, 'Order payment: ' || it.code, v_lines, null);

  if it.duration_days is not null then
    -- the schedule belongs to the entry that exists, whichever date that was posted on; it spreads the whole price (buyer part plus sponsor share)
    select entry_date into v_date from public.finance_journal_entries where id = v_entry;
    if o.state = 'paid' and not exists (select 1 from public.revenue_recognition_schedules where source_kind = 'order' and source_id = o.id) then
      perform private.finance_create_recognition_schedule('order', o.id, null, o.organisation_id, '4020', 'NGN', v_gross, v_date, v_date + it.duration_days);
    end if;
  end if;
  return v_entry;
end $$;
revoke all on function private.post_order_to_ledger(uuid, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 8. Settling a fully covered order, and what a state change does to the sponsor's reservation
-- ---------------------------------------------------------------------------
create function private.settle_sponsor_order(p_order uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare o public.orders%rowtype; it public.catalog_items%rowtype; v_start timestamptz := now(); v_ent uuid;
begin
  select * into o from public.orders where id = p_order for update;
  if not found or o.state <> 'created' or o.amount_kobo <> 0 or o.sponsor_share_kobo <= 0 then return; end if;
  select * into it from public.catalog_items where id = o.catalog_item_id;
  update public.orders set state = 'paid', paid_at = v_start, fee_kobo = 0, total_kobo = 0 where id = o.id;   -- the trigger commits the reservation and emits the event
  insert into public.entitlements (organisation_id, patient_id, order_id, kind, starts_at, ends_at, remaining_uses, is_test)
  values (o.organisation_id, o.beneficiary_patient_id, o.id, case it.kind when 'consultation' then 'consultation_credit' else it.kind end, v_start,
          case when it.duration_days is not null then v_start + make_interval(days => it.duration_days) end, it.uses, o.is_test)
  on conflict (order_id) do nothing returning id into v_ent;
  if v_ent is not null and it.kind = 'membership' then
    insert into public.patient_memberships (organisation_id, patient_id, source, starts_at, ends_at, is_test)
    values (o.organisation_id, o.beneficiary_patient_id, 'employer', v_start, v_start + make_interval(days => it.duration_days), o.is_test);
  end if;
  perform private.emit_domain_event('order.paid', o.organisation_id,
    jsonb_build_object('order_id', o.id, 'care_pack', it.grants_lead, 'kind', it.kind, 'code', it.code),
    'order:' || o.id, o.beneficiary_patient_id, 'order', o.id);
  perform private.post_order_safely(o.id);
end $$;
revoke all on function private.settle_sponsor_order(uuid) from public, anon, authenticated;

create function private.orders_sponsor_effects() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare r public.sponsor_reservations%rowtype; it public.catalog_items%rowtype;
begin
  if new.state is not distinct from old.state or new.sponsor_share_kobo <= 0 then return new; end if;
  select * into r from public.sponsor_reservations where order_id = new.id for update;
  if not found then return new; end if;
  if new.state = 'paid' and r.state <> 'committed' then
    -- a verified late payment on a closed order is honoured even if the budget has moved on (money and the share are owed); say so to a person
    if r.state = 'released' and r.amount_kobo > private.sponsor_budget_left(r.programme_id) then
      perform private.order_incident(new.organisation_id, 'sponsor-late-over-budget:' || new.id, 'A late payment pushed a sponsor programme over its budget',
        'Order ' || new.id || ' was paid after its sponsor reservation was released, and the programme no longer has room for it. The order is honoured; check the budget.');
    end if;
    update public.sponsor_reservations set state = 'committed', settled_at = now() where id = r.id;
    select * into it from public.catalog_items where id = new.catalog_item_id;
    perform private.emit_domain_event('sponsor_entitlement.granted', new.organisation_id,
      jsonb_build_object('order_id', new.id, 'programme_id', r.programme_id, 'code', it.code, 'kind', it.kind),
      'sponsor_entitlement:' || new.id, new.beneficiary_patient_id, 'order', new.id);
  elsif new.state in ('cancelled', 'failed') and r.state = 'reserved' then
    update public.sponsor_reservations set state = 'released', settled_at = now() where id = r.id;
  elsif new.state = 'refunded' and r.state = 'committed' then
    update public.sponsor_reservations set state = 'released', settled_at = now() where id = r.id;
    -- the sponsor no longer owes the share: reverse the receivable against the deferred revenue (or revenue). Never raises: a person is told instead.
    begin
      select * into it from public.catalog_items where id = new.catalog_item_id;
      if not new.is_test then
        perform private.finance_post_journal((now() at time zone 'Africa/Lagos')::date, 'NGN', 'adjustment', 'sponsor-refund:' || new.id, 'Sponsor share released: ' || it.code,
          jsonb_build_array(
            jsonb_build_object('account_code', case when it.duration_days is null then '4100' else '2000' end, 'debit_minor', new.sponsor_share_kobo, 'credit_minor', 0, 'organisation_id', new.organisation_id),
            jsonb_build_object('account_code', '1210', 'debit_minor', 0, 'credit_minor', new.sponsor_share_kobo, 'organisation_id', new.organisation_id)), null);
      end if;
    exception when others then
      perform private.order_incident(new.organisation_id, 'sponsor-refund-ledger:' || new.id, 'A sponsor share could not be reversed in the ledger',
        'Order ' || new.id || ' was refunded but the sponsor receivable reversal failed (' || left(sqlerrm, 300) || ').');
    end;
  end if;
  return new;
end $$;
revoke all on function private.orders_sponsor_effects() from public, anon, authenticated;
create trigger orders_sponsor_effects after update of state on public.orders for each row execute function private.orders_sponsor_effects();

-- a late payment may re-commit a released reservation
create or replace function private.sponsor_reservations_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'sponsor_reservation_immutable' using errcode = 'P0001'; end if;
  if new.programme_id is distinct from old.programme_id or new.order_id is distinct from old.order_id or new.amount_kobo is distinct from old.amount_kobo
     or new.beneficiary_id is distinct from old.beneficiary_id or new.is_test is distinct from old.is_test then
    raise exception 'sponsor_reservation_immutable' using errcode = 'P0001';
  end if;
  if new.state is distinct from old.state and not ((old.state = 'reserved' and new.state in ('committed', 'released'))
                                                   or (old.state = 'committed' and new.state = 'released')
                                                   or (old.state = 'released' and new.state = 'committed')) then
    raise exception 'sponsor_reservation_bad_transition' using errcode = 'P0001';
  end if;
  return new;
end $$;

-- A person sees what they paid and what a sponsor covered. A fully covered order shows no amount to pay.
create or replace function public.my_orders() returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('order_id', o.id, 'state', o.state, 'amount_kobo', o.amount_kobo, 'fee_kobo', o.fee_kobo,
         'total_kobo', o.total_kobo, 'code', i.code, 'name_key', i.name_key, 'created_at', o.created_at, 'paid_at', o.paid_at,
         'sponsor_share_kobo', o.sponsor_share_kobo,
         'sponsor_name', (select so.name from public.sponsor_reservations sr join public.sponsor_programmes sp on sp.id = sr.programme_id
                           join public.organisations so on so.id = sp.sponsor_org_id where sr.order_id = o.id)) order by o.created_at desc), '[]'::jsonb)
    from public.orders o join public.catalog_items i on i.id = o.catalog_item_id
   where o.buyer_profile_id = (select auth.uid()) or o.beneficiary_patient_id = (select auth.uid())
$$;

-- A fully covered order has no payment to give back: it is ended by operations (cancel_sponsor_entitlement), which frees the sponsor's budget.
create or replace function public.request_order_refund(p_order uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  o public.orders%rowtype;
  v_refund uuid;
begin
  if v_uid is null then raise exception 'refund_not_authorised' using errcode = '42501'; end if;

  select * into o from public.orders where id = p_order and buyer_profile_id = v_uid;
  if not found then return jsonb_build_object('result', 'not_found'); end if;
  if o.state <> 'paid' then return jsonb_build_object('result', 'order_not_paid', 'state', o.state); end if;
  if o.amount_kobo = 0 then return jsonb_build_object('result', 'covered_by_sponsor'); end if;
  if length(coalesce(p_reason, '')) < 5 then return jsonb_build_object('result', 'reason_too_short'); end if;

  insert into public.refunds (organisation_id, order_id, amount_kobo, reason, requested_by, is_test)
  values (o.organisation_id, o.id, o.amount_kobo, p_reason, v_uid, o.is_test)
  on conflict (order_id) where state in ('pending', 'approved', 'processing', 'completed') do nothing
  returning id into v_refund;

  if v_refund is null then return jsonb_build_object('result', 'already_requested'); end if;
  return jsonb_build_object('result', 'requested', 'refund_id', v_refund);
end $$;
revoke all on function public.request_order_refund(uuid, text) from public, anon;
grant execute on function public.request_order_refund(uuid, text) to authenticated;

create function public.cancel_sponsor_entitlement(p_order uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare o public.orders%rowtype; e public.entitlements%rowtype; it public.catalog_items%rowtype; v_org uuid := (select organisation_id from public.profiles where id = (select auth.uid()));
begin
  if not private.is_admin() then raise exception 'sponsor_not_authorised' using errcode = '42501'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 10 then raise exception 'sponsor_reason_needed' using errcode = '22023'; end if;
  select * into o from public.orders where id = p_order and organisation_id = v_org for update;
  if not found or o.state <> 'paid' or o.amount_kobo <> 0 or o.sponsor_share_kobo <= 0 then raise exception 'not_a_sponsor_covered_order' using errcode = 'P0001'; end if;
  select * into e from public.entitlements where order_id = o.id for update;
  select * into it from public.catalog_items where id = o.catalog_item_id;
  if e.id is null or e.state <> 'active' or (it.uses is not null and e.remaining_uses is distinct from it.uses) then
    raise exception 'entitlement_already_used' using errcode = 'P0001';
  end if;
  update public.entitlements set state = 'revoked' where id = e.id;
  if it.kind = 'membership' then
    update public.patient_memberships set state = 'ended', ended_at = now(), end_reason = 'Sponsor cover ended by operations: ' || left(btrim(p_reason), 150)
     where patient_id = o.beneficiary_patient_id and source = 'employer' and state = 'active' and starts_at >= o.paid_at - interval '1 minute';
  end if;
  update public.orders set state = 'refunded' where id = o.id;   -- the trigger releases the budget and reverses the receivable
  perform private.log_audit('sponsor.entitlement_cancelled', 'orders', o.id, jsonb_build_object('reason', p_reason));
  return jsonb_build_object('result', 'cancelled', 'order_id', o.id);
end $$;

-- ---------------------------------------------------------------------------
-- 9. HMO eligibility functions (19.6)
-- ---------------------------------------------------------------------------
create function public.request_hmo_eligibility(p_hmo uuid, p_member_number text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid()); pr public.profiles%rowtype; v_hash text; c public.hmo_eligibility_checks%rowtype; v_id uuid;
begin
  if v_uid is null then raise exception 'order_not_authorised' using errcode = '42501'; end if;
  select * into pr from public.profiles where id = v_uid and role = 'patient' and is_active;
  if not found then raise exception 'order_not_authorised' using errcode = '42501'; end if;
  if not private.go_live_open_patient('sponsor_payment_enabled', v_uid) then raise exception 'sponsor_payment_not_open' using errcode = 'P0001'; end if;
  -- only an HMO that has a Tarragon programme (an agreement) can be checked
  if not exists (select 1 from public.sponsor_programmes p where p.sponsor_org_id = p_hmo and p.organisation_id = pr.organisation_id
                  and p.eligibility = 'hmo_eligibility' and p.status = 'active' and p.is_test = coalesce(pr.is_test, false)) then
    raise exception 'hmo_not_available' using errcode = 'P0001';
  end if;
  v_hash := private.hmo_member_hash(p_member_number);
  if (select count(*) from public.hmo_eligibility_checks where patient_id = v_uid and checked_at > now() - interval '24 hours') >= (private.sponsor_rules() ->> 'hmo_checks_per_day')::integer then
    raise exception 'hmo_check_rate_limited' using errcode = 'P0001';
  end if;
  -- the same number for the same HMO that is still waiting is the same check
  select * into c from public.hmo_eligibility_checks where patient_id = v_uid and hmo_org_id = p_hmo and member_number_hash = v_hash and result = 'pending_manual' order by checked_at desc limit 1;
  if found then return jsonb_build_object('check_id', c.id, 'result', c.result, 'replay', true); end if;
  insert into public.hmo_eligibility_checks (organisation_id, patient_id, hmo_org_id, member_number_hash, is_test)
  values (pr.organisation_id, v_uid, p_hmo, v_hash, coalesce(pr.is_test, false)) returning id into v_id;
  return jsonb_build_object('check_id', v_id, 'result', 'pending_manual', 'replay', false);
end $$;

-- The adapter (an edge function holding the HMO connection) records its answer. 'unavailable' changes nothing: the check stays for operations.
create function public.record_hmo_eligibility_result(p_check uuid, p_result text, p_adapter text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare c public.hmo_eligibility_checks%rowtype;
begin
  if (select auth.role()) is distinct from 'service_role' then raise exception 'order_not_authorised' using errcode = '42501'; end if;
  if p_result not in ('eligible', 'not_eligible', 'unavailable') then raise exception 'invalid_result' using errcode = '22023'; end if;
  select * into c from public.hmo_eligibility_checks where id = p_check for update;
  if not found then return jsonb_build_object('result', 'not_found'); end if;
  if c.result <> 'pending_manual' then return jsonb_build_object('result', 'already_decided', 'check_result', c.result); end if;
  if p_result = 'unavailable' then return jsonb_build_object('result', 'left_for_operations'); end if;
  update public.hmo_eligibility_checks set result = p_result, decided_via = 'adapter', adapter = p_adapter, decided_at = now() where id = c.id;
  return jsonb_build_object('result', 'recorded', 'check_result', p_result);
end $$;

-- Operations confirm by typing the number again: it is hashed and must equal the stored hash, so the number is never stored and a different
-- number cannot be confirmed in its place.
create function public.ops_verify_hmo_eligibility(p_check uuid, p_member_number text, p_eligible boolean, p_note text default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare c public.hmo_eligibility_checks%rowtype; v_uid uuid := (select auth.uid()); v_org uuid := (select organisation_id from public.profiles where id = (select auth.uid()));
begin
  if not private.is_admin() then raise exception 'hmo_not_authorised' using errcode = '42501'; end if;
  if p_eligible is null then raise exception 'invalid_result' using errcode = '22023'; end if;
  select * into c from public.hmo_eligibility_checks where id = p_check and organisation_id = v_org for update;
  if not found then raise exception 'hmo_check_not_found' using errcode = 'P0001'; end if;
  if c.result <> 'pending_manual' then raise exception 'hmo_check_decided' using errcode = 'P0001'; end if;
  if private.hmo_member_hash(p_member_number) <> c.member_number_hash then raise exception 'member_number_mismatch' using errcode = 'P0001'; end if;
  update public.hmo_eligibility_checks
     set result = case when p_eligible then 'eligible' else 'not_eligible' end, decided_via = 'manual', decided_at = now(), verified_by = v_uid,
         note = left(nullif(btrim(coalesce(p_note, '')), ''), 500)
   where id = c.id;
  perform private.log_audit('hmo.eligibility_verified', 'hmo_eligibility_checks', c.id, jsonb_build_object('eligible', p_eligible));
  return jsonb_build_object('result', 'recorded');
end $$;

-- The health plans a patient can check with: only an HMO that has an active Tarragon programme for their kind of account (test or real).
create function public.available_hmos() returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('hmo_id', o.id, 'name', o.name) order by o.name), '[]'::jsonb)
    from public.organisations o
   where exists (select 1 from public.sponsor_programmes p join public.profiles pr on pr.id = (select auth.uid())
                  where p.sponsor_org_id = o.id and p.organisation_id = pr.organisation_id and p.eligibility = 'hmo_eligibility' and p.status = 'active'
                    and p.is_test = coalesce(pr.is_test, false) and (now() at time zone 'Africa/Lagos')::date between p.valid_from and p.valid_to)
$$;

create function public.my_hmo_eligibility() returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('check_id', h.id, 'hmo_name', o.name, 'result', h.result, 'checked_at', h.checked_at, 'decided_at', h.decided_at) order by h.checked_at desc), '[]'::jsonb)
    from public.hmo_eligibility_checks h join public.organisations o on o.id = h.hmo_org_id where h.patient_id = (select auth.uid())
$$;

create function public.admin_hmo_checks_pending() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_org uuid := (select organisation_id from public.profiles where id = (select auth.uid())); v jsonb;
begin
  if not private.is_admin() then raise exception 'hmo_not_authorised' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('check_id', h.id, 'hmo_name', o.name, 'patient_id', h.patient_id, 'patient_name', p.full_name, 'requested_at', h.checked_at) order by h.checked_at), '[]'::jsonb)
    into v from public.hmo_eligibility_checks h join public.organisations o on o.id = h.hmo_org_id join public.profiles p on p.id = h.patient_id
   where h.organisation_id = v_org and h.result = 'pending_manual';
  perform private.log_audit('hmo.pending_listed', 'hmo_eligibility_checks', null, '{}'::jsonb);
  return v;
end $$;

-- ---------------------------------------------------------------------------
-- 10. Sponsor programme administration (audited; admin only)
-- ---------------------------------------------------------------------------
create function public.admin_create_sponsor_programme(
  p_sponsor_org uuid, p_name text, p_item_codes text[], p_share_percent integer, p_budget_kobo bigint, p_per_person_cap_kobo bigint,
  p_eligibility text, p_cohort_id uuid, p_hmo_check_valid_days integer, p_valid_from date, p_valid_to date, p_reason text, p_is_test boolean default false)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_org uuid := (select organisation_id from public.profiles where id = (select auth.uid())); v_id uuid; v_code text;
begin
  if not private.is_admin() then raise exception 'sponsor_not_authorised' using errcode = '42501'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 10 then raise exception 'sponsor_reason_needed' using errcode = '22023'; end if;
  if not exists (select 1 from public.organisations where id = p_sponsor_org and type in ('hmo', 'corporate', 'ngo')) then raise exception 'sponsor_org_invalid' using errcode = '22023'; end if;
  foreach v_code in array p_item_codes loop
    if not exists (select 1 from public.catalog_items where organisation_id = v_org and code = v_code and audience = 'patient') then
      raise exception 'unknown_item %', v_code using errcode = '22023';
    end if;
  end loop;
  if p_cohort_id is not null and not exists (select 1 from public.sponsor_cohorts where id = p_cohort_id and sponsor_org_id = p_sponsor_org) then
    raise exception 'cohort_not_for_sponsor' using errcode = '22023';
  end if;
  insert into public.sponsor_programmes (organisation_id, sponsor_org_id, name, item_codes, share_percent, budget_kobo, per_person_cap_kobo, eligibility, cohort_id, rules,
                                         valid_from, valid_to, created_by, is_test)
  values (v_org, p_sponsor_org, btrim(p_name), p_item_codes, p_share_percent, p_budget_kobo, p_per_person_cap_kobo, p_eligibility, p_cohort_id,
          case when p_eligibility = 'hmo_eligibility' then jsonb_build_object('hmo_check_valid_days', p_hmo_check_valid_days) else '{}'::jsonb end,
          p_valid_from, p_valid_to, (select auth.uid()), coalesce(p_is_test, false))
  returning id into v_id;
  perform private.log_audit('sponsor.programme_created', 'sponsor_programmes', v_id, jsonb_build_object('reason', p_reason, 'budget_kobo', p_budget_kobo));
  return v_id;
end $$;

create function public.admin_set_sponsor_programme_status(p_id uuid, p_status text, p_reason text) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_org uuid := (select organisation_id from public.profiles where id = (select auth.uid()));
begin
  if not private.is_admin() then raise exception 'sponsor_not_authorised' using errcode = '42501'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 10 then raise exception 'sponsor_reason_needed' using errcode = '22023'; end if;
  if p_status not in ('active', 'closed') then raise exception 'invalid_status' using errcode = '22023'; end if;
  update public.sponsor_programmes set status = p_status where id = p_id and organisation_id = v_org;
  if not found then raise exception 'unknown_programme' using errcode = '22023'; end if;
  perform private.log_audit('sponsor.programme_status', 'sponsor_programmes', p_id, jsonb_build_object('status', p_status, 'reason', p_reason));
end $$;

-- The ceiling can move up or down, but never below what is already reserved or committed.
create function public.admin_set_sponsor_programme_budget(p_id uuid, p_budget_kobo bigint, p_reason text) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_org uuid := (select organisation_id from public.profiles where id = (select auth.uid())); p public.sponsor_programmes%rowtype; v_used bigint;
begin
  if not private.is_admin() then raise exception 'sponsor_not_authorised' using errcode = '42501'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 10 then raise exception 'sponsor_reason_needed' using errcode = '22023'; end if;
  select * into p from public.sponsor_programmes where id = p_id and organisation_id = v_org for update;
  if not found then raise exception 'unknown_programme' using errcode = '22023'; end if;
  select coalesce(sum(amount_kobo), 0) into v_used from public.sponsor_reservations where programme_id = p.id and state in ('reserved', 'committed');
  if p_budget_kobo is null or p_budget_kobo < v_used then raise exception 'budget_below_committed' using errcode = 'P0001'; end if;
  perform set_config('tarragon.sponsor_budget_edit', '1', true);
  update public.sponsor_programmes set budget_kobo = p_budget_kobo where id = p.id;
  perform set_config('tarragon.sponsor_budget_edit', '', true);
  perform private.log_audit('sponsor.programme_budget', 'sponsor_programmes', p.id, jsonb_build_object('from', p.budget_kobo, 'to', p_budget_kobo, 'reason', p_reason));
end $$;

create function public.admin_sponsor_programmes() returns jsonb
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
    into v from public.sponsor_programmes p join public.organisations so on so.id = p.sponsor_org_id where p.organisation_id = v_org;
  return v;
end $$;

-- ---------------------------------------------------------------------------
-- 11. Go-live guards (S37 pattern), both born OFF. The two shared functions are WRAPPED, not replaced (see the header).
-- ---------------------------------------------------------------------------
insert into public.go_live_guards (key, label, blocks, condition_text, switch_role, enforced_in, not_enforced_in) values
  ('checkout_enabled', 'Catalogue checkout', 'A real patient asking for a price quote or creating an order for any catalogue item',
   'Catalogue checkout (v5_checkout) is open; at least one patient item is active and priced; Paystack channels (card, bank transfer, USSD) were tried with the founder test key; a refund was tested end to end; admin confirmation', 'admin',
   array['price_quote (public)', 'create_order (public)'],
   'The legacy per-domain checkouts (OQ-23) are separate and unchanged. A test patient passes (the S37 pair rule) so the flow can be proved before launch. The order-checkout edge function only calls create_order, so it is covered through it.'),
  ('sponsor_payment_enabled', 'Sponsor-paid items and HMO eligibility', 'A sponsor programme covering any part of a real person''s order; an HMO eligibility request',
   'Counsel has given an opinion on order-linked sponsor payment (OQ-07); finance has confirmed the sponsor receivable account (OQ-403); at least one real sponsor programme is active with budget; admin confirmation', 'admin',
   array['private.sponsor_match (the quote)', 'create_order (sponsor reservation)', 'request_hmo_eligibility'],
   'A test patient with a test programme passes. Sponsor invoicing and collection are not built; this guard does not make a sponsor pay.');

alter function private.go_live_conditions(text, uuid) rename to go_live_conditions_base;
revoke all on function private.go_live_conditions_base(text, uuid) from public, anon, authenticated;
create function private.go_live_conditions(p_key text, p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_key = 'checkout_enabled' then
    return jsonb_build_array(
      private.go_live_cond('checkout_module_open', 'Catalogue checkout (v5_checkout) is open',
        coalesce((select is_enabled from public.platform_modules where key = 'v5_checkout'), false), 'data', null),
      private.go_live_cond('a_priced_item_is_active', 'At least one patient item is active and priced',
        exists (select 1 from public.catalog_items i where i.organisation_id = p_org and i.active and i.audience = 'patient' and (private.current_price(i.id)).id is not null), 'data', null),
      private.go_live_cond('paystack_channels_verified', 'Card, bank transfer and USSD were tried with the founder test key', private.go_live_attested(p_key, 'paystack_channels_verified'), 'attestation', null),
      private.go_live_cond('refund_path_tested', 'A refund of a paid order has been tested end to end', private.go_live_attested(p_key, 'refund_path_tested'), 'attestation', null),
      private.go_live_cond('admin_confirmation', 'Admin confirmation', true, 'switch', 'Given by an admin pressing the switch'));
  elsif p_key = 'sponsor_payment_enabled' then
    return jsonb_build_array(
      private.go_live_cond('counsel_opinion_recorded', 'Counsel has given an opinion on order-linked sponsor payment (OQ-07)', private.go_live_attested(p_key, 'counsel_opinion_recorded'), 'attestation', null),
      private.go_live_cond('sponsor_receivable_confirmed', 'Finance has confirmed the sponsor receivable account (OQ-403)', private.go_live_attested(p_key, 'sponsor_receivable_confirmed'), 'attestation', null),
      private.go_live_cond('a_real_programme_is_active', 'At least one real sponsor programme is active with budget left',
        exists (select 1 from public.sponsor_programmes p where p.organisation_id = p_org and p.status = 'active' and not p.is_test and private.sponsor_budget_left(p.id) > 0), 'data', null),
      private.go_live_cond('admin_confirmation', 'Admin confirmation', true, 'switch', 'Given by an admin pressing the switch'));
  end if;
  -- An unknown key has no conditions here: ask the function this one wraps. (This exact comment is the anchor that later migrations on main-dev look for when they
  -- add their own branch to private.go_live_conditions in place. Do not reword it.)
  return private.go_live_conditions_base(p_key, p_org);
end $$;
revoke all on function private.go_live_conditions(text, uuid) from public;

-- attest_go_live_condition is NOT wrapped: later migrations on main-dev add their own (guard, condition) pairs to its list by patching it in place, and a thin
-- wrapper has no list to patch. So this is the full function with this migration's pairs added to the list.
create or replace function public.attest_go_live_condition(p_key text, p_code text, p_met boolean, p_note text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if private.go_live_actor_role() is null then raise exception 'only an admin or the Chief Medical Officer can record this' using errcode = '42501'; end if;
  if not exists (select 1 from public.go_live_guards where key = p_key) then raise exception 'no such go-live guard: %', p_key using errcode = '22023'; end if;
  -- the conditions a person records (the rest are read from the data). A fixed list, so a broken data query cannot block recording one.
  if (p_key, p_code) not in (
       ('clinical_operations_enabled', 'clinical_safety_case_current'), ('prescribing_enabled', 'clinical_safety_case_current'),
       ('scribe_enabled', 'clinical_safety_case_current'), ('prescribing_enabled', 'notification_sender_deployed'),
       ('lab_booking_enabled', 'results_flow_tested'),
       ('scribe_enabled', 'con001_legal_review_recorded'), ('scribe_enabled', 'speech_provider_configured'),
       ('payouts_enabled', 'fee_schedule_approved'), ('payouts_enabled', 'paystack_transfers_configured'),
       ('public_signup_enabled', 'stage2_exit_criteria_met'),
       ('membership_billing_enabled', 'paystack_plan_codes_disabled'), ('membership_billing_enabled', 'refund_path_tested'),
       ('concierge_coordinator_enabled', 'coordinator_staffing_in_place'),
       ('checkout_enabled', 'paystack_channels_verified'),
       ('checkout_enabled', 'refund_path_tested'),
       ('sponsor_payment_enabled', 'counsel_opinion_recorded'),
       ('sponsor_payment_enabled', 'sponsor_receivable_confirmed')) then
    raise exception 'that condition is read from the data (or does not exist), it cannot be attested' using errcode = '22023';
  end if;
  if p_met is null or length(btrim(coalesce(p_note, ''))) < 10 then
    raise exception 'say what was checked and by whom, in a sentence' using errcode = '22023';
  end if;
  -- the safety case is the safety officer's: an admin who is not the CMO cannot record it
  if p_code = 'clinical_safety_case_current' and not private.credential_is_cmo() then
    raise exception 'only the Chief Medical Officer can record the clinical safety case' using errcode = '42501';
  end if;
  if p_code = 'clinical_safety_case_current' and p_met and length(btrim(p_note)) < 25 then
    raise exception 'name the safety case document, its version and who signed it' using errcode = '22023';
  end if;
  insert into public.go_live_attestations (guard_key, condition_code, met, note, attested_by)
  values (p_key, p_code, p_met, btrim(p_note), v_uid);
  perform private.log_audit('go_live_guard.condition_attested', 'go_live_guard', null, jsonb_build_object('key', p_key, 'code', p_code, 'met', p_met));
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------------
-- 12. Grants: functions only. Nothing is revoked from authenticated that was granted before; every new function is revoked from PUBLIC.
-- ---------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'public.request_hmo_eligibility(uuid,text)', 'public.my_hmo_eligibility()', 'public.available_hmos()', 'public.ops_verify_hmo_eligibility(uuid,text,boolean,text)',
    'public.admin_hmo_checks_pending()', 'public.admin_create_sponsor_programme(uuid,text,text[],integer,bigint,bigint,text,uuid,integer,date,date,text,boolean)',
    'public.admin_set_sponsor_programme_status(uuid,text,text)', 'public.admin_set_sponsor_programme_budget(uuid,bigint,text)', 'public.admin_sponsor_programmes()',
    'public.cancel_sponsor_entitlement(uuid,text)', 'public.attest_go_live_condition(text,text,boolean,text)', 'public.my_orders()',
    'public.price_quote(text,uuid,text,boolean)', 'public.create_order(text,uuid,uuid,text,boolean,bigint)']
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  revoke all on function public.record_hmo_eligibility_result(uuid, text, text) from public, anon, authenticated;
  grant execute on function public.record_hmo_eligibility_result(uuid, text, text) to service_role;
end $$;

-- ---------------------------------------------------------------------------
-- 13. The migration proves what it claims
-- ---------------------------------------------------------------------------
do $$
declare f text; t text;
begin
  foreach t in array array['sponsor_config', 'sponsor_programmes', 'sponsor_reservations', 'hmo_eligibility_checks'] loop
    if has_table_privilege('anon', 'public.' || t, 'SELECT') or has_table_privilege('authenticated', 'public.' || t, 'SELECT')
       or has_table_privilege('authenticated', 'public.' || t, 'INSERT') or has_table_privilege('authenticated', 'public.' || t, 'UPDATE')
       or has_table_privilege('authenticated', 'public.' || t, 'DELETE') then
      raise exception 'S71: % is reachable by anon or authenticated', t;
    end if;
    if not (select relrowsecurity from pg_class where oid = ('public.' || t)::regclass) then raise exception 'S71: % has no RLS', t; end if;
  end loop;
  foreach f in array array[
    'public.request_hmo_eligibility(uuid,text)', 'public.my_hmo_eligibility()', 'public.ops_verify_hmo_eligibility(uuid,text,boolean,text)', 'public.admin_hmo_checks_pending()',
    'public.record_hmo_eligibility_result(uuid,text,text)', 'public.admin_sponsor_programmes()', 'public.cancel_sponsor_entitlement(uuid,text)',
    'public.create_order(text,uuid,uuid,text,boolean,bigint)', 'public.price_quote(text,uuid,text,boolean)', 'public.attest_go_live_condition(text,text,boolean,text)',
    'private.sponsor_match(uuid,uuid,uuid,boolean)', 'private.sponsor_reserve(uuid,uuid,bigint)', 'private.settle_sponsor_order(uuid)', 'private.hmo_member_hash(text)',
    'private.go_live_conditions(text,uuid)', 'private.go_live_conditions_base(text,uuid)']
  loop
    if has_function_privilege('anon', f, 'EXECUTE') then raise exception 'S71: anon can execute %', f; end if;
  end loop;
  foreach f in array array['private.sponsor_match(uuid,uuid,uuid,boolean)', 'private.sponsor_reserve(uuid,uuid,bigint)', 'private.settle_sponsor_order(uuid)',
                           'private.hmo_member_hash(text)', 'private.go_live_conditions_base(text,uuid)'] loop
    if has_function_privilege('authenticated', f, 'EXECUTE') then raise exception 'S71: authenticated can execute %', f; end if;
  end loop;
  if has_function_privilege('authenticated', 'public.record_hmo_eligibility_result(uuid,text,text)', 'EXECUTE') then raise exception 'S71: authenticated can record an adapter result'; end if;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'create_order') <> 1 then
    raise exception 'S71: create_order must have exactly one signature';
  end if;
  if not exists (select 1 from public.event_type_versions where event_type = 'sponsor_entitlement.granted' and version = 1) then raise exception 'S71: sponsor_entitlement.granted is not registered'; end if;
  if (select count(*) from public.go_live_guards where key in ('checkout_enabled', 'sponsor_payment_enabled') and not is_on) <> 2 then raise exception 'S71: the two new guards must exist and be off'; end if;
  if jsonb_array_length(private.go_live_conditions('checkout_enabled', null)) < 4 or jsonb_array_length(private.go_live_conditions('membership_billing_enabled', null)) < 4
     or jsonb_array_length(private.go_live_conditions('clinical_operations_enabled', null)) < 4 then
    raise exception 'S71: a guard lost its conditions through the wrapper';
  end if;
  if exists (select 1 from public.catalog_items where code in ('consultation_single', 'lab_panel_standard', 'home_kit_sample') and (active or private.current_price(id) is not null)) then
    raise exception 'S71: the placeholders must be off and unpriced';
  end if;
  if exists (select 1 from public.sponsor_programmes) or exists (select 1 from public.hmo_eligibility_checks) then raise exception 'S71: no programme or check may exist at migration time'; end if;
end $$;
