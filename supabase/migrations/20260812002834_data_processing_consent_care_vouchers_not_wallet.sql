-- Marketing-site audit (2026-08-12) found the data processing consent still
-- describes the "Health Wallet" (deleted 2026-07-31 for CBN structuring
-- reasons, see project_care_vouchers_replace_wallet memory) in two places:
-- the "Wallet and payment information" collection bullet, and the
-- "Family/sponsor access" consent bullet's "sponsor funding your Health
-- Wallet" phrase. terms_of_service got the equivalent Wallet-to-Voucher
-- rewrite the same week (20260731220052_terms_of_service_care_vouchers.sql)
-- but that migration's own comment says "data_processing and telehealth are
-- untouched" -- this document was simply missed, and stayed missed through
-- a later, unrelated republish for the 2026-08-10 vitals-escalation gating
-- correction. This document is a legal consent a patient actually accepts,
-- so it should describe the payment mechanism that actually exists.
--
-- consent_versions is append-only: this retires the current data_processing
-- row and publishes a successor built from it, changing exactly the two
-- Wallet passages. terms_of_service and telehealth are untouched here (each
-- gets its own migration), so existing acceptances of those two stay valid.

do $$
declare
  v_body text;
  v_title text;
  v_old_collection text;
  v_new_collection text;
  v_old_sponsor text;
  v_new_sponsor text;
begin
  select body, title into v_body, v_title
    from public.consent_versions
   where consent_type = 'data_processing' and is_current;

  if v_body is null then raise exception 'no current data processing consent to amend'; end if;

  v_old_collection := '• Wallet and payment information — subscription, Health Wallet, and order history, and payment references from Paystack or Stripe. We do not store your full card number. Where you top up your own or a family member''s Health Wallet, we record the amount and the funding relationship between you.';

  v_old_sponsor := '• Family/sponsor access — a family member, next of kin, or sponsor funding your Health Wallet may, with your separate consent, view your record or manage bookings on your behalf. Funding your care never grants this access automatically — it is a separate, two-sided request either of you can initiate and either of you can decline.';

  if position(v_old_collection in v_body) = 0 or position(v_old_sponsor in v_body) = 0 then
    raise exception 'the passages to amend were not found verbatim; re-read the live row before amending';
  end if;

  v_new_collection := '• Payment and voucher information — subscription, Care Voucher, and order history, and payment references from Paystack or Stripe. We do not store your full card number. Where someone buys you a Care Voucher, we record the purchase and the funding relationship between you.';

  v_new_sponsor := '• Family/sponsor access — a family member, next of kin, or sponsor funding your care may, with your separate consent, view your record or manage bookings on your behalf. Funding your care never grants this access automatically — it is a separate, two-sided request either of you can initiate and either of you can decline.';

  update public.consent_versions
     set is_current = false
   where consent_type = 'data_processing' and is_current;

  insert into public.consent_versions (consent_type, version, title, body, is_current)
  values ('data_processing', '2026-08-12-v1', v_title,
          replace(replace(v_body, v_old_collection, v_new_collection), v_old_sponsor, v_new_sponsor),
          true);
end $$;

do $$
declare v_body text;
begin
  select body into v_body from public.consent_versions
   where consent_type = 'data_processing' and is_current;

  if v_body ilike '%health wallet%' or v_body ilike '%wallet%' then
    raise exception 'the data processing consent still mentions a wallet';
  end if;
  if v_body not ilike '%care voucher%' then
    raise exception 'the data processing consent does not mention Care Vouchers';
  end if;
  if (select count(*) from public.consent_versions
      where consent_type = 'data_processing' and is_current) <> 1 then
    raise exception 'exactly one data_processing version must be current';
  end if;
  -- The other two consent types must be untouched, so prior acceptances hold.
  if (select count(*) from public.consent_versions
      where consent_type in ('terms_of_service', 'telehealth') and is_current) <> 2 then
    raise exception 'the other consent types were disturbed';
  end if;
end $$;
