-- Tarragon Health Wallet — core ledger (founder-directed 2026-07-23).
--
-- One NGN-denominated wallet per patient; four ways credit flows in (own
-- top-up, diaspora sponsor top-up, referral reward, prevention reward — the
-- latter two in the companion referral_rewards migration) and one way it
-- flows out: spent on Tarragon care (booking orders). M-TIBA lesson baked
-- in: the wallet is fused to care delivery, never cashed out.
--
-- INTEGRATION DESIGN (no Edge Function edits): the deployed payment webhooks
-- record every verified charge into payment_transactions BEFORE branching on
-- metadata.kind. A top-up charge carries metadata {kind:'wallet_topup'} that
-- the webhook doesn't recognise (its unknown-kind branch no-ops/marks error —
-- cosmetic); an AFTER INSERT trigger here matches the recorded transaction to
-- wallet_topups.pending_provider_ref and credits the wallet. This deliberately
-- avoids touching supabase/functions/* because the DEPLOYED webhook is ahead
-- of this branch (PR #113's video_visit handling) — a redeploy from this
-- branch's source would regress it.
--
-- Spending is an atomic SECURITY DEFINER RPC (wallet_pay_booking_order) that
-- debits the ledger and flips the order to payment_confirmed — which fires
-- the existing commission/timeline/debrief triggers exactly as a card
-- payment does. payment_provider gains a 'wallet' value for attribution.
--
-- FX for diaspora top-ups: sponsor chooses the NGN credit; the GBP/USD charge
-- is computed from admin-set rates on platform_currency_settings
-- (ngn_per_gbp / ngn_per_usd, added here, NULL until the founder sets them —
-- GBP/USD top-ups gracefully unavailable meanwhile). Credit is locked in
-- kobo on the wallet_topups row at initiate time.

alter type public.payment_provider add value if not exists 'wallet';

alter table public.platform_currency_settings
  add column if not exists ngn_per_gbp numeric,
  add column if not exists ngn_per_usd numeric;

create type public.wallet_entry_type as enum
  ('topup', 'sponsor_topup', 'referral_reward', 'prevention_reward', 'spend', 'refund', 'adjustment');

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.health_wallets (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete restrict,
  profile_id       uuid not null references public.profiles (id) on delete cascade unique,
  balance_kobo     bigint not null default 0 check (balance_kobo >= 0),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table public.wallet_topups (
  id                     uuid primary key default gen_random_uuid(),
  organisation_id        uuid not null references public.organisations (id) on delete restrict,
  wallet_id              uuid not null references public.health_wallets (id) on delete cascade,
  payer_profile_id       uuid not null references public.profiles (id) on delete cascade,
  amount_minor           bigint not null check (amount_minor > 0),
  currency               text not null default 'NGN' check (currency in ('NGN', 'GBP', 'USD')),
  credit_kobo            bigint not null check (credit_kobo > 0),
  provider               public.payment_provider,
  pending_provider_ref   text,
  status                 text not null default 'pending' check (status in ('pending', 'credited', 'failed')),
  payment_transaction_id uuid references public.payment_transactions (id),
  created_at             timestamptz not null default now()
);

create index wallet_topups_wallet_idx on public.wallet_topups (wallet_id);
create index wallet_topups_pending_ref_idx on public.wallet_topups (pending_provider_ref)
  where pending_provider_ref is not null;

-- Append-only: SELECT-only grants, every write goes through private.wallet_apply.
create table public.wallet_ledger (
  id                     uuid primary key default gen_random_uuid(),
  organisation_id        uuid not null references public.organisations (id) on delete restrict,
  wallet_id              uuid not null references public.health_wallets (id) on delete cascade,
  entry_type             public.wallet_entry_type not null,
  amount_kobo            bigint not null check (amount_kobo <> 0),
  balance_after_kobo     bigint not null,
  actor_profile_id       uuid references public.profiles (id),
  payment_transaction_id uuid references public.payment_transactions (id),
  topup_id               uuid references public.wallet_topups (id),
  booking_order_type     public.commission_type,
  booking_order_id       uuid,
  note                   text,
  created_at             timestamptz not null default now()
);

create index wallet_ledger_wallet_idx on public.wallet_ledger (wallet_id, created_at desc);

-- Savings toward a health check ("pay small small"): a named target displayed
-- against the single wallet balance — no earmarked sub-balances, deliberately
-- simple and honest. Auto-completed by private.wallet_apply when the balance
-- reaches the target.
create table public.wallet_savings_goals (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete restrict,
  wallet_id        uuid not null references public.health_wallets (id) on delete cascade,
  name             text not null,
  panel_bundle_id  uuid references public.panel_bundles (id),
  target_kobo      bigint not null check (target_kobo > 0),
  status           text not null default 'active' check (status in ('active', 'completed', 'cancelled')),
  completed_at     timestamptz,
  created_at       timestamptz not null default now()
);

create unique index wallet_savings_goals_one_active
  on public.wallet_savings_goals (wallet_id) where status = 'active';

-- ---------------------------------------------------------------------------
-- Helpers (private schema, unexposed)
-- ---------------------------------------------------------------------------

create or replace function private.ensure_wallet(p_profile uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_wallet uuid;
  v_org uuid;
begin
  select id into v_wallet from public.health_wallets where profile_id = p_profile;
  if v_wallet is not null then return v_wallet; end if;
  select organisation_id into v_org from public.profiles where id = p_profile;
  if v_org is null then raise exception 'profile has no organisation'; end if;
  insert into public.health_wallets (organisation_id, profile_id)
  values (v_org, p_profile)
  on conflict (profile_id) do update set updated_at = now()
  returning id into v_wallet;
  return v_wallet;
end;
$$;

-- The single write path for every balance change. Locks the wallet row,
-- enforces non-negative balance on debits, appends the ledger entry with
-- balance_after, and auto-completes any active savings goal the new balance
-- satisfies. Returns the ledger entry id.
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
  end if;

  return v_entry;
end;
$$;

-- Sponsorship authorization: who may top up someone else's wallet. The payer
-- always may fund their own; funding another patient requires an explicit
-- relationship — a family_plan_members link (either direction) or a
-- profile_access grant from the wallet owner.
create or replace function private.can_fund_wallet(p_wallet uuid, p_payer uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1 from public.health_wallets w
    where w.id = p_wallet
      and (
        w.profile_id = p_payer
        or exists (
          select 1 from public.family_plan_members f
          where (f.plan_owner_id = p_payer and f.member_id = w.profile_id)
             or (f.plan_owner_id = w.profile_id and f.member_id = p_payer)
        )
        or exists (
          select 1 from public.profile_access pa
          where pa.profile_id = w.profile_id and pa.grantee_user_id = p_payer
        )
      )
  );
$$;

-- ---------------------------------------------------------------------------
-- Credit on confirmed charge: AFTER INSERT on payment_transactions.
-- The webhooks insert one row per verified event (idempotent on
-- (provider, provider_event_id)), so this fires exactly once per charge.
-- Handles both Paystack ({event,data:{reference,metadata}}) and Stripe
-- ({...data:{object:{id,metadata}}}) payload shapes.
-- ---------------------------------------------------------------------------

create or replace function private.credit_wallet_from_payment_transaction()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind text;
  v_ref text;
  v_topup public.wallet_topups%rowtype;
begin
  if new.event_type not in ('charge.success', 'checkout.session.completed') then
    return new;
  end if;

  v_kind := coalesce(
    new.raw_payload -> 'data' -> 'metadata' ->> 'kind',
    new.raw_payload -> 'data' -> 'object' -> 'metadata' ->> 'kind'
  );
  if v_kind is distinct from 'wallet_topup' then return new; end if;

  v_ref := coalesce(
    new.raw_payload -> 'data' ->> 'reference',
    new.raw_payload -> 'data' -> 'object' ->> 'id'
  );
  if v_ref is null then return new; end if;

  select * into v_topup
  from public.wallet_topups
  where pending_provider_ref = v_ref and status = 'pending'
  for update;
  if not found then return new; end if;

  perform private.wallet_apply(
    v_topup.wallet_id,
    v_topup.credit_kobo,
    case
      when v_topup.payer_profile_id = (select profile_id from public.health_wallets where id = v_topup.wallet_id)
        then 'topup'::public.wallet_entry_type
      else 'sponsor_topup'::public.wallet_entry_type
    end,
    v_topup.payer_profile_id,
    null,
    v_topup.id,
    new.id
  );

  update public.wallet_topups
    set status = 'credited', payment_transaction_id = new.id
    where id = v_topup.id;

  return new;
end;
$$;

create trigger payment_transactions_credit_wallet
  after insert on public.payment_transactions
  for each row execute function private.credit_wallet_from_payment_transaction();

-- ---------------------------------------------------------------------------
-- Public RPCs
-- ---------------------------------------------------------------------------

-- Lazily creates and returns the caller's own wallet id.
create or replace function public.get_or_create_my_wallet()
returns uuid
language sql
security definer
set search_path = ''
as $$
  select private.ensure_wallet(auth.uid());
$$;

-- Pay a pending_payment booking order from the CALLER'S OWN wallet balance.
-- Sponsors fund wallets; only the owner spends. Atomic: debit + status flip
-- in one transaction, so the existing payment_confirmed triggers (commission,
-- notifications, timeline) fire exactly as they do for a card payment.
create or replace function public.wallet_pay_booking_order(p_order_type text, p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_wallet uuid;
  v_total bigint;
  v_patient uuid;
  v_status text;
  v_entry uuid;
begin
  if v_caller is null then raise exception 'not authenticated'; end if;
  if p_order_type not in ('lab', 'pharmacy', 'referral') then
    raise exception 'unsupported order type %', p_order_type;
  end if;

  if p_order_type = 'lab' then
    select patient_id, status::text, total_kobo into v_patient, v_status, v_total
      from public.lab_orders where id = p_order_id for update;
  elsif p_order_type = 'pharmacy' then
    select patient_id, status::text, total_kobo into v_patient, v_status, v_total
      from public.pharmacy_orders where id = p_order_id for update;
  else
    select patient_id, status::text, total_kobo into v_patient, v_status, v_total
      from public.specialist_referrals where id = p_order_id for update;
  end if;

  if v_patient is null then raise exception 'order not found'; end if;
  if v_patient <> v_caller then raise exception 'not your order' using errcode = '42501'; end if;
  if v_status <> 'pending_payment' then raise exception 'order is not awaiting payment'; end if;
  if v_total is null or v_total <= 0 then raise exception 'order has no payable amount'; end if;

  v_wallet := private.ensure_wallet(v_caller);

  v_entry := private.wallet_apply(
    v_wallet, -v_total, 'spend', v_caller,
    null, null, null,
    p_order_type::public.commission_type, p_order_id
  );

  if p_order_type = 'lab' then
    update public.lab_orders
      set status = 'payment_confirmed', payment_provider = 'wallet',
          payment_provider_ref = v_entry::text, pending_payment_provider_ref = null
      where id = p_order_id;
  elsif p_order_type = 'pharmacy' then
    update public.pharmacy_orders
      set status = 'payment_confirmed', payment_provider = 'wallet',
          payment_provider_ref = v_entry::text, pending_payment_provider_ref = null
      where id = p_order_id;
  else
    update public.specialist_referrals
      set status = 'payment_confirmed', payment_provider = 'wallet',
          payment_provider_ref = v_entry::text, pending_payment_provider_ref = null
      where id = p_order_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'balance_kobo', (select balance_kobo from public.health_wallets where id = v_wallet)
  );
end;
$$;

revoke execute on function public.get_or_create_my_wallet() from public, anon;
revoke execute on function public.wallet_pay_booking_order(text, uuid) from public, anon;
grant execute on function public.get_or_create_my_wallet() to authenticated;
grant execute on function public.wallet_pay_booking_order(text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.health_wallets enable row level security;
alter table public.wallet_topups enable row level security;
alter table public.wallet_ledger enable row level security;
alter table public.wallet_savings_goals enable row level security;

-- Balance: owner, org staff, or a consented grantee (profile_access is the
-- consent primitive — sponsors see the wallet they fund only with consent).
create policy health_wallets_select on public.health_wallets
  for select to authenticated
  using (
    profile_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or exists (
      select 1 from public.profile_access pa
      where pa.profile_id = health_wallets.profile_id
        and pa.grantee_user_id = (select auth.uid())
    )
  );

-- Top-ups: visible to the wallet owner, the payer, and org staff. INSERT by
-- the payer for any wallet they're authorised to fund, always status pending;
-- status flips only via the definer trigger.
create policy wallet_topups_select on public.wallet_topups
  for select to authenticated
  using (
    payer_profile_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or exists (
      select 1 from public.health_wallets w
      where w.id = wallet_topups.wallet_id and w.profile_id = (select auth.uid())
    )
  );

create policy wallet_topups_insert on public.wallet_topups
  for insert to authenticated
  with check (
    payer_profile_id = (select auth.uid())
    and status = 'pending'
    and private.can_fund_wallet(wallet_id, (select auth.uid()))
  );

-- Ledger: owner + staff + consented grantee. Append-only — no INSERT/UPDATE/
-- DELETE policies at all; writes happen only inside definer helpers.
create policy wallet_ledger_select on public.wallet_ledger
  for select to authenticated
  using (
    private.is_org_staff(organisation_id)
    or exists (
      select 1 from public.health_wallets w
      where w.id = wallet_ledger.wallet_id
        and (
          w.profile_id = (select auth.uid())
          or exists (
            select 1 from public.profile_access pa
            where pa.profile_id = w.profile_id
              and pa.grantee_user_id = (select auth.uid())
          )
        )
    )
  );

-- Savings goals: owner manages their own; staff read.
create policy wallet_savings_goals_select on public.wallet_savings_goals
  for select to authenticated
  using (
    private.is_org_staff(organisation_id)
    or exists (
      select 1 from public.health_wallets w
      where w.id = wallet_savings_goals.wallet_id and w.profile_id = (select auth.uid())
    )
  );

create policy wallet_savings_goals_insert on public.wallet_savings_goals
  for insert to authenticated
  with check (
    exists (
      select 1 from public.health_wallets w
      where w.id = wallet_savings_goals.wallet_id and w.profile_id = (select auth.uid())
    )
  );

create policy wallet_savings_goals_update on public.wallet_savings_goals
  for update to authenticated
  using (
    exists (
      select 1 from public.health_wallets w
      where w.id = wallet_savings_goals.wallet_id and w.profile_id = (select auth.uid())
    )
  );
