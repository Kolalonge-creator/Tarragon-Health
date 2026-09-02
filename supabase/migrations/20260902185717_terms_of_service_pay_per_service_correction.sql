-- Tarragon Health
-- The live Terms of Service (consent_versions, terms_of_service, currently
-- 2026-08-12-v2) still says: "Your subscription automatically renews at the
-- end of each billing period unless you turn off auto-renewal before the
-- renewal date; turning off auto-renewal doesn't end your access early, it
-- just stops the next charge." That was true of the old recurring-billing
-- model. It has not been true since the 2026-08-31 pay-per-service cutover
-- (PR #418): every plan and service is now a one-off purchase for a fixed
-- period, nothing charges a card again automatically, and there is no
-- auto-renewal toggle anywhere in the product. This document was patching
-- unrelated passages (device sales, em dashes) right through 2026-08-12
-- without anyone re-checking this one against the shipped product change
-- two and a half weeks later -- real patients have been agreeing to a false
-- billing description since 2026-08-31. Confirmed against the live,
-- correct copy on six other surfaces before writing this: pricing.ts
-- (FAQ + plan-detail copy), subscription-manager.tsx (patient billing
-- page), ai-coach-chat.tsx, plan-selector.tsx, and vouchers/actions.ts.
--
-- Two more passages in the same document describe the retired model and are
-- corrected alongside it for the same reason the Care Voucher migration
-- (20260731220052) touched both the wallet section and the referral
-- paragraph in one pass: "Cancelling and refunds" still describes cancelling
-- a subscription that no longer exists, and "Fees and price changes" still
-- describes a price change "affecting your existing subscription." Leaving
-- either uncorrected would leave the document contradicting itself even
-- after this fix.
--
-- Same pattern as 20260731220052_terms_of_service_care_vouchers.sql and
-- 20260812004025_legal_consent_em_dash_cleanup.sql: consent_versions is
-- append-only, so this retires the current terms_of_service row and
-- publishes a successor built from it via verbatim string replacement,
-- with a position()-based guard that the exact passages exist before
-- amending and a sanity check afterward. data_processing and telehealth
-- are untouched, so existing acceptances of those two stay valid. Still
-- explicitly draft/pending-counsel-review, same as every version before it
-- -- this is a correction of fact, not a claim of legal sign-off.

do $$
declare
  v_body text;
  v_title text;
  v_old_subscription text;
  v_new_payments text;
  v_old_cancelling text;
  v_new_cancelling text;
  v_old_fees text;
  v_new_fees text;
begin
  select body, title into v_body, v_title
    from public.consent_versions
   where consent_type = 'terms_of_service' and is_current;

  if v_body is null then raise exception 'no current terms of service to amend'; end if;

  v_old_subscription := '## Your subscription' || chr(10) ||
    'All plans are priced in Naira; the same plan costs the same amount whichever way you pay, whether by a Nigerian payment method or an international card. We do not operate a separate foreign-currency price list. Your subscription automatically renews at the end of each billing period unless you turn off auto-renewal before the renewal date; turning off auto-renewal doesn''t end your access early, it just stops the next charge.';

  v_old_cancelling := '## Cancelling and refunds' || chr(10) ||
    'You can cancel a subscription at any time from your account settings. Cancelling stops it from renewing; you keep full access through the end of the period you have already paid for. We do not provide a partial or pro-rata refund for the unused portion of a period you cancel mid-cycle, except where required by applicable law, where we decide, at our discretion, that a billing error or a service failure attributable to us warrants one, or as described above for a held video-visit payment that is never accepted.' || chr(10) || chr(10) ||
    '[Counsel to confirm whether Nigerian consumer protection law (the FCCPC framework) requires a cooling-off period or a different refund position than the one stated above.]';

  v_old_fees := '## Fees and price changes' || chr(10) ||
    'We may change our prices. If a change affects your existing subscription, we will give you at least 30 days'' notice before it takes effect, and you may cancel before the new price applies.';

  if position(v_old_subscription in v_body) = 0
     or position(v_old_cancelling in v_body) = 0
     or position(v_old_fees in v_body) = 0 then
    raise exception 'the passages to amend were not found verbatim; re-read the live row before amending';
  end if;

  v_new_payments := '## Payments and services' || chr(10) ||
    'All prices are in Naira; the same price applies whichever way you pay, whether by a Nigerian payment method or an international card. We do not operate a separate foreign-currency price list. Every plan and service on TarragonHealth is a one-off purchase for a fixed period, not a subscription: nothing is ever charged to your card again automatically, and there is no auto-renewal to turn off. When a purchase''s period ends, your access simply ends with it; buying it again from your My services page is the only way to continue, whenever you''re ready.';

  v_new_cancelling := '## Cancelling and refunds' || chr(10) ||
    'Because nothing on TarragonHealth renews automatically, there is no subscription to cancel. Each purchase is a one-off payment for a fixed period, and once made it is not refundable, except where required by applicable law, where we decide, at our discretion, that a billing error or a service failure attributable to us warrants one, or as described above for a held video-visit payment that is never accepted.' || chr(10) || chr(10) ||
    '[Counsel to confirm whether Nigerian consumer protection law (the FCCPC framework) requires a cooling-off period or a different refund position than the one stated above for a one-off digital-service purchase.]';

  v_new_fees := '## Fees and price changes' || chr(10) ||
    'We may change our prices at any time. A price change never affects a purchase you have already made; it only applies to purchases made after the change takes effect.';

  update public.consent_versions
     set is_current = false
   where consent_type = 'terms_of_service' and is_current;

  insert into public.consent_versions (consent_type, version, title, body, is_current)
  values ('terms_of_service', '2026-09-02-v1', v_title,
          replace(replace(replace(v_body, v_old_subscription, v_new_payments), v_old_cancelling, v_new_cancelling), v_old_fees, v_new_fees),
          true);
end $$;

do $$
declare v_body text;
begin
  select body into v_body from public.consent_versions
   where consent_type = 'terms_of_service' and is_current;

  if v_body ilike '%automatically renews%' or v_body ilike '%turn off auto-renewal%' then
    raise exception 'the false auto-renewal claim is still present';
  end if;
  if v_body not ilike '%## Payments and services%'
     or v_body not ilike '%one-off purchase for a fixed period%'
     or v_body not ilike '%no auto-renewal to turn off%' then
    raise exception 'the corrected payments section is missing expected content';
  end if;
  if v_body not ilike '%there is no subscription to cancel%' then
    raise exception 'the corrected cancelling section is missing expected content';
  end if;
  if v_body ilike '%your existing subscription%' then
    raise exception 'the fees section still references an existing subscription';
  end if;
  if v_body like '%—%' then
    raise exception 'em dash reintroduced into terms_of_service';
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
end $$;

-- ---------------------------------------------------------------------------
-- Credit where it's actually due: the regulatory register (§87.15,
-- 20260829224053_regulatory_register_and_vendor_assessments.sql) logged
-- an FCCPC "auto-renewal disclosure" obligation as code_complete, citing
-- the app-layer surfaces above -- but the Terms of Service itself, the one
-- document a regulator actually reads, was still asserting the opposite of
-- what those surfaces said until the correction above. Re-point that row
-- at what is now true: there is no recurring charge left to disclose
-- (retired 2026-08-31), and the contract text now matches the product.
-- ---------------------------------------------------------------------------
do $$
declare v_updated integer;
begin
  update public.regulatory_obligations
     set obligation = 'Pre-purchase pricing and refund-terms disclosure',
         detail = 'Recurring subscriptions/auto-renewal were retired platform-wide 2026-08-31 (pay-per-service cutover); there is no renewal left to disclose. App-layer purchase surfaces (subscription-manager.tsx, pricing.ts, ai-coach-chat.tsx) already stated this correctly, but the Terms of Service itself still falsely claimed auto-renewal until corrected 2026-09-02 -- see 20260902185717_terms_of_service_pay_per_service_correction.sql.',
         last_reviewed_at = current_date
   where regulator_or_law = 'FCCPC / consumer protection'
     and obligation = 'Pre-purchase auto-renewal / plan-change disclosure';

  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    raise exception 'expected regulatory_obligations row not found; re-check the row before assuming this update applied';
  end if;
end $$;
