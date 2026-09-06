-- Tarragon Health — §91.8 admin-configurable discount/promo-code system.
--
-- Generalises the existing choke points rather than a parallel mechanism:
-- redemption mints a one-off `reward_discount` care voucher via the same
-- private.issue_reward_voucher() the referral/wellness-points rewards already
-- use, then redeems it via the existing public.redeem_care_voucher() —
-- reusing its single-purpose/non-transferable/never-cash-redeemable
-- guarantees rather than re-implementing discount application.
--
-- Real scope limit, discovered by reading the live redeem_care_voucher()
-- definition rather than assuming: it only supports order_type in
-- ('lab','pharmacy','referral') — one-off bookings. Subscriptions/add-ons and
-- video visits are billed as recurring Paystack/Stripe objects with a fixed
-- price and are NOT reachable through this mechanism. A promo code that
-- discounts a subscription would need a different design (a provider-side
-- coupon object or a price override) — out of scope here, not silently
-- dropped: applicable_order_types is structurally constrained to the three
-- supported types so this can never be configured to look like it covers more
-- than it does.

create table public.promo_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  kind text not null check (kind in ('percentage','fixed_amount')),
  value_bp integer check (value_bp between 1 and 10000),
  value_kobo bigint check (value_kobo > 0),
  applicable_order_types text[] not null default array['lab','pharmacy','referral'],
  max_redemptions integer check (max_redemptions is null or max_redemptions > 0),
  per_profile_limit integer not null default 1 check (per_profile_limit > 0),
  min_spend_kobo bigint not null default 0 check (min_spend_kobo >= 0),
  starts_at timestamptz not null default now(),
  expires_at timestamptz,
  is_active boolean not null default true,
  organisation_id uuid references public.organisations (id) on delete set null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint promo_codes_kind_shape check (
    (kind = 'percentage' and value_bp is not null and value_kobo is null)
    or (kind = 'fixed_amount' and value_kobo is not null and value_bp is null)
  ),
  constraint promo_codes_order_types_valid check (
    applicable_order_types <@ array['lab','pharmacy','referral']::text[]
    and coalesce(array_length(applicable_order_types, 1), 0) > 0
  ),
  constraint promo_codes_date_window check (expires_at is null or expires_at > starts_at)
);
alter table public.promo_codes enable row level security;

create trigger promo_codes_set_updated_at before update on public.promo_codes
  for each row execute function private.set_updated_at();

-- Read via RLS (same split as care_vouchers: SELECT policy, RPC-only writes).
-- Ordinary patients never SELECT this table directly — they validate a code
-- only by attempting redeem_promo_code, so business-sensitive fields
-- (redemption limits, dates) are never exposed to a browsing patient.
create policy promo_codes_select on public.promo_codes
  for select to authenticated
  using (private.is_admin() or private.has_permission('vouchers.manage'));
grant select on public.promo_codes to authenticated;

create table public.promo_code_redemptions (
  id uuid primary key default gen_random_uuid(),
  promo_code_id uuid not null references public.promo_codes (id) on delete restrict,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  order_type text not null check (order_type in ('lab','pharmacy','referral')),
  order_id uuid not null,
  discount_applied_kobo bigint not null check (discount_applied_kobo > 0),
  voucher_id uuid references public.care_vouchers (id) on delete set null,
  redeemed_at timestamptz not null default now(),
  unique (promo_code_id, order_type, order_id)
);
alter table public.promo_code_redemptions enable row level security;
create index promo_code_redemptions_profile_idx on public.promo_code_redemptions (profile_id);
create index promo_code_redemptions_code_idx on public.promo_code_redemptions (promo_code_id);

create policy promo_code_redemptions_select on public.promo_code_redemptions
  for select to authenticated
  using (profile_id = (select auth.uid()) or private.is_admin() or private.has_permission('vouchers.manage'));
grant select on public.promo_code_redemptions to authenticated;

-- ---------------------------------------------------------------------------
-- Redemption: validate → mint a one-off reward_discount voucher → redeem it
-- against the order via the existing engine → log. No stacking: an order
-- that already has applied_voucher_id set (a reward or a purchased voucher)
-- refuses a second discount outright.
-- ---------------------------------------------------------------------------
create or replace function public.redeem_promo_code(
  p_code text,
  p_order_type text,
  p_order_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_promo public.promo_codes%rowtype;
  v_patient uuid;
  v_status text;
  v_payable bigint;
  v_applied_voucher uuid;
  v_redemption_count int;
  v_global_count int;
  v_discount bigint;
  v_voucher_id uuid;
  v_result jsonb;
begin
  if v_caller is null then raise exception 'not authenticated'; end if;
  if p_order_type not in ('lab', 'pharmacy', 'referral') then
    raise exception 'promo codes can only be applied to lab, pharmacy, or referral orders';
  end if;

  select * into v_promo from public.promo_codes where upper(code) = upper(trim(p_code)) for update;
  if not found then raise exception 'that code was not recognised'; end if;
  if not v_promo.is_active then raise exception 'that code is no longer active'; end if;
  if v_promo.starts_at > now() then raise exception 'that code is not active yet'; end if;
  if v_promo.expires_at is not null and v_promo.expires_at <= now() then raise exception 'that code has expired'; end if;
  if not (p_order_type = any(v_promo.applicable_order_types)) then
    raise exception 'that code cannot be used for this kind of order';
  end if;

  if p_order_type = 'lab' then
    select patient_id, status::text, payable_kobo, applied_voucher_id
      into v_patient, v_status, v_payable, v_applied_voucher
      from public.lab_orders where id = p_order_id for update;
  elsif p_order_type = 'pharmacy' then
    select patient_id, status::text, payable_kobo, applied_voucher_id
      into v_patient, v_status, v_payable, v_applied_voucher
      from public.pharmacy_orders where id = p_order_id for update;
  else
    select patient_id, status::text, payable_kobo, applied_voucher_id
      into v_patient, v_status, v_payable, v_applied_voucher
      from public.specialist_referrals where id = p_order_id for update;
  end if;

  if v_patient is null then raise exception 'order not found'; end if;

  if v_patient <> v_caller
     and not exists (
       select 1 from public.profile_access pa
       where pa.profile_id = v_patient and pa.grantee_user_id = v_caller and pa.permission_level = 'manage'
     ) then
    raise exception 'This order is not yours to discount' using errcode = '42501';
  end if;

  if v_status <> 'pending_payment' then raise exception 'that order is not awaiting payment'; end if;
  if v_payable is null or v_payable <= 0 then raise exception 'that order has nothing left to pay'; end if;
  if v_applied_voucher is not null then
    raise exception 'this order already has a discount applied — only one discount per order';
  end if;
  if v_payable < v_promo.min_spend_kobo then
    raise exception 'this code needs a minimum spend of %', to_char(v_promo.min_spend_kobo / 100.0, 'FM999999990.00');
  end if;

  select count(*) into v_redemption_count from public.promo_code_redemptions
    where promo_code_id = v_promo.id and profile_id = v_patient;
  if v_redemption_count >= v_promo.per_profile_limit then
    raise exception 'you have already used this code the maximum number of times';
  end if;

  if v_promo.max_redemptions is not null then
    select count(*) into v_global_count from public.promo_code_redemptions where promo_code_id = v_promo.id;
    if v_global_count >= v_promo.max_redemptions then
      raise exception 'this code has reached its redemption limit';
    end if;
  end if;

  v_discount := case v_promo.kind
    when 'percentage' then round(v_payable * v_promo.value_bp / 10000.0)
    else v_promo.value_kobo
  end;
  v_discount := least(v_discount, v_payable);
  if v_discount <= 0 then raise exception 'this code produces no discount on this order'; end if;

  v_voucher_id := private.issue_reward_voucher(v_patient, v_discount, 'Promo: ' || v_promo.code, 'Applied via promo code');
  if v_voucher_id is null then
    raise exception 'could not apply this code right now — please try again';
  end if;

  v_result := public.redeem_care_voucher(v_voucher_id, p_order_type, p_order_id);

  insert into public.promo_code_redemptions
    (promo_code_id, profile_id, order_type, order_id, discount_applied_kobo, voucher_id)
  values (v_promo.id, v_patient, p_order_type, p_order_id, v_discount, v_voucher_id);

  return v_result || jsonb_build_object('code', v_promo.code, 'discount_kobo', v_discount);
end;
$$;

revoke all on function public.redeem_promo_code(text, text, uuid) from public;
revoke all on function public.redeem_promo_code(text, text, uuid) from anon;
revoke all on function public.redeem_promo_code(text, text, uuid) from public, anon;
grant execute on function public.redeem_promo_code(text, text, uuid) to authenticated;

create or replace function public.create_promo_code(
  p_code text,
  p_kind text,
  p_value numeric,
  p_applicable_order_types text[] default array['lab','pharmacy','referral'],
  p_max_redemptions integer default null,
  p_per_profile_limit integer default 1,
  p_min_spend_kobo bigint default 0,
  p_starts_at timestamptz default now(),
  p_expires_at timestamptz default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_org uuid;
begin
  if not (private.is_admin() or private.has_permission('vouchers.manage')) then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  if p_kind not in ('percentage', 'fixed_amount') then raise exception 'kind must be percentage or fixed_amount'; end if;
  if p_code is null or length(trim(p_code)) < 3 then raise exception 'code must be at least 3 characters'; end if;
  if p_value is null or p_value <= 0 then raise exception 'value must be positive'; end if;

  select organisation_id into v_org from public.profiles where id = (select auth.uid());

  insert into public.promo_codes (
    code, kind, value_bp, value_kobo, applicable_order_types, max_redemptions,
    per_profile_limit, min_spend_kobo, starts_at, expires_at, organisation_id, created_by
  ) values (
    upper(trim(p_code)), p_kind,
    case when p_kind = 'percentage' then round(p_value * 100)::integer else null end,
    case when p_kind = 'fixed_amount' then round(p_value * 100)::bigint else null end,
    coalesce(p_applicable_order_types, array['lab','pharmacy','referral']),
    p_max_redemptions, coalesce(p_per_profile_limit, 1), coalesce(p_min_spend_kobo, 0),
    coalesce(p_starts_at, now()), p_expires_at, v_org, (select auth.uid())
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.create_promo_code(text, text, numeric, text[], integer, integer, bigint, timestamptz, timestamptz) from public;
revoke all on function public.create_promo_code(text, text, numeric, text[], integer, integer, bigint, timestamptz, timestamptz) from anon;
revoke all on function public.create_promo_code(text, text, numeric, text[], integer, integer, bigint, timestamptz, timestamptz) from public, anon;
grant execute on function public.create_promo_code(text, text, numeric, text[], integer, integer, bigint, timestamptz, timestamptz) to authenticated;

create or replace function public.set_promo_code_active(p_id uuid, p_is_active boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (private.is_admin() or private.has_permission('vouchers.manage')) then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  update public.promo_codes set is_active = p_is_active, updated_at = now() where id = p_id;
  if not found then raise exception 'code not found'; end if;
end;
$$;

revoke all on function public.set_promo_code_active(uuid, boolean) from public;
revoke all on function public.set_promo_code_active(uuid, boolean) from anon;
revoke all on function public.set_promo_code_active(uuid, boolean) from public, anon;
grant execute on function public.set_promo_code_active(uuid, boolean) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.redeem_promo_code(text, text, uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.create_promo_code(text, text, numeric, text[], integer, integer, bigint, timestamptz, timestamptz)', 'EXECUTE')
     or has_function_privilege('anon', 'public.set_promo_code_active(uuid, boolean)', 'EXECUTE') then
    raise exception 'anon must never execute a promo-code function';
  end if;
  if not exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'promo_codes') then
    raise exception 'promo_codes was not created';
  end if;
  if not exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'promo_code_redemptions') then
    raise exception 'promo_code_redemptions was not created';
  end if;
end $$;
