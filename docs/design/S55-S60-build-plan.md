# S55 to S60 build plan: Learning Centre, Mental wellbeing and sleep, Rewards, Symptom checker

Drafted 2026-10-07 on branch `s38/outcome-snapshots-analytics`. Planning document only: nothing here is built, applied or decided.
Inputs: `docs/v5-sessions/S55..S60`, `docs/BUILD-SPEC-v5.md` lines 1232 to 1440, a read-only repo audit, `docs/research/competitor-review-{global,africa}-2026-10.md`, and two fresh web research passes (confidence tags below: **V** verified by a fetched or searched source, **U** unverified, from background knowledge only).

## 1. Bottom line

1. **None of S55 to S60 is built as a v5 session, but about half of the underlying product already exists** as pre-v5 legacy work (health education, mental health screens, wellbeing check-ins, sleep log, wellness points, a deterministic symptom triage engine). The plan is therefore mostly upgrade, alias and fix, not greenfield. Spec table names (`content_items`, `mood_checkins`, `points_ledger`, `symptom_sessions` and so on) do not exist; do not create duplicates. Map them onto the live tables (section 6).
2. **Three existing defects should be fixed before any new feature**, because they contradict a spec acceptance test or a founder decision:
   - Content past its review date is still served (`20260830013226` keeps `review_due` items active). Spec 9 acceptance test fails.
   - OQ-08 (decided 2026-09-30: points are non-monetary) is not implemented. `redeem_wellness_points` still converts points to kobo at 50 per point and issues a voucher. This is also an INV-09 problem.
   - `symptom_triage` has no entry in the signed `escalation_slas` v7 (FOUNDER_DECISIONS A5), so urgent assessments break when the checker is switched on, and `private.handle_symptom_triage_assessment` raises.
3. **The biggest gap against competitors is Module 12, and the right answer is not to chase them.** Ada and Infermedica produce ranked possible causes. Our engine is deliberately a routing engine (three signed pathways, four categories, no differential). The evidence (Semigran 2015, Gilbert 2020, Babylon) says broad differentials are about 70% top-3 accurate at best and that marketing them early destroys trust. Recommended path: finish the safe, narrow, deterministic product first (S60-first), and treat the "possible causes" half of S59 as a separate, licence-gated track behind D-18 and D-19.
4. **S55 to S60 cannot start yet.** Every prompt's Step 0 requires `BUILD-PROGRESS.md` to begin "Stage 1 complete" (written by S40). It currently ends at S37 with S38 in progress. S32 (audio manifest) and S33 (BP course, BRE-01 breathing) are also not built and are real dependencies of S55 and S57. Section 3 gives the order.
5. **Decisions D-18 and D-19 are referenced by the spec but not defined** in `docs/DECISIONS.md` (it stops at D-13). The founder must define and decide them before S59 can choose an engine.

## 2. Hard constraints that shape every session

- INV-01: no model in the triage or crisis path. INV-07: notifications never name a condition or reading. INV-09: no stored balance. INV-11/INV-14: guard-gated clinical features. INV-12: staff see only patients they hold a task for. INV-15: money in integer kobo. INV-16: versioned protocols.
- PROPOSED values live in `packages/shared/src/proposed-config`, never in code. Strings go through `packages/i18n` (en, pcm). No em dashes in copy. "Your care team", never "your doctor" or "instant doctor".
- AI scribe/AI output never enters the record unsigned. No clinical protocol or rule set is signed by an agent (CMO signs).
- `private.is_org_staff()` currently gives org-wide staff read of `mental_health_screens`, `wellbeing_checkins` and `symptom_triage_assessments`. This is the INV-12 exposure the reconciliation already flagged. Mental health is the most sensitive of these; S56 should not add new tables that inherit that shape (see 4.2).
- Nothing in this plan is a clinical decision. Every threshold, instrument cut-off, helpline number, urgency mapping and reward amount is PROPOSED config awaiting CMO or founder sign-off.

## 3. Sequencing and dependencies

Gate: S38, S39, S40 land first. Then:

| Step | Work | Why this order |
|---|---|---|
| 0 | Define D-18 and D-19, record NAFDAC position request, confirm helpline numbers by phone | Long-lead items that are not engineering. Start now. |
| 1 | **Fix-first migration set** (three defects above) plus symptom-checker go-live guard row | Small, independently shippable, removes live contradictions. Can run before S40 as maintenance if the founder agrees. |
| 2 | S32 audio manifest and S33 (BP course, BRE-01) | S55 audio, S57 breathing and downloads depend on them. |
| 3 | S60 (safety half of Module 12) | Safety rails, audit loop and review tables must exist before a broader checker is exposed. |
| 4 | S55, S56 in parallel | Independent modules; S56 is higher clinical risk so give it the stricter review. |
| 5 | S57 (needs S56 and S32) | Media library depends on S56's privacy model and S32's audio pipeline. |
| 6 | S58 (needs OQ-08 fix, S55 lesson events, S56/S60 events) | Rewards subscribe to events the others emit. |
| 7 | S59 assessment extensions | Last, because it is gated by engine licence, NAFDAC position, localisation sign-off and an accuracy baseline. |

Note this reverses the numbering for S59/S60. The spec's own safety rule says red-flag handling must work independently of the engine, so building and auditing that half first is both safer and unblocks the go-live guard.

## 4. Module by module: benchmark, gap and plan

### 4.1 S55 Module 9: Health Learning Centre

**What the full products do.** NHS and Mayo use a fixed page template with a named reviewer, last-reviewed date and next-review-due date (**V**/high stability). Healthily and BabyCenter personalise by condition or due date and show reviewer credits (**U**). Noom's lessons are about five minutes and end in one action and a quiz (**U**, known product). Insight Timer pays vetted teachers from a pool, but quality is unvetted and open (**U**). Altibbi proves telco-bundled distribution (**U**). None of these ship Pidgin, Yoruba, Hausa or Igbo at clinical quality, and offline is a paid feature at Noom and Insight Timer (**U**).

**What we already have (reuse).** `health_education_content` with versioning, status lifecycle (draft to published to review_due), reviewer and source fields, `audio_url`, translations (pcm), programmes and modules (HTN/DM seeded), feedback, trigger mappings, recommendations, unlock notifications; `lpe_content_blocks` with embeddings and review-gate RLS; patient `learn` pages and mobile `learn-screen`; marketing share button; AI-009 registered.

| Fn | Status | Benchmark-informed upgrade |
|---|---|---|
| 9.1 formats | partial | Wire S32 audio manifest so `audio_url` is real; short illustrated explainer format; low-bandwidth image budget. |
| 9.2 courses | partial | Daily micro-lesson card on Today (S47 Today screen dependency noted); lesson = under five minutes, one action, one check question (Noom pattern). Emit `lesson.completed`, `course.completed` on the S10 outbox. |
| 9.3 search | partial | Synonym table ("BP", "sugar", "pressure", "high blood", "belle") held as config; Pidgin terms; log zero-result queries for content planning. Mobile search already exists, extend it, do not replace it. |
| 9.4 next step | partial | Make "What can I do next?" a required block in the content schema: self-care action, ask-your-care-team button (saves the lesson to the next consultation), book, or emergency. |
| 9.5 myths | missing | New series, authored by clinicians, with herbal-remedy interaction cautions. Content work, owned by CMO. |
| 9.6 review and offline | partial | **Fix expiry gate first.** Collapse `next_review_due` and `review_due_at` to one authoritative column. Offline download packs on mobile (text plus audio under a size cap, free, not a paid tier). |
| 9.7 creator programme | missing | `creators` table (verification, credentials, MDCN number, indemnity flag), invite-only (rejects the open-upload Insight Timer model for clinical content), every item still clinically reviewed, credited by name. Revenue share: do not build until a founder decision (OQ). |
| 9.8 share | partial | Share patient articles by link or email. Link must carry no PHI and resolve only to public, published, in-date content. |

**New.** Fixed, non-editable "when to seek urgent help" box rendered by the template, never authored by a creator. Reading-level check at authoring time (`reading_level` exists). Uniform Module-25 CMS dependency: until S80 exists, authoring stays in the current admin screens (record this in OQ).

**Safety and tests.** Acceptance: content past review date is not served (RLS and API level, plus the daily cron); a proof that sabotages the gate and fails. Share link test: unpublished or expired item returns 404. Offline pack test: pack excludes expired items and refreshes on reconnect.

### 4.2 S56 and S57 Module 10: mental wellbeing, sleep, meditation

**What the full products do.** Wysa: always-visible SOS to local helplines, scripted CBT tools, human coach tier, reports meeting NHS DCB0129 (**V**); FDA Breakthrough designation is a designation, not clearance (**V**), and a 2026 NHS trial result I could only see in a search summary is unconfirmed (**U**, do not cite). Woebot's consumer app closed 30 June 2025, with the founder citing regulatory uncertainty for LLM chatbots (**V**). BetterHelp paid $7.8M to settle FTC claims over sharing sensitive data with ad platforms (**V**). Headspace and Calm: large audio libraries with offline downloads on paid tiers, sleep stories, subscription dark-pattern complaints (**U**). Big Health: short daily sleep diary with weekly feedback, strong RCT base (**U**). Oura-style scores cause "orthosomnia" (**U**). Nigerian helplines SURPIN and MANI exist but the numbers came from directory listings and must be dialled before use (**U**).

**What we already have (reuse).** `mental_health_screens` (PHQ-9, GAD-7, AUDIT-C, EPDS, crisis flag, cadence governance, risk stratification), DB crisis trigger raising `emergency_events` (no AI), `wellbeing_checkins` (patient-private, not fed into risk scores), `sleep_log_entries` and goals, wearable sleep minutes, therapy network and sessions, corporate cohort summary with minimum cohort size, `keyword-guardrail.ts` for the coach.

| Fn | Status | Plan |
|---|---|---|
| 10.1 check-ins | exists | Add optional tags; show mood beside BP and sleep trend (S07/S47 surfaces). Keep patient-private. |
| 10.2 PHQ-9, GAD-7 | partial | Emit `questionnaire.completed`. Re-measure schedule and change tracking exist; add a clinician follow-up pathway task (a real `clinical_tasks` row, S16). Alias the spec's `questionnaire_responses` to `mental_health_screens`. |
| 10.3 crisis | partial | **Highest priority in this module.** Today the trigger raises `emergency_events` but creates no `clinical_tasks` priority task and emits no `crisis.detected`. Add both, via the S19 paging path so it never waits for a pull (INV-05). Crisis card on the same screen with 112, the nearest-hospital action and verified helplines, each with a "last verified" date held in config. Works offline (INV-06): bundle the card. No AI. |
| 10.13 human care | partial | Booking hand-off from a positive screen to a consultation with the summary attached; onward referral to local mental-health services (Module 15 dependency; stub as a referral task until then). |
| 10.4 to 10.9 library | missing | New `media_library` (kind, language, voice, length, bytes, `creator_id`, review fields, download pack size) reusing the 9.6 review gate and S32 audio manifest. Series: stress, grief, work, exams, faith-compatible reflection. Local-voice sleep stories (a clear competitor gap). Downloads over Wi-Fi only, default under 5MB per track. Journal with prompts is device-first, encrypted at rest, never synced unless the patient opts in. Scripted self-help exercises are reviewed scripts, not generated text. |
| 10.7 breathing | missing | BRE-01 comes from S33; S57 adds the 3 to 5 minute variants. |
| 10.10 sleep | partial | Add the wind-down planner. Do **not** show a single sleep score (orthosomnia). Short diary plus weekly efficiency feedback. |
| 10.11 snoring and sleepiness | partial | Add a STOP-Bang style questionnaire (instrument and cut-offs are PROPOSED, CMO-signed) with a referral task if apnoea is suspected. Currently only one `daytime_sleepiness` item. |
| 10.12 programmes | missing | Deferred to Module 14 (S63). Record only. |

**Privacy design (do first in S56).**
- New mental-health rows get per-patient access, not `is_org_staff`: a clinician sees them only through an assigned task, lead assignment or on-call page (INV-12) and every read is audited (INV-10). Plan a follow-up migration to move the existing three mental-health tables onto the same model; this is also the spec's "(b) phase it" option in OPEN-QUESTIONS and needs a founder answer.
- Sponsors, employers and Care Circle never see this data without an explicit, revocable, per-category consent. Add the missing consent hook for Care Circle.
- Neutral notification text (INV-07), shared-phone mode (no mood data on lock screen or notification, quick-hide, optional PIN), no analytics or ad SDKs on any mental-health screen (BetterHelp precedent). Add a lint or scan test for the SDK rule.
- Keep the mobile `lib/mental-health.ts` em-dash fix recorded in RECONCILIATION.

**AI stance.** No conversational AI therapy. Spec says AI is never presented as therapy. Scripted exercises only; if an AI companion is ever considered it needs its own `ai_systems` registration, a kill switch, and the scripted core must keep working with it off (Woebot lesson).

**Tests.** Acceptance: PHQ-9 item 9 positive creates a priority task and shows the crisis card; sponsor dashboard never includes mental health data. Add: a dedicated DB proof for the crisis trigger (none exists today), a sabotage that removes the trigger, an RLS proof that refused roles are refused, an offline test for the crisis card, and a scan test for tracking SDKs.

### 4.3 S58 Module 11: rewards and engagement

**What the full products do.** Discovery Vitality: five tiers (Blue to Diamond), annual points reset with earned status kept, partner-funded rewards, rewards tied to verified actions like screenings and vaccinations (**V**). Personify/Virgin Pulse, Sidekick, Noom: points, streaks, challenges, employer pools (**U**). The best independent evidence (Illinois workplace wellness RCT) shows incentives raise participation but not biometrics or spend, and that healthier staff self-select in (**V**). Known harms: weight and calorie rewards, shaming leaderboards, streak anxiety, step gaming (**U**).

**What we already have (reuse).** `wellness_points_*` (config, balances, ledger with idempotency index and daily caps, redemptions), 10 badges, challenges with enrolment and cron evaluation, earning triggers for vitals, meals, adherence, lessons, tasks and goals, patient and admin screens on web and mobile, and no points for weight-loss amounts.

| Fn | Status | Plan |
|---|---|---|
| 11.1 earning | partial | **Move hardcoded trigger points into `reward_rules`** (alias of `wellness_points_config`, versioned, PROPOSED). Subscribe to S10 outbox events instead of ad hoc triggers so replay is idempotent by event id. Add screenings done and programme milestones. Reward verified clinical actions (BP check, lab done, refill, review attended) over raw steps. Weight each action once or with decay so returns do not flatten into spam (Illinois). |
| 11.2 redemption | partial | **Implement OQ-08.** Remove the 50 kobo per point conversion and any voucher-as-cash path. Redeem points as a capped discount at checkout (S71/S72 dependency; until then, redeem against Tarragon-funded discount codes only). Enforce the cap (configured share of an item price) in the database. Points are non-transferable and non-cashable. |
| 11.3 levels | partial | Add yearly reset tiers that keep earned status (Vitality pattern) and a missed-day grace period. Badges for consistency only, never body size. Leaderboards off by default, no comparison with others, no loss framing. |
| 11.4 employer pools | missing | Defer to S79 (Module 24). Design now: aggregate-only reporting (I9), per-person cap, never individual status to the employer. |

**INV-09 clean-up.** `wellness_points_balances` is a points count, not money, which is acceptable once the kobo conversion is gone. `care_vouchers` still holds face value; OQ-07 already decided a rebuild around order-linked sponsor checkout. S58 must not extend vouchers; reconcile with S25/S29.

**Safety and tests.** Acceptance: replaying an event does not double award; discount cannot exceed the cap. Add: a test that no rule can reference weight, BMI or body metrics; a proof that no column or function converts points to kobo; a minors rule (no variable or gambling-like rewards); a check that a streak never nudges a late dangerous reading (red readings still go to triage first). There are currently no wellness unit tests, so S58 starts with characterisation tests of the existing award function before changing it.

### 4.4 S59 and S60 Module 12: symptom checker and assessment

**What the full products do.** Infermedica: knowledge-base Bayesian engine, EU MDR class IIb, API licensing with quote-only pricing, a Nigeria deployment case study, accuracy figures that are vendor-claimed (**V** for class and case study, **U** for accuracy). Ada: Gilbert 2020 found 99% condition coverage and 70.5% top-3 accuracy versus 82.1% for GPs, a Swahili local-language study protocol exists (**V**). Semigran 2015 across 23 checkers: triage correct 57% of the time, correct diagnosis first 34%, with a bias toward caution (**V**). Babylon: reassuring on heart attack and pulmonary embolism, an unverifiable exam claim, bankruptcy in 2023 (**V**). Buoy, K Health, Ubie, Healthily: classes and evidence not verified (**U**). Zuri Health: no confirmed symptom engine (**V**). NAFDAC published a draft Medical Devices and IVD regulation in July 2025 with no software-specific criteria, and I found no final text (**V** for the draft, **U** for current status).

**What we already have (reuse).** `packages/symptom-triage-engine` (deterministic, no LLM, signed v1 pathways: headache, chest pain, breathlessness; v2 with fever and abdominal pain drafted but not active), red flags screened first and independent of any engine, `symptom_triage_assessments`, `triage_protocols` with CMO-only signing, `symptom_triage_safety_monitoring`, paediatric danger-sign rules, the symptom red-flag handler that pages a clinician, a symptom-to-test checker, patient web and mobile screens, a "not a diagnosis" marketing page. S11/S12 BP triage is separate and shadow-only until the CMO signs a rule set (OQ-88).

#### S60 first: safety half

| Fn | Status | Plan |
|---|---|---|
| 12.8 red flags first | exists | Add the missing acceptance test at the product level: chest pain with sweating returns emergency even if the engine is down or times out (fail toward escalation). Bundle red-flag content for offline (INV-06), and evaluate red flags on device. |
| 12.9 labelling | exists | Put the "possible causes, not a diagnosis, your care team confirms" label in one shared component, used everywhere, not per-screen copy. |
| 12.10 doctor review | partial | Create `symptom_reviews` (clinician, final diagnosis code, agrees, reviewed_at) and a stated review time driven by `escalation_slas`. **Fix the missing `symptom_triage` SLA entry** (needs a new signed SLA version; the founder or CMO signs, not an agent). |
| 12.11 knowledge base | partial | Record provenance, version and clinical sign-off for each pathway; define "Nigerian prevalence" as versioned config (malaria, typhoid, Lassa season, sickle cell) that the red-flag and urgency layers can read. Not a diagnosis input yet. |
| 12.12 accuracy audit | missing | Monthly job comparing the checker's category and (later) top suggestions with the clinician's final diagnosis, by age, sex and region, with confidence intervals and a minimum cell size. First report is a baseline, not a claim. Never publish accuracy numbers before an independent local validation (Babylon, Ada AFYA design). |
| 12.13 NAFDAC | missing | A recorded regulatory position, not code. Classify conservatively as decision support, obtain Nigerian counsel's view, record in `docs/DECISIONS.md`. Add `symptom_checker_enabled` to the S37 guard table with conditions: position recorded, engine licence or internal validation recorded, localisation sign-off, accuracy baseline present. |
| go-live | missing | The guard does not exist today (S37 seeds seven guards, none for this). Add it, seeded off. |

#### S59 second: assessment half, split into two tracks

**Track A, no licence needed (build now after S60):**
- 12.4: extend four categories to the six urgency levels as a mapping table (self-care, see a pharmacist, doctor within days, within 24 hours, today, emergency now). The mapping is PROPOSED config signed by the CMO. Keep the current four-category result as the source of truth and derive the six levels, so existing escalations are unchanged.
- 12.5: next-step hand-off: book a consultation with a structured summary attached, a lab or home test, nearest clinic, self-care content (links into S55), or emergency guidance. Summary must appear in the clinician's patient summary (acceptance test), written only after the patient sends it.
- 12.6: dependants answered by a parent or carer, with paediatric-first pathways (IMCI-style danger signs exist; add paediatric fever and dehydration pathways), pregnancy branch that tightens thresholds.
- 12.2: use age, sex, pregnancy, known conditions, medicines and recent readings as inputs to **urgency tightening only** (never to loosen). Add the travel and seasonal risk input from versioned prevalence config.
- 12.7: photo upload for a doctor to review (`skin_photos`, no automated score, stored privately, reviewed under a task). Do not use any automated skin-cancer scoring; SkinVision's regulatory status is unverified and the spec forbids it.
- 12.1: adaptive questioning in English and Pidgin from signed content, text first; voice input is a later add-on. Early-stop questions for slow connections. Add `symptom_sessions` as an alias or view over `symptom_triage_assessments` plus engine and version columns.
- Add the `SymptomEngine` interface (`start`, `answer`, `result`) with the in-house engine as the first adapter. This costs little and makes a licensed adapter a drop-in later.

**Track B, licence-gated (do not start until D-18 and D-19 are decided):**
- 12.3: possible causes with prevalence and what makes each more or less likely. This is the only part that needs a licensed knowledge base or a validated internal one. My recommendation, matching the verified evidence: keep the deterministic red-flag and urgency layer in-house, and evaluate a licensed engine only for the differential. Gate any trial on a Nigeria-specific validation plan, data-residency and NDPA cross-border transfer analysis, language coverage (African languages are thin), and a contractual right to export our session data. No price is public; request quotes. Register any new call site in `ai_systems` and `runGovernedAi()` equivalent, and keep the engine unable to downgrade a red flag.

**Do not build:** LLM free-text triage, photo-based diagnosis, any "beats doctors" or accuracy claim, or a symptom engine reachable without the go-live guard.

**Tests.** Acceptance: chest pain with sweating returns emergency even if the engine fails; session summary appears in the clinician patient summary when a consultation is booked. Add: sabotage that disables the engine and still gets emergency; a monotonic-urgency property test (extra inputs never lower urgency); a guard-off test (checker unreachable with the flag off); RLS proofs for `symptom_sessions`, `symptom_reviews` and `skin_photos` per role, using per-patient clinician access, not `is_org_staff`.

## 5. Cross-cutting work and decisions needed

**Fix-first migrations (new version numbers from wall-clock, check `list_migrations` live first, per CLAUDE.md):**
1. Hide expired learning content, one authoritative review column.
2. Implement OQ-08: drop `kobo_credited` conversion and voucher issue from points redemption.
3. Add `symptom_triage` to `escalation_slas` (new signed version, signer is the founder or CMO) and the `symptom_checker_enabled` guard row.
4. Add the crisis `clinical_tasks` task and `crisis.detected` event.

**Shared infrastructure to build once, not per session:** a content review gate used by 9.6 and 10.9; an offline pack mechanism used by learning, meditation and the crisis card; module events on the S10 outbox (`lesson.completed`, `course.completed`, `questionnaire.completed`, `crisis.detected`, `points.awarded`, `symptom_check.completed`, `symptom_review.completed`), none of which exist today; i18n key namespaces (`learn`, `mood`, `sleep`, `crisis`, `points`, `symptom`) in en and pcm, since `packages/i18n` has none; a "not a diagnosis" component; a verified-helpline config with last-verified dates.

**Decisions the founder or CMO must make (draft entries for `docs/OPEN-QUESTIONS.md`):**
1. D-18 and D-19: define them, then choose licensed engine versus in-house for the differential (4.4 Track B).
2. NAFDAC and counsel position for a symptom checker, and whether MDCN treats triage software as practice.
3. Mental-health data access: phase to per-patient access (spec option b)? Recommended yes, mental health first.
4. Who verifies and owns the crisis helpline list, and the staffed callback SLA for a crisis flag.
5. CMO sign-off ownership for: six-level urgency map, STOP-Bang cut-offs, PHQ/GAD follow-up pathway, prevalence config, myth-busting content.
6. Creator programme: payment model, credentialing evidence, indemnity.
7. Points: cap share of item price, yearly tier thresholds, whether Tarragon or partners fund discounts.
8. Language scope: spec says en and pcm; the repo has an English-only founder decision (2026-08-03) and the spec has Pidgin. Confirm which applies to patient-facing assessment and meditation audio.
9. Whether to ship fix-first migrations before S40 as maintenance.

## 6. Spec-to-live table mapping (alias, do not duplicate)

| Spec name | Live object |
|---|---|
| `content_items` | `health_education_content` (+ versions, translations) |
| `course_progress` | `health_education_progress`, `health_education_programme_modules` |
| `creators` | new |
| `mood_checkins` | `wellbeing_checkins` |
| `questionnaire_responses` | `mental_health_screens` |
| `sleep_logs` | `sleep_log_entries` |
| `media_library` | new |
| `points_ledger` / `reward_rules` / `reward_redemptions` | `wellness_points_ledger` / `wellness_points_config` / `wellness_points_redemptions` |
| `symptom_sessions` | view or extension of `symptom_triage_assessments` |
| `symptom_reviews`, `skin_photos` | new |

## 7. Rough sizing

Counting build sessions, not calendar time: fix-first set 1; S32/S33 prerequisites already planned; S60 about 2; S55 about 2; S56 about 2 (privacy migration is the heavy part); S57 about 2; S58 about 1 to 2; S59 Track A about 2; Track B undetermined until the licence decision. Each session also carries its own `/code-review high` and DB proofs per the Definition of Done. Non-engineering lead items (helpline verification, counsel, CMO signatures, content authoring, audio recording) are the real critical path.

## 8. What was not verified

Pricing for every competitor; Vitality Nigeria status; Personify, Sidekick, Omada and Healthily mechanics and regulatory classes; SkinVision's classification; Kenya and Rwanda precedents; whether NAFDAC has finalised its device regulation; whether MANI and SURPIN numbers currently answer; the Wysa 2026 trial; any app-store listing, screenshot or onboarding flow (the design lens is open for all products); mDoc, Wellahealth, Vula and Jacaranda details. Treat every **U** tag as a lead to check, not a fact. The repo audit was read-only and by search, so a function marked "missing" means no matching code was found, not that it was proved absent.

## 9. Founder decisions given 2026-10-07 (in chat) and build rules

1. Gate: build ahead of the S40 gate as stacked PRs off `origin/main-dev`; open PRs, do NOT merge any until S38 to S40 land.
2. Production: apply migrations live after a rolled-back dry run, version pinned to the filename timestamp (never bare apply_migration), `list_migrations` checked first. Edge function deploys use `supabase functions deploy`, never a placeholder.
3. Module 12: interface plus in-house adapter only. No possible-causes screen, no licensed or mock differential. `symptom_checker_enabled` stays OFF.
4. Mental health: move all mental-health tables to per-patient access (INV-12) with audited reads (INV-10) and RLS proofs for every role.
5. Agents never sign clinical protocols, SLAs, rule sets, urgency maps or STOP-Bang cut-offs; they build drafts and the sign-off UI. Anything needing CMO/founder signature, counsel, helpline phone verification or content authoring is listed as a follow-up, not faked.

## 10. Founder and CMO decisions, 2026-10-07 (second round, in chat)

Release: apply each migration to production, then merge its PR straight away (stack order, after review fixes and green CI).
Voice: phone keyboard dictation only; no server speech-to-text. Language: English only (D-14). Creators: fixed fee per approved item via the S30/S31 earnings ledger. Mobile audio downloads: build behind a flag, needs a native build.
No helplines exist in Nigeria: crisis card says go to the nearest hospital now, 112 only where it connects; no helpline numbers anywhere; no callback promise until staffed.
CMO accepted for signing: C1 SLA v9 (symptom_triage 60 min urgent / 24 h review), C3 degraded mode (3 s, unclassifiable = urgent), C6 child policy + 14-day context, C7 accuracy audit; C14, C15, B1 to B4 rewards/offline/library config, C13 config, C19a-d. Chest pain: remove the severity floor for the cardiac pattern in a NEW draft protocol version for CMO review. Urgency map: reword 'urgent' to 'get care today' (still draft). HOLD with sourced redraft: C4, C5, C8 (merge with v2 adult draft), C12.
Review requests: Members only; Free sees the message route. Children: block the checker for under 18 until the paediatric protocol is signed, require date of birth; a carer may book an adult consult for the child's concern. Baseline: clinician-reviewed scripted test cases. Close the org-wide staff read of symptom assessments behind an audited function. Faith-compatible content: CMO writes, named faith-leader reviews. Expiry flag job runs daily.
Mental health: break-glass keeps opening it; psychiatry booking approval proposes a slot and the patient confirms; new `crisis_follow_up` task type; admin view-as never sees mood or screen data.
Other: keep Nigerian search words, search gap log OFF; points never expire, class points capped 2/day; journal key lost = copy lost; lesson/rewards event failures open sev2/sev3 not sev1. Everything else follows the sign-off sheet's recommendation.
