-- Care Vouchers, part 6: rewards stop crediting a balance and start issuing
-- their own discount vouchers.
--
-- The regulatory point is not cosmetic. Nobody pays cash for a reward, so it
-- is not customer money and there is no float to protect — but only if it is
-- kept structurally apart from money customers DID pay. Mixing promotional
-- credit into the same spendable balance as prepayments was what made the two
-- indistinguishable. A reward voucher has purchaser_profile_id NULL by
-- constraint, which is what lets the finance layer post it to a marketing
-- liability instead of the customer-prepayment liability.
--
-- Amounts are unchanged from what was already live: referral NGN 500 each side
-- (read off the referrals row, not re-hardcoded here), prevention NGN 500 /
-- 500 / 1,000, annual prevention cap NGN 5,000.

-- ---------------------------------------------------------------------------
-- Referral reward — both sides, unchanged amount, now a voucher each.
-- ---------------------------------------------------------------------------
create or replace function private.maybe_reward_referral(p_referee uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ref public.referrals%rowtype;
begin
  select * into v_ref
  from public.referrals
  where referred_id = p_referee and reward_status = 'pending'
  for update skip locked;
  if not found then return; end if;

  perform private.issue_reward_voucher(
    v_ref.referrer_id, v_ref.reward_kobo,
    'Referral reward',
    'Your invite completed their first paid order');
  perform private.issue_reward_voucher(
    v_ref.referred_id, v_ref.reward_kobo,
    'Welcome reward',
    'Referral credit toward your care');

  update public.referrals set reward_status = 'earned', updated_at = now() where id = v_ref.id;
exception when others then
  -- Reward failure must never block the payment path.
  null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Prevention rewards. Cap now counts issued reward vouchers rather than
-- ledger entries; same NGN 5,000 rolling year, same fixed-per-event-type rule
-- (an abnormal result earns exactly what a normal one does, no penalty ever).
-- ---------------------------------------------------------------------------
create or replace function private.prevention_reward(p_profile uuid, p_amount bigint, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_year_total bigint;
  c_annual_cap constant bigint := 500000; -- PLACEHOLDER NGN 5,000/yr
begin
  select coalesce(sum(face_value_kobo), 0) into v_year_total
  from public.care_vouchers
  where beneficiary_profile_id = p_profile
    and kind = 'reward_discount'
    and created_at > now() - interval '365 days';

  if v_year_total + p_amount > c_annual_cap then return; end if;

  perform private.issue_reward_voucher(p_profile, p_amount, 'Prevention reward', p_note);
exception when others then
  null; -- never block the clinical write path
end;
$$;

-- ---------------------------------------------------------------------------
-- Wellness points redemption -> a discount voucher, not a balance.
-- ---------------------------------------------------------------------------
alter table public.wellness_points_redemptions
  add column if not exists voucher_id uuid references public.care_vouchers (id) on delete set null;

create or replace function public.redeem_wellness_points(p_points integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_bal public.wellness_points_balances%rowtype;
  v_rate numeric;
  v_kobo bigint;
  v_voucher uuid;
begin
  if v_caller is null then raise exception 'not authenticated'; end if;
  if p_points is null or p_points <= 0 then
    return jsonb_build_object('ok', false, 'error', 'Enter a positive number of points.');
  end if;

  select * into v_bal from public.wellness_points_balances where patient_id = v_caller for update;
  if not found or v_bal.balance < p_points then
    return jsonb_build_object('ok', false, 'error', 'You don''t have enough points for that yet.');
  end if;

  select points_to_kobo_rate into v_rate from public.wellness_points_config where id = true;
  v_kobo := round(p_points * coalesce(v_rate, 1));
  if v_kobo <= 0 then
    return jsonb_build_object('ok', false, 'error', 'Redemption isn''t available right now.');
  end if;

  v_voucher := private.issue_reward_voucher(
    v_caller, v_kobo, 'Wellness reward',
    p_points::text || ' wellness points redeemed');
  if v_voucher is null then
    return jsonb_build_object('ok', false, 'error', 'Could not create your reward just now — try again shortly.');
  end if;

  update public.wellness_points_balances
    set balance = balance - p_points, updated_at = now()
    where patient_id = v_caller;

  insert into public.wellness_points_ledger
    (organisation_id, patient_id, points, balance_after, reason)
  values (v_bal.organisation_id, v_caller, -p_points, v_bal.balance - p_points, 'redeemed_to_voucher');

  insert into public.wellness_points_redemptions
    (organisation_id, patient_id, points_redeemed, kobo_credited, voucher_id)
  values (v_bal.organisation_id, v_caller, p_points, v_kobo, v_voucher);

  return jsonb_build_object(
    'ok', true, 'balance', v_bal.balance - p_points,
    'kobo_credited', v_kobo, 'voucher_id', v_voucher);
end;
$$;

do $$
begin
  if (select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'private' and p.proname = 'prevention_reward') ilike '%wallet%' then
    raise exception 'prevention_reward still references the wallet';
  end if;
  if (select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'private' and p.proname = 'maybe_reward_referral') ilike '%wallet%' then
    raise exception 'maybe_reward_referral still references the wallet';
  end if;
  if (select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'redeem_wellness_points') ilike '%wallet_apply%' then
    raise exception 'redeem_wellness_points still credits the wallet';
  end if;
end $$;;
