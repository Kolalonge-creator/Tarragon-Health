# Memo to Counsel

**To:** [Outside Counsel — Data Protection & Health Regulatory, to be confirmed]
**From:** Dr Kola Longe, Founder, TarragonHealth
**Date:** 31 July 2026 (v3 — full rewrite; the previous version described a product we no longer build, see below)
**Re:** Review requested — data protection, telehealth, consumer terms, and fintech/CBN posture ahead of public launch

## What changed since v2 of this memo, and why it matters

Version 2 of this memo (29 July 2026) was written against `docs/tarragon-build-spec-v3.md` — a founder-authored specification for a narrower, cardiometabolic-only product ("Control"/"Concierge" service tiers, a "tech_layer"/"provider" accountability model, WHO HEARTS as the sole clinical protocol, field-screening-day consent capture). **That specification was superseded within a day of being written.** The actual platform we operate and are asking you to review — `apps/web`, live in production at `app.tarragonhealth.ng` — is a materially different and considerably broader product. If Schedules A, B, or C were sent to you in their prior form, please disregard that version: it describes a product we do not build. This memo and the attached schedules now describe what is actually live.

**Four things from the narrower spec did survive**, because the founder separately confirmed them as real product decisions on their own merits, not because the narrower spec was adopted wholesale:
1. **No capitation, ever.** We take no per-member premium and bear no insurance risk on any organisational contract.
2. **Institutions get aggregate data only.** An employer or HMO that pays for its members' access sees only de-identified, small-cell-suppressed statistics about the group — never an individual member's record.
3. **One price list.** We do not maintain a separate, higher foreign-currency price book. The Naira price is the only stored price; a dollar price is derived from it at an admin-set reference rate.
4. **Individual enrolment.** There is no household or family subscription. Each person — including a minor, enrolled by their guardian — has their own account. A person may separately name a next of kin, who can be contacted in an emergency and can view (not edit) that person's record with consent.

Everything else about the platform's actual scope, clinical model, and communication design is different from what v2 described, as set out below.

## What TarragonHealth actually is

TarragonHealth (Tarragon Health Ltd, RC 9702108) is Nigeria's digital-first chronic disease, preventive health, and care-coordination platform — the coordination layer between patients, families, doctors, labs, pharmacies, HMOs, and employers. Five categories, commercially linked and sharing one patient record:

1. **Chronic disease management** — hypertension and type 2 diabetes as the core wedge; expanding to asthma, chronic kidney disease, heart failure.
2. **Preventive medicine** — cancer, metabolic, infectious, and reproductive-health screening; vaccination tracking with doctor-verified certificates; an annual whole-body health check.
3. **Care coordination** — a lab network, a pharmacy network, specialist referrals, and hospital-admission tracking.
4. **B2B and institutional** — corporate wellness and HMO-funded access (aggregate-only, per Item 2 above; no capitation, per Item 1).
5. **Platform infrastructure** — notification engine, clinical decision support, a longitudinal patient record, partner integrations, and analytics.

We do not own or operate any hospital, clinic, or laboratory — every lab, pharmacy, and specialist a patient interacts with is an independent partner organisation.

## Clinical staffing: a five-tier ladder, not the two accountability models v2 described

Every clinical judgement is made by an employed or contracted doctor; no case is ever closed by non-clinical staff. We do **not** operate the "tech_layer" vs. "provider" accountability-model switch v2 described — that mechanism does not exist in the live platform. Instead, clinical authority is layered by seniority:

- **Care Coordinator** (employed, non-clinical) — logistics only: check-ins, adherence tracking, booking. Cannot interpret a result, adjust medication, or close an escalation.
- **Tier 1** — Medical Officer, under 3 years' experience. First-line review of routine/stable readings under protocol; may confirm an existing stable prescription's refill, never initiate a new one.
- **Tier 2** — Medical Officer, 3+ years. Initiates new medications, adjusts doses, handles Tier 1 escalations.
- **Tier 3** — Senior Medical Officer. Complex/multi-drug case management; audits Tiers 1–2.
- **Tier 4** — Senior Registrar (part-time contract). Pre-referral consult, sets referral urgency, owns clinical protocols, supervises Tiers 1–3.
- **Tier 5** — Partner Specialist (referral-only, per-consult contract). Complex or procedural input; hands routine follow-up back to Tier 3/4.

Every doctor's MDCN registration is verified before they may see patients and checked continuously afterwards — a doctor whose registration or indemnity cover lapses is automatically suspended from the system overnight, no manual step required. **MDCN's own confirmation that this tier-authority split is compliant with Nigerian medical-practice regulation is an open item on our side, not yet obtained** — we do not represent the tier ladder as regulator-approved anywhere, and we would value your view on whether MDCN engagement is a prerequisite for public launch or can follow it.

## How results are classified and escalated

Every reading is classified automatically against a clinical protocol appropriate to its type (not solely WHO HEARTS — we run separate, clinically-reviewed protocols for hypertension, diabetes, obesity, and several preventive-screening pathways). An AI model may assist triage, but structurally can only draft a summary for a doctor's own review — it never diagnoses, never closes a case, and never substitutes for the doctor's own signed attribution on the record. **This AI assistance is new since v2 and needs your attention** — see "A new disclosure item" below.

Response-time commitments are pathway-specific rather than one flat table, reflecting genuinely different clinical urgency across contexts (a routine screening abnormality is not the same urgency as a red-flagged home blood-pressure reading). The founder has confirmed this differentiation is deliberate, not an inconsistency to reconcile to one number. A case classified as an emergency cannot be closed on a written note alone — the system enforces, at the database level, that a closing doctor must have completed a real synchronous voice or video contact with the patient first.

## Communications: five channels, WhatsApp is notification-only

- **The app** carries the clinical record and every clinical conversation.
- **A phone or video call** — increasingly via a masked-number system so neither party's real number is exposed to the other — is how clinical judgement is delivered.
- **SMS** is urgent backup and the primary channel for patients without a smartphone.
- **WhatsApp is notification-only.** It carries reminders, alerts, and confirmations — never a diagnosis, a specific result, or a medication name. This is enforced by a database constraint, not merely a policy: a notification row cannot be flagged as carrying clinical content and also be queued on WhatsApp, SMS, or email simultaneously. Patients may also message their doctor on WhatsApp for support, with the doctor replying there too — but that is a human-routed inbox, never an automated system parsing an inbound message into a platform action. **No feature on the platform requires a WhatsApp send to succeed** — signup and every core patient action happen via the app.
- **Email** carries documents, receipts, and reports.

## Money: subscriptions, a wallet, and a real fintech question for you

Patients pay by subscription (Naira, one price list, derived-rate diaspora payment) or per booking. We also operate a **Health Wallet** — a real stored-value balance a patient (or a consented family member/sponsor, local or abroad) tops up via card, which can then be spent on bookings within the platform. **This is the item we most need your read on.** We have built CBN-tiered-KYC-shaped balance ceilings (a lower cap for an unverified wallet, a higher cap once a real identity check is on file) and non-blocking compliance flagging for unusual funding patterns, as risk controls — but we have not sought, and do not hold, any Central Bank of Nigeria payment-service-provider licence or equivalent authorisation, and we need your view on whether the wallet as designed requires one, or whether it can properly operate under Paystack's/Stripe's own licensed rails as a pass-through. See "Questions for your review," Question 1.

## Where your data is stored, and international transfer

Unchanged from v2: our database runs on Supabase Postgres in AWS's eu-west-1 region (Dublin), because our provider has no data centre in Nigeria or elsewhere in Africa. This remains the single highest-priority open item in our legal position — Nigerian law requires a specific lawful mechanism before personal data, including sensitive health data, is transferred outside Nigeria, and none has yet been confirmed.

## A new disclosure item: AI processing of real patient data by a third party

Since v2, we have begun using a third-party large-language-model API (Anthropic's Claude) to draft summaries of a patient's record for a doctor's own review before they act — never to diagnose, never to close a case, never to prescribe. As of a founder decision on 30 July 2026, this now runs against real patient data, not only test fixtures. This is a second international data transfer this memo did not previously disclose, to a different processor than Supabase, and needs its own assessment: a data-processing agreement with Anthropic, and a view on whether it needs separate patient disclosure beyond the general "automated processing" language already in Schedule A.

## Nine questions for your review

**1. The Health Wallet and CBN.** Does the wallet, as described above, require a CBN payment-service-provider licence, tiered-KYC compliance beyond what we've built as a precaution, or AML/CFT transaction-monitoring obligations we haven't yet met? This is now our highest-priority open question, alongside cross-border transfer.

**2. Cross-border data transfer (Supabase).** Which lawful mechanism should we rely on for the eu-west-1 transfer — an adequacy finding, contractual safeguards, or patient consent to that specific transfer — and is this a hard blocker for public launch?

**3. The new AI processor (Anthropic).** Do we need a formal DPA with Anthropic, a supplementary DPIA, and/or new patient-facing disclosure specific to this processing, distinct from the general automated-processing language already in Schedule A?

**4. Sensitive personal data and lawful basis.** Is the consent-scope structure in Schedule A (general care necessity, plus named specific consents individually revocable) the right architecture under the Nigeria Data Protection Act 2023? May account activation be conditioned on the "escalation contact" consent, as our platform currently requires?

**5. Controller/processor status and NDPC registration.** Are we controller, processor, or both, depending on whether a patient is self-enrolled or organisation-enrolled? What is our current NDPC registration status, and is DPO appointment a prerequisite for the live patients we already have, or can it follow?

**6. MDCN and the tier ladder.** Does the five-tier clinical-authority model described above (a Tier 1 doctor confirming an existing refill but never initiating a new prescription, for example) need MDCN's affirmative confirmation before we can rely on it, and if so, is that a launch blocker?

**7. Consumer protection (FCCPC).** Does our "cancel any time, access runs to the end of the paid period, no pro-rata refund" position meet the Federal Competition and Consumer Protection Act's requirements for a subscription service?

**8. Minors and dependants.** Does our guardian-enrols-a-child-under-18 mechanism (enforced as a database-level age constraint, one account per person, no shared family account) meet the Act's threshold for guardian consent to a minor's data?

**9. Institutional commercial agreements.** Where we sell organisational access to an employer or HMO directly, does that relationship need a separate commercial services agreement distinct from the individual-facing terms of service, and can you help us produce one?

## Attached
- Schedule A — Data Processing Consent
- Schedule B — Telehealth Consent
- Schedule C — Terms of Service

Each schedule has been rewritten to match the platform actually described above. Sections still requiring your input are marked in brackets, and repeated in the checklist below.

## Open items checklist
1. **CBN posture for the Health Wallet** — see Question 1. New since v2, now the top priority alongside cross-border transfer.
2. **Data Protection Officer** — appointment, name, and contact details.
3. **NDPC registration status** — confirm current status and whether it gates the live patients already on the platform.
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
