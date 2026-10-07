# S66 to S70 build plan: Women's, maternal and child health; Care Circle and community; Devices and wearables

Drafted 2026-10-07 on branch `s38/outcome-snapshots-analytics`. Planning document only: nothing here is built, applied or decided.
Inputs: `docs/v5-sessions/S66..S70`, `docs/BUILD-SPEC-v5.md` lines 83 to 105 and 1612 to 1768, a read-only repo audit (Module 17 audited on `origin/main-dev`), and three web research passes. Confidence tags: **V** stated in a source the research pass retrieved, **U** from background knowledge only. Verify every **U** before it goes into `docs/research/S6x.md` or a clinical config.

## 1. Bottom line

1. **The spec says Modules 16 and 18 are "not in Stage 1". That is wrong for the live repo.** Roughly half of each already exists as pre-v5 work (cycle tracker, pregnancy BP rules, postnatal and growth tables, BLE pairing, wearable OAuth, HealthKit and Health Connect bridges). Module 17's Stage 1 half (S29) is live. So S66 to S70 are mostly **upgrade, map and fix**, not greenfield. Spec table names (`cycles`, `pregnancies`, `children_growth`, `device_connections`, `observations`) do not exist and must not be created as duplicates; section 6 maps them to live tables.
2. **Fix these defects before adding features**, because they contradict an invariant, a spec acceptance test, or are silently broken today:
   - **`growth_reference_lms` ships empty**, so every child z-score is NULL (S68).
   - **Pregnancy BP rules cannot fire offline.** The phone has no `pregnant` flag, so BP-P1, P3 and P4 never run on device. That breaks INV-06 for exactly this module (OQ-90 option a, S67).
   - **Cycle notifications are not discreet.** In-app copy says "Your period is expected in a couple of days", and the INV-07 lint covers `pregnan*` and `menstrual` but may not cover "period" or "cycle" (S66).
   - **Cross-source de-duplication fails its own acceptance test.** The unique index only covers one device's own reading id (S70).
   - **The Fitbit connector is probably already dead.** The legacy Fitbit Web API stops 30 Sep 2026 and tokens do not carry over (**V**). Today is 2026-10-07 (S70).
   - **`patient_pregnancy` is one row per patient**, so a second pregnancy or a postnatal reset is impossible (S67).
3. **Biggest design risks are privacy, not features.** Flo's FTC order and the 2025 Meta jury finding (**V**) are the failure to avoid. The premium position is a provable privacy stance: no ad or analytics SDKs, a section PIN, neutral notifications, audited reads, sponsors and employers provably excluded.
4. **Three spec items should be narrowed or dropped, with a founder decision each:** anonymised *member* rankings (17.7, becomes cohort-level only), connected inhalers (18.7, no Nigerian supply) and the paid CGM insight programme (18.5). The Tarragon band (18.8) stays a dormant stub under D-22.
5. **None of S66 to S70 can start yet.** Every prompt's Step 0 requires `BUILD-PROGRESS.md` to begin "Stage 1 complete" (S40). It does not. The checked-out branch is also 135 commits behind `origin/main-dev` and lacks the S29 Care Circle code. Rebase first (section 3).
6. **Session prompts mention "en, pcm" strings. D-14 later made the app English only** and Pidgin was removed from `main-dev`. Treat the prompts as stale on that point; English only.

## 2. Hard constraints that shape every session

- INV-01 no language model in any triage path. INV-06 emergency guidance and red rules work offline. INV-07 notifications never name a condition, reading or result. INV-09 no stored balance. INV-10 audited clinical reads. INV-11 no AI scribe on group sessions. INV-12 staff see only tied patients. INV-13 `is_test` excluded from metrics. INV-14 go-live guards. INV-15 integer kobo. INV-16 versioned protocols and thresholds.
- Part C: never used as contraception; reproductive data never visible to sponsors or employers; no public feeds, profiles or body-metric leaderboards; no WhatsApp sharing or integration; no ads.
- CLAUDE.md: reproductive-category RLS must be written fresh (never copied from an older sibling table), proven with a simulated caregiver and emergency session. `private.can_read_clinical` has overloads: always cast literals. A new table needs its own grants. A new function needs `revoke ... from public` for anon. Never hand-type a migration timestamp and check live `list_migrations` first. `generate_typescript_types` returns production: splice only your own additions. Enum `ADD VALUE` goes in its own migration.
- No clinical threshold, rule set, cut-off or content is signed by an agent. The CMO signs. Everything below marked PROPOSED lives in `packages/shared/src/proposed-config`, with a `*-mirror.test.ts`.
- No em dashes in copy. "Your care team", never "your doctor". Strings through `packages/i18n`.

## 3. Sequencing and dependencies

| Step | Work | Why |
|---|---|---|
| 0 | Non-engineering long-lead items: CMO obstetric protocol review (BP-P rules, kick and contraction thresholds, EPDS cut-off, SAM routing), DPO view on cohort membership as sensitive data, founder answers to section 9, NAFDAC/MDCN position on pregnancy monitoring and rhythm alerts as SaMD, WHO LMS data licence check | Gates `maternal_enabled` and several guards. Start now. |
| 1 | S38, S39, S40 land. Rebase onto `origin/main-dev` | Stage 1 gate; S29 code lives only there |
| 2 | **Fix-first migrations**: load WHO LMS tables, in-app cycle copy and INV-07 lint, cross-source dedupe resolver, Fitbit to Google Health API, `pregnancies` history | Each is small and independently shippable |
| 3 | **S70 core** (device model, dedupe, plausibility, `DeviceSource`) | S66 to S68 consume device BP and weight; S66 PIN lock is independent |
| 4 | **S66** | Private-section PIN and discreet notifications are the template S67 and S68 reuse |
| 5 | **S67** then **S68** | Chain per the spec; S68 closes Module 16 and its acceptance list |
| 6 | **S69** (cohorts and challenges) | Independent of 16 and 18 except wearable step metrics (consented only) |
| 7 | S70 connectors and photo capture; S69 group audio last | Longest tail; group audio depends on S21 real-device testing |

S66 and S69 can run in parallel with S70 once step 2 is done. S67 and S68 are strictly sequential.

## 4. Module by module: benchmark, gap and plan

### 4.1 S66 Module 16 (1 of 3): menstrual and reproductive (16.1 to 16.4)

**What the full products do.** Flo and Clue give predictions, rich symptom and mood logging and insights; Flo's anonymous mode is **U**. Natural Cycles is the only FDA-cleared cycle-based contraceptive (**V**, class II) and needs NAFDAC clearance in Nigeria, so Part C says do not build it. Mira and Femometer sell hardware hormone and BBT tracking (**U**), which conflicts with the 2026-08-02 no-hardware founder decision. Flo's data-sharing settlement and the Meta jury finding (**V**) are the cautionary case. Common complaints: inaccurate predictions for irregular cycles (**U**), paywalled basics (**U**), fertile-window screens that read as contraception.

**What we already have (reuse).** `menstrual_cycles`, `menstrual_daily_logs` (BBT, ovulation tests, `can_read_clinical` gate, adolescent gate), web `patient/cycle/*`, mobile `cycle-screen.tsx` and `cycle-prediction.ts`, `FERTILE_WINDOW_DISCLAIMER`, thermal shift, `reproductive_health_profiles`, `contraception_plans`, clinician `womens-health-panel` and `cycle-insights-card`, `profiles.discreet_mode`, the S13 INV-07 lint, whole-app biometric lock (`app-lock.ts`), perimenopause education content.

| Fn | Status | Upgrade |
|---|---|---|
| 16.1 tracking, PIN, discreet | partial, large | Add a **section-level private lock** (PIN hashed and device-held, or biometric), separate from the app lock, re-asked after backgrounding. Define PIN recovery up front (founder choice, section 9). Make cycle notifications generic ("Your tracker has an update"), extend the lint to "period", "cycle", "fertile", "ovulation". Consolidate the two prediction implementations (mobile `cycle-prediction.ts`, web `lib/rules/cycle-insights.ts`) into one shared package with golden tests. |
| 16.2 conception planning | partial | Put the fertile window **behind an explicit "planning a pregnancy" mode**, off by default. "Not contraception" label on every surface that shows a window, on any export, and never in a push or email. Copy audit so nothing suggests avoiding pregnancy. Ovulation-test log already exists. |
| 16.3 clinician report, contraception | partial | New clinician **pattern report** (cycle-length variability, flow, symptoms) as a PDF or in-console view, via an audited read function (INV-10). Contraception page: neutral options, no recommendation, no fertility-awareness claims, referral to the care team. |
| 16.4 perimenopause | education only | Symptom log (hot flushes, sleep, mood, bleeding change) plus education. A validated score only if the CMO signs one (Greene scale is **U**). No hormone-therapy guidance in the patient app. |

**Premium differentiators.** A privacy position competitors cannot claim (no ad SDKs, section PIN, neutral notifications, a plain-language "who can see this" screen showing the audit log); clinician-ready export; offline tracking.

### 4.2 S67 Module 16 (2 of 3): pregnancy (16.5 to 16.8)

**What the full products do.** BabyCenter and Ovia give week-by-week content, baby-size, symptom logging and community; BabyCenter has the highest ad density in the category (**V**). Maven and Peanut sell virtual care and community (**V**, thin). African programmes (MomConnect, Jacaranda PROMPTS, Mobile Midwife) deliver stage-based messages over SMS, WhatsApp or voice (**V**); Jacaranda answers about 70 percent of queries by AI (**V**), which INV-01 forbids in our clinical path, and we cannot use SMS or WhatsApp. No consumer app runs a deterministic pregnancy BP pathway with an on-call page. That is our wedge.

**Clinical reference points.** WHO 2016: eight contacts, first within 12 weeks, then 20, 26, 30, 34, 36, 38, 40 weeks (**V**). NICE NG133: admit at 160/110 or more; aspirin 75 to 150 mg from 12 weeks for high risk; target 135/85 on therapy (**V**). Kick counts: 10 movements in 2 hours from about week 28 (**V**, Cleveland Clinic). Contractions: 5-1-1, often 7-1-1 for later births (**V**). All of these become PROPOSED config, not constants.

**What we already have.** `patient_pregnancy` (is_pregnant, EDD, LMP, high_risk), `antenatal_visits`, pregnancy card and form, mobile `gestational-age.ts`; **BP-P1, P3, P4 in `packages/clinical/src/rules/bp-care-v1.ts`** (pregnancy amber to clinician, 160/110 red, 140/90 plus pre-eclampsia symptom group red); `pregnancy-red-flag-check.tsx` writing `emergency_events`; `headache.pregnancy_severe` triage protocol; on-device `triage-device.ts`; `PREGNANCY_DANGER_SIGNS`.

| Fn | Status | Upgrade |
|---|---|---|
| 16.5 week-by-week, antenatal reminders | partial | Week-by-week content, text first, then audio (S32 manifest), CMO-reviewed, bundled offline. **Generate the antenatal schedule** into `antenatal_visits` from versioned config (WHO eight-contact baseline PROPOSED; national schedule to confirm). Reminders are generic text (INV-07). Retire the old `antenatal_booking` screening route (already cancelled in 20260918105225). |
| 16.6 pregnancy BP | partial, strongest | Add the missing acceptance test (150/100 at 30 weeks with headache is red) plus boundaries 139/89, 159/109. Fix the **offline `pregnant` flag** by caching emergency facts on device (OQ-90 option a). Rules stay DRAFT until the CMO signs. A pregnant red reading pages the on-call clinician (INV-05). |
| 16.7 kick counter, contraction timer, birth plan | missing | New `kick_counts`, `contractions`, `birth_plans`. Offline-first, outbox-synced. Kick pattern (fewer than N in 2 hours, or a sudden drop) and the 5-1-1 or 7-1-1 pattern surface a fixed "call or go now" card, never advice to wait. Birth plan: place, transport, money (kobo, a plan note, not a wallet, INV-09), blood donor, escort, danger-sign card offline. |
| 16.8 nutrition, safe medicines, offline danger signs | partial | CMO-reviewed content, never AI-generated. Safe-medicine list is "ask your care team first" by default. Bundle the danger-sign guide and audio in the app. |

**Data model (extend, do not duplicate).** Replace the one-row-per-patient limit: add a `pregnancies` history table (state, risk_flags text[], lmp, edd, outcome) and keep `patient_pregnancy` as the current-state view or migrate it, with the migration header recording row counts. New tables get `source`, `recorded_by`, `is_test`, `organisation_id`, and a **fresh category-scoped RLS** (`reproductive_health`), proven with simulated caregiver and emergency sessions plus a sabotage step. Emit `pregnancy.recorded` through the outbox; it switches the BP rule set, content and danger signs.

### 4.3 S68 Module 16 (3 of 3): postnatal and child (16.9 to 16.11)

**What the full products do.** Ovia and BabyCenter cover postpartum recovery, feed logging and baby milestones; Huckleberry, Baby Tracker and Glow Baby are strong on feeds, sleep and diapers but often not WHO-referenced (**U**). WHO Anthro and the `anthro` package give LMS z-scores for six indicators including MUAC-for-age (**V**). Complaints: anxiety from over-alerting (**U**), US growth references (**U**).

**What we already have.** `postnatal_profiles`, `postnatal_checkins` (week 1, 6, month 3, 6, 12) with EPDS link, `child_growth_measurements`, `growth_reference_lms` (**empty**), `private.growth_z_score` (LMS, closest-age within 1.5 months), growth card, developmental screening, vaccination and NPHCDA immunisation tables, `vaccination-for-family`, paediatric danger-sign triage, crisis gate migration `20260910014008`.

| Fn | Status | Upgrade |
|---|---|---|
| 16.9 postnatal, EPDS, breastfeeding | partial | **EPDS cut-off is versioned config signed by the CMO**, not a fixed 13. Nigerian validation studies report cut-offs from 7 to 12 depending on language and period (**V**). Item 10 (self-harm) always routes to the crisis gate regardless of total (INV-01). Add a feed-log table and breastfeeding support content. Add baby-side checks (week 1, week 6). |
| 16.10 growth, milestones, immunisation, danger signs | partial, defective | **Load the real WHO 2006 LMS tables** as data with `reference_version` (weight, length or height, BMI, head circumference, MUAC for age, weight for length or height), golden-tested against `anthro` output. Add `muac_mm` and a severe-wasting indicator routing to the care team (PROPOSED). Fix the length-versus-height correction. Interpolate rather than nearest-age. Reconcile `child_immunisation_nphcda` against the current NPHCDA page, including the malaria vaccine doses (**U**); "next due" reminders generic (INV-07). Child records stay under the parent through the existing dependent model, with the adolescent gate. |
| 16.11 transitions | missing | A small lifecycle state machine (tracking, trying, pregnant, postnatal, parenting). Transitions are **confirmed events**, never silent inference: a person confirms a pregnancy, a delivery outcome, a pregnancy loss. Content and thresholds switch on the event. Pregnancy loss gets its own gentle path with no baby content (founder or CMO to write). |

### 4.4 S69 Module 17: Care Circle and community (17.1 to 17.9)

**What the full products do.** Strava has clubs, group challenges and privacy zones; Peloton has leaderboards with block and hide-tag controls but name, avatar and metrics stay public (**V**). Fitbit shut down open challenges in 2023 and kept private groups (**V**). Personify Health and Wellable run corporate team leaderboards (**V**). Omada pairs small peer groups with a coach (**V**). Medisafe Medfriend gives a view-only supporter and a missed-dose alert about an hour late (**V**). Lotsa Helping Hands, CaringBridge and ianacare coordinate caregiver tasks (**V**). WellaHealth HealthSend is a diaspora top-up wallet (**V**), which INV-09 forbids. Gamification harm: numbers fixation, guilt from streaks, more pre-existing eating-disorder symptoms among fitness-app users (**V**).

**What we already have (S29, live on `origin/main-dev`).** `care_circle_invites`, `care_circle_members`, RPCs for invite, preview, accept, cancel, update, revoke, renew; hashed single-use invite tokens (72 hours PROPOSED), HMAC-stored contacts; five permissions as a CHECKed array; pause, expiry notices, "who looked" log; `circle_supporter_view`; pay-for-a-loved-one through `create_order` with beneficiary; `care_circle_concierge` dormant `platform_modules` row; web and mobile screens. Near-misses to reuse: `wellness_challenges` and `patient_challenge_enrolments` (solo, no cohort link), `institutions/suppression.ts` (floor 5), the `care-circle-mirror.test.ts` config pattern.

| Fn | Status | Upgrade |
|---|---|---|
| 17.1 to 17.4 | built | Audit only. Close OQ-220 (same-organisation limit and join link lost across email verification), add native deep links, confirm the Paystack foreign-card setting (**V** it must be switched on) so diaspora supporters can pay. Recheck the wellness challenge ending nudge for INV-07. |
| 17.5 concierge | dormant flag | Leave dormant. No code. |
| 17.6 cohorts and challenges | missing | `community_cohorts` (not `cohorts`, which collides with `ngo_funded_cohort` and cohort targeting), `cohort_members`, `challenges`, `challenge_participation` (private to the member), `challenge_totals` (aggregate, no member id). Closed cohorts, invite by hashed token reusing the S29 pattern. Lay moderators (pastor's assistant, estate chair) invite, remove and close; **no free-text posts in v1**. Challenges chosen from CMO-approved templates. |
| 17.7 totals and rankings | missing | Server-side `challenge-aggregate`. **Rank cohorts, not people** (founder to confirm, OQ-NEW-1). Floor of 10 contributors (PROPOSED), suppress when any one member's exit would move a total beyond a set percentage, round, and delay updates. The existing floor of 5 is for institutional aggregates and is unsafe for a five-person cell group. |
| 17.8 live audio sessions | missing | Reuse the S21 Zoom path with a new room type: programme members only, clinician host, mute on entry, waiting room, audio only, **no recording, no scribe** (INV-11). Roster shows first names, is audit-logged, and each attendee is tied by a task or lead assignment (INV-12). Capped at about 20 (**U**), confirm the plan limit and Meeting versus Webinar. |
| 17.9 moderation, opt-out, notifications | missing | Per-cohort mute, global community off, leave anytime, report-and-remove, platform freeze. Notification text never carries a cohort name, metric name or progress figure. |

**Metric rule.** Effort counts only: days with a log, adherence check-ins, lessons done, activity minutes (consented wearables). Salt and hydration are self-reported "days I did it". **No weight, calories or BP values, ever** (Part C and the eating-disorder evidence). Rewards stay badges and the existing non-monetary points (INV-09, OQ-08). A workplace cohort gives the employer no view.

### 4.5 S70 Module 18: Devices, wearables and data connections (18.1 to 18.9)

**What the full products do.** Withings: best BP and scale cloud data, free self-serve API with a 1,000 active-user cap (**V**). Omron and Accu-Chek lock to their own apps (**U**). Dexcom: OAuth API, sandbox then commercial tiers, data delayed three hours outside the US (**V**). Libre has no official public API, only unofficial LibreView (**V**). KardiaMobile has an FDA-cleared AF, brady and tachy result and an SDK and cloud API under a commercial agreement (**V**/**U**). Aggregators: Terra about $399 a month plus about $0.80 per active user, ROOK $399 for 750 users, Vital $0.50 per user with a $300 minimum, Thryve covers Libre (**V**). Complaints: sync lag, silent disconnects, token expiry; wrist PPG SpO2 less accurate across skin tones (**V**, FDA draft guidance); OCR of seven-segment displays is error-prone (86.5 percent digit accuracy in one study, **V**).

**What we already have.** `patient_devices`, `patient_device_type` enum (bp_cuff, glucometer, scale, thermometer, pulse_oximeter, smart_band, ecg, peak_flow_meter), BLE in `apps/mobile/src/lib/ble.ts` for five GATT profiles, `POST /api/mobile/device-readings`, `device_catalog` with `active` and `clinically_reviewed` gates, `wearable_connections`, `wearable_readings`, adapters for Oura, WHOOP, Garmin, Fitbit, Dexcom, HealthKit and Health Connect bridges with background sync, per-category consent, `delete_wearable_connection_data()`, `vitals_readings.source` (manual, device, wearable, cgm, fhir_import) and a plausibility trigger that flags and never rejects. **BLE, HealthKit and Health Connect have never run on real hardware. No vendor has real credentials.**

| Fn | Status | Upgrade |
|---|---|---|
| 18.1 BLE pairing | built, untested | Hardware test with an A&D UA-651BLE and an Accu-Chek Guide before any model is named. Per-person pairing with a patient picker (shared phones). |
| 18.2 recommended devices | partial | Use `device_catalog`; add `validated_source_url`, `nafdac_number`, `authorised_distributor`. **Recommend only, never sell**, per the 2026-08-02 decision (spec wording "from official distributors" conflicts; record it). "Any other device: type it in." Show only `clinically_reviewed` rows. |
| 18.3 photo capture | missing | On-device text recognition (ML Kit, **U** for exact SDK), works offline, image not uploaded by default. The person edits and confirms every digit. The confirmed value goes through the **same deterministic triage as manual entry**. New source value `photo_confirmed` (own `ADD VALUE` migration). If a cloud vision model is ever used, register in `ai_systems` and route through `runGovernedAi()`. |
| 18.4 wearables | partial | Move Fitbit to the Google Health API now. Add Withings direct. Samsung through Health Connect only (Samsung's partner programme was closed, **V**). Skin temperature trends. Informational tiles only, per the standing founder decision. |
| 18.5 CGM | partial, dormant | Dexcom adapter exists; **no Libre adapter, do not use the unofficial API**. Add the missing abnormal-CGM escalation trigger (known gap). Defer the paid two-week insight programme (section 9). |
| 18.6 ECG | different shape | Keep PDF report upload. Add a `device.alert` path for a cleared device's own rhythm label, stored verbatim and shown as "from your device". It creates a **clinician task**, never a patient-facing diagnosis, and no notification names the condition. Needs a Kardia commercial agreement and counsel first. |
| 18.7 inhalers | missing | Drop from this release (no Nigerian supply). Keep the `peak_flow_meter` type only. |
| 18.8 band | paused | Dormant stub behind a guard, off. Confirm where D-22 is recorded (not found in `docs/DECISIONS.md`). |
| 18.9 source label and plausibility | partial | Source badge on every reading in every UI. Versioned, CMO-signable range table with two classes: **impossible** values are held as "please confirm" and never triage; **extreme but possible** values still triage, so a real crisis is never blocked. **Cross-source de-duplication**: same patient, vital type, value within tolerance, within a window, with a precedence order (BLE device, vendor cloud, aggregator mirror, manual). Keep one canonical row and link the other as superseded; nothing is deleted. Consider showing wrist SpO2 as informational only and excluding it from red-flag triggers (CMO). |

**Build versus buy.** Do not buy an aggregator now. Use direct connectors plus Health Connect and HealthKit as the primary route. Reconsider an aggregator once more than about three connectors need upkeep, or if a real Libre cohort appears. Define the `DeviceSource` interface (connect, sync, normalise, revoke) in a shared package and wrap the existing adapters behind it. Every connector sits behind its own go-live flag (the Connect card is currently ungated). Expo native modules need a `runtimeVersion` bump and a fresh EAS build before an OTA publish.

## 5. Cross-module seams

- **Private-section pattern** (S66): PIN or biometric, neutral notifications, audit log view. S67, S68 and S69 reuse it for pregnancy, child and cohort data.
- **Lifecycle events** (S66 to S68): `pregnancy.recorded`, `child.growth_recorded`, plus delivery and loss events through the S10 outbox.
- **Device readings into pregnancy and child** (S70 to S67/S68): a home BP cuff reading in pregnancy must hit the pregnancy rule set; a smart-scale weight must reach growth only through the parent profile.
- **Step and activity metrics** (S70 to S69): consented wearable data only, effort counts only.
- **One config pattern**: everything PROPOSED goes in the registry with a mirror test; the S37 guards screen shows `maternal_enabled`, `community_cohorts`, `group_sessions` and each connector flag.

## 6. Spec name to live table mapping

| Spec | Live | Action |
|---|---|---|
| `cycles` | `menstrual_cycles` (+ `menstrual_daily_logs` for symptoms) | map, no new table |
| `pregnancies` | `patient_pregnancy` (one row per patient) | add history table or migrate |
| `antenatal_schedule` | `antenatal_visits` | generate rows from config |
| `kick_counts`, `contractions`, `birth_plans` | none | new, fresh RLS |
| `children_growth` | `child_growth_measurements` | add `muac_mm`, versioned reference, no `z_scores jsonb` cache |
| `cohorts` | none (name collides) | `community_cohorts` |
| `challenges`, `challenge_totals`, `group_sessions` | none (`wellness_challenges` is solo) | new, link to existing for reuse |
| `device_connections` | `wearable_connections` | add enum values (withings, samsung, kardia, tarragon_band) |
| `observations.source = device` | `vitals_readings.source` + `device_id` | add `photo_confirmed` |

## 7. Safety, privacy and test plan

- **Fresh RLS proofs, with a sabotage step each, registered in `ci.manifest`:** caregiver, emergency, sponsor, employer, moderator and unrelated-clinician sessions all refused on every new reproductive, child, cohort and device table. A positive control for each that must succeed.
- **Sponsor test:** `sponsor_care_report()` and the sponsor UI can never include cycle, pregnancy, postnatal, contraception or child-growth rows; a voucher for a maternal item shows without detail.
- **Acceptance (spec):** BP 150/100 at 30 weeks with headache is red; fertile window always shows the "not contraception" label (snapshot test across every surface); individual values never appear in challenge views; duplicate readings from two sources are de-duplicated; irregular rhythm creates a task, not a diagnosis.
- **Added:** WHO golden tests against `anthro`; EPDS item 10 always routes to the crisis gate; INV-07 template lint extended; k-floor and leave-one-out tests; moderator-reads-no-health-data; roster read audit-logged; offline `pregnant` red rule fires on device; Part D check at close.
- **Retention.** The "no erase of real data" rule conflicts with a user wanting cycle or pregnancy-loss data deleted. Needs a decision before launch (section 9).

## 8. Effort and risk (rough, relative)

| Session | Size | Main risk |
|---|---|---|
| S66 | M | Section PIN recovery design; notification lint regressions |
| S67 | L | New tables, offline queue, CMO sign-off on four rule sets |
| S68 | L | WHO data import and golden tests; EPDS config; transitions UX |
| S69 | L | Aggregate privacy maths; group audio staffing and untested Zoom room |
| S70 | XL | Native modules, vendor agreements, real-hardware testing; split into S70a core and S70b connectors |

Recommend splitting S70 into S70a (device model, dedupe, plausibility, `DeviceSource`, recommended devices, source labels) and S70b (Fitbit migration, Withings, photo capture, ECG alert, CGM escalation).

## 9. Decisions needed

**Decided by the founder 2026-10-07 (selected in chat, recommended option each time; still to be written into `docs/DECISIONS.md` as D-numbers):**
- **17.7 rankings:** cohorts only. Members see their cohort's total and "goal reached", never a member rank. Effort metrics only, 10-contributor floor.
- **Section PIN:** optional, on by default, separate from the app lock. Forgotten PIN is recovered by re-verifying the account; server data is never lost. Emergency and danger-sign content stays outside the lock.
- **Deletion:** split by who recorded it. Patient-entered tracker data is deleted on request after a short grace window, with an audit receipt. Clinician-recorded or clinician-acted-on data is sealed, not erased. Counsel to confirm the NDPA 2023 carve-out wording.
- **17.8 group audio:** deferred. Build the schema and a dormant `group_sessions` module (off) only; revisit after S21 is proven on real devices and a rota and fee line exist.

Items 1, 5, 6 and 7 of the founder list below are answered by the above; the rest remain open.

**Founder**
1. 17.7: rank cohorts only, not members? (Recommended: cohorts only.)
2. Accept OS share-sheet links to WhatsApp while building no WhatsApp integration? Record it.
3. Drop 18.7 inhalers and defer the paid CGM programme? Keep 18.8 band as a dormant stub; where is D-22 recorded?
4. Aggregator budget versus direct connectors (recommended: direct).
5. Private-section PIN: mandatory or optional for reproductive sections, and recovery path (data unrecoverable, or re-verify the account)?
6. Pregnancy or cycle data deletion on request versus the no-erase rule.
7. Group audio: needs a clinician rota and a fee schedule line in S30. Build now or later?
8. Pregnancy-loss path and copy.

**CMO**
1. Sign BP-P1, P3, P4, the pre-eclampsia symptom group, kick count and contraction thresholds before `maternal_enabled` can flip.
2. EPDS cut-off per language and period; local validation?
3. Plausibility ranges, dedupe tolerances, rhythm-alert task priority and recipient, wording of "from your device".
4. Safe challenge templates for diabetes, pregnancy, insulin and eating-disorder history. Whether consumer wrist SpO2 may trigger anything.
5. SAM and MAM routing thresholds; WHO LMS data source and licence.

**DPO and counsel**
1. Cohort membership as sensitive data (religion, health), lawful basis and naming rules.
2. NAFDAC and MDCN stance on pregnancy monitoring and device rhythm flags.
3. Group-session roster retention and INV-12 treatment.
4. Supporters abroad as data subjects under NDPA 2023 (**V**: health data is sensitive).

**Engineering to confirm**
1. OQ-220 and OQ-192 status; whether Pidgin removal reached S29 strings.
2. Zoom plan limits for audio groups; Meeting versus Webinar.
3. Offline cached emergency facts design (OQ-90).

## 10. Evidence gaps

The research used search-result summaries, not full-page fetches. Features of Clue, Mira, Femometer, Huckleberry, Glow, Kindbody, Ubenwa, Maisha, Clinic.ng, Helium, Noom groups, Apple Fitness sharing, Mobicure, Piggyvest cohorts and Clubhouse-style moderation are **U**. Post-Dobbs subpoena risk, the validatebp.org listing for specific Omron models, the ESH and AHA home BP protocol, current NPHCDA malaria vaccine dosing and any Nigerian distributor names are **U**. Live Supabase state was not queried. The Module 17 audit read `origin/main-dev` only; S29 proof pass status was not read. The branch is 135 commits stale: rebase before any build.
