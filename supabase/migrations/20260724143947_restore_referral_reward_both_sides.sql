-- Founder decision (2026-07-24, reversing the same-day referrer-only change
-- in 20260724143319_referral_reward_referrer_only.sql): a two-sided referral
-- reward converts better (the referee has a concrete reason to actually
-- complete their first paid order, not just do a friend a favour), and the
-- incremental ₦500 cost is small next to a converted patient's lifetime
-- value. Both sides get reward_kobo (₦500) again.
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
