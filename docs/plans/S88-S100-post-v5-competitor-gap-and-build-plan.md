# S88 to S100: post-v5 competitor gap review and build plan

Date: 2026-10-07. Branch context: `s38/outcome-snapshots-analytics`. Status: DRAFT for founder decision. Nothing here is approved, signed or started.

## 0. What this is, and what it is not

- **S88 to S100 do not exist in the repo.** The v5 session set ends at S87 (`docs/v5-sessions/00-INDEX.md`, "Total sessions: 90" counts S01b, S01c, S01d). On 2026-10-07 the founder chose: define a post-v5 roadmap and compare it against competitors. These 13 sessions are therefore **proposed**, not extracted.
- **Prerequisites are unmet.** `docs/BUILD-PROGRESS.md` logs work only to about S37. The S40 Stage 1 gate has not passed. S38 to S87 are mostly unbuilt. Treat S88 to S100 as the plan for what comes after v5, and as an input for re-ordering v5 itself where a competitor finding changes priorities.
- **Evidence quality.** Competitor facts come from three read-only research passes today (search summaries only, no app installed, no primary pages for most). Outcome and scale numbers are vendor or press claims. Items from model background knowledge are marked (bk). TechCabal's "State of Healthtech in Nigeria 2026" report could not be read (HTTP 403) and is the highest-value follow-up. Not verified at all: Ro, Ada, K Health, Lark, Kaia, Dario, Practo, Kangpe, Zuri, Curacel, Moni, Hygeia-type HMO apps, Lifestores.
- **Repo facts** come from docs and greps, not the live database. Verify live definitions at the start of each session (CLAUDE.md is emphatic on this).

## 1. What mature competitors actually contain (full-product view)

### 1a. Global chronic and virtual care (2026)

| Company | Full product surface | Business model | What matters for Tarragon |
|---|---|---|---|
| Omada | Diabetes, hypertension, GLP-1 track, cardiometabolic bundles, new cholesterol track; app + devices + care team | B2B employer/plan. Q2 2026 revenue $88M, ~1.1M members (press) | Multi-condition bundles and GLP-1 are the growth driver |
| Teladoc/Livongo | Chronic care 1.27M enrolled (+14%), bundles; BetterHelp down 11.6% | Mixed; revenue falling 4% overall | Bundled B2B chronic care grows, consumer cash-pay therapy shrinks |
| Virta | Low-carb + coaching + RPM + GLP-1 prescribing | B2B, fees at risk against outcomes, ~$2.4-2.8K/member/yr (Sacra, possibly dated) | Outcome-linked contracts. Collides with invariant I8 (no capitation) only if structured as capitation; needs a ruling |
| Hinge Health | MSK care, AI assistant "Robin" (claimed 47% more members at flat care-team cost) | B2B, 2026 revenue guide ~$800M | AI to cut clinician cost per member is the proven lever |
| Sword | Digital PT, AI therapist + clinicians, wearable | B2B, $4B valuation (press) | Mental health "AI therapist" collides with Part C; not for Tarragon |
| Function Health | 100+ biomarkers, repeat panel at ~6 months, clinician notes, AI coach, $365/yr | Consumer membership; MRI add-on | Directly the model for S46b Health Report and annual check |
| Hims/Ro/Noom | Branded GLP-1 via Novo self-pay; Noom bought a compounding pharmacy | Consumer cash-pay | Drug supply is the moat; not reachable in Nigeria now |
| One Medical | Free health AI (March 2026), $29 message / $49 video visits | Membership + pay-per-visit | Same shape as Tarragon's Membership + per-consult pricing |
| WHOOP/Oura | Wearables moving into lab panels ($299) and BP insights (WHOOP got an FDA warning letter) | Consumer | Do not ship wearable-derived BP claims |
| Included Health | Navigation + virtual care + AI "Dot" built on claims/benefits data; integrates Hinge/Sword/Virta | B2B | Navigation is becoming an AI layer, not a staffed desk |
| Abridge/Nabla/Ambience | Scribe moving upstream to coding, documentation integrity, EHR actions | Health systems | Clinician copilot beyond notes is the next step |
| Ping An Good Doctor | Online + in-hospital + at-home + corporate network; insurer enablement RMB 1.58B | Insurer-linked | Payer enablement and at-home are real revenue |
| Eka Care (India) | Doctor EMR (25K doctors) + patient record app + national ABDM exchange + multilingual scribe | Closest emerging-market analogue | Owns the patient's portable record, sits on national rails |
| Doctronic (Utah) | Pilot of AI autonomously renewing 192 chronic drugs; medical board objected | Pilot | Reinforces C.1: no autonomous prescribing |

### 1b. Nigeria and Africa

| Company | Full product | Evidence | Lesson |
|---|---|---|---|
| Reliance Health | HMO with own platform: telemedicine, drugs, labs, provider network; plans ~₦3.5K to ~₦148.5K; claims 200K+ lives, 600 corporates | Press/aggregator; $40M 2022 | Payer + bundled care is the scaled model |
| Helium Health | Hospital EMR, billing, analytics; HeliumCredit facility lending; claims 500-1,000+ facilities | Press, figures inconsistent | Hospital-side layer is the moat. A different business from Tarragon |
| Clafiya | CHW home primary care reached by USSD | Press, small scale (3K patients in 2023) | Field layer works but is small; USSD is dropped for Tarragon |
| WellaHealth | Low-price plans, chronic care mgmt, pharmacy network | Thin | Closest local analogue to Tarragon's chronic pricing |
| Healthtracka | At-home sample collection, results 1-3 days | Press | Tarragon already has home collection |
| mPharma | Cut multi-country ops (2023 layoffs); now community pharmacies with consults/diagnostics | Press | Partner/franchise survived, owned ops did not |
| Doctoora/mDoc | Prepaid membership + community hospitals + telemedicine; chronic support via SMS/voice/video | Aggregator | Membership + chronic is validated |
| M-TIBA/CarePay | Health wallet + claims rails; consumer wallet closed March 2026, CEO stepped down | Press, reasons unknown | Consumer wallets fail; payer/admin rails last. Matches the Platform Credit removal |
| Babyl (Babylon Rwanda) | 2M enrolled, halted 2023, reportedly ceased | Press + 2026 JMIR study | Scaled ahead of financing and health-system integration |
| Medsaf, 54gene | Shut 2024 and 2023 | Press | Supply-chain float and unrecovered hospital debt kill; governance churn |
| Zipline, LifeBank, ERA | Drone logistics, blood/oxygen, ambulance dispatch | Press/vendor | Partner integrations, not builds |
| Public sector | Health Sector Renewal Initiative; BHCPF ~₦339B disbursed (gov/press); 2026 push on biometric verification and +5M insured | Gov/press | Main 2026 funding flow is public insurance and primary care |

## 2. Where Tarragon already matches or leads (do not rebuild)

Hypertension and diabetes pathways, symptom checker (Track A), AI assistant, medicines and adherence, labs with home collection, consultations, Health Report and annual check (Function-style), care circle, clinician console with task queue, rota, earnings and AI scribe (clinician only), payer / provider-org / NGO consoles (dormant), FHIR import, sponsor / Care Voucher model, hybrid clinician network, go-live guards, governed AI registry. None of the competitors above combines this with Nigerian-specific safety rules (INV-01 deterministic triage first, INV-04 sensitive-positive handling).

## 3. Gap analysis: competitor capability vs Tarragon, with a fit verdict

Verdicts: BUILD (fits scale, law and Part C), PARTNER (integrate, do not build), GATE (build only after a named decision or licence), SKIP (banned, failed elsewhere, or no fit).

| # | Capability | Who has it | Tarragon today | Verdict | Reason |
|---|---|---|---|---|---|
| 1 | Clinician AI copilot beyond scribe (visit brief, order and task drafts, message-reply drafts, documentation checks) | Abridge, Nabla, Ambience, Doctolib, Hinge Robin | Scribe (AI-017, off), case briefs | **BUILD** | Cheapest lever on the doctor-capacity constraint; every output signed (INV-11) |
| 2 | Proactive risk-based population outreach and care-gap closure | Omada, Hinge, Lark | Reminders, risk scores, Module 22 planned | **BUILD** | Low cost, no new regulation, feeds payer and cohort value |
| 3 | Payer/HMO rails: eligibility, pre-authorisation-lite, claims-lite, settlement | Reliance, Wellahealth, Included Health, M-TIBA, Ping An | Payer platform built, dormant, no counterparty | **BUILD (activate)** | Where scale sits (Teladoc, Reliance). Capitation banned (I8), so claims-lite only |
| 4 | Employer, NGO and public-programme cohorts with outcome reporting | Omada, Virta, Personify | NGO cohort and institution console dormant | **BUILD (activate)** | Funding strategy already ranks this; BHCPF/insurance expansion is the 2026 money |
| 5 | In-person visit layer (nurse BP check, injections, wound care, post-discharge visit) and ambulance hand-off | Clafiya, Ping An, ERA | Home sample collection, home-visit partners dormant | **PARTNER** | Reuse partner machinery. Not a virtual ward (removed) and not medicine delivery (removed) |
| 6 | Second opinion / expert review | Teladoc, others (bk) | None | **GATE** | Adjacent to referral pipeline. Needs explicit founder ask (matching-engine guardrail) |
| 7 | Weight and metabolic programme (lifestyle-first, GLP-1 readiness) | Omada, Virta, Noom, Hims | Low-carb T2D protocol (guard OFF) | **GATE** | Drug supply, price and CMO protocol. Lifestyle part is cheap; no automated dosing |
| 8 | Digital MSK / back-pain programme | Hinge, Sword, Kaia | Module 14 planned | **BUILD later** | Medium fit; content-heavy, employers not yet paying |
| 9 | Interoperability: FHIR export, hospital connector, record exchange | Eka Care, Helium | FHIR import, passport | **BUILD (connector)** | Own the portable record; do not build a hospital EMR (Helium is a different business) |
| 10 | Premium diagnostics / longevity panels | Function, WHOOP, Oura | Annual check, Health Report | **BUILD small** | Extra clinician-set panels inside Membership; imaging and genetics banned (Part C) |
| 11 | Developer / partner platform | Doctolib, Eka | INTEGRATIONS_API, sandbox key | **BUILD later** | Low priority until partners live; no composite partner score |
| 12 | Consumer health wallet | M-TIBA (closed) | Removed | **SKIP** | Failed in Kenya; banned by INV-09 |
| 13 | Provider credit / working-capital lending | HeliumCredit | None | **SKIP** | Babyl/Medsaf lesson; wrong risk for a solo-founder platform |
| 14 | Hospital-at-home | US Medicare waiver to 2030 | Virtual ward removed | **SKIP** | 24/7 nurse cover; founder removed virtual ward |
| 15 | Therapist matching / AI therapist | BetterHelp, Sword | Removed (C.1, C.2) | **SKIP** | Banned; BetterHelp shrinking |
| 16 | Autonomous AI prescribing | Doctronic pilot | None | **SKIP** | C.1; contested even in Utah |
| 17 | Hardware kit bundles | Omada, Livongo | Shelved 2026-08-02 | **SKIP** | NAFDAC representative burden; BYO device |
| 18 | USSD / feature-phone | Clafiya | Dropped 2026-10-07 | **SKIP** | Founder decision; revisit only on an explicit ask |
| 19 | Pharmacy delivery | Hims, JD Health | Removed | **SKIP** | Founder decision (collection only) |
| 20 | RPM reimbursement codes (US CPT) | US only | n/a | **SKIP** | No Nigerian code. HMO reimbursement analogue is handled in item 3 |

## 4. The best build: principles

1. **Make what exists real before adding surface.** Babyl, Medsaf and mPharma failed on integration, float and over-reach, not missing features. Tarragon has about 40 sessions of unproven, unapplied or dormant work. S88 is hardening and activation readiness.
2. **Spend on doctor capacity, not on new clinical surface.** The proven 2026 lever is AI and automation reducing care-team cost per member (Hinge claim, vendor). Doctor review and outreach come before new programmes.
3. **Scale through payers and cohorts, not consumer cash-pay.** Bundled B2B chronic care grows (Teladoc, Omada); consumer cash-pay therapy and wallets shrink or die. The payer, employer and NGO consoles already exist dormant; activation needs a real signed counterparty.
4. **Partner for the physical world.** Nurse visits, ambulances, pharmacies: integrate, never own (mPharma lesson, no-owned-clinics rule).
5. **Respect Part C and the guardrails.** Every session below states the collision check. Nothing in S88 to S100 writes a clinical rule, signs a protocol, or flips a go-live guard without the CMO or founder.
6. **Everything ships behind a guard** and has a deterministic fallback; no feature may require a notification send to succeed.

## 5. Proposed sessions S88 to S100

Format matches existing session prompts: one session = one section, ends by logging to `docs/BUILD-PROGRESS.md`. "CMO to sign" items follow the chat-signing method (R6 in the S46-S50 plan): full text shown, founder approves each, agent never signs unprompted.

### Tier A: must build (do these first)

**S88. Release readiness and real-device hardening** (no competitor feature; prerequisite)
- Scope: close the recurring-debt list from section 7: apply and reconcile pending migrations in order, redeploy drifted edge functions and delete `whatsapp-webhook` / `send-support-reply`, add Sentry to Edge Functions and mobile, run the native device lab on the 4 GB floor phone (Maestro flows, Health Connect and HealthKit, mobile consultation room, exact alarms), finish offline mirror for care plan, emergency card, tasks and released results, fix the three missing alert-escalation template keys, wire the remaining go-live guards (`prescribing_enabled`, `payouts_enabled`, `lab_booking_enabled`, `public_signup_enabled`, `on_call_cover_ok`), finish INV-10/12 staff read tie on the 8 remaining clinical tables, `platform_modules` vs `go_live_guards` reconciliation.
- Needs: founder go-ahead for native build (DG-6), S40 gate waiver or completion.
- Acceptance: release-integrity job green with 0 loss-risk findings; device-lab report with measured numbers; zero deployed functions without source.
- Competitor driver: Babyl, Medsaf, mPharma (integration and over-reach failures).

**S89. Clinician AI copilot** (Abridge, Nabla, Ambience, Hinge Robin, Doctolib)
- Scope: pre-visit brief refresh, proposed task and order drafts, patient-message reply drafts, documentation completeness checks, handoff summaries between clinicians. Each is a draft the clinician edits and signs. No coding or billing automation yet.
- Reuses: AI-017 scribe path, `attach_scribe_draft_to_note`, case briefs, `runGovernedAi()`.
- Guardrails: each call site registered in `ai_systems`; `runtime_governed` only with a real evaluation run (never seeded); kill switch; paste-or-type input, no speech vendor (OQ-96 stays open); INV-01 (no model in triage), INV-11.
- Metric to prove: minutes per review and per message with the copilot vs without, measured in shadow mode before any claim is made.
- CMO to sign: acceptable-use wording, evaluation set, prompt approvals.

**S90. Population outreach and care-gap engine** (Omada, Hinge, Lark)
- Scope: configurable rules over existing signals (missed readings, overdue review, no labs in 12 months, rising BP trend, adherence lapse) producing outreach queues for coordinators and clinicians, in-app/push/email nudges via `patient_reminder_channel()`, closure tracking, and an institution-console view of gap counts.
- Guardrails: INV-07 (no condition or reading in a notification), INV-12 ties, aggregate-only for institutions (I9), no employer visibility of reproductive or mental-health data (C.1), small-cell suppression.
- CMO to sign: gap definitions and thresholds (config, PROPOSED until signed).

**S91. Payer and HMO activation: eligibility, pre-authorisation-lite, claims-lite, settlement** (Reliance, WellaHealth, Included Health, Ping An enablement)
- Scope: take the dormant `payer_platform` to a pilot-ready state with one real HMO: member eligibility check, benefit rules as data, pre-authorisation request/approve for labs and consultations, claim creation from completed services, settlement report, HMO-visible aggregate outcomes. `set_platform_module('payer_platform', true, ...)` is a founder act, not an agent act.
- Guardrails: no capitation (I8), no stored balance (INV-09), money in kobo, partner sees no patient identity beyond the covered member, RLS proof per table.
- Blocker: a signed counterparty and counsel review. Without it the session ends at "pilot-ready, off".

**S92. Employer, NGO and public-programme cohorts** (Omada, Virta, Personify; BHCPF and insurance expansion)
- Scope: activate `ngo_funded_cohort`, employer pools (11.4) and a government-programme enrolment path (eligibility lists, biometric or ID verification hook where lawful), cohort dashboards with outcome reporting (BP control rate, HbA1c movement, engagement), funding_programme invitations, sponsor-paid entitlements.
- Decision needed: outcome-linked pricing (Virta style, "fees at risk") is not capitation, but `FULL_SPECIFICATION_V4` lists fee-at-risk contracts; the founder must rule on it before any contract template ships.
- Guardrails: aggregate only, CAF (Community Access Fund) stays off until the traction decision.

### Tier B: should build (after Tier A pilot data)

**S93. Field-care and emergency partner layer** (Clafiya, Healthtracka, Ping An at-home, ERA)
- Scope: nurse-visit service type through contracted partners (BP check, injections, wound care, post-discharge visit), reusing home-sample-collection routing, partner billing and SLA data; ambulance dispatch hand-off by partner directory + one-tap call and event, no dispatch built; post-discharge follow-up built as an ordinary condition pathway, explicitly not a virtual ward.
- Collision check: virtual ward and pharmacy delivery are removed (C.2); this session adds neither.
- Blocker: a contracted nurse-visit partner and an ambulance partner.

**S95. Weight and metabolic programme, lifestyle-first** (Omada, Virta, Noom)
- Scope: weight pathway on the existing pathway engine, nutrition and activity (S48 to S50) assembled into a 12-week programme, GLP-1 **readiness and monitoring protocol** only (eligibility, contraindication screen, lab monitoring, supervised titration proposals signed by a clinician).
- Collision check: automated dose changes banned (C.1); every drug decision is a signed clinician act; no compounded drugs; supply only through partner pharmacies for collection.
- Gate: CMO-signed protocol, a licensed prescriber rota, a confirmed supply route and price. Guard ships OFF.

**S97. Interoperability connector and portable record** (Eka Care, Helium)
- Scope: FHIR export and outbound partner connector (patient-consented, access-category scoped), hospital-partner result import, a "my record travels with me" share flow (time-limited, audited), mapping to NHIA/state registries as they publish specs.
- Guardrails: reproductive_health category never exported without explicit category consent; no EMR product.

### Tier C: gated or later

**S94. Second opinion and expert review.** Gate: explicit founder ask. Product is a named-case consultation with a chosen specialist at a fixed fee, **no ranking or matching engine** (CLAUDE.md guardrail). Diaspora specialists are a supply option; indemnity and MDCN position need counsel.

**S96. Digital MSK and back-pain programme** (Hinge, Sword, Kaia). Module 14 extension: exercise video content, pain tracking, clinician-reviewed plans, safety rules for red flags. Licensing of content and a physiotherapist reviewer are the blockers.

**S98. Premium diagnostics panels** (Function, WHOOP). Clinician-set add-on panels and repeat-panel scheduling inside the Membership; no imaging, genetic or "biological age" outputs (Part C, R4). Reuse Health Report.

**S99. Developer and partner platform.** Public docs, scoped keys, webhooks, sandbox, partner onboarding. No composite partner score or patient-facing ranking.

### Tier D: gate

**S100. Stage 2 gate** (no features)
- Run the full test matrix and the clinical-safety cases for everything in S41 to S99, write `docs/STAGE-2-SIGNOFF.md`, outcome proof from real cohorts (not vendor claims), regulatory map refresh (MDCN, NAFDAC, NDPA, NHIA), reconcile OPEN-QUESTIONS, then and only then record "Stage 2 complete".

## 6. Sequencing and dependencies

```
S40 gate (or waiver)
  -> S41..S87 (v5)
      -> S88 hardening
          -> S89 copilot ---------> S90 outreach
          -> S91 payer activation --\
          -> S92 cohorts -----------+-> S93 field care (needs S91/S92 demand)
                                     -> S95 weight (needs S89 capacity)
          S97 interop (parallel after S88)
          S94, S96, S98, S99 (gated, any order)
  -> S100 gate
```

Parallelisation: S89 and S91 are independent. S97 can run beside S90. Keep stacked a/b PRs for any session over about 1,500 lines, as in the S46 to S50 plan.

Suggested release: **R5a** = S88 to S92 (hardening, capacity, scale channel); **R5b** = S93, S95, S97; **R6** = S94, S96, S98, S99; **S100** closes.

## 7. Technical and governance prerequisites (from the repo backlog scan)

- Migrations are applied by hand; drift counts were at least 119 live rows without files and 107 files without live rows. `list_migrations` vs files must be run before every apply.
- Edge function drift (`send-pending-notifications`, `process-events`) repeatedly deferred; removed WhatsApp functions still deployed.
- No real-device run for HealthKit, Health Connect, the mobile consultation room, exact alarms or the Maestro medicines flow. Native build needs DG-6 go-ahead.
- Staff reads direct on 8 clinical tables; `is_org_staff()` still gives org-wide read of mental-health tables.
- Single-person controls: the founder is both admin and CMO; attestations and credential separation are weak (OQ-182, OQ-183, OQ-186).
- PROPOSED config awaiting CMO signature: triage rule set, consultation policy, task types. The symptom grader runs in shadow mode until signed.
- Data residency contradiction (af-south-1 vs eu-west-1) still open in the gap analysis.
- Language: `plans/S41-S45-build-plan.md` says English only is now on main-dev; spec D.2 still says English and Pidgin. Reconcile before any language-dependent session.

## 8. Decisions needed from the founder

| # | Decision | Recommended | Blocks |
|---|---|---|---|
| F1 | Approve this tiering, or reorder (for example, pull S91 ahead if an HMO is already in conversation) | Approve as drafted | All |
| F2 | Record an S40 waiver, or finish S40 first | Finish S40; waiver only for dormant, flag-off work | S88 onward |
| F3 | Is outcome-linked ("fee at risk") pricing allowed given I8? | Allow outcome-linked reporting; forbid capitation and risk transfer | S91, S92 |
| F4 | Name the first real HMO / employer / NGO counterparty | Pick one, build to its needs | S91, S92 |
| F5 | Contracted nurse-visit and ambulance partners | Partner list first, build after | S93 |
| F6 | Second opinion: lift the matching-engine guardrail for a no-ranking, named-specialist product? | Defer until volume | S94 |
| F7 | GLP-1 stance: readiness and monitoring only, no sourcing by Tarragon? | Yes | S95 |
| F8 | Native build go-ahead (DG-6) and a budget for the 4 GB device lab | Yes | S88 |
| F9 | Fund a primary read of the TechCabal 2026 healthtech report and Reliance's pricing pages | Yes, before S91 | S91 |

## 9. Risks

1. **Plan on top of an unfinished base.** Mitigation: S88 first, gate S100.
2. **Counterparty risk.** Payer and cohort sessions deliver nothing without a signed partner. Mitigation: each ends in "pilot-ready, off" if none exists.
3. **Vendor-claim reliance.** Hinge's 47% and Omada's weight figures are vendor claims. Mitigation: S89 and S90 measure their own baseline in shadow mode before any public claim.
4. **Regulatory.** NAFDAC (decision support, devices), MDCN (fee-sharing, supervised prescribing), NDPA (data transfer to partners), insurance law for claims-lite. Counsel review is listed per session, not assumed.
5. **Solo-founder bandwidth.** Thirteen sessions, many needing signatures. Mitigation: Tier A is five sessions; Tiers C and D can slip without harm.

## 10. Sources

Repo: `docs/BUILD-SPEC-v5.md` (Part C, D, E), `docs/v5-sessions/00-INDEX.md`, `00-FOUNDER-DECISIONS.md`, `docs/OPEN-QUESTIONS.md`, `docs/BUILD-PROGRESS.md`, `docs/PARTNER_ECOSYSTEM_SPEC.md`, `docs/CLINICAL_NETWORK_SPEC.md`, `docs/MASTER_ARCHITECTURE_BLUEPRINT_GAP_ANALYSIS.md`, `docs/FUNDING_STRATEGY.md`, `docs/research/S46-S50-*`, `S51-S55-*`, `docs/design/S55-S60-build-plan.md`.
Web (2026-10-07, search summaries): MarketBeat (Omada, Teladoc Q2 2026), Sacra (Virta, Function, Maven), Fierce Healthcare (Hinge, Included Health), MobiHealthNews (Sword), BusinessWire (WHOOP), TechRepublic (One Medical AI), Drug Topics and STAT (Doctronic Utah), Webull (Ping An, JD Health H1 2026), MedTech Spectrum (Eka Care), TechCrunch (Reliance $40M), TechCabal (Helium Credit, mPharma, Zipline, 54gene, M-TIBA refund), launchbaseafrica (Medsaf), JMIR 2026 (Babyl lessons), FMINO and NAN (BHCPF, Health Sector Renewal Initiative).
