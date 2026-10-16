# Questions for Nigerian counsel (S83)

Prepared 2026-10-07 by the S83 audit. This is a list of questions, not legal conclusions. Nothing here should be repeated to a regulator, patient or investor as "compliant". Statements about the law below are the engineering team's understanding and may be wrong or out of date; counsel is asked to correct them. Where we name a law or guidance, we are naming what the question turns on, not asserting what it requires.

Companion documents: `docs/audit-D3-D6.md` (the gap list), `docs/legal/cover-memo-to-counsel.md` (v3, 31 July 2026), `docs/legal/nigeria-regulatory-compliance-status.md`, `docs/legal/breach-notification-runbook.md`, DPIAs and DPA drafts in `docs/legal/`. Live facts are as of 2026-10-07 and are small (five patients with consent rows, one active laboratory, no active pharmacy partner).

Decisions the founder has already taken that counsel should treat as fixed inputs unless advised otherwise: no capitation (I8), institutions see aggregate figures only (I9), individual enrolment only, no stored patient balance (INV-09), SMS only for verification codes (INV-08, with D-12 on clinician paging), English only, the app is free and Tarragon charges for doctor time and a membership.

## A. Data protection (NDPA 2023, NDPC GAID 2025)

### 1. Registration tier and annual filings
Facts: CLAUDE.md records NDPC registration approved and a DPO appointment accepted (2026-09-15). We do not hold the registration certificate or tier in the repository. We process health data (a sensitive category) for individual patients, plus aggregated data for sponsors.
Decision needed: which registration tier or category applies (data controller of major importance or other), what annual compliance audit return or filing follows from it, and whether any filing is overdue.
Turns on: NDPA 2023 registration provisions; NDPC General Application and Implementation Directive (GAID) 2025. Counsel to confirm the current text and thresholds.

### 2. Data protection officer
Facts: a DPO has been appointed (founder). Unknown whether the DPO is internal or external, whether independence or conflict rules matter when the DPO is also the founder, and whether the appointment must be published or notified.
Decision needed: whether the current appointment meets the requirement, and what the DPO must sign (DPIAs, retention schedule, processor assessments) before launch.
Turns on: NDPA 2023 DPO provisions and GAID 2025.

### 3. DPIA
Facts: two drafts exist, general health-data processing and AI case briefs, both unsigned. No DPIA exists yet for: staff audited access to any patient record (S39c), the AI scribe (S23), wearable data (S09 and device governance), the Care Circle (S29), reproductive health data, or sponsor and employer reporting (S38).
Decision needed: which processing requires a DPIA before launch, who must sign, whether any must be submitted to the NDPC, and whether prior consultation is needed for high-risk processing.
Turns on: NDPA 2023 impact assessment provisions; GAID 2025.

### 4. Breach notification, 72 hours
Facts: runbook and an incident tracker with a 72-hour alert exist. The clock in the runbook starts when we become aware. No rehearsal has been recorded. Processors include Supabase, Vercel, Resend, Termii, Paystack, Anthropic, Sentry.
Decision needed: when the 72 hours starts in a case where a processor tells us late; what content the notice to the NDPC and to affected patients must carry; whether a breach of de-identified or sponsor-aggregate data is notifiable; whether a MDCN or health ministry notice is also needed for a clinical record breach.
Turns on: NDPA 2023 breach notification provisions; GAID 2025.

### 5. Cross-border transfer basis, per processor
Facts (each is outside Nigeria or may be): Supabase database in eu-west-1 (no Africa region exists); Anthropic (AI case briefs, scribe drafts, coach, with a draft DPA at `docs/legal/dpa-anthropic-ai-processing.md`); Resend (email); Termii (SMS, Nigerian aggregator, but may route abroad); Paystack (payments, Nigerian entity); Vercel (hosting and edge, with logs); Sentry (error events, scrubbed of email and phone but not of other free text); Zoom (consultation video, S21); Expo push and Apple and Google push gateways (notification content is discreet by INV-07).
Decision needed: for each processor, the lawful transfer basis (adequacy, contractual safeguards, binding corporate rules, consent, other derogations), what written DPA must exist, and whether patient consent alone is acceptable for health data. Also whether any processor must be dropped or replaced by a Nigeria-hosted option before launch.
Turns on: NDPA 2023 cross-border transfer provisions; GAID 2025; any NDPC adequacy list. Unconfirmed in our records for every processor above.

### 6. Consent design for sensitive data
Facts: consent purposes in the enum are data_processing, telehealth, terms_of_service, device_data, wearable_device_data, marketing, research, care, care_circle_sharing, sponsor_reporting, scribe_default. Only four have a current version row live. Withdrawal is a new append-only row; the history is kept. Optional purposes can be withdrawn in two taps on the web (not yet on the phone).
Decision needed: which processing is on consent and which on another lawful basis (contract, legal obligation, vital interests, legitimate interest) so that withdrawal means what the patient expects; whether explicit consent is needed separately for each sensitive category (HIV, reproductive, mental health); whether bundling data_processing and telehealth as required purposes is acceptable.
Turns on: NDPA 2023 lawful basis and sensitive personal data provisions.

### 7. Minors and dependants
Facts: guardians can hold access to a child's record (Care Circle, parent and dependent access); reproductive health is category-protected; a guardian of a 10 to 17 year old needs a waiver for confidential domains (per CLAUDE.md, verification pending).
Decision needed: age of consent for health data processing in Nigeria, whether an adolescent can consent alone to reproductive health care and data, and whether a guardian may see data the adolescent wants confidential.
Turns on: NDPA 2023 children's data provisions; Child Rights Act and state laws; National Health Act 2014 consent provisions.

### 8. Withdrawal of required consents
Facts: patients cannot withdraw data_processing, telehealth or terms through the consent list; they are sent to a deletion request. The spec asks for withdrawal in two taps.
Decision needed: whether refusing in-list withdrawal of a consent that is the basis of processing is lawful, and what must happen on a withdrawal (stop processing, keep what is legally required, tell the patient).
Turns on: NDPA 2023 right to withdraw consent.

### 9. Erasure versus National Health Act 2014 and other record duties
Facts: the founder's direction is no erasure of real data once care has been given; patients can request export, correction, deletion. Test accounts were purged. Retention periods are config only and no auto-delete runs.
Decision needed: the minimum retention period for each record class (clinical notes, results, prescriptions, audit logs, payment records, consent history); what must be kept when a patient requests erasure; whether we may keep a minimal tombstone; how long the audit log of record access must be kept and whether the patient may see it.
Turns on: NDPA 2023 erasure and retention provisions; National Health Act 2014; MDCN Code of Medical Ethics; tax and CAC record duties for payment data. Counsel to name the periods.

### 10. Staff audited access and the patient's right to know who looked
Facts: S39c lets any active clinician in the organisation open any patient's record with no reason typed; every opening is logged append-only; the patient is not told (OQ-281). Break-glass and support view-as also exist.
Decision needed: whether a patient has a legal right to the access log or to be told who saw their record; whether "any clinician may search any patient" meets the minimum necessary expectation; whether a reason must be recorded for sensitive categories; how long the log is kept.
Turns on: NDPA 2023 transparency, access and security of processing provisions; MDCN confidentiality duties.

### 11. Research use and de-identified analytics
Facts: a `research` consent value exists with no current version row and no gate (audit row 1.6). Sponsors receive small-cell-suppressed aggregates (S38). No product analytics SDK is used.
Decision needed: whether de-identified or aggregate use for sponsors and for product improvement needs consent; what counts as de-identified (the suppression threshold is a PROPOSED value awaiting signature); whether secondary research needs ethics committee approval (NHREC) and a separate consent; whether sharing aggregates with an NGO funder is a transfer of personal data.
Turns on: NDPA 2023 research and statistical provisions; National Code of Health Research Ethics. Counsel to confirm.

## B. Health regulation

### 12. Telemedicine and MDCN
Facts: only doctors we verify consult; five doctor tiers collapsing to one doctor tier plus a Chief Medical Officer (F-05); a Medical Officer may confirm refills, a Senior Medical Officer may initiate new medicines; consultations by video (Zoom), asynchronous written question, in-app messaging; prescriptions are signed by a clinician (INV-02); no owned clinic. MDCN has never been asked to confirm the tier model.
Decision needed: whether the entity needs facility or telehealth registration (federal or state); whether MDCN telemedicine guidance allows first consultations by video or message, prescribing without a physical exam, cross-state and diaspora patients; whether a Medical Officer confirming a refill under protocol is acceptable; what indemnity cover is required; whether employing or contracting doctors as a corporate body raises any MDCN issue.
Turns on: Medical and Dental Practitioners Act; MDCN Code of Medical Ethics and any current telemedicine guidelines; state ministry of health rules. Counsel to name the current instruments.

### 13. Payments, Care Vouchers, no stored balance
Facts: Paystack (NGN) is the only provider; Platform Credit removed 2026-09-30; Care Vouchers (sponsor buys a voucher for a person's care) are live; sponsor payments, payouts to doctors (S31, guard OFF) and partner settlement exist. Founder INV-09: no stored balance, every payment tied to an order.
Decision needed: whether a Care Voucher is stored value or an electronic money instrument requiring a licence; whether holding sponsor funds between payment and use triggers CBN requirements; whether doctor and partner payouts through Paystack Transfers are permissible without our own licence; AML and KYC duties on sponsors.
Turns on: CBN licensing and payment service guidance, and CBN guidance on electronic money and wallets. Counsel to confirm which framework applies.

### 14. NAFDAC and the symptom checker
Facts: a deterministic rule-based symptom checker and triage engine (no AI, no learning); outputs advise a level of urgency and never a diagnosis; public marketing pages carry "not a diagnosis" wording; a clinician signs rule sets (CMO). Also wearables sync consumer data and Bluetooth devices are read but not sold.
Decision needed: whether the checker, the triage engine, the blood pressure or glucose alerting, or the weight and cardiovascular risk scoring is software as a medical device under NAFDAC rules; if so, which class and whether registration is required before launch; whether the label wording we use is sufficient.
Turns on: NAFDAC medical device and software guidance, if any exists; counsel to confirm the position and whether NAFDAC has a published SaMD stance.

### 15. NAFDAC and PCN, pharmacy and medicines
Facts: prescriptions go to licensed partner pharmacies only; collection only (home delivery removed, OQ-261); no active pharmacy partner live; a pharmacy dispensing model with one shared supply count (S28); partner licence fields exist but a hard assignment gate is missing on three partner tables.
Decision needed: whether the platform may hold or display medicine prices; what a partnership agreement with a pharmacy needs; whether showing a prescribed medicine name in-app is advertising; whether patients can be offered a choice of pharmacy; whether a clinician-signed prescription can be transmitted electronically.
Turns on: Pharmacists Council of Nigeria rules; NAFDAC advertising regulations for drugs; Pharmacy law. Counsel to name current instruments.

### 16. Laboratory and sample collection
Facts: one active laboratory; the lab network model routes to any contracted laboratory (home sample collection status not re-checked here); positive HIV, hepatitis B and C results are never auto-released (INV-04).
Decision needed: whether the platform needs a licence to broker lab tests; who is the controller for result data; what a clinician must do on disclosure of a sensitive positive result; whether result release rules (INV-03) conflict with any patient right of access.
Turns on: MLSCN rules (counsel to confirm), National Health Act 2014 patient rights, NDPA 2023.

### 17. HIV and other sensitive positive results
Facts: results flagged `sensitive_positive` are held for personal clinician disclosure.
Decision needed: whether the HIV and AIDS (Anti-Discrimination) Act 2014 or related law imposes any notification, consent or confidentiality duty beyond what we do; how long a patient may wait for a disclosure before it counts as withholding.
Turns on: HIV and AIDS (Anti-Discrimination) Act 2014; NDPA 2023; counsel to confirm.

## C. Marketing, messaging, insurance

### 18. ARCON pre-vetting
Facts: about 30 public marketing routes make claims about monitoring, hypertension, diabetes, HMO and corporate programmes; no in-app advertising; no record of any pre-vetting. The wording "your care team" is used instead of "your doctor", with no "cure" claims (house rule).
Decision needed: whether each public page, social post, email campaign and app store listing needs ARCON pre-vetting before first use; whether a static website counts as advertising; what record of approval we should keep; whether health claims need additional approval (for example NAFDAC for product claims).
Turns on: Advertising Practitioners (Registration, etc.) Act and ARCON Code; the Nigerian Code of Advertising Practice. Counsel to confirm which applies to a digital health service.

### 19. NCC and sender ID
Facts: Termii sends SMS and voice. Verification codes use the auth hook. Live data shows non-verification SMS to patients (new-device sign-in alerts and a re-engagement check-in) and SMS and voice paging of clinicians. Sender ID registration status unconfirmed. USSD was dropped.
Decision needed: whether Termii as a licensed aggregator is enough for our use, whether the sender ID must be registered in our name, whether transactional versus promotional categories, DND and opt-out rules apply to security alerts and re-engagement messages, and whether voice calls need separate treatment.
Turns on: NCC rules on bulk SMS and sender ID, DND register; counsel to name the current instrument.

### 20. NHIA and insurance-like language
Facts: no capitation. HMO integration is eligibility and billing only. A public page answers "Is this insurance?" with no, and compares the monthly price with the cheapest individual health insurance. The mobile app lists insurance as a navigator topic. The monitoring product is a one-time 90-day purchase.
Decision needed: whether any phrase we use (premium, cover, "pays for", comparing price to insurance, "keep your HMO") could be read as carrying on insurance business; whether a prepaid membership or Care Voucher could be insurance under the Insurance Act or NAICOM rules; whether NHIA registration is needed to work with HMOs or state schemes; wording we should use or avoid.
Turns on: Insurance Act 2003 (and any successor), NAICOM guidance, National Health Insurance Authority Act 2022. Counsel to confirm current text.

## D. Other

### 21. Telehealth consent and terms of service
Facts: Schedules A, B, C are live (telehealth version 2026-08-12, terms 2026-09-02, data processing 2026-09-08). English only. Product pivoted to membership (2026-10-05) after some versions were published.
Decision needed: whether current live consent text still matches what we do (membership, scribe, Care Circle, staff audited access, AI case briefs); whether patients must re-accept after a material change; how to handle FCCPC rules on cancellation, auto-renewal and refunds.
Turns on: NDPA 2023; Federal Competition and Consumer Protection Act; counsel to review `docs/legal/schedule-*`.

### 22. Employer and HMO aggregate reporting
Facts: institutions get aggregate-only access (I9), small-cell suppressed; only a superadmin may drill into an individual; DPA templates exist for HMO and employer.
Decision needed: whether the DPA templates are sufficient; whether an employer that pays for a membership may know who enrolled; whether aggregated data about a small employer remains personal data.
Turns on: NDPA 2023; counsel to confirm.

### 23. Sponsor and diaspora payers
Facts: a sponsor can fund a person's care and see a monthly figure (S38); the patient consents with `sponsor_reporting` (optional). Payers may be outside Nigeria.
Decision needed: whether the payer is a joint controller or a recipient; what the payer may be told; cross-border transfer of the figures; AML checks on sponsors.
Turns on: NDPA 2023; AML rules; counsel to confirm.

## What we would like back

For each question: the answer or "needs a regulator conversation", the instrument counsel relied on, and any change to the product or wording that counsel advises before launch. Questions 1 to 5, 13, 14 and 20 are the ones we think could change the product, not just the paperwork.
