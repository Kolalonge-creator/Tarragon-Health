-- Tarragon Health
-- CBN-readiness controls for the Health Wallet — found in a Nigeria-
-- regulator-lens review: health_wallets holds a real stored-value balance,
-- funded by a real charge (Paystack/Stripe) and by a real cross-account
-- "sponsor" (any consented relationship, per can_fund_wallet — a Lagos son
-- funding an Enugu mother's wallet works today), with no CBN tiered-KYC
-- balance ceiling and no oversight signal on unusual funding patterns. This
-- doesn't obtain a CBN PSP license — that's a legal/business decision for
-- the founder, not something a migration can grant — it builds the risk
-- controls a real license application would need to show are already in
-- place, using CBN's published 3-tier KYC framework as the reference shape
-- (Tier 1 unverified / Tier 2 identity-verified / Tier 3 full KYC), and
-- reuses the identity_verifications table this platform already has rather
-- than inventing a parallel verification record.
--
-- Two halves:
-- 1. A tiered balance ceiling, enforced PROSPECTIVELY at checkout-initiation
--    time in TypeScript (lib/billing/wallet-checkout.ts) — never inside
--    private.wallet_apply itself, because wallet_apply's only caller for a
--    real top-up is private.credit_wallet_from_payment_transaction, an
--    AFTER INSERT trigger on payment_transactions with no exception
--    handler: raising there would abort the webhook's own audit-log write
--    for a charge that ALREADY SUCCEEDED at the payment provider, stranding
--    a patient's captured payment with nothing to show for it. Blocking
--    checkout initiation (before money changes hands) is the safe
--    enforcement point; the config table below is what that TS check reads.
-- 2. Non-blocking compliance flags: wallet_apply itself is where every
--    credit — top-up, sponsor top-up, referral/prevention reward, wellness
--    points redemption — actually lands, so it's the right place to record
--    (never reject) anything worth a human review: a credit that still
--    pushes past the tier ceiling despite the prospective check (e.g. two
--    concurrent top-ups racing each other), an unusually large single
--    sponsor top-up, or one payer sponsoring several different wallets in a
--    short window (a classic structuring/smurfing shape).

create table public.wallet_kyc_tier_limits (
  tier              text primary key check (tier in ('default', 'identity_verified')),
  max_balance_kobo  bigint check (max_balance_kobo is null or max_balance_kobo > 0),
  updated_at        timestamptz not null default now(),
  updated_by        uuid references public.profiles (id) on delete restrict
);

comment on table public.wallet_kyc_tier_limits is
  'CBN tiered-KYC balance ceilings for the Health Wallet. "default" = no verified identity on file (identity_verifications has no verified row for this patient); "identity_verified" = a verified NIN/BVN check exists. NULL max_balance_kobo means unlimited (reserved for a future admin-flagged full-KYC tier, not seeded here). These are placeholder figures matching the shape of CBN Circular-published tier limits — confirm the exact naira amounts with counsel/CBN before relying on them for a real license position.';

-- ₦50,000 / ₦500,000, in kobo — placeholder figures, see table comment.
insert into public.wallet_kyc_tier_limits (tier, max_balance_kobo) values
  ('default', 5000000),
  ('identity_verified', 50000000);

alter table public.wallet_kyc_tier_limits enable row level security;

create policy wallet_kyc_tier_limits_select on public.wallet_kyc_tier_limits
  for select to authenticated using (true);

create policy wallet_kyc_tier_limits_update on public.wallet_kyc_tier_limits
  for update to authenticated using (private.is_admin()) with check (private.is_admin());

grant select, update on public.wallet_kyc_tier_limits to authenticated;

create or replace function private.wallet_kyc_tier(p_profile uuid)
returns text
language sql
security definer
set search_path = ''
stable
as $$
  select case
    when exists (
      select 1 from public.identity_verifications
      where patient_id = p_profile and status = 'verified'
    ) then 'identity_verified'
    else 'default'
  end;
$$;

create or replace function private.wallet_kyc_max_balance(p_profile uuid)
returns bigint
language sql
security definer
set search_path = ''
stable
as $$
  select max_balance_kobo
  from public.wallet_kyc_tier_limits
  where tier = private.wallet_kyc_tier(p_profile);
$$;

-- public wrapper so the checkout-time TS check (an authenticated patient
-- session, not an admin) can read their own effective cap without a broad
-- grant on wallet_kyc_tier_limits' underlying logic.
create or replace function public.wallet_kyc_balance_headroom(p_profile uuid)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cap bigint;
  v_balance bigint;
begin
  if p_profile <> auth.uid() and not private.is_org_staff(
    (select organisation_id from public.profiles where id = p_profile)
  ) then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  v_cap := private.wallet_kyc_max_balance(p_profile);
  if v_cap is null then
    return null; -- unlimited
  end if;

  select coalesce(w.balance_kobo, 0) into v_balance
  from public.health_wallets w
  where w.profile_id = p_profile;

  return greatest(v_cap - coalesce(v_balance, 0), 0);
end;
$$;

revoke all on function public.wallet_kyc_balance_headroom(uuid) from public, anon;
revoke all on function public.wallet_kyc_balance_headroom(uuid) from anon;
grant execute on function public.wallet_kyc_balance_headroom(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Non-blocking compliance flags
-- ---------------------------------------------------------------------------

create table public.wallet_compliance_flags (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  wallet_id         uuid not null references public.health_wallets (id) on delete cascade,
  flag_type         text not null check (flag_type in ('kyc_cap_exceeded', 'large_sponsor_topup', 'multi_wallet_sponsor')),
  detail            jsonb not null default '{}'::jsonb,
  ledger_entry_id   uuid references public.wallet_ledger (id) on delete set null,
  status            text not null default 'open' check (status in ('open', 'reviewed', 'dismissed')),
  reviewed_by       uuid references public.profiles (id) on delete restrict,
  reviewed_at       timestamptz,
  created_at        timestamptz not null default now()
);

create index wallet_compliance_flags_status_idx on public.wallet_compliance_flags (status, created_at desc);

alter table public.wallet_compliance_flags enable row level security;

create policy wallet_compliance_flags_select on public.wallet_compliance_flags
  for select to authenticated using (private.is_admin());

create policy wallet_compliance_flags_update on public.wallet_compliance_flags
  for update to authenticated using (private.is_admin()) with check (private.is_admin());

-- No insert/delete policy — every row comes from the SECURITY DEFINER
-- wallet_apply function below, never a direct client write.

grant select, update on public.wallet_compliance_flags to authenticated;

-- ---------------------------------------------------------------------------
-- wallet_apply: extended with flag-raising, never blocking. Every existing
-- line preserved byte-for-byte; only the new block after the ledger insert
-- is added.
-- ---------------------------------------------------------------------------

create or replace function private.wallet_apply(
  p_wallet uuid,
  p_amount_kobo bigint,
  p_entry_type public.wallet_entry_type,
  p_actor uuid default null,
  p_note text default null,
  p_topup uuid default null,
  p_payment_transaction uuid default null,
  p_booking_order_type public.commission_type default null,
  p_booking_order_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_wallet public.health_wallets%rowtype;
  v_new_balance bigint;
  v_entry uuid;
  v_cap bigint;
  v_recent_distinct_wallets int;
begin
  if p_amount_kobo = 0 then raise exception 'amount must be non-zero'; end if;

  select * into v_wallet from public.health_wallets where id = p_wallet for update;
  if not found then raise exception 'wallet not found'; end if;

  v_new_balance := v_wallet.balance_kobo + p_amount_kobo;
  if v_new_balance < 0 then
    raise exception 'Insufficient wallet balance' using errcode = 'P0001';
  end if;

  update public.health_wallets
    set balance_kobo = v_new_balance, updated_at = now()
    where id = p_wallet;

  insert into public.wallet_ledger
    (organisation_id, wallet_id, entry_type, amount_kobo, balance_after_kobo,
     actor_profile_id, payment_transaction_id, topup_id, booking_order_type, booking_order_id, note)
  values
    (v_wallet.organisation_id, p_wallet, p_entry_type, p_amount_kobo, v_new_balance,
     p_actor, p_payment_transaction, p_topup, p_booking_order_type, p_booking_order_id, p_note)
  returning id into v_entry;

  if p_amount_kobo > 0 then
    update public.wallet_savings_goals
      set status = 'completed', completed_at = now()
      where wallet_id = p_wallet and status = 'active' and target_kobo <= v_new_balance;

    -- Compliance flags — informational only, never rejects the credit that
    -- was already paid for.
    v_cap := private.wallet_kyc_max_balance(v_wallet.profile_id);
    if v_cap is not null and v_new_balance > v_cap then
      insert into public.wallet_compliance_flags (organisation_id, wallet_id, flag_type, detail, ledger_entry_id)
      values (
        v_wallet.organisation_id, p_wallet, 'kyc_cap_exceeded',
        jsonb_build_object('cap_kobo', v_cap, 'balance_kobo', v_new_balance, 'tier', private.wallet_kyc_tier(v_wallet.profile_id)),
        v_entry
      );
    end if;

    if p_entry_type = 'sponsor_topup' then
      if p_amount_kobo >= 20000000 then -- ₦200,000 placeholder large-transaction threshold
        insert into public.wallet_compliance_flags (organisation_id, wallet_id, flag_type, detail, ledger_entry_id)
        values (
          v_wallet.organisation_id, p_wallet, 'large_sponsor_topup',
          jsonb_build_object('amount_kobo', p_amount_kobo, 'payer_profile_id', p_actor),
          v_entry
        );
      end if;

      if p_actor is not null then
        select count(distinct wl.wallet_id) into v_recent_distinct_wallets
        from public.wallet_ledger wl
        where wl.actor_profile_id = p_actor
          and wl.entry_type = 'sponsor_topup'
          and wl.created_at > now() - interval '30 days'
          and wl.wallet_id <> p_wallet;

        if v_recent_distinct_wallets >= 2 then
          insert into public.wallet_compliance_flags (organisation_id, wallet_id, flag_type, detail, ledger_entry_id)
          values (
            v_wallet.organisation_id, p_wallet, 'multi_wallet_sponsor',
            jsonb_build_object('payer_profile_id', p_actor, 'distinct_other_wallets_30d', v_recent_distinct_wallets),
            v_entry
          );
        end if;
      end if;
    end if;
  end if;

  return v_entry;
end;
$$;

do $$
begin
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'wallet_kyc_tier_limits'
  ) then
    raise exception 'wallet_kyc_tier_limits was not created';
  end if;

  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'wallet_compliance_flags'
  ) then
    raise exception 'wallet_compliance_flags was not created';
  end if;

  if has_function_privilege('anon', 'public.wallet_kyc_balance_headroom(uuid)', 'EXECUTE') then
    raise exception 'wallet_kyc_balance_headroom must not be anon-executable';
  end if;
end;
$$;
