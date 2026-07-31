-- Tarragon Health — Terms of Service v2026-07-30-v1: discloses the
-- commission relationship with partner labs/pharmacies/specialists.
--
-- Gap found during a review of financial conflict-of-interest exposure
-- (Tarragon earns a commission on lab/pharmacy/referral orders booked
-- through the platform — see the commissions table + record_lab_commission/
-- record_pharmacy_commission/record_referral_commission triggers). Nothing
-- in the current terms_of_service text (2026-07-29-v1, "Booking labs,
-- pharmacy, and specialist services" section) told a patient that
-- relationship exists. consent_versions is append-only (2026-07-16's own
-- design) and 2026-07-29-v1 is itself already marked "in draft, pending
-- final review by our legal counsel" for several other clauses, so adding
-- this disclosure the same way (a plain, bracket-free sentence, since this
-- one isn't a placeholder pending a legal decision — it's a fact) is
-- consistent with how that document has been amended so far.
--
-- Same retire-then-insert pattern as 20260729025118_legal_consent_v2.sql:
-- only terms_of_service is retired/replaced here — data_processing and
-- telehealth are untouched, so patient_consents rows for those two consent
-- types still point at their real, unchanged, already-accepted version.

update public.consent_versions
set is_current = false
where consent_type = 'terms_of_service'
  and is_current = true;

insert into public.consent_versions (consent_type, version, title, body, is_current)
values
(
  'terms_of_service',
  '2026-07-30-v1',
  'Terms of service',
  $sched_c$## About this document
This is TarragonHealth's Terms of Service — Schedule C of our legal documentation. Version 2026-07-30-v1, published 30 July 2026. This document is currently in draft and pending final review by our legal counsel.

## Acceptance of these terms
By creating a TarragonHealth account, you agree to these terms, our Data Processing Consent, and our Telehealth Consent. If you do not agree, do not use the platform.

## Eligibility and accounts
You must be at least 18 years old to open a primary account. Once you have an account, you may add family members or dependants you are legally responsible for, including children, under our family and ParentCare plans, and manage their care through your account. You are responsible for the accuracy of the information you provide, including information you enter on a dependant's behalf, and for keeping your login secure.

## What TarragonHealth is, and isn't
TarragonHealth is a coordination platform. We employ and contract the doctors and clinical staff who monitor and review your care, and we connect you to a network of independent partner laboratories, pharmacies, and specialists for tests, medication, and referrals. We do not own or operate any hospital, clinic, laboratory, or pharmacy. We are not an emergency service. Where we work with an employer or HMO, our role is care coordination and reporting; we are not an insurer, and nothing on the platform should be read as insurance underwriting or a guarantee of coverage.

## Your subscription
Plans are billed in Naira through Paystack, or in GBP/USD through Stripe if you are billed as a diaspora subscriber. The price and billing interval shown to you at checkout apply to your subscription. Your subscription automatically renews at the end of each billing period unless you cancel before the renewal date.

## Cancelling and refunds
You can cancel at any time from your account settings. Cancelling stops your subscription from renewing; you keep full access through the end of the period you have already paid for. We do not provide a partial or pro-rata refund for the unused portion of a period you cancel mid-cycle, except where required by applicable law or where we decide, at our discretion, that a billing error or a service failure attributable to us warrants one.

[Our position on refunds and cooling-off periods is being reviewed with counsel, including whether a different rule should apply to diaspora subscribers billed in GBP/USD.]

## Fees, price changes, and currency
We may change our prices. If a change affects your existing subscription, we will give you at least 30 days' notice before it takes effect, and you may cancel before the new price applies.

## Booking labs, pharmacy, and specialist services
Lab tests, pharmacy orders, home visits, and specialist referrals booked through the platform are separate, one-off charges from your subscription. Booking and paying through the platform reserves or confirms your order with the relevant partner; the partner then fulfils it according to their own availability and processes. We are not responsible for a partner's acts or omissions in fulfilling an order, though we will help you resolve a problem where we reasonably can.

TarragonHealth receives a commission from the partner laboratory, pharmacy, or specialist on orders booked through the platform. This does not change the price you pay, and clinical decisions about what to order, prescribe, or refer are made independently of it. Which partner fulfils your order is decided by availability, location, and your own choice where the platform offers one — never by which partner pays the largest commission.

## Acceptable use
You agree to provide accurate information, not to impersonate another person or misrepresent your relationship to a dependant you manage, not to misuse the platform to harass our staff or other users, and not to attempt to bypass the platform's security or access controls.

## Intellectual property
The TarragonHealth name, brand, and the software and content that make up the platform belong to us or our licensors. We grant you a personal, non-transferable licence to use the platform for your own care or the care of dependants you manage. You may not copy, resell, or build a competing service from our platform or content.

## Third-party services
The platform links to and integrates with services we do not control, including Paystack, Stripe, WhatsApp, and our partner laboratories, pharmacies, and specialists. Your use of those services is subject to their own terms, and we are not responsible for their acts, omissions, or availability.

## Disclaimers and limitation of liability
The platform is provided on an "as available" basis. To the maximum extent permitted by law, our liability to you is limited.

[The specific limitation-of-liability cap and structure is being finalised with counsel.]

## Termination
We may suspend or terminate your account if you breach these terms, do not pay a fee that is due, or engage in conduct that puts our staff, other users, or the platform at risk.

## Changes to these terms
We may update these terms as the platform changes. We will show you the current version and ask you to accept it again if a material change affects your rights or obligations.

## Governing law and disputes
These terms are governed by the laws of the Federal Republic of Nigeria.

[The specific dispute-resolution venue and mechanism is being finalised with counsel.]

Nothing in this clause limits any right you have under the Federal Competition and Consumer Protection Act 2018 to complain to the FCCPC, or your right to complain to the Nigeria Data Protection Commission under our Data Processing Consent.

## Contact
Questions about these terms: legal@tarragonhealth.ng.$sched_c$,
  true
)
on conflict (consent_type, version) do nothing;

-- Assertion: exactly one current terms_of_service version, and it's the new one.
do $$
declare
  v_count int;
  v_version text;
begin
  select count(*) into v_count from public.consent_versions
    where consent_type = 'terms_of_service' and is_current = true;
  if v_count <> 1 then
    raise exception 'expected exactly 1 current terms_of_service version, found %', v_count;
  end if;

  select version into v_version from public.consent_versions
    where consent_type = 'terms_of_service' and is_current = true;
  if v_version <> '2026-07-30-v1' then
    raise exception 'unexpected current terms_of_service version: %', v_version;
  end if;
end;
$$;
