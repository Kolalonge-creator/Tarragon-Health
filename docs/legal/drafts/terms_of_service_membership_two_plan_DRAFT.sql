-- DRAFT. NOT APPLIED. DO NOT APPLY until the owner (CEO and CMO) has signed the
-- terms as the responsible officer, counsel has reviewed them, and every
-- square-bracketed placeholder in the body below is resolved (the guard below
-- refuses to run while any '[' remains).
--
-- Source of the text: docs/legal/schedule-c-terms-of-service.md, version
-- 2026-10-13-v1-draft. Research and counsel items:
-- docs/legal/membership-terms-nigeria-review.md. Sign-off sheet:
-- docs/legal/membership-terms-signoff.md.
--
-- Shape of the table (read live, read-only, 2026-10-13): there is no table
-- called legal_documents. The terms live in public.consent_versions
-- (id, consent_type, version, title, body, is_current, published_at,
-- created_at, text_key, is_optional). It is append-only by convention: a new
-- version row is inserted and the old row's is_current is turned off. Rows are
-- never edited. The live current terms_of_service row on 2026-10-13 was
-- version 2026-09-02-v1 (9,500 characters). data_processing (2026-09-08-v1)
-- and telehealth (2026-08-12-v2) are left untouched so prior acceptances of
-- those two stay valid.
--
-- Effect on patients: publishing a new current terms_of_service version means
-- patients are asked to accept it again where the app checks the current
-- version. Confirm that behaviour with the consent flow before applying.
--
-- Apply only as execute_sql in a transaction with the schema_migrations row
-- inserted at this file's version (never bare apply_migration, which stamps
-- wall-clock time), and run list_migrations first for anything new. This
-- version stamp was taken from the clock on 2026-10-13 and must be re-checked
-- against the live head before use, as in docs/design/TWO-TIER-INTEGRATION.md.
--
-- ROLLBACK: set the new row's is_current = false and the 2026-09-02-v1 row's
-- is_current = true (never delete a published version).

do $$
declare
  v_title text;
  v_body text := $tos_body$
## About this document
This is TarragonHealth's Terms of Service, Schedule C of our legal documentation. Version 2026-10-13-v1-draft. This document is currently in draft and pending final review by our legal counsel and approval by our responsible officer.

## Acceptance of these terms
By ticking the box to accept and enrolling with TarragonHealth, you agree to these terms, our Data Processing Consent, and our Telehealth Consent. If you do not agree, do not use the platform.

## Eligibility and accounts
You must be at least 18 years old to hold your own account. An adult may enrol a child under 18 as their dependant and manage their care, under our Guardian and dependant data terms. Each person, including a minor, has their own individually-structured account; we do not offer a shared household or family account or a multi-person discount. Separately, you may name a next of kin who can be contacted in an emergency and, with your consent, view (not edit) your record, and, for an adult who wants help managing their own care, you may set up a two-sided arrangement letting another adult manage bookings on your behalf; either of you can end this at any time. You are responsible for the accuracy of the information you provide, including anything you record on a dependant's behalf, and for keeping your login secure.

## What TarragonHealth is, and isn't
TarragonHealth is a digital-first chronic disease, preventive health, and care-coordination platform: we measure your readings, classify them against a clinical protocol, connect you with a doctor when something needs attention, and coordinate labs, pharmacies, and specialist referrals on your behalf. We do not own or operate any hospital, clinic, laboratory, or screening facility; every lab, pharmacy, and specialist you use through the platform is an independent partner. We are not an emergency service; see Emergencies below and our Telehealth Consent. We are not an insurer: nothing on the platform is capitation, claims cover, or any form of risk transfer, and where we bill an organisation for its members' access, that billing is a service fee, never a per-member premium.

## Individual and organisational access
You can join and pay for Membership yourself. An employer, HMO or other organisation may also pay for your Membership. If an organisation pays, you receive the same Membership as anyone else, and that organisation only ever sees aggregate statistics about its whole covered group, never anything about you individually (see our Data Processing Consent). Your results, notes and messages stay between you and your care team. The organisation cannot ask us for them.

When an organisation pays, you have no payment relationship with TarragonHealth, and only the organisation that paid can claim the 21-day refund. Any refund goes back to that organisation. If the organisation claims a refund, we tell you, and your Member access ends at once, as it does for any approved refund. You keep your right to a make-good if we fail to deliver the service itself (see "If we do not deliver" below), and your records stay with you.

[Where TarragonHealth sells to an organisation directly, that relationship is expected to be governed by a separate commercial agreement with the organisation, not by these terms; counsel to confirm. See the accompanying memo, Question 9.]

## The two plans: Free and Membership
There are two plans.

**Free.** The app, your record, your readings, reminders, and general health guidance. Free does not include time with a doctor. See "If you are on the Free plan" below for what that means when a reading or symptom looks dangerous.

**Membership.** Membership costs 120,000 naira for one year, paid through Paystack. It is a one-off payment, not a subscription. It includes:

- one annual blood test, with HIV, hepatitis B and hepatitis C screening included each year;
- point-of-care checks such as an ECG, a urine test, blood pressure and weight, at a listed testing day or at an on-site visit arranged by an employer;
- a follow-up with a doctor about once a month, by video, with audio and phone as a fallback if video does not work for you; and
- prescription renewals, which your doctor discusses with you at the monthly follow-up.

"About once a month" means the doctor offers you times each month and you choose one. It is the pace we plan for, not a promise that a call can never move by a few days. If we miss it for a reason on our side, the section "If we do not deliver" applies.

**Not included.**

- Medicines. A doctor may prescribe medicines, and you can fill the prescription at any pharmacy you choose. You pay the pharmacy.
- Tests, scans and hospital care beyond those listed above. If your doctor advises further tests or a referral, we will tell you what they cost before you decide.
- Emergency care. See Emergencies below.
- A second opinion, which is available to Members only, for an extra 5,000 naira each time. Nothing is charged until you ask for one and confirm the price.

## Price and payment
All prices are in Naira; the same price applies whichever way you pay, whether by a Nigerian payment method or an international card. We do not operate a separate foreign-currency price list. Payment is handled by Paystack. We do not see or store your full card details.

Your Membership starts when we receive confirmation of payment from Paystack, and runs for 12 months from that day. We show you the price, what is included and the refund rule on the screen before you pay.

## No automatic renewal
Membership does not renew automatically. Nothing is charged to your card again unless you choose to buy again. About 30 days before your year ends we will remind you in the app and by email, so you can buy another year if you wish. If you do nothing, your Membership ends on its end date.

## When your year ends
When your year ends naturally, you keep your Member access for a further 14 days (the grace period). During those 14 days you can still use your Member services and you can buy a new Membership without a gap. After the 14 days your account returns to the Free plan. Your health record is kept and stays yours: you can still read it, download it and use the Free plan. Buying a Membership again restores your Member access.

## Care Vouchers
When you pay for a health check or screening ahead of time, you receive a Care Voucher for that specific service. A voucher is an entitlement to the named service. It is not a store of money and not an account balance, and these terms apply to it.

**It is single-purpose.** A voucher can only be used for the service named on it. It cannot be applied to a different test, a different product, or a Membership.

**It is non-transferable.** A voucher belongs to the person it was issued to and cannot be sold, given away, or moved to another account. Neither you nor we can reassign it.

**It is never redeemable for cash.** There is no withdrawal, payout, or transfer route of any kind, and we will not create one. If a voucher is cancelled, any refund is made to the card or account that originally paid for it, never as cash and never as credit to somebody else.

**It is valid for 24 months** from the day it is fully paid for. We will tell you 30 days before it expires. If it does expire unused, contact us: we will normally extend it, and we would rather you got the care than lost the money.

**You can pay for it in instalments.** A voucher you are still paying for is reserved rather than active, and becomes usable once the full amount is paid. We do not expire a voucher you are still paying toward, and the 24 months only begins once it is fully paid.

**Someone else can buy one for you.** A family member or sponsor, including one living abroad, can buy a named service for you if you have linked them to your care. They will see that they bought it and later that it was used. They will not see your results or any other health information.

**Rewards are vouchers too.** Credit earned through referrals or prevention activities is issued as a discount voucher on these same terms. It has no cash value, was not bought with your money, and cannot be exchanged for money.

## Held payments for doctor video visits
A paid video visit with a doctor works differently from a Membership payment: your payment is held by us at the time you request the visit, and only goes through once a doctor accepts the request; a visit is never automatic, and depends on doctor availability. If no doctor accepts your request within a set window, or a doctor declines it, your payment is refunded.

## Refunds, cancelling, and if we do not deliver

**The 21-day refund.** You can ask for a refund of your Membership within 21 days of buying it. The 21 days start on the day we receive confirmation of your payment, and a request made on the 21st day is in time. If you ask in time, we refund the full price you paid. [Owner decision: whether the cost of a blood test or point-of-care check already carried out is deducted. The consumer-fair draft is no deduction.]

**After 21 days.** After 21 days, a Membership is not refundable, except as set out in "If we do not deliver" below and except where the law requires a refund.

**What happens to your access.** When we approve a refund, your Member access ends straight away. You move to the Free plan, with no 14-day grace period. Your health record is kept and stays yours.

**How to ask.** Use the "Request a refund" option on your Membership page in the app, or write to legal@tarragonhealth.ng [support address to be confirmed] from the email address on your account. Tell us your name and the date you bought. You do not need to give a reason. If an organisation paid for your Membership, only the organisation can ask, and we will not accept a refund request from the Member.

**How long it takes.** We reply within 5 working days [proposed]. If we approve, we send the money back, through Paystack, to the card or bank account that paid, within 5 working days [proposed]. Your bank then usually shows it within 3 to 10 working days after that. We do not charge you for a refund.

**If we do not deliver.** The 21-day limit does not take away any right you have if we fail to provide what you paid for. If, during your year, we cannot provide your annual blood test, or we repeatedly cannot provide your monthly follow-ups, for a reason on our side (for example no testing day or collection route is available to you, or no doctor can offer you times), we will tell you and offer you a choice:

1. a make-good, meaning we deliver the missing item by a new date we agree with you, and extend your Member access by the time it was missing if you ask; or
2. a refund of a fair share of the price for the part we did not deliver.

You choose. If an organisation paid for your Membership, you are entitled to the make-good in option 1 for the service itself; a refund under option 2 goes to the organisation that paid. A refund under option 2 is worked out by taking the value of the part not delivered as a share of the Membership price and refunding that share, even if more than 21 days have passed. [Owner to set and publish the value of each part (annual blood test and checks, monthly follow-ups) before publication; a PROPOSED split is in the sign-off sheet.] If a missed item is your doing, for example a testing day you booked and did not attend, it is not "on our side", but we will still offer to rebook you once.

**Cancelling early.** You can stop using your Membership at any time. After the first 21 days, we do not refund the unused part of a Membership you choose to give up, apart from the cases above. [Counsel item: whether a fixed window with no refund after it is compatible with section 120 (reasonable cancellation charge) and section 127 (unfair terms) of the Federal Competition and Consumer Protection Act 2018. See the review memo.]

**Other refunds.** A billing error, or a payment taken twice, is always refunded in full. A held video-visit payment that is never accepted is refunded as described above. A cancelled Care Voucher is refunded to the original payer as described under Care Vouchers.

**Your legal rights.** Nothing in this section removes any right you have under the law, including under the Federal Competition and Consumer Protection Act 2018.

## Your monitoring device
TarragonHealth does not sell, import, or supply blood-pressure cuffs, glucometers, or other monitoring devices. You buy your own device from any retailer of your choosing. Where your device uses a supported Bluetooth connection, our app can pair with it so a reading it takes can be logged to your record; support for a specific device model is not a guarantee that model will work with the app, and you should confirm compatibility before relying on it.

## Fees and price changes
We may change our prices. A price change never affects a purchase you have already made; it only applies to purchases made after the change takes effect, and we show you the price before you pay.

## Referral rewards
If you refer someone who joins TarragonHealth using your referral link or code, both of you may receive a reward voucher once they complete their first paid action on the platform. A reward voucher is a discount toward care on the terms set out under Care Vouchers above: it has no cash value and cannot be exchanged for money. Reward amounts and terms may change; we'll tell you the current amount before you share your link.

## Emergencies
TarragonHealth is not an emergency service. If you think you or someone with you is having an emergency, do not wait for the app, a message or a call from us. Call your local emergency number [owner to insert the verified number] or go to the nearest hospital. Ask someone to go with you if you can.

## If you are on the Free plan
The Free plan does not include time with a doctor. This is what that means in practice.

If you record a reading or a symptom that looks dangerous, the app shows you straight away what to do: seek emergency care or go to the nearest hospital. It tells you plainly that no doctor has been alerted, because you are on the Free plan. If you have named an emergency contact, we let them know. The app also asks you to check the reading again shortly afterwards, and checks in later to ask whether you were able to get care. Your answers stay in your own record and are not sent to a doctor.

On Membership, a dangerous reading is seen by our care team as part of your care. You can buy Membership at any time. Please do not rely on the Free plan, or on the app, to watch your readings for you. If you feel unwell, get care.

## Records
We keep your health record while you use TarragonHealth and afterwards, including after a Membership ends, after a refund and when you return to the Free plan, for the periods set out in our Data Processing Consent and as the law requires. You can read and download your record at any time. You can withdraw your consent to data processing at any time, as easily as you gave it, as set out in the Data Processing Consent. If you withdraw, some parts of the service that need your data may no longer be possible, and we will tell you which.

## Complaints
If something is wrong, write to legal@tarragonhealth.ng [complaints address to be confirmed]. We will acknowledge within 2 working days and give you an answer within 10 working days [proposed]. If you are not happy with our answer, you may complain to the Federal Competition and Consumer Protection Commission (FCCPC) about the service or charges, to the Nigeria Data Protection Commission (NDPC) about your data, and to the Medical and Dental Council of Nigeria (MDCN) about the conduct of a doctor. You may also go to court.

## Acceptable use
You agree to provide accurate information, not to impersonate another person or misrepresent your relationship to a dependant or adult you manage, not to misuse the platform to harass our staff or other users, and not to attempt to bypass the platform's security or access controls.

## Intellectual property
The TarragonHealth name, brand, and the software and content that make up the platform belong to us or our licensors. We grant you a personal, non-transferable licence to use the platform for your own care or the care of a dependant or adult you manage. You may not copy, resell, or build a competing service from our platform or content.

## Third-party services
The platform links to and integrates with services we do not control, including Paystack, our video-call provider, and our partner laboratories, pharmacies, and specialists. Your use of those services is subject to their own terms, and we are not responsible for their acts, omissions, or availability.

## Disclaimers and liability
The platform and the services are provided with reasonable care and skill. Remote care has limits, as explained in our Telehealth Consent: a doctor cannot examine you in person, and advice is based on what you tell us and what we can measure.

Nothing in these terms excludes or limits our liability for death or personal injury caused by our negligence, for fraud, or for anything else that the law does not allow us to exclude or limit. Any other limit on our liability applies only to the extent the law allows, and we will not rely on it where it would be unfair to you.

[Counsel to decide whether any financial cap on liability for other loss should be stated at all, and, if so, its structure; see the review memo. The consumer-fair draft states none.]

## Termination
We may suspend or terminate your account if you breach these terms, do not pay a fee that is due, or engage in conduct that puts our staff, other users, or the platform at risk. If we end your Membership because of your breach, we will tell you why. If we end it and you did nothing wrong, we refund the unused part of the price.

## Changes to these terms
We may update these terms as the platform changes. We will show you the current version and ask you to accept it again if a material change affects your rights or obligations. A change never reduces what you have already paid for.

## Governing law and disputes
These terms are governed by the laws of the Federal Republic of Nigeria. You may bring a dispute in the courts of Nigeria.

[The specific dispute-resolution venue and any mediation step is being finalised with counsel. Any such step must not stop you from complaining to a regulator or going to court.]

Nothing in this clause limits any right you have under the Federal Competition and Consumer Protection Act 2018 to complain to the FCCPC, or your right to complain to the Nigeria Data Protection Commission under our Data Processing Consent.

## Contact
Questions about these terms: legal@tarragonhealth.ng.
$tos_body$;
begin
  select title into v_title
    from public.consent_versions
   where consent_type = 'terms_of_service' and is_current;
  if v_title is null then
    raise exception 'no current terms_of_service row to supersede';
  end if;

  -- Guards: refuse to publish a draft.
  if position('[' in v_body) > 0 then
    raise exception 'unresolved square-bracket placeholder in the terms body; resolve all owner and counsel items first';
  end if;
  if v_body like '%' || chr(8212) || '%' then
    raise exception 'em dash in terms body';
  end if;
  if v_body ilike '%whatsapp%' or v_body ilike '%stripe%' then
    raise exception 'retired provider mentioned in terms body';
  end if;

  update public.consent_versions
     set is_current = false
   where consent_type = 'terms_of_service' and is_current;

  insert into public.consent_versions (consent_type, version, title, body, is_current)
  values ('terms_of_service', '2026-10-13-v1', v_title, v_body, true);
end $$;

do $$
begin
  if (select count(*) from public.consent_versions
       where consent_type = 'terms_of_service' and is_current) <> 1 then
    raise exception 'exactly one terms_of_service version must be current';
  end if;
  if (select count(*) from public.consent_versions
       where consent_type in ('data_processing', 'telehealth') and is_current) <> 2 then
    raise exception 'the other consent types were disturbed';
  end if;
  if not exists (select 1 from public.consent_versions
                  where consent_type = 'terms_of_service' and is_current
                    and body ilike '%21 days%' and body ilike '%No automatic renewal%'
                    and body ilike '%no doctor has been alerted%') then
    raise exception 'new terms body is missing expected content';
  end if;
end $$;
