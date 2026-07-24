-- Founder correction (2026-07-24): referral reward was launched at a ₦2,000
-- placeholder; founder confirmed the real value is ₦500 each side. Only the
-- redemption-time literal changes — the payout function (private.maybe_reward_referral)
-- already reads reward_kobo back off the referrals row, so it needs no edit.
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
  values (v_org, v_owner, v_caller, upper(trim(p_code)), 'patient_refers_patient', 50000, 'pending');
  return jsonb_build_object('ok', true);
end;
$$;

revoke execute on function public.redeem_referral_code(text) from public, anon;
grant execute on function public.redeem_referral_code(text) to authenticated;

-- Any already-redeemed-but-not-yet-earned referrals (none exist yet, but this
-- keeps the migration correct/idempotent if run against a lagging environment)
-- get the corrected amount too.
update public.referrals set reward_kobo = 50000 where reward_status = 'pending' and reward_kobo = 200000;
