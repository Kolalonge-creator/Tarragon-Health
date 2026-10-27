# Memo to Counsel

**To:** [Outside Counsel — Data Protection & Health Regulatory, to be confirmed]
**From:** Dr Kola Longe, Founder, TarragonHealth
**Date:** 27 October 2026 (v4, a refresh of the 31 July 2026 v3 memo. The sections on staffing, channels, money and the open-items list are rewritten to match the live platform. DRAFT for counsel: anything in square brackets is an open item and no legal fact below has been confirmed by counsel)
**Re:** Review requested — data protection, telehealth, consumer terms, and fintech/CBN posture ahead of public launch

## What changed since v3 (31 July 2026)

- **WhatsApp has been removed entirely** (founder decision, 30 September 2026). No WhatsApp channel, webhook, template or inbox exists. The channels are the app (in-app inbox), push, email and voice; SMS is used only for phone verification codes.
- **There is no wallet and no stored balance.** The Health Wallet and the later Platform Credit were removed. Patients pay per item at checkout through Paystack, or use a Care Voucher a sponsor has bought for them. Question 1 of v3 (CBN licence for the wallet) is withdrawn and replaced by a narrower question about Care Vouchers.
- **There is no subscription.** The app is free. A Member pays once for a year of Membership or Membership Plus. Membership does not renew by itself. [Auto-renewal code exists but is switched off and cannot apply to gifts or sponsored years; the public wording says there is no subscription.]
- **Naira only.** Paystack in naira is the only live payment provider. Stripe and the foreign-currency price book are removed.
- **Refund:** 21 days from purchase, full price, then no refund except where we fail to deliver or the law requires it [counsel to confirm against the FCCPC; see Question 7].
- **Doctor ladder:** one doctor tier plus a Chief Medical Officer, replacing the five-tier ladder described in v3. There is no independent Chief Medical Officer; the founder holds that role [verify with counsel whether this is acceptable for governance sign-off and indemnity].
- **NDPC registration is approved and the founder's Data Protection Officer appointment has been accepted by the NDPC (15 September 2026).** DPO name and contact: [founder to supply]. NDPC registration reference: [founder to supply].

## What changed since v2 of this memo, and why it matters

Version 2 of this memo (29 July 2026) was written against `docs/tarragon-build-spec-v3.md` — a founder-authored specification for a narrower, cardiometabolic-only product ("Control"/"Concierge" service tiers, a "tech_layer"/"provider" accountability model, WHO HEARTS as the sole clinical protocol, field-screening-day consent capture). **That specification was superseded within a day of being written.** The actual platform we operate and are asking you to review — `apps/web`, live in production at `app.tarragonhealth.ng` — is a materially different and considerably broader product. If Schedules A, B, or C were sent to you in their prior form, please disregard that version: it describes a product we do not build. This memo and the attached schedules now describe what is actually live.

**Four things from the narrower spec did survive**, because the founder separately confirmed them as real product decisions on their own merits, not because the narrower spec was adopted wholesale:
1. **No capitation, ever.** We take no per-member premium and bear no insurance risk on any organisational contract.
2. **Institutions get aggregate data only.** An employer or HMO that pays for its members' access sees only de-identified, small-cell-suppressed statistics about the group — never an individual member's record.
3. **One price list, in naira.** We do not maintain a separate foreign-currency price book, and no dollar or pound price is shown or charged. [The v3 text said a dollar price was derived at a reference rate; that was removed with Stripe. A reference-rate display for people abroad is an open founder item, not a live feature.]
4. **Individual enrolment.** There is no household or family plan. Each person — including a minor, enrolled by their guardian — has their own account. A person may separately name a next of kin, who can be contacted in an emergency and can view (not edit) that person's record with consent.

Everything else about the platform's actual scope, clinical model, and communication design is different from what v2 described, as set out below.

## What TarragonHealth actually is

TarragonHealth (Tarragon Health Ltd, RC 9702108) is Nigeria's digital-first chronic disease, preventive health, and care-coordination platform — the coordination layer between patients, families, doctors, labs, pharmacies, HMOs, and employers. Five categories, commercially linked and sharing one patient record:

1. **Chronic disease management** — hypertension and type 2 diabetes as the core wedge; expanding to asthma, chronic kidney disease, heart failure.
2. **Preventive medicine** — cancer, metabolic, infectious, and reproductive-health screening; vaccination tracking with doctor-verified certificates; an annual whole-body health check.
3. **Care coordination** — a lab network, a pharmacy network, specialist referrals, and hospital-admission tracking.
4. **B2B and institutional** — corporate wellness and HMO-funded access (aggregate-only, per Item 2 above; no capitation, per Item 1).
5. **Platform infrastructure** — notification engine, clinical decision support, a longitudinal patient record, partner integrations, and analytics.

We do not own or operate any hospital, clinic, or laboratory — every lab, pharmacy, and specialist a patient interacts with is an independent partner organisation.

## Clinical staffing: one doctor tier plus a Chief Medical Officer

Every clinical judgement is made by an employed or contracted doctor; no case is ever closed by non-clinical staff. The five-tier ladder in v3 of this memo has been collapsed:

- **Care Coordinator** (employed, non-clinical): logistics only: check-ins, adherence tracking, booking. Cannot interpret a result, adjust medication, or close an escalation.
- **Doctor (Senior Medical Officer level):** the one doctor tier: standard, complex and specialist cases, initiating medicines, and referrals. Whether a doctor is employed or contracted is a separate attribute; a contracted doctor must hold indemnity cover recorded in the system before activation.
- **Chief Medical Officer:** everything a doctor does, plus oversight of the caseload, reassigning cases, and signing clinical protocols. The founder currently holds this role; there is no independent Chief Medical Officer.

Every doctor's MDCN registration is verified before they may see patients and checked continuously afterwards; a doctor whose registration or indemnity cover lapses is automatically suspended overnight. **MDCN's own confirmation that this authority split complies with Nigerian medical-practice regulation has not been obtained**, and we do not represent it as regulator-approved anywhere. We would value your view on whether MDCN engagement is a prerequisite for public launch, and whether a founder-held Chief Medical Officer role is acceptable.

## How results are classified and escalated

Every reading is classified automatically against a clinical protocol appropriate to its type (not solely WHO HEARTS — we run separate, clinically-reviewed protocols for hypertension, diabetes, obesity, and several preventive-screening pathways). An AI model may assist triage, but structurally can only draft a summary for a doctor's own review — it never diagnoses, never closes a case, and never substitutes for the doctor's own signed attribution on the record. **This AI assistance is new since v2 and needs your attention** — see "A new disclosure item" below.

Response-time commitments are pathway-specific rather than one flat table, reflecting genuinely different clinical urgency across contexts (a routine screening abnormality is not the same urgency as a red-flagged home blood-pressure reading). The founder has confirmed this differentiation is deliberate, not an inconsistency to reconcile to one number. A case classified as an emergency cannot be closed on a written note alone — the system enforces, at the database level, that a closing doctor must have completed a real synchronous voice or video contact with the patient first.

## Communications: the app first, no WhatsApp

- **The app** carries the clinical record and every clinical conversation, including the two-way thread between a patient and their care team.
- **Push and email** carry reminders, alerts, confirmations, documents, receipts and reports. A notification never carries a diagnosis, a specific result, or a medication name; this is enforced by a database constraint on notification content class, not only by policy.
- **A phone or video call** is how clinical judgement is delivered. The final fallback for an unanswered urgent page to a clinician is an in-console alarm and a phone call by a named person.
- **SMS** is used only for phone verification codes.
- **WhatsApp does not exist on the platform.** It was removed on 30 September 2026. No feature requires any notification to succeed: signup and every core action happen in the app or on the web.

## Money: pay per item, a one-off yearly Membership, no stored balance

The app is free. People pay for a doctor's time and for the yearly Membership, in naira, through Paystack; we do not see or store card details. A Member buys **Membership** or **Membership Plus** (the difference is whether the yearly blood panel is included and collected for them). It is a one-off payment for a year; it does not renew automatically and is not a subscription. Someone else (a family member, a sponsor abroad, an employer) may pay for a person's access by buying a **Care Voucher** or a Membership year for them. A voucher is for that person's account alone, is never redeemable for cash, and is not a stored balance we hold for anyone. We hold no wallet, no balance and no float, and we have not sought a Central Bank of Nigeria licence because we no longer hold customer funds [counsel to confirm that a Care Voucher, which is prepaid for a named service, does not itself need one; see Question 1].

## Where your data is stored, and international transfer

Unchanged from v2: our database runs on Supabase Postgres in AWS's eu-west-1 region (Dublin), because our provider has no data centre in Nigeria or elsewhere in Africa. This remains the single highest-priority open item in our legal position — Nigerian law requires a specific lawful mechanism before personal data, including sensitive health data, is transferred outside Nigeria, and none has yet been confirmed.

## A new disclosure item: AI processing of real patient data by a third party

Since v2, we have begun using a third-party large-language-model API (Anthropic's Claude) to draft summaries of a patient's record for a doctor's own review before they act — never to diagnose, never to close a case, never to prescribe. As of a founder decision on 30 July 2026, this now runs against real patient data, not only test fixtures. This is a second international data transfer this memo did not previously disclose, to a different processor than Supabase, and needs its own assessment: a data-processing agreement with Anthropic, and a view on whether it needs separate patient disclosure beyond the general "automated processing" language already in Schedule A.

## Nine questions for your review

**1. Care Vouchers and CBN.** The Health Wallet from v3 no longer exists. Does a Care Voucher (prepaid by one person for another person's named health service, never redeemable for cash, refunded only to the original payer) fall outside CBN payment-service licensing, and are there AML/CFT or consumer-prepayment obligations we have not met?

**2. Cross-border data transfer (Supabase).** Which lawful mechanism should we rely on for the eu-west-1 transfer — an adequacy finding, contractual safeguards, or patient consent to that specific transfer — and is this a hard blocker for public launch?

**3. The new AI processor (Anthropic).** Do we need a formal DPA with Anthropic, a supplementary DPIA, and/or new patient-facing disclosure specific to this processing, distinct from the general automated-processing language already in Schedule A?

**4. Sensitive personal data and lawful basis.** Is the consent-scope structure in Schedule A (general care necessity, plus named specific consents individually revocable) the right architecture under the Nigeria Data Protection Act 2023? May account activation be conditioned on the "escalation contact" consent, as our platform currently requires?

**5. Controller/processor status and NDPC registration.** Are we controller, processor, or both, depending on whether a patient is self-enrolled or organisation-enrolled? NDPC registration is approved and the DPO appointment has been accepted (15 September 2026); please confirm that nothing further is owed to the NDPC, and confirm the DPO's published contact requirements. [DPO name and contact: founder to supply.]

**6. MDCN and the tier ladder.** Does the clinical-authority model described above (one doctor tier, a Chief Medical Officer who signs protocols, no independent Chief Medical Officer) need MDCN's affirmative confirmation before we can rely on it, and if so, is that a launch blocker?

**7. Consumer protection (FCCPC).** Our position is: a Membership is a one-off yearly purchase, refundable in full within 21 days of buying it, and not refundable after that except where we fail to deliver or the law requires it. Does that meet the Federal Competition and Consumer Protection Act's requirements (sections 120 and 127 in particular)? Is the position sound once the yearly blood panel has already been delivered inside the 21 days? [Founder decision on any deduction is open.]

**8. Minors and dependants.** Does our guardian-enrols-a-child-under-18 mechanism (enforced as a database-level age constraint, one account per person, no shared family account) meet the Act's threshold for guardian consent to a minor's data?

**9. Institutional commercial agreements.** Where we sell organisational access to an employer or HMO directly, does that relationship need a separate commercial services agreement distinct from the individual-facing terms of service, and can you help us produce one?

## Attached
- Schedule A — Data Processing Consent
- Schedule B — Telehealth Consent
- Schedule C — Terms of Service

Each schedule has been rewritten to match the platform actually described above. Sections still requiring your input are marked in brackets, and repeated in the checklist below.

## Open items checklist
1. **CBN posture for Care Vouchers**: see Question 1 (the wallet itself is gone).
2. **Data Protection Officer**: appointment accepted by the NDPC on 15 September 2026; name and contact details [founder to supply].
3. **NDPC registration**: approved; registration reference [founder to supply]; confirm nothing further is owed.
4. **Lawful mechanism for the Supabase eu-west-1 cross-border transfer** — see Question 2.
5. **Anthropic DPA and disclosure adequacy** — see Question 3, a new item since v2.
6. **MDCN confirmation of the tier-authority model** — see Question 6.
7. **NDPC contact details**, for the complaints clause in Schedule A.
8. **Refund/cooling-off policy** under FCCPC — see Question 7.
9. **Limitation-of-liability cap and structure**, for Schedule C.
10. **Dispute-resolution venue and mechanism**, for Schedule C's governing-law clause.
11. **Data retention schedule** — exact periods by data category.
12. **Guardian/dependant consent mechanism sufficiency** — see Question 8.
13. **Whether a separate institutional commercial agreement is needed** — see Question 9.
