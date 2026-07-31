# Data Protection Impact Assessment — General Health Data Processing

*Draft for legal review — not yet approved by counsel or a Data Protection Officer. This is TarragonHealth's own working assessment of its highest-risk processing activity, prepared to give counsel a concrete starting point rather than a blank page. It does not substitute for a DPO-conducted DPIA, which the Nigeria Data Protection Act 2023 requires before processing likely to result in a high risk to data subjects — see `docs/legal/cover-memo-to-counsel.md`, Question 5, for the open question of whether this processing already requires that formal DPIA before further scale-up.*

**Date:** 31 July 2026
**Scope:** The core patient-data-processing activity of `apps/web`, the live TarragonHealth platform.

## 1. Description of the processing

### What is processed
Sensitive personal (health) data for every enrolled patient: vitals readings, symptoms, medications, lab and screening results, vaccination records, clinical notes, risk scores, and care-plan history — described in full in `docs/legal/schedule-a-data-processing-consent.md`. Also processed: identity/contact data, next-of-kin and family-access relationships, and Health Wallet/payment data.

### Why it is processed
To deliver remote chronic-disease monitoring, preventive screening, and care coordination — the core service the patient signs up for. Automated classification against a clinical protocol runs on every reading so that no result is silently missed (`docs/CLINICAL_TRUST_MODEL_SPEC.md`; the abnormal-result Cat 2→1 escalation path is treated internally as the single highest-priority event the platform handles and is explicitly never allowed to fail silently, per `CLAUDE.md`'s Non-Negotiable Business Rules).

### Who processes it
- TarragonHealth's own doctors and coordinators, layered by clinical seniority (the five-tier model — see the cover memo).
- Supabase (infrastructure processor; Postgres database, storage, and auth, hosted in AWS eu-west-1, Ireland — see Section 3, Cross-border transfer).
- Paystack/Stripe (payment processors, card/payment data only, not clinical data).
- Where a patient specifically consents: a named specialist, family member, or sponsor.
- Where an employer/HMO funds a patient's access: aggregate, de-identified statistics only, enforced at the database level (`private.is_org_staff` and the institutions-aggregate-only migration, `20260729124330_institutions_aggregate_only_i9.sql`) — this is a structural guarantee, not a policy promise, and was itself the subject of a real finding: a prior version of the access-control function admitted employer/HMO administrator roles to 314 policies across 110 patient-scoped tables before being fixed (see `CLAUDE.md`'s "⚠️ `private.is_org_staff`" section).

### How long it is retained
No formal retention schedule exists yet — see the cover memo, open item 11. Data is currently retained indefinitely for an active enrolment.

## 2. Necessity and proportionality

The processing is necessary for the stated purpose: a chronic-disease monitoring and escalation service cannot function without the underlying vitals/symptom/medication data, and cannot safely triage results without automated classification against a protocol. Where data collection goes beyond the minimum needed for direct care, it is gated behind a specific, revocable consent (see Schedule A's "specific, scoped consent" list) rather than bundled into a single blanket acceptance.

**One structural minimisation already built:** identity verification (NIN/BVN) stores only the last four digits of the identifier, never the full number (`identity_verifications.id_last4`), a deliberate choice recorded in `CLAUDE.md`'s 2026-07-16 onboarding entry.

## 3. Cross-border transfer

Patient data is processed on infrastructure outside Nigeria as a routine, continuous fact of how the platform runs — not an occasional export. Two distinct transfers exist:

1. **Supabase (Postgres, storage, auth)** — AWS eu-west-1 (Ireland). This is where the full patient record lives. **No confirmed lawful transfer mechanism is yet on record** — this is the single highest-priority open item across the whole legal package (cover memo, Question 2).
2. **Anthropic (Claude API)** — a second, narrower transfer specific to AI-assisted doctor case summaries; assessed separately in `docs/legal/dpia-ai-case-briefs.md`, since it carries a different data shape and a different risk profile.

No Nigeria-based hosting option currently exists for the platform's infrastructure provider — this is a genuine constraint, not an unexamined default, and is recorded as such in `CLAUDE.md`'s architecture section.

## 4. Risks to data subjects, and current mitigations

| Risk | Mitigation already in place | Residual gap |
|---|---|---|
| An RLS/authorization bug exposes one patient's or organisation's data to another | Every multi-tenant table is RLS-scoped by `organisation_id`; every finding this codebase has produced has been fixed as a migration with a rolled-back-transaction proof, not a spot patch (see `CLAUDE.md`'s repeated "Verified live" discipline) | RLS bugs are found reactively, after the fact, in several documented cases (`is_org_staff`, the `lab_partner`/`pharmacist` cross-tenant read fixed 2026-07-27) — there is no systematic, scheduled RLS audit process |
| A patient's device-sourced clinical reading (BP, glucose) is silently edited, undermining the red-flag pipeline | Closed 2026-07-30 — `private.enforce_vitals_reading_source_lock` blocks a patient session from editing any non-manual vitals row | None known |
| An urgent/emergency case is closed without real clinical contact | Closed 2026-07-30 — a database trigger requires a real synchronous voice/video contact before an emergency-level escalation can resolve | None known |
| Clinical content leaks onto WhatsApp/SMS/email, an "open" channel outside our control | Closed 2026-07-30 — `notifications.content_class` CHECK constraint structurally prevents this at the database level; a residual free-text risk (admin broadcast messages) is closed by a server-side heuristic block, not UI copy alone | The heuristic is a best-effort backstop, not a true content classifier — a determined admin could still phrase around it |
| A breach goes undetected or unreported within the statutory window | `docs/legal/breach-notification-runbook.md` and `/admin/settings/data-breach-incidents` (built 31 July 2026) | The runbook has never been exercised on a real incident; detection still depends on a human noticing, there is no automated anomaly-detection layer |
| Excessive retention beyond what's needed | None yet — no retention schedule exists | Real gap, tracked as open item 11 in the cover memo |
| No confirmed lawful cross-border transfer basis | None yet | Real gap, the highest-priority open item |

## 5. Consultation

This DPIA has not yet been reviewed by a Data Protection Officer (none is appointed) or by outside counsel. It should be treated as a working draft that materially informs, but does not substitute for, that review.

## 6. Conclusion

The processing is necessary and proportionate to the service TarragonHealth provides, and several real risks identified through this platform's own development history have been closed with structural (database-level) fixes rather than policy alone — a pattern worth preserving. The two genuinely open, high-severity gaps are the absence of a confirmed lawful cross-border transfer mechanism and the absence of an appointed DPO — both are prerequisites this assessment recommends resolving before further patient-volume growth, not after.
