# Competitor product review and plan (2026-10-06)

Not the v5 S39 session (that is security hardening). Evidence and caveats are in
`docs/research/competitor-review-africa-2026-10.md` and `competitor-review-global-2026-10.md`.

**Honest limits.** Design and UX findings are inferred from search snippets, not from installed
apps or screenshots. No competitor's private code was seen; the only public code reviewed is open
source (HAPI FHIR Apache 2.0, OpenMRS MPL 2.0, OpenEMR GPL 3, Bahmni AGPL per a search source).
Copyleft code must not be copied in without legal review. Outcome and member figures are
vendor-reported and unaudited. Ideas are adapted, never copied (CLAUDE.md rule 11).

## What the review found about Tarragon

Verified in code, not just inventoried: the patient app is broad (vitals, medicines, offline
outbox, care messages, labs, caregivers, streaks, reminders, en and pcm, PDF results, a service
worker). Two inventory claims were wrong and corrected: a patient data export exists (admin
fulfilled by design) and the web has a service worker.

Confirmed gaps: no clinician-ready printable readings report, no weekly summary, no user-facing
low-data mode, no voice entry, mobile dark mode has no System option (legacy screens pinned light).

## Ranked plan

| # | Item | Source of idea | Status | Notes |
|---|------|----------------|--------|-------|
| 1 | Report for your visit (PDF of own readings) | global #8, Medisafe/mySugr style reports | **Built (this branch)** | Plain statistics, no classification, wearable estimates labelled |
| 2 | Weekly summary (in-app card, optional push) | inventory gap | Next | Reuse `summariseReadings`; needs reminder-channel rule and quiet hours |
| 3 | Escalating missed-dose reminder with a family contact told in-app | global #2 (Medisafe) | Needs decision | Consent and proxy rules; never depends on a send succeeding |
| 4 | Low-data mode (skip images, defer sync, smaller lists) | Vula, Helium | Next | Extend `offline-budget.ts`, add a setting |
| 5 | Outcome report for the 12-week programme, payer shareable | Platos, Reliance | Needs founder | Aggregate only (I9); vendor figures are not a model for claims |
| 6 | Outcome-linked pricing on the programme | Virta | Founder only | Pricing churns; do not build unprompted |
| 7 | "Buy for a parent abroad" sponsor flow | Reliance Alafia | Founder only | Overlaps Care Voucher counsel item |
| 8 | Chronic-drug price lock via pharmacy partner | mutti | Founder only | Needs a signed partner |
| 9 | Specialty-specific structured referral forms | Vula | Later | Staff-created referrals only, matching-engine guardrail stands |
| 10 | Voice entry for readings | inventory gap | Later | Must confirm the value before saving; safety review |
| 11 | Mobile dark mode System option | inventory gap | Blocked | Needs legacy-kit migration first |
| 12 | Embeddable partner API | WellaHealth | Later | Phase 2/3 gate |

## Do not do (from the research and our rules)
WhatsApp as a care channel (F-02), unvalidated AI triage or accuracy claims (INV, Babylon, Ada
studies), deprescribing automation without CMO-signed protocols, insurance-style coverage claims,
emailing raw lab results, wearable readings presented as clinical.

## Follow-ups for item 1
- Strings are English in the component and PDF, like the sibling PDFs; move to `packages/i18n`
  (en, pcm) before this is treated as finished.
- The route serves the signed-in patient's own readings only. A caregiver acting for a dependant
  cannot generate one yet (needs the category-scoped access check).
- Mobile has no button yet; the route is bearer-cookie web only.
