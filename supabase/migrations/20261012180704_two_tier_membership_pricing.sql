-- Two-tier pricing (founder decisions D2 2026-10-08, C3 and C10 2026-10-12; docs/v5-sessions/00-AMENDMENTS-2026-10-08-two-tier.md).
--
--   1. Individual Membership: 120,000 naira a year (12,000,000 kobo), in force the moment this migration is applied (founder, 2026-10-12:
--      the platform launches at 120,000). It is a NEW prices row (valid_from = apply time) and the 10,000,000 row is closed at the same
--      instant, never edited, so the 100,000 price is never in force again on any path. The item is still inactive and the v5_checkout
--      module still off; this migration switches nothing on for sale.
--   2. Organisation member price: 100,000 naira (10,000,000 kobo), flat, adjustable per organisation by an admin. Versioned rows
--      (organisation_member_prices), a default row for every organisation, per-organisation overrides, a floor and ceiling from
--      PROPOSED config (organisation_price_limits, mirrored as commerce.organisation_member_price_limits) so a typo cannot set 1 naira.
--      No volume tiers.
--   3. The organisation pays for its members. A claimed employer roster member whose benefit package points at the Membership item
--      gets a Membership seat: an entitlements row with no order (roster_member_id instead), billed to the organisation at the price in
--      force that day (snapshotted), plus a patient_memberships row (source employer). No per-employee card payment. Seats are
--      invoiced by public.generate_organisation_membership_invoice (finance). Employers see counts and money only (I9).
--      Dormant behind platform module organisation_membership (off).
--   4. employer_benefit_packages gains catalog_item_id (the v5 Membership item); the retired service_product_id stays valid for
--      packages that still use it (zero packages exist live, checked 2026-10-12).
--
-- Live counts before this migration (read-only, 2026-10-12): employer_benefit_packages 0, employer_roster_members 0,
-- employer_billing_configs 0, employer_invoices 0, catalog_items 1 (membership_annual, inactive), prices 1 (10,000,000 kobo),
-- v5_checkout off. So nothing is converted or backfilled.

-- ---------------------------------------------------------------------------
-- 1. The individual 120,000 price, in force from the moment of apply; the 100,000 row is closed, not edited
-- ---------------------------------------------------------------------------
do $$
declare it public.catalog_items%rowtype; v_old public.prices%rowtype; v_now timestamptz := now();
begin
  select * into it from public.catalog_items where code = 'membership_annual' order by created_at limit 1;
  if not found then return; end if;
  select * into v_old from public.prices where catalog_item_id = it.id and valid_to is null;
  if found then
    if v_old.amount_kobo = 12000000 then return; end if;
    v_now := greatest(v_now, v_old.valid_from + interval '1 second');
    update public.prices set valid_to = v_now where id = v_old.id;
  end if;
  insert into public.prices (organisation_id, catalog_item_id, amount_kobo, valid_from, reason)
  values (it.organisation_id, it.id, 12000000, v_now,
          'Founder decision D2, 2026-10-08/12: individual Membership 120,000 naira a year, the launch price. Replaces the 100,000 naira seed.');
end $$;

-- ---------------------------------------------------------------------------
-- 2. Organisation member prices
-- ---------------------------------------------------------------------------
create table public.organisation_price_limits (
  id             uuid primary key default gen_random_uuid(),
  version        integer not null unique,
  is_active      boolean not null default false,
  effective_from date not null,
  rules          jsonb not null,
  created_at     timestamptz not null default now()
);
create unique index organisation_price_limits_one_active on public.organisation_price_limits (is_active) where is_active;
alter table public.organisation_price_limits enable row level security;
revoke all on public.organisation_price_limits from public, anon, authenticated;

-- organisation-price-limits-begin (mirrored as commerce.organisation_member_price_limits in packages/shared/src/proposed-config/registry.ts)
insert into public.organisation_price_limits (version, is_active, effective_from, rules)
values (1, true, date '2026-10-12', $json${"item_code":"membership_annual","min_kobo":5000000,"max_kobo":20000000,"default_kobo":10000000}$json$::jsonb);
-- organisation-price-limits-end

create table public.organisation_member_prices (
  id                       uuid primary key default gen_random_uuid(),
  organisation_id          uuid not null references public.organisations (id) on delete restrict,
  employer_organisation_id uuid references public.organisations (id) on delete restrict,
  catalog_item_id          uuid not null references public.catalog_items (id) on delete restrict,
  amount_kobo              bigint not null check (amount_kobo > 0 and amount_kobo <= 100000000000),
  valid_from               timestamptz not null default now(),
  valid_to                 timestamptz,
  created_by               uuid references public.profiles (id) on delete set null,
  reason                   text not null check (char_length(btrim(reason)) >= 10),
  created_at               timestamptz not null default now(),
  check (valid_to is null or valid_to > valid_from),
  exclude using gist (catalog_item_id with =,
                      (coalesce(employer_organisation_id, '00000000-0000-0000-0000-000000000000'::uuid)) with =,
                      tstzrange(valid_from, coalesce(valid_to, 'infinity'::timestamptz)) with &&)
);
comment on table public.organisation_member_prices is
  'Versioned price an organisation pays per Membership seat. employer_organisation_id null = the default for every organisation. Rows are never edited: a new price closes the old one. Floor and ceiling come from organisation_price_limits.';
alter table public.organisation_member_prices enable row level security;
revoke all on public.organisation_member_prices from public, anon, authenticated;

create function private.organisation_member_prices_guard() returns trigger language plpgsql set search_path = '' as $$
declare v_min bigint; v_max bigint;
begin
  if tg_op = 'DELETE' then raise exception 'price_immutable' using errcode = 'P0001'; end if;
  if tg_op = 'UPDATE' then
    if new.amount_kobo is distinct from old.amount_kobo or new.catalog_item_id is distinct from old.catalog_item_id
       or new.valid_from is distinct from old.valid_from or new.organisation_id is distinct from old.organisation_id
       or new.employer_organisation_id is distinct from old.employer_organisation_id or new.reason is distinct from old.reason
       or old.valid_to is not null then
      raise exception 'price_immutable' using errcode = 'P0001';
    end if;
    return new;
  end if;
  if new.employer_organisation_id is not null and not exists (
       select 1 from public.organisations o where o.id = new.employer_organisation_id and o.type in ('corporate', 'hmo')) then
    raise exception 'organisation_price_unknown_organisation' using errcode = '22023';
  end if;
  select (rules ->> 'min_kobo')::bigint, (rules ->> 'max_kobo')::bigint into v_min, v_max
    from public.organisation_price_limits where is_active;
  if v_min is null or new.amount_kobo < v_min or new.amount_kobo > v_max then
    raise exception 'organisation_price_out_of_range' using errcode = '22023';
  end if;
  return new;
end $$;
revoke all on function private.organisation_member_prices_guard() from public, anon, authenticated;
create trigger organisation_member_prices_guard before insert or update or delete on public.organisation_member_prices
  for each row execute function private.organisation_member_prices_guard();

-- the flat default, 100,000 naira
insert into public.organisation_member_prices (organisation_id, employer_organisation_id, catalog_item_id, amount_kobo, valid_from, reason)
select i.organisation_id, null, i.id, 10000000, now(),
       'Founder decisions C3 and C10, 2026-10-12: flat 100,000 naira per organisation member, paid by the organisation.'
  from public.catalog_items i where i.code = 'membership_annual' order by i.created_at limit 1;

-- the price an organisation pays today: its own row if it has one in force, else the default
create function private.organisation_member_price(p_employer uuid, p_item uuid) returns public.organisation_member_prices
language sql stable security definer set search_path = ''
as $$
  select p.* from public.organisation_member_prices p
   where p.catalog_item_id = p_item and p.valid_from <= now() and (p.valid_to is null or p.valid_to > now())
     and (p.employer_organisation_id = p_employer or p.employer_organisation_id is null)
   order by (p.employer_organisation_id is not null) desc, p.valid_from desc limit 1
$$;
revoke all on function private.organisation_member_price(uuid, uuid) from public, anon, authenticated;

create function private.set_organisation_member_price_core(p_employer_org uuid, p_amount_kobo bigint, p_reason text, p_valid_from timestamptz)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_org uuid := (select organisation_id from public.profiles where id = (select auth.uid()));
  it public.catalog_items%rowtype; v_old public.organisation_member_prices%rowtype;
  v_from timestamptz := coalesce(p_valid_from, now()); v_id uuid;
begin
  if not private.is_admin() then raise exception 'catalogue_not_authorised' using errcode = '42501'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 10 then raise exception 'catalogue_reason_needed' using errcode = '22023'; end if;
  select * into it from public.catalog_items where organisation_id = v_org and code = 'membership_annual' for update;
  if not found then raise exception 'unknown_item' using errcode = '22023'; end if;
  select * into v_old from public.organisation_member_prices
   where catalog_item_id = it.id and employer_organisation_id is not distinct from p_employer_org and valid_to is null;
  if found then
    if v_from <= v_old.valid_from then raise exception 'price_start_before_current' using errcode = '22023'; end if;
    update public.organisation_member_prices set valid_to = v_from where id = v_old.id;
  end if;
  insert into public.organisation_member_prices (organisation_id, employer_organisation_id, catalog_item_id, amount_kobo, valid_from, created_by, reason)
  values (v_org, p_employer_org, it.id, p_amount_kobo, v_from, (select auth.uid()), btrim(p_reason)) returning id into v_id;
  perform private.log_audit('catalogue.organisation_price_set', 'organisation_member_prices', v_id,
    jsonb_build_object('employer_organisation_id', p_employer_org, 'amount_kobo', p_amount_kobo, 'from', v_from, 'reason', p_reason));
  return v_id;
end $$;
revoke all on function private.set_organisation_member_price_core(uuid, bigint, text, timestamptz) from public, anon, authenticated;

-- one organisation's own price
create function public.set_organisation_member_price(p_employer_org uuid, p_amount_kobo bigint, p_reason text, p_valid_from timestamptz default null)
returns uuid language plpgsql security definer set search_path = ''
as $$
begin
  if p_employer_org is null then raise exception 'organisation_price_unknown_organisation' using errcode = '22023'; end if;
  return private.set_organisation_member_price_core(p_employer_org, p_amount_kobo, p_reason, p_valid_from);
end $$;

-- the default every organisation without its own price pays
create function public.set_default_organisation_member_price(p_amount_kobo bigint, p_reason text, p_valid_from timestamptz default null)
returns uuid language plpgsql security definer set search_path = ''
as $$
begin
  return private.set_organisation_member_price_core(null, p_amount_kobo, p_reason, p_valid_from);
end $$;

-- back to the default for one organisation: its override stops on a date
create function public.clear_organisation_member_price(p_employer_org uuid, p_reason text, p_valid_from timestamptz default null)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_org uuid := (select organisation_id from public.profiles where id = (select auth.uid()));
  it public.catalog_items%rowtype; v_old public.organisation_member_prices%rowtype; v_from timestamptz := coalesce(p_valid_from, now());
begin
  if not private.is_admin() then raise exception 'catalogue_not_authorised' using errcode = '42501'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 10 then raise exception 'catalogue_reason_needed' using errcode = '22023'; end if;
  if p_employer_org is null then raise exception 'organisation_price_default_cannot_clear' using errcode = '22023'; end if;
  select * into it from public.catalog_items where organisation_id = v_org and code = 'membership_annual';
  if not found then raise exception 'unknown_item' using errcode = '22023'; end if;
  select * into v_old from public.organisation_member_prices
   where catalog_item_id = it.id and employer_organisation_id = p_employer_org and valid_to is null for update;
  if not found then raise exception 'organisation_price_no_override' using errcode = 'P0001'; end if;
  if v_from <= v_old.valid_from then raise exception 'price_start_before_current' using errcode = '22023'; end if;
  update public.organisation_member_prices set valid_to = v_from where id = v_old.id;
  perform private.log_audit('catalogue.organisation_price_cleared', 'organisation_member_prices', v_old.id,
    jsonb_build_object('employer_organisation_id', p_employer_org, 'from', v_from, 'reason', p_reason));
end $$;

-- admin screen: limits, the default, every organisation with the price it pays today, and the history
create function public.admin_organisation_prices() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_org uuid := (select organisation_id from public.profiles where id = (select auth.uid())); v_item uuid;
begin
  if not private.is_admin() then raise exception 'catalogue_not_authorised' using errcode = '42501'; end if;
  select id into v_item from public.catalog_items where organisation_id = v_org and code = 'membership_annual';
  return jsonb_build_object(
    'limits', (select jsonb_build_object('min_kobo', (rules ->> 'min_kobo')::bigint, 'max_kobo', (rules ->> 'max_kobo')::bigint)
                 from public.organisation_price_limits where is_active),
    'module_open', coalesce((select is_enabled from public.platform_modules where key = 'organisation_membership'), false),
    'default', (select to_jsonb(d) from (select amount_kobo, valid_from from private.organisation_member_price(null, v_item) where id is not null) d),
    'organisations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', o.id, 'name', o.name, 'type', o.type,
        'amount_kobo', (select amount_kobo from private.organisation_member_price(o.id, v_item)),
        'source', case when exists (select 1 from public.organisation_member_prices p where p.catalog_item_id = v_item and p.employer_organisation_id = o.id
                                      and p.valid_from <= now() and (p.valid_to is null or p.valid_to > now())) then 'override' else 'default' end,
        'active_seats', (select count(*) from public.entitlements e where e.billed_to_organisation_id = o.id and e.state = 'active'))
        order by o.name)
      from public.organisations o where o.type in ('corporate', 'hmo')), '[]'::jsonb),
    'history', coalesce((
      select jsonb_agg(jsonb_build_object(
        'employer_organisation_id', p.employer_organisation_id,
        'employer_name', (select name from public.organisations where id = p.employer_organisation_id),
        'amount_kobo', p.amount_kobo, 'valid_from', p.valid_from, 'valid_to', p.valid_to, 'reason', p.reason)
        order by p.valid_from desc)
      from public.organisation_member_prices p where p.catalog_item_id = v_item), '[]'::jsonb));
end $$;

-- an organisation's own administrator, its staff, finance or an admin may ask what one seat costs and how many seats there are
create function public.organisation_seat_summary(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_item uuid; px public.organisation_member_prices%rowtype;
begin
  if not (private.is_admin() or private.is_finance() or private.is_org_staff(p_org)
          or (private.is_institution_admin() and private.current_org_id() = p_org)) then
    raise exception 'catalogue_not_authorised' using errcode = '42501';
  end if;
  select id into v_item from public.catalog_items where code = 'membership_annual' order by created_at limit 1;
  px := private.organisation_member_price(p_org, v_item);
  -- counts and money only: never who (rule I9)
  return jsonb_build_object(
    'catalog_item_id', v_item,
    'price_kobo', px.amount_kobo,
    'price_source', case when px.employer_organisation_id is null then 'default' else 'override' end,
    'module_open', coalesce((select is_enabled from public.platform_modules where key = 'organisation_membership'), false),
    'active_seats', (select count(*) from public.entitlements e where e.billed_to_organisation_id = p_org and e.state = 'active' and not e.is_test),
    'already_member_count', (select count(*) from public.employer_roster_members r where r.organisation_id = p_org and r.status = 'claimed' and r.seat_state = 'already_member'),
    'seats_ever', (select count(*) from public.entitlements e where e.billed_to_organisation_id = p_org and not e.is_test),
    'uninvoiced_kobo', coalesce((select sum(e.seat_price_kobo) from public.entitlements e
                                  where e.billed_to_organisation_id = p_org and e.invoice_id is null and not e.is_test), 0));
end $$;

revoke all on function public.set_organisation_member_price(uuid, bigint, text, timestamptz),
  public.set_default_organisation_member_price(bigint, text, timestamptz),
  public.clear_organisation_member_price(uuid, text, timestamptz), public.admin_organisation_prices(),
  public.organisation_seat_summary(uuid) from public, anon;
grant execute on function public.set_organisation_member_price(uuid, bigint, text, timestamptz),
  public.set_default_organisation_member_price(bigint, text, timestamptz),
  public.clear_organisation_member_price(uuid, text, timestamptz), public.admin_organisation_prices(),
  public.organisation_seat_summary(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Organisation-billed Membership seats
-- ---------------------------------------------------------------------------
insert into public.platform_modules (key, label, description)
values ('organisation_membership', 'Organisation-paid Membership',
        'Lets an employer benefit package grant its rostered employees a Membership billed to the organisation at the organisation price. Dormant until the founder confirms the price, the on-site visit offer and the invoicing process.')
on conflict (key) do nothing;

alter table public.employer_roster_members
  add column seat_state text check (seat_state is null or seat_state in ('seat', 'already_member'));
comment on column public.employer_roster_members.seat_state is
  'seat: the organisation pays for this person''s Membership. already_member: the person holds their own Membership, so the organisation is not billed until it ends. Surfaced to the employer as a count only.';

alter table public.entitlements alter column order_id drop not null;
alter table public.entitlements
  add column roster_member_id          uuid references public.employer_roster_members (id) on delete restrict,
  add column billed_to_organisation_id uuid references public.organisations (id) on delete restrict,
  add column seat_price_kobo           bigint check (seat_price_kobo is null or seat_price_kobo > 0),
  add column seat_price_id             uuid references public.organisation_member_prices (id) on delete restrict,
  add column invoice_id                uuid references public.employer_invoices (id) on delete set null;
alter table public.entitlements add constraint entitlements_funding_source check (
  (order_id is not null and roster_member_id is null and billed_to_organisation_id is null and seat_price_kobo is null and seat_price_id is null)
  or (order_id is null and roster_member_id is not null and billed_to_organisation_id is not null and seat_price_kobo is not null and seat_price_id is not null and kind = 'membership'));
create unique index entitlements_one_active_seat on public.entitlements (roster_member_id) where state = 'active' and roster_member_id is not null;
create index entitlements_uninvoiced_seat_idx on public.entitlements (billed_to_organisation_id) where invoice_id is null and billed_to_organisation_id is not null;

alter table public.employer_benefit_packages alter column service_product_id drop not null;
alter table public.employer_benefit_packages
  add column catalog_item_id uuid references public.catalog_items (id) on delete restrict;
alter table public.employer_benefit_packages add constraint employer_benefit_packages_one_grant
  check (num_nonnulls(service_product_id, catalog_item_id) = 1);

create or replace function private.assert_benefit_package_org_matches()
returns trigger language plpgsql security definer set search_path to ''
as $function$
begin
  if new.catalog_item_id is not null then
    if not exists (select 1 from public.catalog_items where id = new.catalog_item_id and kind = 'membership') then
      raise exception 'employer_benefit_packages.catalog_item_id must reference a membership item';
    end if;
    if not coalesce((select is_enabled from public.platform_modules where key = 'organisation_membership'), false) then
      raise exception 'organisation_membership_not_open' using errcode = 'P0001';
    end if;
  elsif not exists (select 1 from public.service_products where id = new.service_product_id and is_active) then
    raise exception 'employer_benefit_packages.service_product_id must reference an active service';
  end if;
  return new;
end;
$function$;
drop trigger if exists employer_benefit_packages_plan_is_active on public.employer_benefit_packages;
create trigger employer_benefit_packages_plan_is_active
  before insert or update of service_product_id, catalog_item_id on public.employer_benefit_packages
  for each row execute function private.assert_benefit_package_org_matches();

-- One place that makes a seat. Returns 'seat' (made), 'already_member' (the person holds their own Membership: the organisation is NOT
-- billed; the roster row is marked and the employer sees a count only), or 'skipped' (module off, no price, nothing to grant).
create function private.grant_org_seat(p_roster uuid) returns text
language plpgsql security definer set search_path = ''
as $$
declare
  r public.employer_roster_members%rowtype;
  v_package public.employer_benefit_packages;
  it public.catalog_items%rowtype;
  px public.organisation_member_prices%rowtype;
  v_ends timestamptz; v_ent uuid; v_is_test boolean;
begin
  select * into r from public.employer_roster_members where id = p_roster for update;
  if not found or r.status <> 'claimed' or r.claimed_profile_id is null or r.benefit_package_id is null then return 'skipped'; end if;
  select * into v_package from public.employer_benefit_packages where id = r.benefit_package_id and is_active;
  if v_package.id is null or v_package.catalog_item_id is null then return 'skipped'; end if;
  if not coalesce((select is_enabled from public.platform_modules where key = 'organisation_membership'), false) then
    perform private.order_incident(r.organisation_id, 'org-seat-module-off:' || r.id, 'A rostered employee claimed while organisation Membership is off',
      'Roster row ' || r.id || ' claimed a benefit package that grants Membership, but the organisation_membership module is off, so no seat was created.');
    return 'skipped';
  end if;
  select * into it from public.catalog_items where id = v_package.catalog_item_id;
  px := private.organisation_member_price(r.organisation_id, it.id);
  if px.id is null then
    perform private.order_incident(r.organisation_id, 'org-seat-no-price:' || r.id, 'No organisation Membership price is in force',
      'Roster row ' || r.id || ' claimed a Membership benefit but no organisation price is in force, so no seat was created.');
    return 'skipped';
  end if;
  -- the person's own Membership wins; the organisation is not billed until it ends (the daily sweep re-offers the seat)
  if private.patient_is_member(r.claimed_profile_id) then return 'already_member'; end if;
  v_ends := least(now() + make_interval(days => it.duration_days),
                  case when r.eligible_until is not null then r.eligible_until::timestamptz + interval '1 day' end);
  if v_ends <= now() then return 'skipped'; end if;
  select coalesce(p.is_test, false) into v_is_test from public.profiles p where p.id = r.claimed_profile_id;
  insert into public.entitlements (organisation_id, patient_id, kind, starts_at, ends_at, roster_member_id,
                                   billed_to_organisation_id, seat_price_kobo, seat_price_id, is_test)
  values (r.organisation_id, r.claimed_profile_id, 'membership', now(), v_ends, r.id,
          r.organisation_id, px.amount_kobo, px.id, coalesce(v_is_test, false))
  on conflict (roster_member_id) where state = 'active' and roster_member_id is not null do nothing
  returning id into v_ent;
  if v_ent is not null then
    insert into public.patient_memberships (organisation_id, patient_id, source, starts_at, ends_at, is_test)
    values (r.organisation_id, r.claimed_profile_id, 'employer', now(), v_ends, coalesce(v_is_test, false));
  end if;
  return 'seat';
end $$;
revoke all on function private.grant_org_seat(uuid) from public, anon, authenticated;

create or replace function private.sync_employer_subscription_from_roster()
returns trigger language plpgsql security definer set search_path to ''
as $function$
declare
  v_package public.employer_benefit_packages;
  v_period_end timestamptz;
  v_purchase_id uuid;
  v_result text;
begin
  if new.claimed_profile_id is null then
    return null;
  end if;

  if new.status in ('departed', 'removed')
     and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    if new.granted_subscription_id is not null then
      update public.service_purchases
         set status = 'cancelled', cancelled_at = now()
       where id = new.granted_subscription_id
         and status = 'active';
    end if;
    -- an organisation-paid seat ends with the employment; the organisation already paid for the year and is not refunded here
    update public.entitlements set state = 'revoked' where roster_member_id = new.id and state = 'active';
    update public.patient_memberships
       set state = 'ended', ended_at = now(), end_reason = 'Employer seat ended: left the employer roster'
     where patient_id = new.claimed_profile_id and source = 'employer' and state = 'active';
    return null;
  end if;

  if new.status <> 'claimed' then
    return null;
  end if;

  if new.benefit_package_id is null then
    return null;
  end if;

  if tg_op = 'UPDATE'
     and old.status = 'claimed'
     and old.benefit_package_id is not distinct from new.benefit_package_id
     and old.claimed_profile_id is not distinct from new.claimed_profile_id
     and old.eligible_until is not distinct from new.eligible_until then
    return null;
  end if;

  select * into v_package from public.employer_benefit_packages where id = new.benefit_package_id and is_active;
  if v_package.id is null then
    return null;
  end if;

  -- v5 path: a Membership seat billed to the organisation
  if v_package.catalog_item_id is not null then
    v_result := private.grant_org_seat(new.id);
    if v_result in ('seat', 'already_member') then
      update public.employer_roster_members set seat_state = v_result where id = new.id and seat_state is distinct from v_result;
    end if;
    return null;
  end if;

  v_period_end := case when new.eligible_until is not null
                       then new.eligible_until::timestamptz + interval '1 day'
                       else now() + interval '1 year' end;

  if new.granted_subscription_id is not null then
    update public.service_purchases
       set service_product_id = v_package.service_product_id,
           expires_at = v_period_end,
           status = 'active',
           cancelled_at = null
     where id = new.granted_subscription_id
       and patient_id = new.claimed_profile_id
     returning id into v_purchase_id;
  end if;

  if v_purchase_id is null then
    insert into public.service_purchases
      (organisation_id, patient_id, purchaser_profile_id, service_product_id, status,
       amount_kobo, currency, payment_provider, purchased_at, expires_at)
    values
      (new.organisation_id, new.claimed_profile_id, new.claimed_profile_id, v_package.service_product_id,
       'active', 0, 'NGN', 'employer', now(), v_period_end)
    returning id into v_purchase_id;

    update public.employer_roster_members set granted_subscription_id = v_purchase_id where id = new.id;
  end if;

  return null;
end;
$function$;

-- Invoice the seats not yet billed. Finance only. The organisation sees the count and the total, never a person (I9).
create function public.generate_organisation_membership_invoice(p_organisation_id uuid, p_period_start date, p_period_end date)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_n integer; v_sum bigint; v_min bigint; v_max bigint; v_id uuid;
begin
  if not private.is_finance() then raise exception 'not authorised' using errcode = '42501'; end if;
  if p_period_end < p_period_start then raise exception 'invoice_period_invalid' using errcode = '22023'; end if;
  perform 1 from public.entitlements
    where billed_to_organisation_id = p_organisation_id and invoice_id is null and not is_test
      and (created_at at time zone 'Africa/Lagos')::date <= p_period_end for update;
  select count(*), coalesce(sum(seat_price_kobo), 0), min(seat_price_kobo), max(seat_price_kobo) into v_n, v_sum, v_min, v_max
    from public.entitlements
   where billed_to_organisation_id = p_organisation_id and invoice_id is null and not is_test
     and (created_at at time zone 'Africa/Lagos')::date <= p_period_end;
  if v_n = 0 then raise exception 'no_uninvoiced_seats' using errcode = 'P0001'; end if;
  insert into public.employer_invoices (organisation_id, contract_id, period_start, period_end, billing_model, headcount_basis, rate_kobo, amount_kobo, notes, created_by)
  values (p_organisation_id, null, p_period_start, p_period_end, 'per_active_member', v_n, case when v_min = v_max then v_min end, v_sum,
          'Membership seats activated up to the end of the period, billed at the organisation price in force on each activation day.', (select auth.uid()))
  returning id into v_id;
  update public.entitlements set invoice_id = v_id
   where billed_to_organisation_id = p_organisation_id and invoice_id is null and not is_test
     and (created_at at time zone 'Africa/Lagos')::date <= p_period_end;
  perform private.log_audit('employer_invoice.membership_generated', 'employer_invoices', v_id,
    jsonb_build_object('organisation_id', p_organisation_id, 'seats', v_n, 'amount_kobo', v_sum));
  return v_id;
end $$;
revoke all on function public.generate_organisation_membership_invoice(uuid, date, date) from public, anon;
grant execute on function public.generate_organisation_membership_invoice(uuid, date, date) to authenticated;

-- a voided invoice frees its seats to be billed again
create function private.release_seats_on_invoice_void() returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.status = 'void' and old.status is distinct from 'void' then
    update public.entitlements set invoice_id = null where invoice_id = new.id;
  end if;
  return null;
end $$;
revoke all on function private.release_seats_on_invoice_void() from public, anon, authenticated;
create trigger employer_invoices_release_seats after update of status on public.employer_invoices
  for each row execute function private.release_seats_on_invoice_void();

-- ---------------------------------------------------------------------------
-- 4. What an employee must not see, and a reminder that must not sell
-- ---------------------------------------------------------------------------
-- An employee reads their own entitlements, but the price their employer pays, the organisation billed and the invoice are the
-- organisation's business. Column privileges, not a view, so the app's existing queries keep working unchanged. A column added to
-- entitlements later is NOT readable by authenticated until it is granted here on purpose (a loud "permission denied", never a silent gap).
revoke select on public.entitlements from authenticated;
grant select (id, organisation_id, patient_id, order_id, kind, starts_at, ends_at, remaining_uses, state, is_test, created_at,
              reminded_at, acceptance, decided_at, roster_member_id)
  on public.entitlements to authenticated;

-- The 7-day expiry reminder tells a person to buy a new one. That is wrong for an employer-paid seat (the employer renews it) and a
-- Membership now has its own 30, 14 and 7 day reminders, so neither is reminded here.
create or replace function private.queue_entitlement_expiry_reminders() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  r record;
  n integer := 0;
begin
  for r in
    select e.id, e.patient_id, e.organisation_id, e.kind, e.ends_at
      from public.entitlements e
     where e.state = 'active'
       and e.ends_at is not null
       and e.ends_at > now()
       and e.ends_at <= now() + interval '7 days'
       and e.reminded_at is null
       and e.roster_member_id is null
       and e.kind <> 'membership'
  loop
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
    values (r.organisation_id, r.patient_id,
            private.patient_reminder_channel(r.patient_id), 'pending',
            'entitlement_expiring_soon',
            jsonb_build_object('entitlement_id', r.id, 'kind', r.kind, 'ends_at', r.ends_at));
    update public.entitlements set reminded_at = now() where id = r.id;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function private.queue_entitlement_expiry_reminders() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Self-check
-- ---------------------------------------------------------------------------
do $$
declare v_item uuid; v_sched int; v_dflt bigint;
begin
  select id into v_item from public.catalog_items where code = 'membership_annual' order by created_at limit 1;
  if v_item is not null then
    if (select amount_kobo from private.current_price(v_item)) <> 12000000 then raise exception 'two-tier: the individual price in force is not 12,000,000 kobo'; end if;
    select count(*) into v_sched from public.prices where catalog_item_id = v_item and amount_kobo = 10000000 and valid_to is null;
    if v_sched <> 0 then raise exception 'two-tier: the 100,000 naira individual price is still open'; end if;
    select amount_kobo into v_dflt from private.organisation_member_price(null, v_item);
    if v_dflt <> 10000000 then raise exception 'two-tier: default organisation price is not 10,000,000 kobo'; end if;
  end if;
  if coalesce((select is_enabled from public.platform_modules where key = 'organisation_membership'), true) then raise exception 'two-tier: module must start off'; end if;
  if coalesce((select is_enabled from public.platform_modules where key = 'v5_checkout'), false) then raise exception 'two-tier: v5_checkout was switched on'; end if;
  if exists (select 1 from public.catalog_items where code = 'membership_annual' and active) then raise exception 'two-tier: the Membership item was switched on'; end if;
  if has_function_privilege('anon', 'public.set_organisation_member_price(uuid,bigint,text,timestamptz)', 'EXECUTE')
     or has_function_privilege('anon', 'public.set_default_organisation_member_price(bigint,text,timestamptz)', 'EXECUTE')
     or has_function_privilege('anon', 'public.admin_organisation_prices()', 'EXECUTE')
     or has_function_privilege('anon', 'public.generate_organisation_membership_invoice(uuid,date,date)', 'EXECUTE')
     or has_function_privilege('anon', 'public.organisation_seat_summary(uuid)', 'EXECUTE') then
    raise exception 'two-tier: anon can execute a pricing function';
  end if;
  if has_column_privilege('authenticated', 'public.entitlements', 'seat_price_kobo', 'SELECT')
     or has_column_privilege('authenticated', 'public.entitlements', 'billed_to_organisation_id', 'SELECT')
     or has_column_privilege('authenticated', 'public.entitlements', 'invoice_id', 'SELECT') then
    raise exception 'two-tier: an employee can read what the organisation pays';
  end if;
  if not has_column_privilege('authenticated', 'public.entitlements', 'state', 'SELECT') then raise exception 'two-tier: authenticated lost entitlements.state'; end if;
  if has_table_privilege('authenticated', 'public.organisation_member_prices', 'SELECT') then raise exception 'two-tier: authenticated can read organisation_member_prices directly'; end if;
end $$;
