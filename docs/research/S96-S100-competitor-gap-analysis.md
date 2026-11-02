# S96 to S100: built state vs competitors, and what to build next

Date: 2026-10-28. Written from the 2026-10-22 analysis, updated for the S96 and S98 merges of 2026-10-28. Nothing here changes code.

## How much to trust this

- S96 to S100 are NOT v5 sessions. They are proposals in `docs/plans/S88-S100-post-v5-competitor-gap-and-build-plan.md` (2026-10-07): S96 digital MSK programme, S97 interoperability connector, S98 premium diagnostic panels, S99 developer and partner platform, S100 Stage 2 gate (no features).
- Code facts come from `origin/main-dev` and read-only checks of the live database. Nothing was run in a browser or on a device.
- Competitor research was thin. Four research passes ran about 4 to 14 searches each and opened few product pages. Items marked SOURCED have a URL. Everything else is BACKGROUND-KNOWLEDGE and must be confirmed before it goes into a spec. No competitor app was installed, so UI notes are patterns, not observations.
- Not verified at all: Peerwell, Exer Health, hellopt/Vori, Curovate, Physiotattva, Cure.fit, Mito, InsideTracker, Lifeforce, WHOOP and Oura labs, Ultrahuman, Everlywell, Quest, Levels, Synlab, Lancet/Cerba, Lifestores, Kangpe, Healthians, 1mg, Thyrocare, Practo, Apple Health Records, Health Connect, CommonHealth, NHS App, Medplum, Particle, Redox, Healthie, Canvas, Doctolib, Helium Health, Paystack and Flutterwave developer docs (HTTP 403).

## Headline

1. S96 (MSK) and S98 (automatic preventive test requests) are now built and live as dormant code. Both have all guards OFF and nothing signed.
2. S97 (interoperability) was already mostly built under other names. The gaps are consent visibility, provenance and paper import, not the standards.
3. S99 (developer platform) has a real gateway but no developer portal.
4. S100 cannot run: "Stage 1 complete" has not been written.
5. Competitors are ahead on depth and polish (camera form feedback, result explainers, developer portals), not on missing modules.

## Status per session

| Session | Status | Notes |
|---|---|---|
| S96 MSK programmes | BUILT, dormant (PR #1366) | Back, neck, knee, hip on the S63 therapy-programme engine. Guard `therapy_pain_enabled` OFF. Content, entry lists and numbers are DRAFT/PROPOSED. |
| S97 interoperability | MOSTLY BUILT | FHIR import with clinician review queue, FHIR and IPS export, SMART Health Link, PIN share links with view cap and access log. Gaps below. |
| S98 premium diagnostics | PARTLY BUILT | Health Report with charts and recheck suggestions exists. Automatic test requests built (PR #1367, dormant). Per-marker repeat cadence and add-on panels NOT built. |
| S99 developer platform | PARTLY BUILT | API gateway (scoped keys, idempotency, request log), partner webhook admin. No portal, sandbox with synthetic patients, or webhook replay. |
| S100 Stage 2 gate | BLOCKED | `docs/STAGE-1-SIGNOFF.md` is a draft; the Stage 1 gate (S40) has not passed. |

## S96 digital MSK: competitors

| Vendor | What was found | Status |
|---|---|---|
| Hinge Health | Tailored plan, goal setting, coaching, virtual PT, TrueMotion camera form feedback, Enso pain device (described as FDA-cleared, clearance number not checked), "Robin" 24/7 AI assistant (Oct 2025) that triages flare-ups and summarises for PTs. Claims about 95 percent fewer care-team hours and 3.6x ROI are vendor claims. | SOURCED: hingehealth.com/for-organizations/our-approach; businesswire 20251021731830 (search snippet only, page 403) |
| Sword Health | Thrive (MSK), Bloom (pelvic), Move; "Phoenix" AI care specialist (June 2024). Claims 3:1 ROI, 55 percent surgery-free. "FDA-listed 2017" is not the same as cleared. | SOURCED vendor: swordhealth.com/articles/introducing-phoenix |
| Kaia Health | App-delivered multidisciplinary programme. RCT of 101 adults: pain 2.70 vs 3.40 on an 11-point scale at 12 weeks against 6 PT sessions plus online education. Per-protocol analysis, sponsor-funded. CE class not confirmed. | SOURCED: PMC6550294 |
| Joint Academy / Arthro | Osteoarthritis first, back pain too. About 2 exercises a day, difficulty rating after each, cannot proceed until the day is marked complete. Personal PT, peer support. The "41 percent vs 6 percent" figure is from trade press and must be checked against the paper. | SOURCED: PMC4912680; mobihealthnews |
| Physitrack | Clinician SaaS: 18,000+ exercise videos, patient app, outcome tracking. Listing shows $23.99 to $30 per clinician per month (may be stale). | SOURCED: getapp, capterra |
| Africa | Open Doors Access (Nigeria), Rehabify (Nigeria), Together PT (Tanzania), ReMotion Rehab (Tunisia): all early stage; snippets only. India: Physiqcian (WhatsApp-native), PhysioMantra (vendor claims). | SOURCED snippets only |

Evidence for digital MSK: a meta-analysis of 56 trials (9,359 people, about 25 weeks) found small effects (pain SMD 0.19, function 0.14, moderate certainty); multicomponent programmes that included provider elements did better (pain SMD 0.34). SOURCED: PMC9490534. A 2024 scoping review of 28 chronic low back pain telerehab studies found mostly asynchronous smartphone delivery. SOURCED: PMC11585175. Most large outcome claims are vendor claims.

Red flags: a review of 17 low back pain guidelines groups red flags into malignancy, fracture, cauda equina and infection, with no consensus between guidelines and little accuracy evidence. SOURCED: PubMed 27376890. Serious pathology is rare in primary care. No vendor publishes its own red-flag questions. Check against NICE NG59 (not read).

What was built to match, and what was not:
- Built: daily cap of 3 exercises, difficulty rating after each, a completion gate (3 different days to finish a week), deterministic flare-up re-screen (no AI), PEG pain scale plus a function goal at weeks 1, 4 and 8, 68 red-flag items fail closed, original line drawings in the app code (offline), hospital-now guidance without paging on possible heart or stroke signs (90-minute task, founder decision 2026-10-27), CMO sign-off hub line.
- Not built, on purpose: camera form feedback (needs bandwidth and a device), an AI triage assistant (INV-01), wearable kits, a physiotherapist role (founder: not hiring now; an internal "not physiotherapist-reviewed" marker is the hook for later).
- Not built, still a gap: a clinician-facing trend view of MSK scores (OQ-S96-5), a pregnancy-specific back plan (OQ-S96-9), post-surgery and arthritis tracks, an evidence plan from Tarragon's own pilot patients.

## S97 interoperability and portable record

| Player | What was found | Status |
|---|---|---|
| Nigeria Core FHIR IG | Exists under the Federal Ministry of Health and NDHI; profile-only or profile plus interaction; "under development" with no national terminology server. A 2025 connectathon had insurance and claims, MNCH referral and ePharmacy tracks. I found no page on a live national health information exchange. | SOURCED: build.fhir.org/ig/digitalhealth-gov-ng/Nigeria-Core; packages.fhir.org/jurisdictions/NG |
| India ABDM / Eka Care | Consent is a first-class object: requester asks, patient approves in the PHR app, data arrives as encrypted FHIR, revocation updates the other side, the consumer must honour the consent duration. | SOURCED vendor and third party (not official NHA docs) |
| Epic on FHIR | Free self-registration; non-production client ID; production needs a sponsoring customer; synthetic test patients. TEFCA individual access exists. | SOURCED: open.epic.com |
| Metriport, Junction (Vital) | Sandbox toggle with a separate key and predefined patients; Svix-signed webhooks and per-user sync state. | SOURCED: docs.metriport.com; docs.junction.com |
| Apple Health Records, Health Connect, CommonHealth, NHS App, Medplum, Particle, Redox, 1upHealth, HealthGorilla, OpenHIE/OpenMRS/DHIS2, Helium | Pattern knowledge only. | BACKGROUND-KNOWLEDGE |

Already built (do not rebuild): FHIR import with clinician review, FHIR and IPS export, SMART Health Link, time-limited PIN share with view cap and window, patient access log.

Gaps a basic implementation would miss (from the research; check each against the code):
- A patient-visible "who accessed what and when" screen that covers API access as well as share links.
- A named, off-by-default toggle for reproductive health in share and export flows.
- Provenance, source system, import time and a clinician verification state on every imported record; imported data never overwrites verified data.
- LOINC mappings for portable lab results (no national terminology server yet).
- Patient matching without a universal ID (phone plus a verified factor, not name and date of birth alone).
- A photo or PDF import path with clinician verification. Most Nigerian providers are paper-based, so this matters more than FHIR pull.
- A pre-set emergency access profile, separate from time-limited links.
- UI to copy: a consent card that states who is asking, what, and until when; a Sharing tab with active and expired grants and one-tap revoke.
- Constraints: NDPA 2023 cross-border rules apply to any partner outside Nigeria (eu-west-1 hosting is already an accepted gap); NIN and BVN need legal review before use; consent withdrawal does not recall data already delivered, so say so in the UI.

## S98 premium diagnostic panels

| Player | What was found | Status |
|---|---|---|
| Function Health | 100+ markers, then a follow-up of about 60+ markers 3 to 6 months later (two draws a year). Clinician notes per result. MRI and cancer screening sold as add-ons. Price reports conflict ($365 and $499 a year). | SOURCED: outliyr, crowncounseling, ahealthysliceoflife (affiliate blogs; confirm) |
| Superpower | 100+ markers, "optimal range" for each. $199 a year listed ($399 in NY/NJ), $179 retest, $99 at-home draw. One reviewer reports $400+ a month of recommended supplements (a single opinion). | SOURCED: superpower.com/pricing; crowncounseling |
| Healthtracka (Nigeria) | Home sample collection, partner labs, about 48-hour results. Current prices not found. | SOURCED: Nigeria Health Watch; TechCrunch 2022 |
| Mito, InsideTracker, Lifeforce, Ultrahuman, WHOOP, Oura, Everlywell, Quest, Levels, Synlab, Lancet, Healthians, 1mg, Thyrocare | Not researched. Several have biological-age or hormone-optimisation elements that Tarragon's policy excludes. | UNVERIFIED |

Critique: tests aimed at healthy people carry a high false-positive risk and cause overtesting and distress; no randomised trials show better outcomes; one multi-cancer blood test showed only 27 to 37 percent sensitivity for stage 1 to 2 cancers. SOURCED: Psychology Today (June 2026), Healthcare Dive. None of these sources is specific to Function or Superpower.

UI patterns worth copying (background knowledge): results grouped by body system; a range bar per marker with the previous result shown; a biomarker detail page with a trend chart; a doctor note with name and time (matches the null-gated `ReviewedByDoctor` rule); one next action per result; status in words, not colour alone; "change since last time" in plain words; a one-page signed PDF report.
Avoid: composite scores and biological age (policy), "optimal range" labels with no outcome evidence, red styling for non-urgent values, supplement upsell tied to results, add-on imaging inside the results page.

Idea list for the CMO, NOT clinical advice: HbA1c, lipids, kidney (creatinine and eGFR, urine albumin-creatinine ratio), liver, hepatitis B and C, full blood count and ferritin, vitamin D and B12 (on clinician indication only), TSH. Open policy questions: any panel for people with no symptom or risk factor; PSA and cervical screening; the sickle genotype test (touches the genetics ban); whether a clinician must review before release; a follow-up path for every abnormal result.

Built: the active annual panel `membership_annual` v3 (19 tests), the request-PDF flow, and the automatic issue of the request when a screening is due (S98, dormant). Not built: per-marker repeat cadence and scheduling, a "why this repeat" line from the doctor, a cap on add-on panels per year, body-system grouping and range bars on the results screen.

## S99 developer and partner platform

| Player | Pattern | Status |
|---|---|---|
| Stripe-style (benchmark) | Test and live modes, restricted keys, event log with resend, idempotency keys, dated changelog. | BACKGROUND-KNOWLEDGE |
| Paystack and Flutterwave | Test and live keys, signed webhooks, retries, dashboard resend. The local developer expectation. Docs not opened (403). | UNVERIFIED |
| Epic, Metriport, Junction | Free sandbox, separate sandbox key, synthetic patients, signed webhooks, per-user sync state. | SOURCED |
| Terra, Thryve, Healthie, Redox, Particle, Doctolib, Practice Fusion | Pattern knowledge only. Doctolib and Practice Fusion are mostly closed. | UNVERIFIED |

Already built: gateway pipeline (authentication, scope, idempotency, validation, rate limit, log), scoped keys, partner webhook admin (list, rotate key, re-enable with reason, event map), `INTEGRATIONS_API.md`.
Missing: a developer portal and API explorer; a test-and-live toggle on every page; webhook event log with one-click replay and a dead-letter view; signing-secret rotation with an overlap period; a sandbox with synthetic patients (never real data, keys that cannot reach production); a status page, dated changelog and deprecation policy; a partner onboarding checklist (sandbox passes, security questionnaire, DPA signed, go-live approval). Keep webhook events thin (an id and a type, no PHI) and make API scopes unable to request patient-level data for institutions (I9).

## New capabilities seen across the strongest products

From the cross-product scan (4 searches, no pages opened; most items BACKGROUND-KNOWLEDGE):

1. Doctor-approved post-visit summary with a to-do list (an after-visit summary with a what-happens-next checklist, #1205, was already merged; check whether this is covered).
2. Annual results as "what changed, what to do next" with the top 3 focus areas (Function's results chat, SOURCED: apps.apple.com Function Health listing). Use clinician-signed text; AI only for plain-language rewrite.
3. Pre-visit prep form that feeds the visit brief (an S07y pre-visit summary exists; check).
4. AI-drafted clinician brief and between-visit digest (S89 copilot; the scribe is still off). Omada keeps a human component. SOURCED: silicon.co.uk, insidermonkey.
5. Safe streaks: count days logged, never show a lost streak, allow "skipped, I was unwell".
6. Medication adherence companion with a clinician-routed side-effect flag (S08y likely covers much of this).
7. Upload and verify outside paper results to build a fuller trend line. Extraction must be clinician-verified.
8. English-only text-to-speech reading mode for older adults.
9. A nurse or community health worker on the home sample collection visit to capture BP and weight (Clafiya's model without USSD, which is banned). SOURCED: techpoint.africa, vc4a.com (2023 or earlier).
10. Patient-controlled export of results to the patient's own AI app, with revoke (Function connects to ChatGPT, Claude and Perplexity; OpenAI launched Health in ChatGPT on 23 July 2026, US only). SOURCED: clpmag.com, openai.com. Low priority; NDPA cross-border risk.

## Safety and policy checks before any new feature

- Nothing here authorises a language model in triage (INV-01), autonomous prescribing, an AI therapist, a wallet, hardware bundles, pharmacy delivery, WhatsApp or USSD.
- Sensitive test names (HIV, hepatitis) stay out of notifications, emails and logs (INV-04, INV-07). The S98 opt-in for sensitive requests is behind a guard that needs CMO and DPO review.
- Every figure above marked vendor claim must be re-checked before it appears in a spec, a page or a pitch.

## What this session built (2026-10-28)

- S96 MSK programmes: PR #1366, merged 01:33 UTC, applied live, `therapy_pain_enabled` OFF. See BUILD-PROGRESS and `docs/design/S96.md`.
- S98 automatic preventive test requests: PR #1367, merged 02:24 UTC, applied live, three guards OFF. See `docs/design/S98.md`.
- Owed from humans: the CMO approves the MSK content and confirms list v2 and every PROPOSED number; the CMO signs a screening rule set before the scheduler and automation guards are switched on; the CMO and DPO review the sensitive-test opt-in; clinician cover and outcome-threshold attestations. Open questions: OQ-S96-1 to -10 and OQ-S98-1 to -7 in `docs/OPEN-QUESTIONS.md`.

## Sources

Hinge: hingehealth.com/for-organizations/our-approach. Sword: swordhealth.com/articles/introducing-phoenix; fiercehealthcare.com. Kaia RCT: ncbi.nlm.nih.gov/pmc/articles/PMC6550294. Joint Academy: PMC4912680; mobihealthnews.com. Digital MSK meta-analysis: PMC9490534. Telerehab scoping review: PMC11585175. Red flags: pubmed.ncbi.nlm.nih.gov/27376890. Physitrack: getapp.com, capterra.in. Function and Superpower: outliyr.com, crowncounseling.com, ahealthysliceoflife.com, superpower.com/pricing. DTC testing critique: psychologytoday.com (June 2026), healthcaredive.com. Healthtracka: sjai.nigeriahealthwatch.com, techcrunch.com (2022). Nigeria Core FHIR IG: build.fhir.org/ig/digitalhealth-gov-ng/Nigeria-Core; packages.fhir.org/jurisdictions/NG; NPHCDA Immunization IG and 2025 Connectathon IG on build.fhir.org/ig/Nigeria-FHIR-Community. ABDM: skillsmp.com (Eka consent skill), bahmni.atlassian.net. Epic: open.epic.com. Metriport: docs.metriport.com. Junction: docs.junction.com/webhooks/introduction. Cross-product: clpmag.com, openai.com/index/introducing-chatgpt-health, apps.apple.com (Function Health), silicon.co.uk, insidermonkey.com, techpoint.africa, vc4a.com.
