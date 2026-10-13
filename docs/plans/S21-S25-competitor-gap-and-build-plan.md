# S21 to S25: competitor comparison, best build, and plan

Date: 2026-10-07. Status: DRAFT for founder and CMO decision. Nothing here is approved, signed or started.

## 0. What this is, and the evidence behind it

S21 to S25 are already built (consultation room, written questions and notes, AI scribe, prescribing and titration, catalogue and Paystack checkout). So this is not a plan to build them. It compares what exists with the full products of competitors, decides what is missing, and sequences the work to make the five sections safe to switch on.

**Evidence quality, read before relying on any row:**
- Three passes today. An internal audit (read-only, against `origin/main-dev`) and two web sweeps of about 25 searches in total, with few page fetches. Many competitor rows came back empty and are marked UNVERIFIED. Vendor and press claims are not independently confirmed.
- **The local checkout is on `s38/outcome-snapshots-analytics`, 172 commits behind `origin/main-dev`.** The local `BUILD-PROGRESS.md` has no S25 or S26 entry. Apply state below is the build log's claim, not a query of the production ledger. Verify on `list_migrations` first (CLAUDE.md rule).
- OQ numbers are reused across sessions (OQ-124..136 mean S18/S19 and S21; OQ-170..176 mean S24 and S25). Cite OQs with the section.
- Nigerian regulation details (PCN Electronic Pharmacy Regulations 2026, NDPA, VAT) come from secondary summaries. The primary PCN text could not be read. Counsel confirms before launch.

## 1. Where S21 to S25 stand today

| Section | Built | Live state (build log) | Not run against reality | Gate that keeps it off |
|---|---|---|---|---|
| S21 consultations | Encounters, booking from confirmed blocks, room, video then audio then Zoom dial-in ladder, credit return, mobile room (patients) | S21 to S21f live; S21g, S21h reported applied after go-ahead | Zoom is on the Free plan; dial-in, SDK, presence webhook, host key and mobile room never run on real accounts or devices | S37 guard `clinical_operations_enabled` (needs approved hypertension protocol and triage rule set) |
| S22 written questions and notes | 4 per month per Member, 24 hour window, photos, notes release, amendments, memberships, audited inbox | S22, S22b, S22e live; S22c and S22d apply state unclear | Mobile queue and camera never run on a device; withdraw screens not clicked through | Membership grant is manual until checkout is on |
| S23 AI scribe | Paste-or-type input, consent per encounter, Claude draft, attach to note, sign | Base live; S23b, c, d built, not applied | No Anthropic key set; never run end to end or in a browser | AI-017 off: needs key, CMO evaluation run and sign-off |
| S24 prescribing | Signed prescribing, care plan changes, titration engine, protocol sign-off screen, referral consent | S24, S24b reported not applied (verify) | No live click-through; PDF/QR acceptance by pharmacies unverified | No approved `htn_hearts_ng` step table; `prescribing_enabled` not wired |
| S25 commerce | Catalogue, versioned prices, orders, Paystack checkout, signed idempotent webhook, entitlements, GL posting | Live, dormant | **No Paystack test-mode payment has ever run**; fee pass-through field names from docs only | Module `v5_checkout` off; `membership_annual` item off |

Known weak points the audit found, each a plan input:
- OQ-160: a phone-only patient is never recorded as joined, so a no-show report can be wrong for the very person the fallback serves.
- No post-visit "flag a problem" action (policy field exists).
- OQ-170: no interaction, renal or dose-range check (no licensed source). OQ-171: no approved step table. OQ-172: no review task for engine proposals. OQ-173: dependants and caregivers cannot confirm a change, so it expires. OQ-174: independent review of `confirm_care_plan_change`. OQ-176: service-role writes bypass the signed-medicine trigger.
- S25: retired GBP/USD and plan paths are still reachable in `apps/web/src/lib/paystack` and the legacy webhook. A paid order with no free lead slot opens an incident (capacity not reserved). Renewal inside an active membership is refused.
- S26 (the lifecycle after checkout) has a thin 11-check proof next to S25's 143, and no Paystack refund has run.
- Branches `s71/checkout-core` and `s73` (pricing engine, discount codes, price books) are unmerged and change the commerce surface. Check them before extending S25.

## 2. What competitors actually contain

### 2a. Consultation, async and scribe

| Competitor | What they do | Source quality |
|---|---|---|
| Teladoc | Cancellation within 24h and no-shows charged, first offence waived, exempt for some payers | Official policy page |
| MDLive | Tiered late-cancel fees by visit type and window | Official FAQ |
| Doxy.me | Browser-only, no patient account, personal room link, virtual waiting room; reviewers report lag on poor connections | Secondary |
| K Health | Structured AI intake before a clinician; reviewers report waits of hours | Secondary |
| Ro, Hims | Questionnaire plus photo, clinician review, typical reply under 24h | Company newsroom |
| Babyl Rwanda | Voice-first: phone callback, triage on basic phones; ended with the company | Press; collapse is background knowledge |
| Mobihealth (Nigeria) | App video, very low annual price (2023 article, possibly stale) | Press |
| Kangpe (Nigeria) | Verified doctors by SMS, app or web, published 10 minute response | Press, old |
| Epic MyChart / OpenNotes (US) | Signed notes released to patient immediately; withhold only for risk of physical harm | Law firm summary |
| Abridge | Consent, post-visit clinician review; April 2026 class action alleges recording without clear notice | Trade press |
| Dragon Copilot / DAX | Section-by-section review, edit, approve, sign | Vendor docs |
| Heidi, Freed, Nabla | Price benchmarks only (about USD 39 to 150 per clinician per month); language-count claims unproven | Comparison sites |

Not returned at all: Reliance, Wellahealth, Helium (video behaviour), Vezeeta, Practo, Doctoora, Amwell details, Livi, Push Doctor, Ada, Zocdoc, Tortus, Doximity scribe. No scribe vendor's offline or hallucination controls were found. No Nigerian Pidgin, Yoruba, Igbo or Hausa clinical accuracy figure exists for any Western scribe. AfriSpeech-MultiBench finds African-accented medical speech varies widely by country and that drug names (named entities) are the weak spot.

### 2b. Prescribing, titration, commerce

| Competitor | What they do | Source quality |
|---|---|---|
| NHS EPS | Prescription token with barcode, nominated pharmacy, release and return if a pharmacy cannot supply, batch repeat dispensing | Official |
| mPharma | Prescription code to pharmacy and patient phone, automated refills | Case study |
| Reliance Health | Telemedicine Rx fulfilled by own pharmacies, status push | Company page |
| Omada | Clear split between prescriber and non-prescribing coach for GLP-1 titration support | Company release |
| Cadence | Protocol-led titration with a named supervising physician | Trade press, 2021 |
| BlueStar | Clinician sets start dose and bounds; app proposes inside them; patient sees result. FDA-cleared | Trade press |
| Paystack practice | HMAC-SHA512 over raw body, dedupe on event or reference, return 200 fast, verify server-side, compare integer kobo amount and currency; reusable authorisation only from cards | Docs and guides |
| Calm | Free tier, annual anchor, auto-renewing trial | Secondary |
| Reliance HMO plans | About NGN 42K to 80K per year individual, quarterly and biannual options, may be dated | Aggregator |

**Nigerian rules found (confirm against primary text):** PCN Electronic Pharmacy Regulations 2026 (13 Feb 2026) recognise scanned and telemedicine prescriptions; a prescription is valid six months and must carry the prescriber's address, contact, registration number and signature; controlled drugs are excluded from online sale; dispensed quantity is limited to what is authorised; telemedicine prescriptions need informed consent and clear accountability. No national QR standard exists, so pharmacy acceptance of QR is partner by partner. Nigeria Tax Act 2025 exempts medical services but treatment of telemedicine and health subscriptions is contested.

## 3. Where Tarragon already matches or leads (do not rebuild)

Deterministic safety screen on written questions with no diagnosis argument; CMO-only release of protected notes; consent per encounter that only the patient answers; recording pinned off; scribe never writes to the record without a signature and the prompt forbids drug names and doses; controlled medicines are a hard stop; titration engine holds no drug name or threshold in code; signed webhook with one entitlement per order (safety case 24, proved with concurrent replay); no stored balance and no auto-renew. Several of these are stricter than the competitors found.

## 4. Gap analysis and verdicts

BUILD = fits law, scale and Part C. HARDEN = exists, needs proof or tightening. GATE = needs a named decision or licence. SKIP = banned, failed elsewhere, or no fit.

| # | Capability | Who has it | Tarragon today | Verdict | Reason |
|---|---|---|---|---|---|
| 1 | Prove every vendor path on real accounts (Zoom paid plan with dial-in, Paystack test payment and refund, Anthropic key, EAS device build) | n/a | Nothing run | **HARDEN, first** | Biggest risk in the audit; Paystack fee fields and Zoom dial-in are the two most likely to change a design |
| 2 | Honest expected response time shown to the patient, from rota and queue data | K Health lesson, Kangpe, Hims | 24 hour window for written questions; none for booking | **BUILD** | Publish only what the roster can meet (Kangpe-style 10 minute claims invite breach) |
| 3 | No-show handling that waives documented connectivity failure; phone-only join recorded | Teladoc first-offence waiver | OQ-160 open; credit rules exist | **BUILD** | Power and network failure cause many misses; a wrong no-show punishes the fallback user |
| 4 | Cancellation window by visit type | MDLive | One 2 hour rule | **BUILD small** | Short follow-ups and new workups differ; keep in versioned PROPOSED config |
| 5 | Pre-visit structured intake feeding the encounter | K Health, Ro | Safety screen and tasks; intake into room unclear | **BUILD** | Saves clinician minutes; red-flag questions first |
| 6 | Post-visit plain-language summary released only after doctor signature, "flag a problem" action | OpenNotes, Epic | Note release rules and policy field exist, flag action missing | **BUILD** | Signed only, never an AI draft; withhold reason audited |
| 7 | Link entry and waiting room that works on poor networks | Doxy.me | Zoom link plus ladder and dial-in | **HARDEN** | Dial-in answers Doxy's weak point, but only if the Zoom plan is upgraded |
| 8 | Scribe section-by-section confirmation before sign | DAX | Draft attaches to note; sign is the note's own action | **BUILD small** | Hard block until each section is confirmed |
| 9 | Own accuracy evaluation on consented Nigerian English visits, drug names scored separately | AfriSpeech evidence | 18 of 18 synthetic fixtures | **BUILD** | Vendor language claims are not evidence; CMO runs it before AI-017 |
| 10 | Speech-to-text capture | All scribes | Skipped by decision (paste or type) | **GATE** | Cost and accent risk; revisit only after item 9 and a transfer basis |
| 11 | NDPA transfer basis, processing agreement, no-training clause for the model vendor | Abridge lawsuit lesson | Not recorded in the audit | **GATE (counsel)** | Data goes to a model provider abroad; eu-west-1 residency gap already accepted |
| 12 | Pharmacy-facing prescription with minimum data (no diagnosis), status events, release and return | mPharma, NHS EPS, Reliance | PDF, QR, verify page, supply and phone desk built | **HARDEN** | Check PDF fields against PCN 2026 (address, registration number, six month validity); add status events and a "pharmacy cannot supply" return |
| 13 | Pharmacy partner acceptance of PDF and QR | NHS, mPharma | UNVERIFIED | **GATE** | Needs one real pharmacy test; no pharmacy partner active yet |
| 14 | Titration with clinician-set guardrails and patient confirm | BlueStar, Cadence | Engine, protocol sign-off, patient confirm built | **HARDEN** | Add explicit min, max and step bounds in the protocol schema if absent; CMO writes the step table; independent review of confirm path (OQ-174) |
| 15 | Interaction, renal and dose-range checks | Surescripts-class tools | None; sign screen must not imply one ran | **GATE** | Needs a licensed reference source; until then label clearly |
| 16 | Referral letter with QR verification and consent | NHS | Consent and chase date built; letter format unclear | **BUILD small** | Reuse prescription PDF and QR chain |
| 17 | Caregiver or dependant confirms a care plan change | n/a | OQ-173: expires | **GATE** | Touches Care Circle consent model; needs a decision |
| 18 | Bank transfer as a first-class checkout path with pending state | Paystack data: transfer 58 percent of volume in 2023 | Entitlement flips on verified webhook; transfer path not proven | **HARDEN** | Prove with a test-mode transfer and a delayed webhook |
| 19 | Renewal by reminder plus pay link (no auto-renew) and extension inside the last days | Calm lesson | 7 day reminder built (in-app only); renewal refused while active | **BUILD** | Extend, never stack; reminder also by email |
| 20 | Quarterly or biannual instalments | Reliance HMO | Single NGN 100,000 annual item | **GATE** | Founder pricing decision; must not become a stored balance (INV-09) or look like insurance |
| 21 | Receipt with explicit VAT line (exempt or charged), legal entity and TIN | Nigeria Tax Act 2025 | Not confirmed | **GATE (tax adviser)** | Written position needed first |
| 22 | Refunds to original channel, negative ledger entry, never a credit | Paystack API | S26 state machine, thin proof, no live refund | **HARDEN** | Expand proof; run a test-mode refund |
| 23 | Remove retired GBP/USD, plan and Stripe-era paths | n/a | Reachable in code | **HARDEN** | Row count first, then a removal session (OQ-173) |
| 24 | Reserve lead capacity at order time | n/a | Incident opened when paid with no slot | **BUILD** | A paid member with no clinician is a trust failure |
| 25 | Controlled-drug list as a real lookup | PCN rules | Two illustrative copies (OQ-175) | **HARDEN** | One list, sourced, loaded as config |
| 26 | Own pharmacies, delivery, stored wallet, auto-renew, WhatsApp or USSD prescription delivery, autonomous dose change, online sale of controlled drugs | Reliance, Hims, M-TIBA | Removed or banned | **SKIP** | Founder decisions, INV-09, PCN exclusion |

## 5. The best build

The strongest product is the one that is **safe to switch on and honest about its limits**, not the one with the most features. Competitors win on speed (Hims, Kangpe) and on clinician workload (scribes). Tarragon wins on safety rules they lack. So:

1. **Prove before adding.** Items 1, 13, 18, 22 are cheap, and any one of them failing changes a design.
2. **Make waiting honest.** Items 2, 3 and 5: show real expected response times, never penalise infrastructure failure, collect intake once.
3. **Release only what a doctor signed.** Items 6 and 8.
4. **Keep prescribing narrow and bounded.** Items 12, 14, 15, 25: clinician-set bounds, patient confirm, minimum data to the pharmacy, controlled drugs refused.
5. **Make money boring.** Items 19, 22, 23, 24: one price, pay-link renewal, refunds that mirror payments, no stored value.

## 6. Build plan

Session labels use the S21 to S25 section number plus a letter. Each follows the standing rules: start with a live check of the real function definitions, PROPOSED values in versioned config, integer kobo, English only (D-14), no em dashes, "your care team" in patient copy, a BEGIN/ROLLBACK proof with a sabotage step registered in `ci.manifest`, `/code-review high` before the PR, new RLS tests for any new table.

### Phase 0: verify and unblock (no new features)
**S2x-0, 1 to 2 days, mostly founder and account owner**
- Query the production ledger against local files for S22c, S22d, S23b, S23c, S23d, S24, S24b, S21g, S21h. Pin any missing application to its filename version. Rebase onto current `origin/main-dev`.
- Founder actions: upgrade Zoom to a plan with Audio Conferencing and Nigerian numbers (OQ-131); set `ANTHROPIC_API_KEY`; run one Paystack test-mode payment, a dashboard replay and a test-mode refund; produce an EAS dev build.
- Output: a one page "what actually ran" table replacing the UNVERIFIED column in section 1.
- Exit: every UNVERIFIED cell is either a dated pass or a filed OQ.

### Phase 1: S25 commerce hardening (first, because every paid path depends on it)
**S25h, about 1 week**
- Paystack field-name fixes from the real test payment (fee pass-through, `requested_amount`).
- Prove bank transfer and delayed-webhook pending state (item 18).
- Reserve lead capacity at order creation (item 24).
- Renewal extension and email reminder with pay link (item 19).
- Expand the S26 proof and run a refund (item 22).
- Read `s71/checkout-core` and `s73` first; merge, absorb or close them so there is one commerce surface.
- Removal session for retired GBP/USD and plan paths, after a live row count (item 23).
- Tests: safety case 24 re-run against the real webhook shape; replayed, out-of-order and wrong-amount webhooks.
- Exit: `v5_checkout` can be switched on by the superadmin on the documented order (merge, test payment, replay, switch).

### Phase 2: S21 consultation reliability
**S21h2, about 1 week**
- Record phone-only joins (OQ-160) using Zoom dial-in presence; waive no-show on documented connectivity failure; log the reason.
- Visit-type cancellation windows in versioned config (item 4).
- Expected response time on the Care tab computed from rota and queue, with a floor so it is never optimistic (item 2).
- Pre-visit intake carried into the encounter (item 5); Care tab language and sex filters.
- "Flag a problem" within `flagWindowDays`.
- Mobile room and Zoom SDK run on real devices (from Phase 0).
- Exit: a full booked visit completes on a real Zoom account in video, audio-only and dial-in modes.

### Phase 3: S22 written questions and notes
**S22h, 3 to 4 days**
- Plain-language visit summary released only on signature, with an audited withhold reason (item 6).
- Click-through of withdraw screens and renamed routes; mobile photo queue on a device.
- Counsel answers on NDPA correction deadlines and MDCN text-only limits (OQ-153) recorded; under-18 guardian rule (OQ-154) decided.

### Phase 4: S23 scribe go-live
**S23h, about 4 days plus the CMO's time**
- Apply S23b, c, d; redeploy `scribe-draft`; CMO approves prompt v1.
- Section-by-section confirm gate before sign (item 8).
- CMO runs the evaluation on consented real visits, scoring drug-name errors separately (item 9). Do not cherry-pick runs.
- Counsel: transfer basis, processing agreement, no-training clause (item 11).
- Switch AI-017 on only after a recorded pass. Speech-to-text stays gated (item 10).

### Phase 5: S24 prescribing and titration
**S24h, about 1.5 weeks plus the CMO's time**
- Verify S24 and S24b applied. Independent review of `confirm_care_plan_change` (OQ-174); service-role code-scan test (OQ-176).
- Prescription PDF fields against PCN 2026; minimum data to the pharmacy; status events; "cannot supply" return (item 12).
- One controlled-medicine list as sourced config (item 25).
- Protocol schema carries min, max and step bounds; CMO writes and approves `htn_hearts_ng` (OQ-171). The build session writes no clinical content.
- Engine proposals create a review task once the CMO signs the task type (OQ-172).
- Referral letter with QR (item 16).
- One real pharmacy tests PDF and QR (item 13).
- Sign screen keeps its "no interaction check ran" wording until item 15 has a licensed source.
- Tests: signed-before-send, hard stop on controlled medicines, expiry of unconfirmed changes, patient decline.

### Phase 6: gated decisions (no code until decided)
Caregiver confirmation (item 17), instalments (item 20), VAT receipt line (item 21), interaction source (item 15), speech-to-text (item 10).

### Order and dependencies
Phase 0 then Phase 1. Phases 2, 3 and 5 can run in parallel after Phase 0 (different files), except the shared `clinician_has_patient_access` clause (OQ-159) which lands last. Phase 4 waits for the Anthropic key and the CMO's evaluation window. The S37 go-live guard stays off until a hypertension protocol and a triage rule set are approved, and that is the real launch gate for S21, S24 and clinical task flows.

## 7. Decisions needed

| # | Decision | Owner | Recommendation |
|---|---|---|---|
| D1 | Upgrade the Zoom plan with Audio Conferencing | Founder | Yes; the phone fallback is the product's answer to poor networks |
| D2 | Waive no-show fees for documented connectivity failure | Founder | Yes |
| D3 | Publish expected response times | Founder | Yes, computed, never a fixed promise |
| D4 | Quarterly or biannual instalments | Founder | Defer; not a stored balance, never described as insurance |
| D5 | Written VAT position on the membership and receipts | Tax adviser | Required before launch |
| D6 | Model vendor data terms (transfer basis, no training) | Counsel and DPO | Required before AI-017 |
| D7 | Approve the `htn_hearts_ng` step table and bounds | CMO | Required before titration proposals appear |
| D8 | Caregiver confirmation of care plan changes | CMO and DPO | Defer |
| D9 | Source for interaction and dose-range checks | CMO | Pick a licensed reference or keep the clear label |

## 8. Risks

1. Everything is unproven on real vendor accounts. The fee pass-through behaviour and Zoom dial-in are the likeliest to change a design.
2. Three go-live gates sit off by design (`v5_checkout`, AI-017, `clinical_operations_enabled`). Switching one on without its prerequisites is the main way to cause harm.
3. A published response time the roster cannot meet creates liability. Compute it, add margin, review monthly.
4. The scribe handles Nigerian accents and drug names with no independent evidence. The signature is the control; the evaluation is the gate.
5. Parallel branches (`s71`, `s73`) and reused OQ numbers can produce a second commerce surface or wrong citations.
6. Regulatory text is only secondary-sourced (PCN 2026, NDPA, VAT). Counsel confirms before launch.

## 9. Not covered

Competitor facts for Reliance, Wellahealth, Helium (video), Vezeeta, Practo, Doctoora, Livi, Ada, Tortus and Doximity were not found. Fetch the vendor pages and the PCN primary text as a follow-up before turning any UNVERIFIED row into a requirement.
