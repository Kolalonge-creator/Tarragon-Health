# Memo to Counsel

**To:** [Outside Counsel — Data Protection & Health Regulatory, to be confirmed]
**From:** Dr Kola Longe, Founder, TarragonHealth
**Date:** 29 July 2026 (v2 — rewritten same day, after the platform's build specification changed the product materially; see "What changed" below)
**Re:** Review requested — data protection, telehealth, and consumer terms ahead of public launch

## What changed since v1 of this memo
An earlier version of this memo and its attached schedules was drafted against an older description of the platform. Hours later, we found that TarragonHealth's own founder-authored build specification (`tarragon-build-spec-v3.md`, dated 29 July 2026, "supersedes everything else") describes a materially different, narrower product. This version is rewritten against that specification. The most consequential differences: the platform is now scoped to cardiometabolic conditions only (hypertension, type 2 diabetes, obesity) rather than a broad chronic-care/prevention offering; there are no family or household plans and no diaspora billing (both are now permanently out of scope); WhatsApp is strictly notification-only, with clinician chat over WhatsApp explicitly treated as a defect; the prior five-tier doctor model is replaced by a company-wide, configurable accountability model; and the abnormal-result response is now a genuinely tiered SLA rather than a flat four-hour target. The registered company name and RC number, previously an open item, are now confirmed from the spec itself.

## Purpose
We are preparing to launch TarragonHealth publicly and need your review of three consent/terms documents before they go live: a Data Processing Consent (Schedule A), a Telehealth Consent (Schedule B), and Terms of Service (Schedule C). All three are attached. This memo gives you the platform context you need to review them, and lists nine specific legal questions we need answered — the first of which we consider the highest priority and a likely blocker for launch.

## Platform context
TarragonHealth (Tarragon Health Ltd, RC 9702108) operates a cardiometabolic detection-and-control platform for Nigeria, targeting hypertension, type 2 diabetes, and obesity. The clinical loop is: measure repeatedly, classify by protocol, deliver a verified generic medicine, prove the outcome.

**Two commercial products**, differing only in service level: Control (engine-led — an algorithm clears the stable majority of results, sold per covered life to organisations) and Concierge (a named coordinator, faster response times, structured reporting to a consenting funder). Individuals can also enrol and pay for either directly.

**Clinical staffing** operates under one of two configurable models, chosen company-wide: under "tech_layer" (our current default), each doctor practises and signs notes under their own individual MDCN registration, with mandatory indemnity cover; under "provider," Tarragon Health Ltd itself takes responsibility for the note, countersigned by the treating doctor. Which model is in force is recorded on every note. We have not finalised which model to use in production — our own build specification flags this as requiring written legal advice, not an engineering decision.

**Result classification and response** follow a tiered service standard: routine results are reviewed within 7 days, important results within 48 hours, urgent results by a phone call within 2 hours (never a text message alone), and emergency results trigger simultaneous contact on every channel plus a documented attempt to reach the patient's named emergency contact. Any result classified urgent or emergency can only be closed after a doctor has spoken to the patient directly — never from a written note alone.

**Automated processing.** Every reading is classified against a published clinical protocol (WHO HEARTS), assisted by an AI model that can only make a classification more cautious, never less.

**Communications** run on five separate channels with strict content rules: the app carries the clinical record and all clinical conversation; a phone call is how clinical judgement is delivered; SMS is urgent backup and the primary channel for patients without a smartphone; WhatsApp is notification-only, with no clinical content permitted on it at all; email carries documents and receipts.

**Data and hosting** are unchanged by this rewrite: our production database still runs on Supabase (Postgres) in AWS's eu-west-1 region (Dublin, Ireland), because Supabase has no data centre in Nigeria or elsewhere in Africa. Our own build specification independently flags this as the highest-risk open item in our legal position.

**Payments** run on Paystack (Nigeria) and Stripe (international card payments), both charging the same single naira price list — there is no separate foreign-currency price list, and no UK, US, or other non-Nigerian market launch is currently in scope.

**No family or household plans.** An adult account holder may enrol a child under 18 as a dependant and manage their care; we do not offer a shared or discounted household subscription.

**A new operational layer**: field staff run in-person screening events, often at an employer's premises, capturing consent and initial readings on a tablet — sometimes before the person being screened has any app account at all. Consent at that point is captured as a wet signature, a voice recording, or tablet-based e-consent, not through the app.

**Research.** We support anonymised research use of patient data, strictly opt-in, governed by a documented lawful basis and a minimum group size per export, with re-identification keys held separately and never exported. A patient who withdraws consent is excluded from future exports, but we cannot recall an export already delivered before withdrawal.

**A document we could not locate.** Both parts of our build specification repeatedly refer to a companion document, `tarragon-strategy-v3.md`, said to contain the regulatory positions and cross-border transfer reasoning behind several of the decisions above. That document does not currently exist in our codebase. We flag this so you know some of the reasoning referenced in our own specification has not actually been written down anywhere we can show you yet.

## Nine questions for your review

**1. Cross-border data transfer (highest priority).** Because our database sits in eu-west-1, Nigerian patients' personal data, including sensitive health data, leaves Nigeria as an infrastructure fact, not a user choice. Our own build specification independently identifies this as the single highest-risk area in our legal position. The Nigeria Data Protection Act 2023 treats cross-border transfer as something requiring a specific lawful mechanism — an adequacy finding, appropriate contractual safeguards, or the data subject's informed consent to that specific transfer. We need your view on which mechanism we should rely on, and whether this is a hard blocker for public launch.

**2. Sensitive personal data and lawful basis.** Is the consent-scope structure described in Schedule A — a general basis of care necessity, plus five specific, individually revocable consents (escalation contact, clinical share, funder summary, institution aggregate, research anonymised) — the right architecture under the Act? Specifically, may account activation be lawfully conditioned on accepting the "escalation contact" consent, as our platform currently requires?

**3. Controller/processor status and registration.** Are we a data controller, a data processor, or both, depending on the relationship (direct patients vs. organisation-enrolled patients)? Do we need to register with the NDPC, or undergo a data protection compliance audit? Our own platform already refuses to accept live patients in production until NDPC registration is complete and a DPO is named — is that gate sufficient, or does registration itself need to happen earlier in our build/launch sequence?

**4. Automated decision-making disclosure.** Every reading is automatically classified by a deterministic protocol engine, optionally assisted by an AI model that may only escalate a classification, never downgrade it, and a result classified urgent or emergency can only be closed after direct human contact with the patient. Does this design, as described, satisfy any right under the Act to avoid a decision based solely on automated processing, and is our current disclosure of it (Schedule A, "Automated processing") sufficient?

**5. The accountability model.** Should we launch on "tech_layer" (each doctor practises under their own MDCN registration) or "provider" (Tarragon Health Ltd takes responsibility for the note, doctor countersigning)? Our build specification treats this explicitly as a legal decision, not a technical one. We need a recommendation and, ideally, a defensible basis for whichever model you recommend, since Schedule B's description of "who is treating you" depends entirely on this answer.

**6. Field and screening-day consent.** Our field staff capture consent by wet signature, voice recording, or tablet-based e-consent at in-person screening events, sometimes before the person screened has any app account. Is this consent-capture method legally sufficient under the Act, and does it need different or additional disclosure from the app-based consent flow described in Schedules A and B?

**7. Emergency carve-out, tiered SLA, and liability.** Is our tiered response commitment (routine 7 days, important 48 hours, urgent phone call within 2 hours, emergency immediate multi-channel contact plus a documented next-of-kin attempt) adequately disclosed and legally defensible as stated in Schedule B? Should Schedule C carry a more specific limitation-of-liability and indemnity structure than the placeholder we have drafted?

**8. Consumer protection and organisational sales.** Does the FCCPC's consumer protection framework require a cooling-off period or refund right for our subscription model that our current "cancel at period end, no pro-rata refund" position does not provide? Separately: our primary sales motion for the Control product is selling coverage per patient life to an organisation (an employer or HMO) rather than to the individual directly — does that relationship need a distinct commercial services agreement, separate from the individual-facing Schedule C, and if so, can you help us produce one?

**9. Minors and dependant enrolment.** What is the Act's threshold for "child" data requiring guardian consent, and does our dependant-enrolment mechanism (an adult account holder enrols and manages a child under 18, enforced at the database level as a hard age constraint) satisfy the consent mechanism the Act requires?

## Attached
- Schedule A — Data Processing Consent
- Schedule B — Telehealth Consent
- Schedule C — Terms of Service

Each schedule is marked, inline (in red), with the specific gaps we need you to close. A consolidated open items checklist appears at the end of this document.

## Open items checklist
These items are the concrete blanks only TarragonHealth and counsel, together, can close. Each is called out inline in the schedules above, and repeated here so nothing is missed in review. None of the three schedules should be treated as final or launched publicly until this checklist is closed and you have signed off on the marked sections.

1. **Data Protection Officer** — appointment, name, and contact details; confirm whether the role is legally mandatory for us. (Our own platform will not go live with real patients until this is done — see item 2.)
2. **NDPC registration status** — confirm current status; this is now a hard technical gate blocking production patient enrolment on our own systems until satisfied, so timing matters for our build schedule as well as for compliance.
3. **Lawful mechanism for the eu-west-1 cross-border transfer** — see Question 1; our own build specification independently calls this the highest-risk area in our legal position, and defers to a "tarragon-strategy-v3.md" document (see item 5) that does not currently exist.
4. **The accountability model decision (tech_layer vs. provider)** — see Question 5. Our build specification explicitly states this "requires written legal advice, not a build decision," and our platform will not permit any clinical note to be signed in production until this is set.
5. **The missing `tarragon-strategy-v3.md` document** — referenced repeatedly by both parts of our build specification as containing the regulatory positions and pricing/legal reasoning behind several product decisions, including the NDPA cross-border position. It does not exist in our codebase. Recommend either producing it internally for your review, or confirming these positions with you directly without waiting for it.
6. **Field/screening-day consent capture sufficiency** — see Question 6.
7. **Whether a separate institutional/organisational commercial agreement is needed** — see Question 8, second part.
8. **Emergency contact number** — the exact number/instruction Schedule B's emergency carve-out should point to.
9. **NDPC contact details** — for the complaints clause in Schedule A.
10. **Refund/cooling-off policy** — see Question 8, first part; finalises Schedule C's cancellation clause.
11. **Limitation-of-liability cap and structure** — see Question 7; finalises Schedule C.
12. **Dispute-resolution venue and mechanism** — litigation vs. arbitration, and seat/venue, for Schedule C's governing-law clause.
13. **Data retention schedule** — exact retention periods by data category (active enrolment, closed account, minimum clinical record retention, financial/tax records).
14. **Guardian/dependant consent mechanism** — see Question 9.
