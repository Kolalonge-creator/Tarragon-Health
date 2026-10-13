# S41 to S45 build plan: Modules 1, 2 and 3 (first half)

Drafted 2026-10-07. Inputs: `docs/BUILD-SPEC-v5.md` lines 756-955, `docs/v5-sessions/S41` to `S45`, a repo audit of what already exists, and fresh competitor research for each module.

**Evidence caveat.** The competitor research is mostly secondary (search snippets, press, vendor pages) plus background knowledge. No app was installed, no store reviews or Reddit threads were read. Treat every competitor claim, price and complaint theme as "re-verify before using in a decision". The repo audit spot-checked migration headers, not every body. Nothing here is legal or clinical advice; items for counsel and the CMO are listed in section 6.

## Founder decisions recorded 2026-10-07 (override anything below that disagrees)

- **USSD (1.7): not built.** If it ever returns, verification only, no new vendor now. Closes X1.
- **Consent matrix (1.13): build fully end to end** (schema, RLS, privacy centre, mobile and web, withdrawal, export tie-in, tests). Wording still needs counsel (X5).
- **Biomarker trends (2.5) and FHIR export (2.10): build.**
- **Packaged screening with a bundled video consult (3.7):** dropped from S45, covered by the S25 membership plan. HPV DNA SKU and package naming (X8) still open.
- **Yearly Health Report:** study done, see `docs/research/health-report-study.md`; build in S46 with the comparison step.
- **Hepatitis B and C, and handover at 18:** answered "yes", read as the spec rules winning (HCV annual, HBsAg stops after positive anti-HBs; guardian loses access at 18 unless the young person consents). Confirm this reading. Closes X2 and X4.
- **CVD instrument and immunisation schedule:** research and sign-off material in `docs/plans/S41-S45-cmo-signoff-pack.md`. Recommendation is the WHO 2019 charts (West Africa). Schedule cannot be signed yet.

### Confirmed later the same day
- **CVD instrument: WHO 2019 charts (Western sub-Saharan Africa).** Still needs CMO signature and the region check.
- **HPV: two doses (founder).** Note: the only evidence for single-dose HPV (Oct 2023 introduction, ages 9 to 14) is secondary, and it conflicts with this. The dose count is held in versioned config so it can change without a release. The CMO signs the final value after seeing NPHCDA's current document.
- **Typhoid: not in the schedule.**
- **Hepatitis B and C, and handover at 18: spec rules win** (confirmed). **USSD: dropped** (confirmed). **Consent matrix: build the full flow; wording waits for counsel.**

### Update 2026-10-07 (later): language and gate
- **English only is now on main-dev (PR 984 removed Pidgin, Yoruba, Hausa, Igbo).** Everywhere this plan says "English and Pidgin" or "en and pcm", read English only. Pidgin copy and its native-reviewer step drop out; X9 is closed. The report study's Pidgin lines no longer apply.
- **S40 gate status:** not cleared. See section 0.

## 0. Gate and ordering

- **S40 gate is not met.** `docs/BUILD-PROGRESS.md` does not start with "Stage 1 complete", so S41 to S45 will each refuse to start. Either finish S40 or the founder records an explicit waiver.
- The audit says S27 (partner portal, item-level release rules) and S39 have no progress entry. Memory says S39 shipped (PR #986). Confirm against `git log` before relying on either claim.
- **S45 covers functions 3.1 to 3.10 only.** 3.11 to 3.16 (pathway suppression, hep B logic, results explanation, abnormal review, yearly Health Report, disclaimers) belong to S46, which was not in scope. Several of the hardest items sit there, so S46 should follow directly.
- Dependencies: S41 then S42. S43 then S44. S45 stands alone. S41/S43/S45 can run in parallel as separate worktrees. S42 and S44 each close their module and must run the module's full acceptance list.

Recommended order: **S41, S43, S45 in parallel, then S42, S44, then S46.** Reason: S42 (consent) wants the final shape of Passport and screening data types, and S44 (FHIR) wants S43's tables.

## 1. Cross-cutting decisions needed before any session starts

These block or distort several sessions. Put them in `docs/OPEN-QUESTIONS.md` and get answers first.

| # | Decision | Owner | Blocks |
|---|---|---|---|
| X1 | USSD vs INV-08. Spec 1.7 allows USSD, INV-08 says SMS only for auth codes. Is an aggregator USSD session an allowed exception? Also confirm cost, licensing and PIN assurance with Termii and the MNOs. | Founder | S41 (1.7) |
| X2 | Hep B / C rule conflict. Live (founder 2026-08-21) never re-sells HBsAg and HCV Ab once on file. Spec 3.12 says HIV and HCV stay annual and HBsAg stops only after positive anti-HBs. | Founder + CMO | S46, and S45 package contents |
| X3 | Instrument of record for cardiovascular risk: the in-repo AFRO approximation, SCORE2 (ML service), or the WHO 2019 charts. Research suggests the 2019 charts supersede WHO/ISH, with a non-lab model usable without cholesterol. Nigeria's region mapping is unverified. | CMO | S45 (3.2) |
| X4 | Handover at 18. Live behaviour: guardian keeps view access until revoked. Spec safety rule: guardian loses access on completion unless the young person consents. | Founder + counsel | S42 (1.18) |
| X5 | Consent matrix: data type x purpose, a research purpose, and which consents are required-for-care versus optional. Wording is unapproved (OQ-49). | Founder + counsel | S42 (1.13) |
| X6 | Export and delete: keep the admin-reviewed flow (founder 2026-09-07, OQ-50) or move to self-serve. | Founder | S42 (1.15) |
| X7 | Share link defaults: spec says 72 h default; live offers 1 h to 30 days. Spec also excludes mental health and reproductive data unless chosen. | Founder + CMO | S43 (2.8) |
| X8 | Screening packages: live tiers are `screen_core/advanced/comprehensive`; marketing says Essential/Preventive/Complete were retired; spec says Essential/Preventive/Full Screen. Which names and contents ship, and are weak-evidence tests (routine thyroid, annual HIV for everyone) in Essential? | Founder + CMO | S45 (3.6) |
| X9 | Native language scope. Founder decision is English and Pidgin only; competitor-style multi-language audio would contradict it. | Founder | S41 (1.12), S42 (1.14) |
| X10 | Current Nigerian immunisation schedule. The only verified source found is the 2009 policy, which is out of date. Rotavirus (2022) and R21 malaria (Dec 2024, phased) are confirmed. PCV, IPV, MenA, HPV, Td ages are not. CMO must sign a schedule from the current NPHCDA table. | CMO | S43 (2.6) |

## 2. Competitor comparison: where Tarragon stands

Legend: **Ahead**, **Par**, **Behind**, **Gap** (nothing built). "Best" names the product whose behaviour we should study, not copy.

### Module 1: Account, sign-in, consent

| Area | Best-in-class (secondary evidence) | Tarragon today | Position |
|---|---|---|---|
| Sign-up, OTP, biometric | Apple and Eka use device-bound biometric and OTP | Phone-first signup, Termii hook with caps, biometric offer. Real-device check and Termii sender ID pending | Par |
| Password hardening | Not evidenced at health competitors | Breached-password check, rate limit, device recognition built | Ahead |
| Recovery | Not evidenced elsewhere | Assisted recovery built, needs a second admin | Ahead, not yet usable |
| USSD | Helium (booking via USSD, 3,371 bookings reported), Zuri (consult short code), mDoc (reported) | Nothing | Gap |
| Sponsor / cohort code | Omada access codes via benefits portal | Referral codes, funding programmes, roster claim exist; no `cohort_codes` | Partial |
| Onboarding quiz and plan | Noom, BetterMe quiz funnels | 3-way intent step, plan preview. No goal/condition table driving Home | Behind |
| Granular consent | Eka: per-record, time-boxed, purpose-scoped. Clue: strong privacy posture | Append-only consent history, 8 consent types. No data-type x purpose matrix, no research purpose | Behind |
| Export and delete | Eka (partial) | Admin-fulfilled requests only | Behind by design |
| Quiet hours, discreet wording | Flo discreet options (background knowledge) | Quiet hours and discreet mode built, wiring partial; `sms_enabled` and `whatsapp_enabled` columns still present | Par, with INV-08 debt |
| Dependants, proxy | Apple Family Sharing (child under 13 handover); weak everywhere for elders | Dependants, handover cron, proxy setup with parent confirmation all built; web only | Ahead on proxy, Behind on handover consent |

Lessons to copy: decouple consent from service access (Samsung's bundled AI toggle backfired); no third-party SDKs on health screens (Flo FTC settlement); firewall sponsor reports with minimum cohort sizes (Ovia); no dark-pattern billing (Noom $56M settlement, BetterMe complaints).

### Module 2: Health Passport

| Area | Best-in-class | Tarragon today | Position |
|---|---|---|---|
| Source-labelled timeline | Apple Health labels every sample's source | `patient_timeline` spine; labelling and coverage of all item kinds unconfirmed | Partial |
| Paper capture and extraction | Eka Care: AI extraction of reports, prescriptions, vaccine certificates | Per-type extractors (vaccination card, lab, ECG). No generic camera/crop flow, no `ocr_state` on documents | Partial |
| Multi-year biomarker trends | Function Health, InsideTracker | Latest vs previous only | Behind |
| Vaccination | NHS App, NPHCDA FHIR IG | Catalog, records, schedules, sign-off, reminders built | Par; schedule unverified |
| Emergency card | Apple Medical ID (lock screen) | Token card, offline cache built; QR and lock-screen unconfirmed | Par |
| Share and access log | Estonia access log; MyChart Share Everywhere | Share links with lookups table built; not applied to production | Par pending apply |
| FHIR | Apple Health Records; Nigeria Core and NPHCDA IGs exist (under development) | Import with clinician review. No export, no `external_records` | Behind |
| Device import | Health Connect, HealthKit | Both built, never run on real hardware | Par, unproven |
| Early result release | MyChart criticised for releasing before review | Release policy table exists, `after_review` not enforced | Behind (S27) |

Lessons: never auto-commit OCR (handwriting is unreliable; keep the original photo, confirm per field); label "your doctor's target", not a global "optimal" (InsideTracker pattern medicalises normal variation); share links on WhatsApp are the real channel, so short TTL, view cap, optional PIN.

### Module 3: Risk, screening, reports

| Area | Best-in-class | Tarragon today | Position |
|---|---|---|---|
| Risk questionnaire | CDC Prediabetes Risk Test (short, points-based) | Versioned, CMO-signed config built | Par |
| CVD risk | WHO 2019 charts, lab and non-lab models | AFRO approximation labelled "not the official chart", plus SCORE2 | Behind until X3 |
| Calendar | No competitor equivalent seen | `screen_types` + schedules + refresh triggers; no nightly scheduler; no declined/N-A states | Ahead on rules, Behind on states |
| Packages | Function (membership, 100+ biomarkers), Synlab tiers | Panel bundles with SYNLAB prices; different names to spec; no video-consult bundle; no HPV DNA SKU | Behind |
| Home collection and kits | Healthtracka (48 h results), Everlywell, LetsGetChecked | Partial; kit logistics unconfirmed | Behind |
| Result review | Function: urgent-result call. Healthtracka: results by email, no clinical follow-up | Release policies and abnormal-result engine exist; item-level state machine is S27 | Ahead on intent |
| Yearly report | Neko (strong visual design), Function | Quarterly report only | Gap (S46) |

Lessons: keep the questionnaire as risk stratification only (one study found Healthily gave unsafe triage in 28.6% of cases); no auto-released reactive HIV (Everlywell/LetsGetChecked complaints); no imaging or genetics (confirmed correct); Prenuvo-style whole-body scans have no survival evidence. Synlab prices found online looked implausible (a hepatitis B profile at N227,000); use our own partner rate card.

## 3. S41: Module 1, part 1 (sign-up, profile, onboarding; functions 1.1 to 1.12)

**Reuse.** S03 signup, SMS hook, biometric, recovery, breached-password and device checks; S04 proxy; `onboarding/intent-step`, `plan-preview`, `language-chooser`; `patient_blood_profile`.

**Build**
1. **Onboarding answers (1.10, 1.11).** `onboarding_answers` table (RLS, `source`, `recorded_by`, `is_test`). Goal and condition selector, replacing auth-metadata `signup_intent`. Home cards read it. Plan preview built from answers, shown before any payment.
2. **Profile (1.9).** Add LGA (verify the column first). Keep `profiles.language`. Optional blood group and genotype with a "self-reported / lab-verified" flag.
3. **Cohort codes (1.8).** First map `referral_codes`, `funding_programmes`, `employer_benefit_packages` and the roster claim to the spec before creating `cohort_codes` and `profile_cohorts`. `cohort-join` edge function, `max_uses` enforced atomically, `cohort.joined` event. Code claims eligibility only. Entitlement creation waits for S26 and must be a seam, not a stub that grants. Sponsor reports aggregate-only with a configured minimum cohort size.
4. **Language and audio (1.12).** First screen language choice; audio narration wired to the S32 manifest if present, otherwise a documented seam. English and Pidgin only (X9).
5. **Close known S03 issues** where in scope: OQ-41 (roster claim before verification), OQ-52 (unverified accounts for any number). Email verification code-entry option (1.4) as non-blocking.
6. **USSD (1.7): do not build** until X1 is answered. Write the seam: `ussd_pins` schema in a design note only, with the INV-08 and PIN-assurance risk stated (aggregator sees the PIN; no clinical data in sessions).
7. **Mobile parity** for the proxy flow (1.19 is web-only today); likely deferred to S42 where dependants live.

**Tests.** Cohort code at `max_uses` rejected (concurrent claims); expired and wrong-sponsor codes; onboarding answers RLS by role; Home cards change with answers; plan preview contains no price pressure; INV-07 lint on new templates.

**Risks.** Cohort code semantic overlap with referral codes; employer or HMO reading individual data (refuse by design, test it).

## 4. S42: Module 1, part 2 (consent, privacy, dependants; functions 1.13 to 1.19)

Depends on X4, X5, X6. This is the module's final session, so it must also confirm every module-1 acceptance test.

**Build**
1. **Consent matrix (1.13).** Extend `consent_type`/`consent_versions` to data type x purpose (vitals, reproductive, mental health, documents, device data x care, Care Circle sharing, research, sponsor reporting). Default to bundles with an "advanced" view. Required-for-care versus optional marked per row; withdrawing an optional consent never reduces access to care (Samsung lesson). Resolve OQ-53 by enforcing the required-withdrawal rule in the database, not only the web action.
2. **Privacy summary with audio (1.14).** en and pcm, plain language, audio from the manifest. Move hard-coded English strings into `packages/i18n`. Pidgin needs a native reviewer.
3. **Privacy centre (1.15).** Consent history, two-tap withdrawal, "request export" and "request deletion" (reviewed flow per X6). Add the PDF export, `artifact_path`, and `account-delete` anonymiser that follows retention policy. Research-withdrawn patients excluded from the next research export, with a test.
4. **Notification settings (1.16).** Remove `sms_enabled` and `whatsapp_enabled` (INV-08, OQ-32), ship the code before the schema change per CLAUDE.md. Wire discreet wording through every template.
5. **Dependants (1.17, 1.18).** Reconcile `profile_access_categories` versus `permissions` (OQ-51). Fix proxy "manage before consent" (OQ-47). Handover: emit `dependant.handover_due` 30 days before the 18th birthday; the young person consents; guardian access ends on completion unless X4 says otherwise; reconcile `dependent_transition_status` with `adolescent_transition_plans`.
6. **Proxy (1.19).** Mobile flow; coercion safeguard (visible "set up by", parent can withdraw instantly); close OQ-48.

**Tests.** The three spec acceptance tests plus: required consent cannot be withdrawn to lock out care; handover removes guardian reads (simulated JWT, with a control proving the guardian could read before); reproductive and HIV data invisible to a proxy without the category grant; sabotage test for each RLS change.

**Risks.** The reproductive-health copy-an-older-table trap in CLAUDE.md applies to any dependant RLS; write category checks fresh.

## 5. S43: Module 2, part 1 (record, vaccination, emergency card; 2.1 to 2.9)

**Reuse.** `patient_timeline`, `patient_documents` and the three extraction tables, vaccination module, emergency card, S09 share links and Passport PDF.

**Build**
1. **Apply S09 migrations first** (not applied to production) after checking `list_migrations` on the live project.
2. **Timeline (2.1).** Every item source-labelled with a trust tier: lab-pushed, clinician, device, patient, OCR-unconfirmed. Confirm consultations, vaccinations, device data and documents all feed the spine.
3. **History (2.2).** Add `procedures`; add `verified_by_clinician` to `family_history`; keep clinician-sourced items tombstoned on removal.
4. **Photo capture (2.3).** Add `ocr_text`, `ocr_state`, `extracted jsonb` to `patient_documents`; a generic `ocr-extract` function returning suggestions only; camera, crop, per-field confirm; keep the original photo; rejected suggestions leave no record; unconfirmed values never feed escalation or risk.
5. **Symptom journal (2.4).** Offline-first, linked to timeline and checker sessions.
6. **Biomarker trends (2.5).** Multi-year chart per analyte using the lab's own reference range; targets labelled as the care team's target.
7. **Vaccination (2.6).** Reconcile live names with spec (`batch`, `source`, `verified`). Hold the schedule as signed versioned config; do not ship reminder logic until X10 is answered. Free on every account: verify.
8. **Emergency card (2.7).** QR plus printable, patient-chosen minimal field set, opt-in lock-screen presence (shared-phone exposure).
9. **Share (2.8).** Default expiry per X7, optional PIN, view-count cap, instant revoke, expired link returns 410 and logs the attempt, mental and reproductive scope off by default.
10. **Doctor summary PDF (2.9).** A facility-friendly, low-ink variant of the Passport PDF.

**Tests.** Expired share returns 410 and logs; OCR rejection leaves no record; share view audited; scope exclusion; staff reads of any new table go through audited functions (INV-10, INV-12, OQ-54).

## 6. S44: Module 2, part 2 (interoperability; 2.10 to 2.14)

**Build**
1. **`fhir-export`** for Patient, Observation, MedicationStatement, Condition, Immunization, DocumentReference, aligned to the Nigeria Core and NPHCDA IGs where they exist (both under development, so start with export and keep mappings configurable). Access-category rules apply to export exactly as to reads.
2. **`fhir-import` hardening** and `external_records` with provenance; round-trip test preserving observation values and units. Consider HAPI FHIR (Apache 2.0) as a validator in tests only.
3. **Partner lab push (2.12).** Wait for S27; define LOINC/UCUM mapping per lab; hold critical values for review before patient visibility.
4. **Helium Health (2.11).** Public API availability is unverified. Build the adapter seam and a one-facility pilot plan; do not promise integration.
5. **Health Connect / HealthKit (2.13).** Confirm consent wiring against `wearable_device_data`; label wearable data as estimates. Real-device test remains a precondition to calling it working.
6. **Item labels, notes and corrections (2.14).** Respect `enforce_vitals_reading_source_lock`; tombstone, never silently delete, clinician-sourced items.

**Tests.** FHIR round trip; import without consent refused; export honours category scope; provider-synced reading edit blocked.

## 7. S45: Module 3, part 1 (risk, calendar, packages; 3.1 to 3.10)

**Reuse.** `risk_questionnaire_configs`, `cv_risk_config`, `screen_types`, `screening_schedules`, `screening_completions`, `panel_bundles`, `annual_health_checks`, `lab_orders`, home-collection pieces.

**Build**
1. **Risk assessments (3.1 to 3.3).** Create `risk_assessments` (`instrument_code`, `inputs`, `score`, `tier`, `version_id`) and store `version_id` on every result (INV-16). Re-run triggers for "major change". Do not change the instrument until X3. Standing disclaimer on the result.
2. **Calendar (3.4, 3.5).** Add `declined` and `not_applicable` with stored reasons. Nightly `screening-scheduler`. Version and CMO-sign the `screen_types` rules, which today are neither versioned nor signed. Test: 45-year-old woman gets cervical screening per the configured rule. Cervical rule should follow Nigeria's national targets (HPV DNA at 35 and 45) only once the CMO confirms it.
3. **Packages (3.6 to 3.8).** `screening_packages` over existing `panel_bundles`, names per X8. Add HPV DNA standalone SKU, 20-minute video consult bundled in Full Screen. Positive-result pathway (colposcopy, treatment, confirmatory testing) must exist before HPV DNA or any reactive-result test is sold.
4. **Home collection and kits (3.9).** Named partner-lab collection; no HIV or STI kit without a counselling and human-disclosure path; kit support SLA (the Everlywell/LetsGetChecked complaint theme).
5. **Booking and payment in one flow (3.10).** Depends on S25 checkout for the new catalogue; show the partner rate card before checkout; respect never-sell-below-partner-cost triggers.

**Tests.** Cervical rule; package eligibility; sensitive positive in a package never auto-releases (this cannot pass until S27 item-level release exists, so state it as blocked, not passed); `version_id` present on every assessment.

**Seams for S46.** `risk_assessments` rows feed the yearly report; schedule states feed pathway suppression; package contents feed hep B logic.

## 8. Items the CMO must decide

CVD instrument and tier cut-offs, and when a score triggers a doctor; screening calendar ages and intervals (is prostate "discussion only"); package contents with evidence grade per test; result-release classes and time targets; confirmatory and referral pathways for reactive HIV, HBsAg, HCV, HPV and abnormal cervical results; anti-HBs threshold; mental-health screening instrument and crisis pathway; wording of "screening does not rule out disease"; home-kit eligibility; current immunisation schedule; governance of any AI explanation or audio (`ai_systems` registration, kill switch, INV-04 block on hiv, hep_b, hep_c positives).

## 9. Invariant watch-list for all five sessions

INV-03/04 (live schema lacks `release_state` and `sensitive_positive`; S27 owns it); INV-07 (share views, sponsor reports, discreet wording); INV-08 (SMS columns, USSD); INV-10/12 (new tables need audited reads from day one; 8 clinical tables still read directly); INV-13 (metric views and `is_test` retrofit); INV-14 (a go-live guard entry per new clinical feature); INV-15 (kobo); INV-16 (version ids on risk and screening). Per CLAUDE.md: `/code-review high` before each PR, a regression test for every fix, check live `list_migrations` before applying, never hand-type a migration timestamp, never sign clinical protocols as an agent, and no em dashes in copy.

## 10. Suggested sequencing and effort

| Step | Sessions | Notes |
|---|---|---|
| 0 | Resolve S40 gate, X1 to X10 | Founder and CMO time, not engineering |
| 1 | S41, S43, S45 in parallel worktrees | Apply S09 migrations at start of S43 |
| 2 | S42, S44 | Close modules 1 and 2 with full acceptance lists |
| 3 | S46 | Finishes module 3 (suppression, hep B logic, report) |

Rough size: S41 medium, S42 large (consent and handover touch RLS), S43 large, S44 medium, S45 large. Estimates are judgement, not measured.
