# Questions for Nigerian counsel (S39)

From the regulatory map (spec D.6) and what the S39 review found. Each is phrased for a yes or no, or a figure. Please answer in writing; the answer goes into the named open question and the platform is changed to match. Not legal advice from us; these are the points we cannot settle ourselves.

## NDPA 2023 and NDPC
1. Is Tarragon registered with NDPC as a data controller of major importance, and does the filing declare the cross-border transfers (Supabase in Ireland, Anthropic, Zoom, Sentry, Twilio, Expo)? (Records disagree: the spec says filed, the compliance status file says unconfirmed.)
2. Is the patient's explicit consent enough as the transfer basis, or do we also need standard contractual clauses or another mechanism for the EU and US processors?
3. Is a signed DPA with each processor required before go-live, and is Anthropic's API terms DPA enough, with zero retention pinned in writing?
4. Does the DPO appointment accepted on 2026-09-15 satisfy the Act, and which DPIAs (general health data, AI case briefs, Zoom and scribe, wearables) must be filed with NDPC rather than kept internally?
5. What retention periods apply to a clinical record, the audit trail, consultation transcripts, lab results and rejected clinician applications? Is anonymising a clinical record on an erasure request acceptable where a period applies? (OQ-262, OQ-263)
6. For a dependant under 18: is guardian consent enough for health data, and may a 10 to 17 year old's reproductive health data be withheld from the guardian?
7. Is sending a NIN or BVN to Dojah in a GET query string acceptable, and is storing only the last four digits compliant?
8. Are published small-group figures (smallest group 20, 30 for two attributes) acceptable de-identification?
9. Must we notify NDPC within 72 hours of a breach at a processor (for example Sentry), and does our breach runbook match the Act?

## MDCN
10. Does MDCN need to approve telemedicine delivered by a platform, as opposed to individual doctors, and does our split (one doctor tier plus the CMO) need written MDCN confirmation?
11. Is text-only asynchronous advice allowed, and are AI-drafted notes that a doctor signs acceptable, including AI scribing of consultations with consent?
12. Does paying contracted doctors a share of fees breach the fee-splitting rule? (OQ-178)

## NAFDAC
13. Is the symptom checker and triage engine regulated software as a medical device? If so, must it be registered before launch, and does spoken triage change that?
14. Do we need anything for AI reading of ECG or imaging reports, or for Bluetooth device pairing when we sell no devices?

## PCN
15. May prescriptions go only to PCN-registered pharmacies, and must we verify each branch's premises licence? Does an e-prescription need a pharmacist's countersignature? Who is responsible for controlled medicines?

## CBN
16. Does an order-linked checkout with no stored balance (INV-09), including a sponsor paying for a loved one, avoid CBN licensing? May we pass the processor fee to the patient?
17. Do clinician payouts through Paystack Transfers need any licence, and what withholding tax applies to each kind of contractor? (S31, payouts stay off until answered.)

## NCC
18. Does a verification-code sender ID need NCC registration beyond the aggregator's approval? Do dial-in and masked calling raise caller-ID or call-recording consent rules?

## ARCON
19. Must public marketing, the coverage page, videos and review requests be pre-vetted, and may patient reviews (Trustpilot, Google) be shown in health advertising?

## NHIA
20. Is eligibility-and-billing-only HMO integration outside NHIA's insurance rules, and could a 100,000 naira a year Membership be classed as insurance?

## Access log and retention (added in S39c)
21. Does a patient have a right under the NDPA 2023 to know which staff opened their record, or is an internal access log a matter for the DPO only?
22. Are these retention periods acceptable for Nigeria: adult record 8 years after last contact, child to age 25, maternity 25 years, mental health 20 years, access log 8 years, consent records the relationship plus 6 years, payments and ledger 6 years? Does any MDCN rule or other Nigerian statute set a longer or shorter period?
