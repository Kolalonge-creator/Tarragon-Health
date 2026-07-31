-- Care Vouchers, part 9: the Terms of Service say what the product actually is.
--
-- consent_versions is append-only, so this retires the current terms_of_service
-- row and publishes a successor built from it, changing exactly two passages:
-- the "The Health Wallet" section, and the referral paragraph that promised a
-- wallet credit. data_processing and telehealth are untouched, so existing
-- acceptances of those two stay valid.
--
-- The four properties enforced in the schema are stated here in the terms the
-- patient actually agrees to. A promise made in code and not in the contract is
-- only half a promise, and this is the half a regulator reads.

do $$
declare
  v_body text;
  v_title text;
  v_old_wallet text;
  v_new_voucher text;
  v_old_referral text;
  v_new_referral text;
begin
  select body, title into v_body, v_title
    from public.consent_versions
   where consent_type = 'terms_of_service' and is_current;

  if v_body is null then raise exception 'no current terms of service to amend'; end if;

  v_old_wallet := '## The Health Wallet' || chr(10) ||
    'You may hold a Health Wallet balance, funded by you or, with your consent, by a family member or sponsor — including one based abroad. A wallet top-up is spendable within the platform on bookings and orders; it is not a bank account and is not withdrawable as cash. To limit how large an unverified wallet balance can grow, we apply a lower balance ceiling by default, raised once you complete an identity check. [The wallet''s exact regulatory status is being confirmed with counsel.]';

  v_old_referral := 'If you refer someone who joins TarragonHealth using your referral link or code, both of you may receive a credit to your Health Wallet once they complete their first paid action on the platform. Reward amounts and terms may change; we''ll tell you the current amount before you share your link.';

  if position(v_old_wallet in v_body) = 0 or position(v_old_referral in v_body) = 0 then
    raise exception 'the passages to amend were not found verbatim; re-read the live row before amending';
  end if;

  v_new_voucher := '## Care Vouchers' || chr(10) ||
'When you pay for a health check or screening ahead of time, you receive a Care Voucher for that specific service. A voucher is an entitlement to the named service. It is not a store of money and not an account balance, and these terms apply to it.' || chr(10) || chr(10) ||
'**It is single-purpose.** A voucher can only be used for the service named on it. It cannot be applied to a different test, a different product, or a subscription.' || chr(10) || chr(10) ||
'**It is non-transferable.** A voucher belongs to the person it was issued to and cannot be sold, given away, or moved to another account. Neither you nor we can reassign it.' || chr(10) || chr(10) ||
'**It is never redeemable for cash.** There is no withdrawal, payout, or transfer route of any kind, and we will not create one. If a voucher is cancelled, any refund is made to the card or account that originally paid for it, never as cash and never as credit to somebody else.' || chr(10) || chr(10) ||
'**It is valid for 24 months** from the day it is fully paid for. We will tell you 30 days before it expires. If it does expire unused, contact us: we will normally extend it, and we would rather you got the care than lost the money.' || chr(10) || chr(10) ||
'**You can pay for it in instalments.** A voucher you are still paying for is reserved rather than active, and becomes usable once the full amount is paid. We do not expire a voucher you are still paying toward, and the 24 months only begins once it is fully paid.' || chr(10) || chr(10) ||
'**Someone else can buy one for you.** A family member or sponsor, including one living abroad, can buy a named service for you if you have linked them to your care. They will see that they bought it and later that it was used. They will not see your results or any other health information.' || chr(10) || chr(10) ||
'**Rewards are vouchers too.** Credit earned through referrals, prevention activities, or wellness points is issued as a discount voucher on these same terms. It has no cash value, was not bought with your money, and cannot be exchanged for money.';

  v_new_referral := 'If you refer someone who joins TarragonHealth using your referral link or code, both of you may receive a reward voucher once they complete their first paid action on the platform. A reward voucher is a discount toward care on the terms set out under Care Vouchers above: it has no cash value and cannot be exchanged for money. Reward amounts and terms may change; we''ll tell you the current amount before you share your link.';

  update public.consent_versions
     set is_current = false
   where consent_type = 'terms_of_service' and is_current;

  insert into public.consent_versions (consent_type, version, title, body, is_current)
  values ('terms_of_service', '2026-07-31-v2', v_title,
          replace(replace(v_body, v_old_wallet, v_new_voucher), v_old_referral, v_new_referral),
          true);
end $$;

do $$
declare v_body text;
begin
  select body into v_body from public.consent_versions
   where consent_type = 'terms_of_service' and is_current;

  if v_body ilike '%wallet%' then
    raise exception 'the terms still mention a wallet';
  end if;
  if v_body not ilike '%non-transferable%'
     or v_body not ilike '%never redeemable for cash%'
     or v_body not ilike '%single-purpose%'
     or v_body not ilike '%24 months%' then
    raise exception 'the terms do not state all four voucher guarantees';
  end if;
  if (select count(*) from public.consent_versions
      where consent_type = 'terms_of_service' and is_current) <> 1 then
    raise exception 'exactly one terms_of_service version must be current';
  end if;
  -- The other two consent types must be untouched, so prior acceptances hold.
  if (select count(*) from public.consent_versions
      where consent_type in ('data_processing', 'telehealth') and is_current) <> 2 then
    raise exception 'the other consent types were disturbed';
  end if;
end $$;;
