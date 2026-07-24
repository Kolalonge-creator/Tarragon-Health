-- Referral loop + prevention rewards — both pay into the Health Wallet
-- (founder decision 2026-07-23: rewards become wallet balance spendable on
-- Tarragon care, never cash — the fraud posture that survived Nigeria's 2024
-- fintech referral crackdowns: credit-not-cash, gated on a real paid event).
--
-- REUSES the day-one public.referrals scaffold table (platform_infra) rather
-- than creating a parallel one — it was built for exactly this and has zero
-- app usage. Adaptations: the original per-row unique code becomes a
-- non-unique column (the model is one shareable per-user code, minted in the
-- new referral_codes table); one redemption per referee enforced by a new
-- partial unique index; reward_status 'earned' marks the credited state
-- (wallet credit is the payout — 'paid' stays unused/reserved).
--
-- ALL REWARD AMOUNTS ARE PLACEHOLDERS for the founder to confirm:
--   referral: ₦2,000 each side, on the referee's FIRST completed paid event
--   prevention: ₦500 screening completed / ₦500 vaccination verified /
--               ₦1,000 self-booked health check resulted
--   annual cap on prevention rewards: ₦5,000 per patient per rolling year

create table public.referral_codes (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  profile_id      uuid not null references public.profiles (id) on delete cascade unique,
  code            text not null unique,
  created_at      timestamptz not null default now()
);

alter table public.referral_codes enable row level security;

create policy referral_codes_select on public.referral_codes
  for select to authenticated
  using (profile_id = (select auth.uid()) or private.is_org_staff(organisation_id));

-- Adapt the scaffold table to the shared-code model.
alter table public.referrals drop constraint if exists referrals_code_key;
create index if not exists referrals_code_idx on public.referrals (code);
create unique index if not exists referrals_one_per_referee
  on public.referrals (referred_id) where referred_id is not null;

-- The scaffold table shipped with RLS enabled but no policies were ever
-- added by the app; give it the read policy the feature needs now.
alter table public.referrals enable row level security;
drop policy if exists referrals_select on public.referrals;
create policy referrals_select on public.referrals
  for select to authenticated
  using (
    referrer_id = (select auth.uid())
    or referred_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
  );
-- No user INSERT/UPDATE policies: writes via the definer RPCs/engine only.

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------

create or replace function public.get_or_create_my_referral_code()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_org uuid;
  v_code text;
begin
  if v_caller is null then raise exception 'not authenticated'; end if;
  select code into v_code from public.referral_codes where profile_id = v_caller;
  if v_code is not null then return v_code; end if;
  select organisation_id into v_org from public.profiles where id = v_caller;
  loop
    v_code := upper(substr(md5(gen_random_uuid()::text), 1, 8));
    begin
      insert into public.referral_codes (organisation_id, profile_id, code)
      values (v_org, v_caller, v_code);
      return v_code;
    exception when unique_violation then
      select code into v_code from public.referral_codes where profile_id = v_caller;
      if v_code is not null then return v_code; end if;
    end;
  end loop;
end;
$$;

-- Redeem within 30 days of account creation; one redemption per account ever;
-- self-referral blocked; reward is NOT paid here — it waits for the first
-- completed paid event (private.maybe_reward_referral).
create or replace function public.redeem_referral_code(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_org uuid;
  v_created timestamptz;
  v_owner uuid;
begin
  if v_caller is null then raise exception 'not authenticated'; end if;
  select organisation_id, created_at into v_org, v_created from public.profiles where id = v_caller;
  if v_created < now() - interval '30 days' then
    return jsonb_build_object('ok', false, 'error', 'Referral codes can only be applied within 30 days of joining.');
  end if;
  select profile_id into v_owner from public.referral_codes where code = upper(trim(p_code));
  if v_owner is null then
    return jsonb_build_object('ok', false, 'error', 'That code doesn''t look right — check it and try again.');
  end if;
  if v_owner = v_caller then
    return jsonb_build_object('ok', false, 'error', 'You can''t refer yourself.');
  end if;
  if exists (select 1 from public.referrals where referred_id = v_caller) then
    return jsonb_build_object('ok', false, 'error', 'A referral code has already been applied to this account.');
  end if;
  insert into public.referrals (organisation_id, referrer_id, referred_id, code, type, reward_kobo, reward_status)
  values (v_org, v_owner, v_caller, upper(trim(p_code)), 'patient_refers_patient', 200000, 'pending');
  return jsonb_build_object('ok', true);
end;
$$;

revoke execute on function public.get_or_create_my_referral_code() from public, anon;
revoke execute on function public.redeem_referral_code(text) from public, anon;
grant execute on function public.get_or_create_my_referral_code() to authenticated;
grant execute on function public.redeem_referral_code(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Reward engine
-- ---------------------------------------------------------------------------

-- Fires on the referee's first completed PAID event: any booking order
-- reaching payment_confirmed, or a subscription reaching active. Credits
-- BOTH wallets the row's reward_kobo and marks the referral 'earned'.
create or replace function private.maybe_reward_referral(p_referee uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ref public.referrals%rowtype;
  v_referrer_wallet uuid;
  v_referee_wallet uuid;
begin
  select * into v_ref
  from public.referrals
  where referred_id = p_referee and reward_status = 'pending'
  for update skip locked;
  if not found then return; end if;

  v_referrer_wallet := private.ensure_wallet(v_ref.referrer_id);
  v_referee_wallet := private.ensure_wallet(v_ref.referred_id);

  perform private.wallet_apply(v_referrer_wallet, v_ref.reward_kobo, 'referral_reward',
    v_ref.referred_id, 'Referral reward — your invite completed their first paid order');
  perform private.wallet_apply(v_referee_wallet, v_ref.reward_kobo, 'referral_reward',
    v_ref.referrer_id, 'Welcome reward — referral credit');

  update public.referrals set reward_status = 'earned', updated_at = now() where id = v_ref.id;
exception when others then
  -- Reward failure must never block the payment path.
  null;
end;
$$;

create or replace function private.referral_on_booking_paid()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'payment_confirmed' and old.status is distinct from new.status then
    perform private.maybe_reward_referral(new.patient_id);
  end if;
  return new;
end;
$$;

drop trigger if exists lab_orders_referral_reward on public.lab_orders;
create trigger lab_orders_referral_reward
  after update on public.lab_orders
  for each row execute function private.referral_on_booking_paid();

drop trigger if exists pharmacy_orders_referral_reward on public.pharmacy_orders;
create trigger pharmacy_orders_referral_reward
  after update on public.pharmacy_orders
  for each row execute function private.referral_on_booking_paid();

create or replace function private.referral_on_subscription_active()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'active' and old.status is distinct from new.status then
    perform private.maybe_reward_referral(new.subscriber_id);
  end if;
  return new;
end;
$$;

drop trigger if exists subscriptions_referral_reward on public.subscriptions;
create trigger subscriptions_referral_reward
  after update on public.subscriptions
  for each row execute function private.referral_on_subscription_active();

-- ---------------------------------------------------------------------------
-- Prevention rewards: verified prevention actions earn small wallet credits.
-- Rewards the CHECK, with amounts fixed per event type — never keyed to the
-- result's content (an abnormal result earns exactly the same as a normal
-- one; no penalty ever). Capped per rolling year.
-- ---------------------------------------------------------------------------

create or replace function private.prevention_reward(p_profile uuid, p_amount bigint, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_wallet uuid;
  v_year_total bigint;
  c_annual_cap constant bigint := 500000; -- PLACEHOLDER ₦5,000/yr
begin
  v_wallet := private.ensure_wallet(p_profile);
  select coalesce(sum(amount_kobo), 0) into v_year_total
  from public.wallet_ledger
  where wallet_id = v_wallet
    and entry_type = 'prevention_reward'
    and created_at > now() - interval '365 days';
  if v_year_total + p_amount > c_annual_cap then return; end if;
  perform private.wallet_apply(v_wallet, p_amount, 'prevention_reward', null, p_note);
exception when others then
  null; -- never block the clinical write path
end;
$$;

create or replace function private.reward_vaccination_verified()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.verification_status = 'verified' and old.verification_status is distinct from 'verified' then
    perform private.prevention_reward(new.profile_id, 50000, 'Vaccination verified — prevention reward'); -- PLACEHOLDER ₦500
  end if;
  return new;
end;
$$;

drop trigger if exists vaccination_records_reward on public.vaccination_records;
create trigger vaccination_records_reward
  after update on public.vaccination_records
  for each row execute function private.reward_vaccination_verified();

create or replace function private.reward_screening_completed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'completed' and old.status is distinct from new.status then
    perform private.prevention_reward(new.patient_id, 50000, 'Screening completed — prevention reward'); -- PLACEHOLDER ₦500
  end if;
  return new;
end;
$$;

drop trigger if exists screening_schedules_reward on public.screening_schedules;
create trigger screening_schedules_reward
  after update on public.screening_schedules
  for each row execute function private.reward_screening_completed();

create or replace function private.reward_health_check_resulted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'resulted' and old.status is distinct from 'resulted'
     and new.origin = 'patient_initiated'
     and exists (select 1 from public.panel_bundles pb where pb.id = new.panel_bundle_id and pb.self_bookable)
  then
    perform private.prevention_reward(new.patient_id, 100000, 'Health check completed — prevention reward'); -- PLACEHOLDER ₦1,000
  end if;
  return new;
end;
$$;

drop trigger if exists lab_orders_health_check_reward on public.lab_orders;
create trigger lab_orders_health_check_reward
  after update on public.lab_orders
  for each row execute function private.reward_health_check_resulted();
