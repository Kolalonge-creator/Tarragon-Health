# S61 to S65 build plan: Condition pathways, Digital therapy programmes, Consultations and care access

Drafted 2026-10-07 on branch `s38/outcome-snapshots-analytics`. Planning document only: nothing here is built, applied or decided.
Inputs: `docs/v5-sessions/S61..S65`, `docs/BUILD-SPEC-v5.md` lines 1443 to 1609, a read-only repo audit run against `origin/main-dev` (this branch is 125 commits behind it), the S55 to S60 plan's founder decisions (`docs/design/S55-S60-build-plan.md` sections 9 and 10), and three web research passes. Confidence tags: **V** verified by a search result, **U** unverified background knowledge. Competitor outcome numbers are company-reported unless stated; none was independently checked.

## 1. Bottom line

1. **Module 15 is mostly built. Module 13 is half built under older names. Module 14 is greenfield.** Consultations, booking, Zoom with audio and phone fallback, written questions, scribe, prescriptions, referrals and cancellation rules are merged (S21 to S26). The pre-v5 platform already has chronic programmes, a diabetes data layer, CGM ingestion and a facility directory. The v5 engine itself is BP-only. So S61 to S65 are mostly extend, rename-around and fix, not rebuild.
2. **Do not create the spec's tables beside the live ones.** `pathway_enrolments` was decided out (OQ-124, `lead_assignments` instead). There are already 13 tables with "programme" in the name, so a bare `programmes` table is a collision. Map onto live objects (section 6).
3. **Five defects contradict a spec acceptance test and should be fixed before new features:**
   - Glucose 2.8 mmol/L with confusion has no v5 rule, no automated test, and confusion is not an input anywhere. The thresholds are hard-coded in TypeScript (`glucose-red-flags.ts`), which breaks "configuration for every clinical value". On the free plan the emergency handler raises no clinician alert, so nobody is paged.
   - Stale directory listings are never hidden. S36g's sweep deliberately only sets `is_stale` and notifies ops; nothing patient-facing reads it.
   - Ratings: only labs require a completed visit (`lab_location_reviews`). There is no encounter-linked rating.
   - No per-pathway go-live guard exists. Of the 7 seeded guards, only `clinical_operations_enabled` (booking and video-visit RPCs) and `scribe_enabled` are enforced; `prescribing_enabled`, `lab_booking_enabled`, `payouts_enabled`, `public_signup_enabled` and `on_call_cover_ok` block nothing.
   - Offline emergency guidance (INV-06) covers only locally red-flagged BP and glucose. Stroke, heart attack, seizure, pregnancy bleeding and breathing problems are not bundled, and there is no state-level emergency data.
4. **The titration engine has no real step table.** The only table is a fictional fixture (`htn_hearts_ng`, draft). OQ-171 and OQ-172 block real proposals. The live BP rule set is still the older v1 "approved by mistake"; v3 is a draft awaiting the CMO. Module 13 cannot go live for any pathway until the CMO signs, and that is the real critical path.
5. **Module 14 should launch narrow.** The evidence and the Nigerian constraints (data cost, shared phones, privacy, hardware) point to audio-first programmes with strict exclusion screens, not the full eight. Build the engine plus three audio programmes; scaffold the rest with guards off (section 4.2).
6. **None of S61 to S65 can start.** Step 0 of every prompt requires "Stage 1 complete" from S40, and S40 has not passed. S63 also depends on S56 (#1004, open) for mental-health privacy and the crisis path.
7. **Build from a fresh worktree off `origin/main-dev`.** This branch is 125 commits behind and misses S32, S33, S34, S35c and S38c to f.

## 2. Hard constraints that shape every session

- INV-01 deterministic triage, no model in the path. INV-02 no medicine change without a clinician signature. INV-05 a red event pages, it never waits in a queue. INV-06 emergency guidance offline. INV-07 neutral notifications. INV-09 no stored balance. INV-10 audited staff reads. INV-11 AI scribe drafts never enter the record unsigned. INV-12 clinician sees only tied patients. INV-14 guard-gated clinical features. INV-15 integer kobo. INV-16 versioned protocols.
- PROPOSED values live in `packages/shared/src/proposed-config`. English only (D-14). No em dashes in copy. "Your care team", never "your doctor". No agent signs a protocol, rule set, SLA or urgency map: agents build drafts and sign-off screens, the CMO signs.
- Founder decisions already made that bind these modules: no sale of BP cuffs or glucometers (2026-08-02); automated insulin dosing never built (Part C); adults only for consultations (OQ-129); one consultation price NGN 10,000 for video, audio and phone (OQ-130); membership model, Free sees the message route only; no helplines exist, so no helpline numbers anywhere and the crisis and emergency cards say "go to the nearest hospital now", with 112 only where it connects; no USSD (S40); no capitation and aggregate-only institution access.
- `private.is_org_staff()` gates about 110 tables. New tables here must not inherit that shape for mental-health, diabetes or programme data. Use per-patient access plus audited reads.

## 3. Sequencing and dependencies

| Step | Work | Why this order |
|---|---|---|
| 0 | Non-engineering lead items: CMO reads the primary HEARTS and Nigeria protocol PDFs and decides the step table, writes programme content, names the clinical owner per pathway, test-calls any emergency number before it is listed | These are the real critical path. Start now. |
| 1 | **Fix-first migration set** (section 5) | Small, independently shippable, removes live contradictions. |
| 2 | **S62 engine first**: generic pathway registry, rule-set and step-table loader in `packages/clinical`, per-pathway guard rows, enrolment, pause and discharge, scheduled tests | The spec splits pathways (S61) from engine (S62), but every pathway is data on the engine. Building the seam first keeps S61 to config plus rule sets plus tests. |
| 3 | **S61 pathways in wave order**: diabetes, then cardiometabolic and prediabetes, then weight (wrap what exists), then asthma and COPD, then CKD, sickle cell, post-stroke, heart failure | Diabetes has the most existing data (CGM, glucometer, targets) and the one named acceptance test. Others are Release 3. |
| 4 | **S65 emergency half**: offline guidance pack, state emergency data, Care Circle location alert | Highest safety value, fixes the partial INV-06. Independent of the directory. |
| 5 | **S64 gaps**: AI intake summary, referral letters to named facilities, dietitian and pharmacist booking, reminders, pre-payment rules display | Small. AI intake depends on S51 and S59/S60 (open PRs). Do the manual summary path first. |
| 6 | **S65 directory half**: facility fields, search, hide-stale, report wrong info, encounter-linked ratings, partner calendar | Needs the freshness cadence signed (OQ-235) and a data seed. |
| 7 | **S63 programmes**: engine plus wave A | Needs S56 merged (privacy, crisis path), S32 audio (merged) and S33 BRE-01 (merged). |
| 8 | S63 wave B and C scaffolds, S61 Release 3 pathways | Content-gated, guards off. |

Note this puts S62 before S61, S65-emergencies before the directory, and S63 late. Reasons: shared seam, safety value, and the S63 hard dependency on mental-health plumbing.

## 4. Module by module: benchmark, gap and plan

### 4.1 S61 and S62 Module 13: condition pathways

**What the full products do.**
- Omada: coach plus devices plus care team, prevention, T2D, hypertension, weight and a GLP-1 track. Its diabetes-prevention RCT showed a small HbA1c effect (-0.23% against -0.15%) (**V**); it reports 55%+ still engaged monthly after a year (**V**, company).
- Cadence (hypertension RPM with a clinician team): about 9/6 mmHg reduction in one cohort, at-goal 15% to 31% (**V**, company). It is paid by Medicare remote-monitoring billing, which does not exist here.
- Livongo/Teladoc: HbA1c -0.66% in a small pre-post study with over 15% dropout (**V**). Teladoc then wrote down $13.4B over 2022 on the purchase (**V**). The failure was commercial, and the evidence was weak.
- Glooko: unified device and pump data, FDA Class II (**V**). Pump data rides on each vendor's cloud, with no standard path.
- WellDoc BlueStar: FDA-cleared, prescribed, with an insulin calculator in the Rx version (**V**). This is exactly the line Tarragon must not cross: insulin dosing advice is regulated software.
- Twin Health: 319-patient vendor trial, HbA1c -3.1 with remission claims (**V**, single vendor, India). Medication withdrawal was clinician-supervised, which matches our rule.
- Propeller: 8 FDA clearances, vendor claims of ER visits down by about half (**V**). Sensor hardware is not realistic here; manual puff logging is.
- BeatO (India): own low-cost meter kit bundled with care, claims 60% retention at month 12 (**V**, vendor). Closest low-cost template, but no Nigeria presence found.
- Pear and Better Therapeutics both collapsed on reimbursement (**V**). Noom paid a roughly $56 to 62M settlement over auto-renewal tricks (**V**).
- Nigeria's own benchmark: the National Hypertension Control Initiative reports 39% BP control among 23,117 patients under care, 1.21 million screened, simplified protocol with task-sharing (**V**, Project HOPE abstract to May 2025). That is a modest bar and an honest one.

**What we already have (reuse, do not rebuild).**
- `chronic_condition_programmes`, `condition_protocols` (WHO HEARTS/PEN, GINA/GOLD/KDIGO sources), `chronic_programme_enrolments` (track self-monitoring or doctor-supported), schedule templates and occurrences, coordinator tasks, end reviews. Seeded for hypertension, diabetes, asthma, COPD, heart failure, CKD and obesity, `is_active` off by default.
- BP rule set `bp_care_triage` (rules BP-R1 to BP-G2) in `packages/clinical`, S12 shadow grading, titration evaluator (BP only), `protocols` and `care_plan_changes` with DB constraints so an unsigned change cannot save as signed, CMO sign-off screens.
- Diabetes: `patient_diabetes_profile`, `patient_glucose_targets`, `diabetes_complication_checks` (eye, foot, kidney), recheck cadence, CGM partners and connections with an ingestion route and time-in-range, glucometer BLE, a glucose insights card, `screening_pathway_coverage` (pathway suppression), `weight_management_enrolments` with screens.
- S37 go-live guards, S38 outcome snapshots (`pathway_code` is a text check for `bp` only), S25 to S26 entitlements.

**Gaps against the spec and the competitors.**

| Fn | Status | Benchmark-informed plan |
|---|---|---|
| 13.1 hypertension | partial | Keep BP as the reference pathway. Replace the fictional step table with the CMO-signed Nigerian one (OQ-171). Report control against the NHCI 39% yardstick, not vendor claims. |
| 13.2 diabetes | partial | New rule set `diabetes_care_triage` in `packages/clinical` with device and server parity tests. **Move glucose thresholds out of `glucose-red-flags.ts` into versioned PROPOSED config.** Add confusion, seizure and "needed help from another person" as inputs. Pump and CGM stay optional imports; manual and photo logging are the primary path. |
| 13.3 cardiometabolic | missing | A pathway that composes the BP and diabetes rule sets, never a third rule set. Worst-case urgency wins; a test proves it. |
| 13.4 prediabetes | missing | Wrap `preventive_programmes`; milestone-driven, coach-light. Outcome: weight and HbA1c change at defined weeks, reported honestly with dropouts. |
| 13.5 weight | partial | Reuse `weight_management_enrolments`. Add behaviour-change milestones. Reward consistency, never body size (S58 rule). No compounded GLP-1 claims; supervised prescribing stays a signed clinician decision. |
| 13.6 asthma and COPD | missing | Manual inhaler-use log (no sensor), trigger tracking, written action plan, exacerbation alert as a deterministic rule on symptom score and reliever use. Sensor pairing is a later adapter. |
| 13.7 CKD, sickle cell, stroke, heart failure | missing | Config on the same engine: monitoring set, target, red rules, review cadence. Release 3, guard off, content-gated. Sickle cell and CKD exist only as lab and screening content today. |
| 13.8 pregnancy HTN | defer | Module 16 (S66 to S68). Record only. |
| 13.9 enrolment | partial | Guided enrolment captures baseline readings, history, medicines, goals. Reuse `chronic_programme_enrolments`; add a baseline snapshot row so outcomes are measured against it. |
| 13.10 first-line control | partial | Stepped protocol with single-pill combinations as the default, built for what a Nigerian pharmacy can stock. Published referral criteria for anything outside it. The drug steps below are **U** until the CMO checks the primary PDFs. |
| 13.11 traffic light | partial | One shared traffic-light contract across pathways: green self-manage, amber clinician review within 24 hours (SLA from `escalation_slas`), red pages on-call. |
| 13.12 inputs | partial | Add missed doses and silence (7 days, decision S11-1, not the spec's 5) and symptom-checker results as inputs once S60 exists. Device alerts as a last input. |
| 13.13 titration proposals | partial | Generalise the evaluator beyond BP via step-table schema, still requiring signature. **Add the missing clinician review task for engine proposals (OQ-172).** Diabetes proposals are non-insulin only. Never insulin dose changes by the engine. |
| 13.14 diabetes insights | partial | Existing card plus fasting-high and post-meal-spike patterns surfaced to the patient and clinician. Patterns inform review, they never trigger a medicine change. |
| 13.15 milestones | missing | `pathway_milestones` (enrolment, code, due, met). Journeys are config. Milestones are shown at the pathway home; no streak that nudges a late dangerous reading. |
| 13.16 scheduled tests | partial | Reuse complication checks and pathway suppression. Add due-date generation and booking hand-off. |
| 13.17 pause, transfer, discharge, re-enrol | partial | Existing end reviews cover discharge-style. Add pause with reason, transfer between clinicians, re-enrolment, and the outcome evidence layer on S38 snapshots (extend the `pathway_code` check beyond `bp`). |
| 13.18 check-ins | partial | Weekly automated review from schedule occurrences; monthly or quarterly clinician review by control level. |

**Hypoglycaemia rule (PROPOSED, CMO signs).** ADA: Level 1 is below 3.9 mmol/L (70 mg/dL), Level 2 is below 3.0 (54), and Level 3 is a severe event needing another person's help because of confusion or unconsciousness (**V**). The spec example (2.8 with confusion) is correct, and Level 3 is defined by the event, not the number. Proposed rule: any reading below 3.0, or any neuro symptom, seizure, unresponsiveness or assisted event at any reading below 3.9, is red and pages on-call under INV-05. Readings from 3.0 to 3.9 without symptoms are amber with the "treat and recheck" advice and a `hypo_follow_up` task. Insulin or sulfonylurea use tightens, never loosens. One or more Level 2 or 3 episodes raises a medication-review task, per ADA. Existing code values (severe 3.0, alert 3.9) already match the ADA numbers.

**Go-live.** One guard row per pathway, seeded off: signed protocol, signed rule set, safety cases, trained clinicians with the competency attested. Wire them into enrolment RPCs, which today none of the pathway tables check.

**Safety and tests.** Acceptance: glucose 2.8 with confusion is red and pages; a diabetes titration proposal is not applied until signed. Add: sabotage that removes the glucose rule and fails; a property test that extra inputs never lower urgency (also for the cardiometabolic composition); parity test device against server for each rule set; a test that no rule references an insulin dose; RLS proofs per role for `pathway_milestones` and any pause or transfer table.

### 4.2 S63 Module 14: digital therapy programmes

**What the full products do.**
- Big Health (Sleepio, Daylight): six weekly sessions of about 20 minutes with a sleep diary and computed sleep window, FDA-cleared, NICE-recommended, claims of 18 RCTs (**V**, company). Dropout across studies ran from 11% to 62% (**V**, NICE). Price about £45 per person starting (**V**).
- Hinge Health: 73% 12-week completion with one-to-one coaching (**V**, company claim), sold to self-insured employers with part of the fee at risk against outcomes (**V**). Needs a tablet and motion sensors.
- Kaia: 1,245-adult back-pain RCT; COPD app after hospital rehab; both in Germany's reimbursed app list (**V**).
- Mindset Health IBS hypnotherapy: 244-adult RCT, 81% against 63% on the primary endpoint, a 15-minute daily recording for six weeks (**V**).
- Freespira (panic breathing) and Axena Leva (pelvic floor) both depend on hardware (**V**), so we copy the principle, not the product.
- Pear and Better Therapeutics collapsed because no payer would pay (**V**). Per-item naira pricing avoids that failure mode.
- Low-resource evidence is the best fit for us: WHO Self-Help Plus (five pre-recorded audio sessions plus an illustrated book for low literacy), Friendship Bench Zimbabwe (lay-delivered problem solving, 14% against 50% depressed at six months), Healthy Activity Programme (India), Shamiri (Kenya) (**V**).
- Engagement: unguided digital mental-health programmes average about 26% adherence against 72% guided, and dropout is up to 80% (**V**). Plan for 30 to 60% unguided completion and budget a human nudge.
- Nigerian apps name the barriers: data cost, privacy, religious beliefs, no local languages, low digital literacy (**V**).

**What we already have (reuse).** BRE-01 "Three minute calm" and the breathing pacer (S33, merged), the S32 audio manifest (merged), `mental_health_screens` (PHQ-9, GAD-7, EPDS, AUDIT-C, crisis gate, cadence), mobile mental-health lib, `exercise_programmes` with a PAR-Q style readiness screen enforced by a trigger, `health_education_programmes`. Not found: any CBT, insomnia, hypnotherapy, pelvic floor, pain or pulmonary rehab programme; `programme-progress`; the spec events.

**Naming and model.**
- The spec's `programmes` and `programme_enrolments` collide with 13 existing tables, and `programme_code` already means sponsor cohorts (S38e). Use **`therapy_programmes`** and **`therapy_enrolments`** and map the spec names in section 6. Do not extend `chronic_condition_programmes`; those are clinician-supervised chronic care, these are self-guided.
- `sessions jsonb` is replaced by a `therapy_sessions` content table (programme, ordinal, version, audio and text keys, duration, bytes) so versioning and the review gate work, and an enrolment records the programme version it started on (INV-16).

| Fn | Plan |
|---|---|
| 14.9 entry questions and red flags (build first) | A per-programme exclusion screen run at entry and re-checked every session, failing closed: any positive stops the programme and routes to the same-day clinician queue. Content is config, signed by the CMO. |
| 14.5 panic breathing | Audio-paced only, built on BRE-01. No CO2 sensing. First-time panic or any chest symptom goes to a clinician first. |
| 14.6 pelvic floor | Audio-guided exercise. Exclusions: retention, prolapse symptoms, bleeding, infection. Relies on Module 16 for the postnatal context; ship the general version. |
| 14.4 IBS hypnotherapy | Six weeks of 15-minute audio. Exclusions: bleeding, weight loss, anaemia, age over 50, family history of bowel cancer (**U**, CMO to confirm). |
| 14.1 CBT-I | Highest evidence and demand, most safety logic. Launch with sleep diary, wind-down and stimulus control; **hold sleep restriction behind a clinician flag.** Exclusions: bipolar, uncontrolled seizures, Epworth above 11, snoring with witnessed apnoea, drowsy-driving work, shift work, pregnancy, alcohol or sedative dependence (**V** for the first four, **U** for the rest). Sleep window floor of 5 to 5.5 hours (**U**, CMO to set). |
| 14.7 back, neck, knee, hip | Video is the bandwidth and content cost. Short clips and still-image sequences, downloadable, no camera movement feedback in v1. Red flags stop enrolment: saddle numbness, bladder or bowel change, bilateral leg weakness, progressive deficit, trauma, fever, weight loss, cancer history, night pain, plus local additions for TB and sickle cell (**U**). The spec acceptance test (saddle numbness blocks enrolment) lives here. The current back-pain handling is only a BP red-flag symptom, not an exclusion screen. |
| 14.3, 14.2 low mood, stress, anxiety | Wave C, after S56 merges. SH+-style audio plus illustrated format, PHQ-9 and GAD-7 progress. PHQ-9 item 9 above zero stops the programme, shows the crisis card and creates a `crisis_follow_up` task per the S56 design. No helpline numbers. Anxiety CBT shares the mood plumbing. |
| 14.8 pulmonary rehab | Wave C, after the asthma and COPD pathway (S61) and the pain-programme video pipeline. Clinician-set exercise prescription and oxygen saturation limits. |

**Launch waves.**
- **Wave A (content-ready first):** panic breathing, pelvic floor, IBS hypnotherapy. Audio only, low risk, cheap content.
- **Wave B:** CBT-I (stimulus-control-first) and the pain programmes. Needs the heaviest safety logic and the video pipeline.
- **Wave C:** low mood, stress, anxiety CBT, pulmonary rehab. Gated by S56 and the COPD pathway.
Wave order matches the evidence and the safety dependency, not the spec's numbering. The research agent ranked pelvic floor first; I put panic breathing alongside it because BRE-01 already exists and shortens the build.

**`programme-progress` and events.** Compute outcome change at set sessions; worsening beyond a PROPOSED threshold raises a `clinical_tasks` row, never only a notification (INV-07). Events `programme.session_completed` and `programme.flag` go through the S10 outbox. Progress is shared with the clinician only on explicit, revocable consent.

**Privacy.** Same model as S56: per-patient access, audited reads, no `is_org_staff` inheritance, neutral notification text, shared-phone mode (no content on lock screen, PIN, quick hide), no analytics or ad SDKs on these screens, sponsors and employers see aggregate counts only (I9). Diary entries are device-first unless the patient opts in.

**What not to do.** No conversational AI therapy. No hardware. No outcome claim from a trial of a different format; label any cited evidence as from other settings, and run a local pilot to produce Nigerian PHQ-9, GAD-7 and ISI numbers.

**Tests.** Acceptance: back pain with saddle numbness blocks enrolment and shows urgent guidance. Add: every programme refuses enrolment with each exclusion (table-driven); item 9 above zero stops a mood programme and creates a task; a programme version change does not alter an enrolled patient's content; RLS per role and a sabotage test; a scan test for tracking SDKs.

### 4.3 S64 Module 15 (1 of 2): consultations

**What the full products do.**
- Vezeeta: ratings only from patients who booked and visited through the platform, free for patients, providers pay per booking (**V**, vendor page). Practo shows the failure mode of ratings without a visible moderation process: users allege paid reviews and 2 to 4 week moderation (**V**, complaint site, anecdotal).
- Doctolib: no-show rate 4.1% overall, new patients 6.4% against 3.5% for established; reminders at 7 days, 24 to 48 hours and 2 hours (**V**, French data, benchmark only).
- K Health with Cedars-Sinai: AI intake matched physicians in 68% of cases, intake averaged 25 questions in 5 minutes, but it was vendor co-authored and US urgent care only (**V**).
- Babylon went bankrupt in September 2023 after members used far more consultations than were funded (**V**). The symptom checker was never regulated as diagnostic.
- Ambient scribe risk: one audit of three deployed scribes reported a verified failure in 31% of notes, concentrated in allergy and medication lines (**V** for the abstract only; I did not read the paper, treat the number as unconfirmed).
- No single Nigerian telemedicine law exists; MDCN's code touches it briefly, and the NDPA 2023 applies to the data (**V**, one legal commentary). I found no verified "2023 MDCN telemedicine rules"; treat that name as unconfirmed.

**What we already have (merged).** Encounters of four types, rooms and events; booking from bookable slots; VideoProvider with Zoom and audio-only join, phone fallback through Zoom's own dial-in; mobile consultation room (not run on a real phone, OQ-158); written questions with attachments; scribe consent per consultation, transcripts and the draft edge function (guard `scribe_enabled`); prescriptions, referrals and care plan changes; cancellation and refund rules (full credit back at 2 hours or more); one price NGN 10,000.

| Fn | Status | Plan |
|---|---|---|
| 15.1 booking by specialty, language, sex, price | partial | One price means price filtering is moot for doctors; show it, do not filter. Add specialty, spoken language (clinician spoken language is not UI localisation, so D-14 holds), sex, availability. Show licence number and date checked. Add dietitian and pharmacist booking; none exists today. |
| 15.2 video, audio, phone, async | exists | Test the fallback ladder on a real phone (OQ-158) before calling it done. |
| 15.3 AI intake | missing | **Manual structured intake first** (the patient's reason and answers become a summary, written only after they send it, shown in the clinician's patient summary). Add the symptom-checker summary when S60 exists. It is a summary to the clinician, never a diagnosis, and any escalation is deterministic. |
| 15.4 scribe | exists | Add a review pass that shows allergy and medication lines first before signing, and a visible "no scribe" path that loses nothing. Consent stays a row per consultation. |
| 15.5 delivery to Passport | partial | Confirm summary, diagnosis, plan, prescription and follow-up tasks all land in the signed view only. |
| 15.6 referral letters to named facilities | partial | Letters exist in S24/S05e; link to a `facilities` row so the named facility is a directory entry, not free text. |
| 15.7 cancellation and refund | partial | Show the policy and price before payment on every booking path. OQ-133 (cash refund of a cancelled consultation) is open; the plan does not assume cash. |

**Open product question.** Membership pivot says Free sees the message route and no one-off consults. Booking filters and the AI intake must respect entitlements from S26; confirm which of dietitian, pharmacist and specialist bookings sit inside the membership and which are priced per item.

**Reminders, not bans.** Reminders at about 7 days, 1 to 2 days and 2 hours, with an "I come or I cancel" tap. No no-show ban in v1. Nigeria's payment, transport and power conditions differ from France.

**Tests.** Add: booking cannot proceed without the policy and price shown (render test); intake summary appears in the clinician patient summary only after the patient sends it; scribe draft cannot be signed with allergy and medication lines unreviewed.

### 4.4 S65 Module 15 (2 of 2): directory, emergencies, further detail

**What the full products do.** Practo and Vezeeta combine directory, booking and verified-visit reviews. Fake listings are a documented general problem and cluster in emergency-type services (**V**, general). Nigerian data sources are all self-described as unvalidated: the Health Facility Registry master list (about 51,000 facilities in November 2024, no documented public API found), GRID3 Health Facilities v2.0 ("non-exhaustive and non-validated"), and OpenStreetMap exports (**V**). The MDCN register is checkable by name, with no API or bulk export found (**V**). I found no NHIA provider directory. Emergency numbers: the federal government announced 112 as the unified number in April 2026 (**V**, one news report, not proof of routing); Lagos LASAMBUS lists 767 or 112 and self-reports a 97.5% response rate (**V**, government claim); public distrust of 112 is documented (**V**, 2016). 

**What we already have.** `facilities` with type, state, city, phone, address, latitude, longitude, free-text hours and a `verified` flag; `facility_services`; `booking_requests`; lab and pharmacy locations; specialist providers with languages and accepted HMOs; partner integrations; `directory_freshness`, `directory_verifications` and `directory_verification_config` (S36g, cadence PROPOSED, OQ-235); `lab_location_reviews` with a completed-visit check and a moderation path; a facility selector with geolocation; `emergency_cards`; a bundled emergency modal for BP and glucose; an emergency-contact alert on the web.

| Fn | Status | Plan |
|---|---|---|
| 15.8 directory | partial | Extend `facilities` instead of a new table: `services text[]`, structured `hours`, `languages`, `accepts_hmo text[]`, `nhia bool`. Keep freshness in `directory_freshness` and expose it through a view the app reads. |
| 15.9 real-time booking | missing | Start with request and confirm (existing `booking_requests`); add `facility_bookings` and `partner-calendar` sync only for a partner that actually offers a calendar. No partner is contracted beyond Synlab. |
| 15.10 filters | missing | `directory-search` RPC: location, service, hours, language, price where known, HMO and NHIA acceptance. HMO acceptance comes from the HMO's own provider list, not the facility's self-claim. |
| 15.11 verified-visit ratings and last-verified | partial | New `facility_ratings` with `encounter_id` or order id required, one per visit, a reply path and visible moderation, built on the `lab_location_reviews` pattern. Show last-verified on every listing. |
| 15.12 referral partners | missing | Imaging and rhythm monitoring are directory entries with a referral task. No partner is signed; record, do not fabricate. |
| 15.13 offline emergency guidance | partial | Bundle guidance for stroke, heart attack, severe hypertension, hypoglycaemia, pregnancy bleeding, seizure and severe breathing in the app. Evaluate red rules on device for the rest of the vitals (pulse, SpO2, temperature, symptoms). Content is CMO-signed config. |
| 15.14 nearest emergency facilities and numbers by state | missing | A bundled per-state list of emergency-capable hospitals. An emergency number appears only if test-called in the last quarter, with its date shown. 112 may be listed only where it connects. No helpline numbers. |
| 15.15 one-tap Care Circle alert | missing | Decision S48-1 exists; S29 chose a neutral push with no location. Add an explicit, revocable consent and a location-attached alert by push and email, sent only on the patient's own tap. Working in-app, never dependent on a send succeeding. Needs a guard and consent text first. |
| 15.16 directions and call | missing | Deep link to the phone's own maps app and a `tel:` action from every listing. No map SDK, no tracking. |
| 15.17 report wrong info | missing | A patient report queues the listing for re-verification and never changes it by itself. Two independent reports trigger immediate re-verification. |

**Hide-stale rule.** Change the sweep so a listing past a PROPOSED multiple of its cadence is excluded from patient search through the view, not deleted or suspended. The S36g header says it never hides a listing; that behaviour changes by a new decision, so record it in `docs/OPEN-QUESTIONS.md` first.

**Data plan.** Seed existence from the HFR list, cross-check coordinates with GRID3 and OSM, show a tier on every listing: seed only ("not yet verified", name and place), phone-confirmed (open, hours, services), and licence-checked (MDCN for doctors; PCN and MLSCN registers are unconfirmed, check). Care Coordinators do the phone verification; partner facilities may update through a signed-in portal as a second source. Proposed cadence (**U**, signed by the CMO or founder): emergency-capable hospitals and 24-hour pharmacies 90 days, clinics and labs 180, everything else 365; hide past twice the cadence. Do not use Google Places as a primary source. Ask the Federal Ministry or the registry maintainers whether an export exists before building an importer.

**Tests.** Acceptance: a listing unverified longer than the period is absent from `directory-search`; a rating without a completed visit is rejected. Add: sabotage that removes the hide rule; an offline test that the emergency pack loads with no network; a state coverage test (every state has at least one emergency entry or an explicit "none listed" row); RLS per role.

## 5. Cross-cutting work and decisions needed

**Fix-first migrations** (new versions from wall-clock, check `list_migrations` live first, per CLAUDE.md):
1. Move glucose thresholds to versioned PROPOSED config, add confusion and assisted-event inputs, add the red rule and a test (section 4.1).
2. Make the directory search view hide stale listings after the S36g sweep and sign off the cadence.
3. Add per-pathway guard rows (seeded off) and wire them to enrolment RPCs.
4. Add the engine-proposal review task (OQ-172) and the first real step table once the CMO supplies it (OQ-171).
5. Extend `outcome_snapshots.pathway_code` beyond `bp`.

**Shared infrastructure to build once:** the pathway registry and rule-set loader; a step-table schema; a traffic-light contract; the content review gate and offline pack from S55 to S57 reused for programmes and the emergency pack; module events on the S10 outbox (`programme.session_completed`, `programme.flag`, `booking.created`, `booking.reminder_due`, `rating.submitted`, `pathway.milestone_met`); i18n namespaces (`pathway`, `therapy`, `directory`, `emergency`) in English; a "last verified" component used on every listing; guard wiring for the five unwired guards.

**Decisions the founder or CMO must make (draft entries for `docs/OPEN-QUESTIONS.md`; note the file duplicates several OQ numbers, so cite by title as well):**
1. CMO: the first approved BP step table and its Nigerian drug list; sign v3 of `bp_care_triage`; confirm WHO HEARTS and NHCI steps against the primary PDFs (the research agent could not read them).
2. CMO: sign the glucose rule set, hypoglycaemia mapping above, and the cardiometabolic composition rule.
3. Free-plan red glucose: the spec says red pages on-call, the older platform rule skips the clinician alert on the free plan. Decide whether a dangerous reading pages regardless of plan.
4. Naming: confirm `therapy_programmes` and `therapy_enrolments` rather than the spec's `programmes`.
5. Which programmes launch first, and which are content-authored by the CMO and reviewed. Faith-compatible framing follows the S56 decision (CMO writes, named faith leader reviews).
6. Directory: sign cadence (OQ-235) and the hide-stale change; name the verification owner; decide whether Tarragon will build an HFR importer after asking the registry owners.
7. Emergency numbers: who test-calls, how often, and where the date is displayed. Whether to list 112 given the unverified routing.
8. Care Circle location alert: consent text, revocation, and whether it can be sent without a signed-in recipient.
9. Membership entitlements for dietitian, pharmacist and specialist booking.
10. Whether a patient with no smartphone data gets any non-app route. USSD was decided against at S40; the research suggested revisiting it. I recommend leaving it closed and flagging it only if a partner asks.
11. Ratings moderation: who moderates, reply right for the facility, and response time.

## 6. Spec-to-live mapping (alias, do not duplicate)

| Spec name | Live object |
|---|---|
| `pathway_code` values | `chronic_condition_programmes.code` plus the text check on `outcome_snapshots.pathway_code` |
| pathway enrolment | `chronic_programme_enrolments` (OQ-124: `lead_assignments` for the lead clinician) |
| `pathway_milestones` | new, keyed to `chronic_programme_enrolments` |
| per-pathway rule sets | `packages/clinical/src/rules/*` plus `protocols` for step tables |
| `programmes`, `programme_enrolments` | new `therapy_programmes`, `therapy_enrolments`, `therapy_sessions` |
| `facilities` additions | extend `facilities`; freshness in `directory_freshness` |
| `facility_bookings` | new, beside `booking_requests` |
| `ratings` | new `facility_ratings`; labs keep `lab_location_reviews` |
| `directory-search`, `partner-calendar` | new |

## 7. Rough sizing

Counting build sessions, not calendar time: fix-first set 1 to 2; S62 engine 2 to 3; S61 diabetes and cardiometabolic 2, remaining Release 3 pathways 1 to 2 each, content-gated; S65 emergency half 2; S64 gaps 2; S65 directory half 2 to 3; S63 engine plus wave A 3, waves B and C 2 each. Each session also carries its own `/code-review high`, DB proofs and `/code-review ultra` where it touches RLS on a patient table or the tier ladder. The real critical path is non-engineering: CMO step table and signatures, programme content and audio recording, facility verification calls, emergency number test-calls.

## 8. What was not verified

Exact doses and BP thresholds in the WHO HEARTS and Nigeria NHCI protocols (the PDFs were not readable); the 2020 and 2021 Nigerian diabetes guideline contents; Health2Sync, Hello Heart, Heartbeat Health, Kangpe, Mecure, DrugStoc, Aviva and Dexcom Clarity details; any competitor price outside the few quoted; whether the HFR has a usable export; the PCN and MLSCN registers; NHIA provider data; whether 112 routes outside Lagos in practice; the scribe audit beyond its abstract; "Bound" (Sword) and "MindWorks" (not found); mhGAP detail; Happify, Youper, Pzizz, SilverCloud and the pelvic-floor consumer apps (thin results). No app-store listing or onboarding flow was studied, so the design lens is open for all products. The repo audit was by search against `origin/main-dev`; "not found" means no matching code, not proof of absence. OQ numbers are duplicated in `docs/OPEN-QUESTIONS.md`, so every OQ citation here should be checked by title.
