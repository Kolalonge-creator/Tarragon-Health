-- Founder correction (2026-07-24): only the referrer earns the referral
-- reward on the referee's first completed paid order — the referee gets no
-- "welcome" credit (was previously both sides). reward_kobo on the referrals
-- row still holds the single amount to pay out (₦500, see
-- 20260724113718_fix_referral_reward_amount.sql).
create or replace function private.maybe_reward_referral(p_referee uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ref public.referrals%rowtype;
  v_referrer_wallet uuid;
begin
  select * into v_ref
  from public.referrals
  where referred_id = p_referee and reward_status = 'pending'
  for update skip locked;
  if not found then return; end if;

  v_referrer_wallet := private.ensure_wallet(v_ref.referrer_id);

  perform private.wallet_apply(v_referrer_wallet, v_ref.reward_kobo, 'referral_reward',
    v_ref.referred_id, 'Referral reward — your invite completed their first paid order');

  update public.referrals set reward_status = 'earned', updated_at = now() where id = v_ref.id;
exception when others then
  -- Reward failure must never block the payment path.
  null;
end;
$$;
