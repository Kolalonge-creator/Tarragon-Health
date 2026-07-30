# Schedule B — Telehealth Consent

*Draft for legal review — not yet approved by counsel. Version 2026-07-30-v3 (rewritten to match the platform as actually built in `apps/web`, after the narrow cardiometabolic-only pivot described in v2 was reversed the same evening it was adopted — see `CLAUDE.md`'s "PIVOT REVERSED" banner). This text is the canonical source for the `telehealth` consent content and for any future public/patient-facing rendering of it; edit here first, then re-sync wherever it's reused.*

## About this document
This is TarragonHealth's Telehealth Consent — Schedule B of our legal documentation. Version 2026-07-30-v3, published 30 July 2026. This document is currently in draft and pending final review by our legal counsel.

## What this consent covers
This is your consent to receive clinical monitoring, classification, and review from TarragonHealth remotely, and to be contacted by phone, message, or in the app as part of that care. It is separate from, and in addition to, our data processing consent and our terms of service.

## Your care team
Every clinical judgment about your care is made by a doctor registered with the Medical and Dental Council of Nigeria (MDCN), whose registration is verified before they can see patients and checked continuously afterwards — a doctor whose registration or indemnity cover lapses is automatically suspended from seeing patients that same night. Your care may involve several people at different levels of seniority, and your record always shows plainly who did what:

• A **Care Coordinator** (non-clinical) follows up if we haven't heard from you and helps with logistics like booking a lab test or refill — they can see your progress record but cannot read your clinical notes, interpret a result, adjust a medication, or close an escalation.

• **Medical Officers** at increasing levels of seniority review routine results, confirm stable prescriptions, and (at the more senior levels) initiate new medications or manage complex cases.

• A **Senior Registrar** or **Partner Specialist** may be brought in for a pre-referral consult or a specialist opinion on a complex case.

Whenever you see a note that says a doctor reviewed something, it is tied to a real record of who reviewed it and when — never a generic claim. TarragonHealth directly employs its day-to-day care-team doctors.

[We have not yet obtained MDCN/regulatory confirmation that this tiered review structure is compliant; do not represent it to a patient or a regulator as already approved. Counsel to advise.]

## How your results are classified and how we respond
Every reading you log is classified, automatically, against a published clinical protocol — even a normal reading gets a record, so nothing is silently skipped. How quickly we respond depends on what triggered the classification, not a single flat rule for everything — a positive self-harm or mental-health screen, for example, is treated faster than a routine borderline reading, because the two situations are not equally urgent. Our current, clinically-approved response targets are:

• **Emergency** — as fast as 15 minutes for a self-harm risk flag, and up to 2 hours for a critical screening result or a reported danger symptom (for example, a hypertensive-crisis reading). We contact you on every channel at once and, for a reported danger symptom, document an attempt to reach your emergency contact if we cannot reach you. A case classified emergency cannot be closed from a written note alone — our system requires your doctor to have had a real-time voice or video conversation with you first.

• **Urgent** — typically within 1 hour (for example, a red-range home blood pressure reading), up to 4 hours for a reported foot problem, and up to 24 hours for a non-critical abnormal screening result.

• **Needs clinician review** — within 3 days (for example, a reading above target but not in a danger range, or a pattern of missed readings we want a clinician to look at).

• **Routine** — within 7 days.

These are the service standards we hold ourselves to today, set out in a versioned internal configuration a Clinical Director signs off on, not guarantees of a specific outcome in every case — how quickly we can reach you also depends on you being reachable. [Counsel: the founder has confirmed these targets are deliberately differentiated by clinical situation rather than collapsed to one number; flag if a simpler patient-facing summary is legally preferable to the tiered detail above.]

## How we communicate with you
Different channels carry different kinds of information, on purpose:

• The app is your record — your ongoing conversation with your care team, your results, your care plan, and your consent history live here. This in-app conversation is the primary channel for anything clinical.

• A phone or video call is how clinical judgement is delivered when something needs real-time discussion — your doctor's number is masked when we connect a call through the platform, and the call is logged to your record.

• SMS is used for urgent backup, and as the primary channel if you've told us you don't use a smartphone.

• WhatsApp carries reminders, alerts, and confirmations — a short message telling you a result is ready or a check-in is due, so you open the app. It never contains a specific number, result, diagnosis, or medication name — our system enforces this at the database level, not just by convention. Separately, you may message your care team for support over WhatsApp, and a person there may reply to you on WhatsApp too; this is a human-routed help channel, never something automated turns into a clinical decision, and it is never required — you can always reach your care team through the app instead.

• Email carries documents — receipts, reports, and copies of your consent records.

## What remote monitoring can and cannot do
Remote monitoring lets your care team review your readings and respond between visits, without you needing to travel for every check. It has real limits: your doctor cannot examine you in person, and their assessment is based on the readings and information you provide. If something needs an in-person assessment, your care team will tell you and refer you appropriately.

## Emergency care
TarragonHealth does not provide emergency care. If you are having a medical emergency, do not wait for a message or a call from us. Go to the nearest hospital or call [Nigeria's emergency line — exact number to be confirmed] immediately. No part of this platform is designed to be used in an emergency.

## Confidentiality
Your clinical information is kept confidential. It is shared with your care team on a need-to-know basis, and outside that only with your specific consent, where the law requires disclosure, or where there is a serious threat to your life, health, or public health. See our Data Processing Consent for how we handle your data more broadly.

## Your right to information and to take part in your care
Every message and note tells you who is speaking to you and their MDCN number where relevant. You can see every clinical action taken on your record, in plain language, at any time.

## Your right to consent, and to refuse
You can decline a specific recommendation. Declining does not end your access to the rest of the platform, unless what you are declining is safety-critical, in which case we will tell you clearly why.

## Withdrawing this consent
You can withdraw this consent at any time. Withdrawing ends remote clinical review going forward; it does not delete your existing health record, which we keep in line with our Data Processing Consent.

## Contact
Questions about your care or this consent: support@tarragonhealth.ng.
