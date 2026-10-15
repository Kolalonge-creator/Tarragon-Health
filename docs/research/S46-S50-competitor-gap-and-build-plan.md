# S46 to S50: competitor gap review and build plan

Date: 2026-10-07. Scope: S46 (Module 3 part 2), S47 (Module 4), S48 (Module 5), S49 and S50 (Module 6).
Spec source: `docs/BUILD-SPEC-v5.md` lines 890 to 1113. Session prompts: `docs/v5-sessions/S46` to `S50`.

## 0. How this was produced, and what is not verified

- Repo state was read from `origin/main-dev` with `git grep`, not from the live database. Anything marked "exists" means a migration or source file is on main-dev; it does not prove the live schema matches (CLAUDE.md warns about this repeatedly). Each session must check live definitions before extending.
- `docs/BUILD-PROGRESS.md` on main-dev has no S40 "Stage 1 complete" entry and no S41 to S45 entries. Every session prompt tells the agent to STOP in that case. Either those entries live on unmerged branches or the gate has not been written. Decide this first (section 6, item 1).
- Competitor facts come from two sources: the repo's own reviews (`competitor-review-global-2026-10.md`, `competitor-review-africa-2026-10.md`) and web search summaries run today. No app was installed and no screenshot was inspected. Vendor outcome numbers are marketing claims. Features from my own background knowledge are marked (bk) and should be re-checked in each session's Step 2 research.

## 0b. Revision 1: founder decisions, 2026-10-07 (these override the sections below)

| # | Decision | Effect on the plan |
|---|---|---|
| R1 | Voice logging (4.4) is dropped from this batch. No vendor. | S47b loses voice. Logged as a descope in `OPEN-QUESTIONS.md`. Re-open only on an explicit ask. |
| R2 | Naira-budget meal plans and shopping list (6.12) are dropped. | S50a loses 6.12. The existing AI-011 meal plan stays as is. |
| R3 | Everything else is built end to end, including fasting safety (6.13), glucose response (6.11), the low-carb programme (6.10), workout gate, new log types. 6.10 and 6.13 ship with their go-live guard OFF. | No more "dormant, maybe later" items except where a real credential is missing (CGM, wearable cloud). |
| R4 | Part C bans stay: no imaging, no genetic tests, no intermittent-fasting timers, no public routes or maps, no voice or face health scores. | Unchanged. The Health Report must not add imaging, genetic or "biological age" sections. |
| R5 | Split S46, S47, S48 and S50 into a and b stacked PRs, with a shared first PR for the new observation types. | Adopted as section 4. |
| R6 | The CMO signs configured clinical items in chat, with the full text shown first. | Each session ends with a "to sign" pack (section 0c). The agent runs a signing RPC only after the founder approves that specific item, using the existing CMO chat-signing method. Every new governed config must also be registered in the sign-off hub (`GOVERNED_CONFIG_TABLES`, queue, a `_signoff-panels` panel, `CONFIG_PANELS`), or the scan test fails. This is how it stays usable on the platform later. |
| R7 | No packages. Tarragon sells a Membership that includes an annual blood test and review. HBsAg is part of that annual check. Anti-HBs is not something a patient orders. | 3.6, 3.7, 3.8 package wording does not apply. See R9 for how 3.12 still works. |
| R8 | The Health Report is assembled without any AI model in version 1. It must be better than competitors, not just the Passport re-skinned. | Section 4, S46b is rewritten below. |
| R9 | (My proposal, needs your yes.) Hepatitis B immunity: when the annual HBsAg is negative and immunity is unknown, the lab adds anti-HBs once as a clinician-set add-on to that same annual draw, never a patient-selectable item. A result at or above the CMO-signed threshold marks the patient immune and retires the annual HBsAg. HIV and hepatitis C stay annual. | Without some anti-HBs result the immune state can never be reached, so this is the smallest change that makes 3.12 work. The threshold and the wording go in the signed lab-panel and screening-rule config. |
| R10 | Private GPS routes: built now, plus an emergency location feature "so the patient can be located". | CONFLICT, see 0d. |
| R11 | The Stage 1 gate (S40) must be done before S46 to S50 start. | See 0e: it cannot pass today. |

### 0c. What the CMO will be asked to sign, by session
Each item is a versioned config row. The session presents the exact content, flags the judgement calls, and waits for your approval before anything is signed.

| Session | Item to sign | What it contains |
|---|---|---|
| S46a | Screening rule set revision | Hepatitis B rule (R9): add-on conditions, immunity threshold, retirement of annual HBsAg, HIV and HCV stay annual; pathway suppression list. |
| S46a | Lab panel revision | Anti-HBs as clinician add-on to the annual panel. |
| S46b | Health Report spec v1 | Sections, which biomarkers appear, range sets, how "on target" is decided, the three-priority selection rules, the standing not-a-diagnosis wording, what is excluded (sensitive positives, imaging, genetic). |
| S47a | Observation plausibility limits v1 | Hard and soft limits per type: glucose, weight, waist, temperature, SpO2, water, mood, sleep, inhaler use. |
| S47a | Glucose timing and BP technique wording | Patient-facing guidance text. |
| S48a | Activity safety rules v1 | Rest and restrict rules by pathway state and recent red or amber events; conditions covered: hypertension, diabetes, pregnancy, arthritis, back pain; effort values for local activities. |
| S48b | Workout plan set v1 | Starter plans and chair-based classes, their audio scripts. |
| S49a | Nutrition safety limits v1 | Minimum calorie floors, groups for whom targets are hidden (pregnancy, clinician flag), salt, sugar, fibre targets. |
| S50a | Eating plans v1 | Hypertension, diabetes, kidney, pregnancy and weight plans; swap table. |
| S50b | Fasting safety rules v1 | Who may fast, who is blocked, what needs a signed medicine timing plan (insulin and sulfonylureas), Ramadan and Lent date config. |
| S50b | Low-carbohydrate T2D protocol v1 | Eligibility and exclusions, check-in cadence, glucose and ketone thresholds, when a doctor must review medicines, stop rules. Guard stays OFF after signing until a doctor and dietitian rota exists. |

### 0d. GPS and emergency location: needs your decision
The spec (5.7 and its acceptance test "Routes are never shared") and Part C make routes private and unshareable. "Locate the patient in an emergency" is the opposite behaviour for the same data, so building both into one route recorder would break the invariant. Recommended design, which keeps both:
- Route recording stays private and off by default, as specified.
- A separate emergency location feature: the patient's last known position is captured only when the patient presses an SOS button or a red event fires with the patient's prior consent, and is shown only to the paged clinician and the patient's chosen emergency contacts for a short, logged window. Notifications still never carry location or condition (INV-07), and nothing is stored as a route.
- Needs: written consent text, a retention period, an `OPEN-QUESTIONS.md` entry recording that this is an exception request to the route rule, and counsel's view under NDPA. I will not start the route code until you confirm this split.

### 0e. Stage 1 gate (S40): findings
S40 is not a feature. Its prompt says "Do not build features": it runs the whole test matrix (unit, database, integration, Maestro, Playwright, all 25 clinical safety cases, performance), writes `docs/STAGE-1-SIGNOFF.md`, and only then writes "Stage 1 complete". Neither file exists. It depends on S39, and Stage 1 is not finished. Open PRs as of today:

| Stage 1 item | State |
|---|---|
| S28 pharmacy partner | PR 990 open |
| S32b device audio layer | PR 980 open; S32b wording PR 989 is a draft that must not merge before the CMO signs |
| S33 BP course and breathing | PR 982 open |
| S34 low data, accessibility, size | docs only (PR 966); not built |
| S35b, S35c clinician console follow-ups | PRs 967 and 975 open |
| S36 console operations, lead and admin | PR 987 open |
| S37b guard safety cases | PR 971 open |
| S38 outcome snapshots | PR 968 open; S38c and S38d PR 988 open; this checkout also has uncommitted S38 work |
| S39 security hardening | PR 986 open |
| S21h Zoom host key | PR 973 open |

Also: the English-only change (PR 991, and an earlier PR 984) removes Pidgin while the S46 to S50 prompts require `en` and `pcm`; settle which wins before these sessions write copy.

Honest limit: the matrix needs Docker, Maestro and a device, which have not been available in earlier sessions, so I cannot certify "Stage 1 complete" from here. What I can do is merge-order the open PRs, finish S34 build work, then run what is runnable and list exactly which checks need your machine.

## 1. What already exists (so we upgrade, not rebuild)

| Area | Already on main-dev | Gap against the v5 spec |
|---|---|---|
| Risk and screening (3.1 to 3.5) | Risk questionnaire plus CMO-signed config, WHO/ISH based CV risk (`lib/cv-risk/assess.ts`, with lab-optional fallback), yearly reassessment cron, screening schedules with cadence, decline and self-reported completion, pathway suppression migration, preventive calendar UI | Owned by S45. S46 depends on it. |
| 3.11 Pathway suppression | `20260802212440_screening_pathway_suppression.sql` | Audit against the acceptance list; add a test per owning pathway. |
| 3.12 Hepatitis B immunity | `serology_state_machine` migration has the `immune` / `susceptible` states but its own header says anti-HBs is not orderable, so the trigger can only reach `chronic_hbv` or `hbv_negative` | Real gap. Needs anti-HBs in the catalogue and panels, the transition to `immune`, and a rule that stops annual HBsAg after immunity is confirmed once. |
| 3.13 to 3.14 Results | Release state machine (INV-03, INV-04), partner result entry (S27), audio manifest (S32) | Verify the plain-language explanation plus audio plus one next step on every released result. |
| 3.15 Health Report | Health Passport PDF (`health-passport-document.tsx`) and a "Quarterly Family Report" wrapper around it. Biomarker category card. Nothing named `health_reports`. | Not built. This is the main S46 build. |
| 3.16 Not-a-diagnosis statement | Not found as a shared component | Build once, test that it renders on every result and report screen. |
| Today screen, BP log, streak with freeze (4.1, 4.2 part, 4.5 part) | S07: `today-model.ts`, `streaks.ts` with freeze and excused days (PROPOSED rules in config), BP quick log, glucose red-flag code | Remaining observation types, plausibility config, technique guidance, voice, weekly cards, readiness, edit history. |
| Observation store | v5 `observations` is a `security_invoker` view over `vitals_readings`. Live `vital_type` enum: blood_pressure, glucose, weight, pulse, temperature, spo2. | Needs waist, water_ml, mood, sleep_hours. Extending an enum that feeds red-flag triggers is a safety-relevant change. |
| Activity (5.1, 5.2 part) | `patient_activity_goals`, `activity_log_entries` (steps or workout, manual plus wearable source), web activity page, HealthKit and Health Connect sync code (never run on a real device) | No `activity_sessions` shape, no phone-sensor steps, no workout plans, no condition-safe gate, no routes, no readiness scores. |
| Food (6.1 to 6.6 part) | `nigerian_foods` with portions, cost tier, aliases; `nutrition_log_entries` with parsed items and confirmed sodium; AI-008 meal photo estimate (governed, eval script); AI-011 meal plan (governed, scope guardrail eval); `nutrition_referrals` | No v5 `food_logs`/`barcodes`, no wrap or ladle units, one-tap repeat, favourites, macro targets with safe minimums, barcode. |
| Guidance (6.7 to 6.14) | Meal plans, glucose insights card, glucose red flags | No fasting safety, no low-carb T2D programme, no meal-level glucose response, no naira-budget planner with shopping list. |

## 2. Competitor comparison by session

"Complaint" rows are the usual weak points reported for the product; confirm in each session's research file.

### S46: engine logic, results, yearly Health Report

| Reference | What the full product does | Weakness or risk | Tarragon move |
|---|---|---|---|
| Function Health | About 100 or more biomarkers, a follow-up panel about six months later, clinician notes, per-biomarker explanation and action plan, urgent-result call. Priced at $365 a year after a late 2025 cut. Whole-body imaging sold as add-on. Labs via Quest (web search, today). | US pricing and lab network; breadth invites over-testing and false-positive anxiety (bk). | Keep the shape (panel, clinician note, plan) at Nigerian scope. No imaging (Part C). A short, ranked output beats 100 numbers. |
| InsideTracker | Biomarker plan with a "biological age" style score and food and supplement advice (bk). | Supplement upsell; a single age score overclaims. | No age score. Three priorities only. No supplement selling. |
| Neko Health | One-hour body scan, in-person clinician review of every result, body composition added June 2026, Apple Health sync for year-round plans (web search, today). | Hardware and in-person only; its imaging is out of scope here. | Borrow the "clinician explains it in person or by video" step through the Annual Health Check video visit (3.8). |
| Healthtracka (Nigeria) | Results emailed in 24 to 48 hours, no clinician interpretation (repo review). | Privacy and no follow-up. | Our release rules and in-app plain-language result are the differentiator; never email raw results. |

Premium Tarragon version: a clinician-signed, illustrated yearly report with what changed, what is on target, and exactly three priorities, in text and audio (English and Pidgin), always carrying the "does not rule out disease" statement, with sensitive positives never inside the auto-generated body (INV-04).

### S47: Today screen and daily log

| Reference | What the full product does | Weakness or risk | Tarragon move |
|---|---|---|---|
| Noom, MyTherapy | Daily task list, reminders, small lessons (bk). | Noom's billing dark patterns are listed in Part C. | One screen, at most two primary actions (acceptance test). No auto-renew. |
| DarioHealth, mySugr, Omada | Logging tied to coaching, customisable log fields, shareable reports, BP and glucose technique tips (repo review). | Hardware lock-in (Dario); dosing advice needs clearance (mySugr). | Technique and timing tags (fasting, before meal, after meal) on every glucose entry; no dose advice. |
| MyFitnessPal | Fast logging of many entry types, recents (bk). | Heavy screens, paywalled features (bk). | Single quick-log sheet for every type, offline. |
| Oura, WHOOP | Daily readiness score from sleep, HRV, resting heart rate (bk). | Opaque score; no clinical validation in West Africa. | Readiness shown as plain-language bands for wearable users only, labelled an estimate. |
| CareClinic | Full edit history on entries (repo spec cites it). | n/a | Append-only revision table; the chart shows the current value and a "changed" marker. |

Premium Tarragon version: offline-first logging for nine entry types with plausibility checks that explain, not just refuse; gentle streaks that already exist; voice entry that always lands on a confirm card.

### S48: activity, fitness and movement

| Reference | What the full product does | Weakness or risk | Tarragon move |
|---|---|---|---|
| Samsung Health, Fitbit | Phone step counting, weekly goals, challenges (web search, bk). | Challenges compare people; sleep and heart-rate claims are consumer-grade. | Phone-sensor steps with a weekly goal. Group challenges wait for S69. |
| Strava | Activity logging, routes, social feed (bk). | Public maps and feeds are banned in Part C (location safety, eating disorders). | Private routes only, off by default, never shareable. |
| Peloton, BetterMe | Instructor-led classes, short home plans; BetterMe is cited for hard-to-cancel billing (Part C). | Class video is heavy for low data; generic plans ignore conditions. | Audio-first classes and low-data video on request, including chair-based classes for older adults. |
| Hinge Health, Sword, Omada | Exercise with clinician oversight, condition-specific (repo review). | Sword needs hardware and a tablet. | Condition-safe rules from pathway state; no hardware. |
| WHOOP, Oura, Garmin | Training load, recovery, sleep readiness (bk). | Black-box scores. | Only for users who already have a device; reuse `wearable_readings`. Dormant until real provider credentials exist (none do today). |

Nigeria-specific: log walking, dancing, football, farm work and manual labour with a documented effort value, since most users never go to a gym.

### S49: food and nutrition, logging

| Reference | What the full product does | Weakness or risk | Tarragon move |
|---|---|---|---|
| HealthifyMe | Database of 100,000 plus foods with strong Indian coverage, photo logging ("Snap", reported 90% identification), AI nutritionist, about ₹2,499 a year, CGM bundle (web search, today). | Closest model to what we need; vendor accuracy claim is unverified. | Same pattern for Nigeria: curated database first, photo as a suggestion the user confirms. |
| MyFitnessPal, Yazio, Lifesum | Large crowd-sourced database, barcode, recents, macros (bk). | Crowd-sourced entries are noisy; Nigerian foods and packaged goods are thin (bk). | Curated, dietitian-reviewed rows with a `data_quality` flag (the table already has this). |
| Healthy-eating apps in general | Intermittent fasting timers (Yazio, Lifesum). | Banned in Part C. | Not built. Only the Ramadan and Lent module in S50. |

Premium Tarragon version: the 100 most eaten dishes in local units (wrap of eba, cup of garri, ladle of soup, with a photo per size), one-tap repeat, offline food list on the phone, and calorie targets that cannot fall below configured safe minimums.

### S50: food and nutrition, guidance

| Reference | What the full product does | Weakness or risk | Tarragon move |
|---|---|---|---|
| Omada, Oviva | Condition-specific eating support with a human dietitian (repo review, bk). | Staffing cost. | Plans for hypertension, diabetes, kidney, pregnancy, weight; dietitian consult via Module 15. |
| Virta Health | Clinician-supervised low-carb T2D programme; doctors deprescribe insulin and other drugs as glucose falls; screens out riskier patients; has priced 100% of fees at risk (repo review, web). | Controversial diet; needs frequent glucose data and ketone supplies; staple foods here are carbohydrate-heavy. | Build the engine behind a go-live guard that stays OFF until the CMO signs the protocol. Doctor signs every medicine change (INV-02). |
| ZOE, Levels | Personal glucose response to meals from a CGM, food scores, nutritionist support (web search, today). | CGM cost; small-sample inference sold as personal truth (bk). | Same idea from fingerstick pairs (before and 2 hours after) or CGM later. Show ranges and counts, never "bad food". |
| Lifesum | Meal summary without numbers (bk). | n/a | "Light, balanced, heavy" style meal summary for people who do not want numbers. |
| Noom, HealthifyMe | Swap suggestions (bk). | Generic swaps ignore local staples. | Clinician-reviewed swaps for common Nigerian dishes. |

Nigeria-specific: naira-budget meal plans with a shopping list, and Ramadan and Lent fasting safety. For insulin or sulfonylurea users the plan is blocked until a clinician signs medicine timing.

## 3. Cross-cutting constraints that shape every session

- INV-01 and INV-02: no language model in any triage or red-flag path. No medicine, dose or timing change without a clinician signature. This hits the S50 low-carb programme and the fasting timing plans directly.
- INV-04: positive HIV, hepatitis B surface antigen or hepatitis C antibody are never auto-released, never explained by audio or AI. The Health Report generator must exclude them from automated text.
- INV-07: no notification names a condition or reading. Streak, goal and weekly-card notifications must use neutral templates.
- INV-14 and D.4: every clinical feature gets a go-live guard in `app_config`, off until its conditions are met.
- Part C: no imaging or genetic tests, no intermittent-fasting timers, no public maps or leaderboards, no AI health scores from face or voice. Voice logging is speech to text only, never a voice-based health score.
- PROPOSED values (plausibility ranges, safe calorie minimums, activity targets, streak rules, readiness bands) go in `packages/shared/src/proposed-config`, versioned, with the repo scan test.
- Local lessons from CLAUDE.md that bite here: never hand-type migration timestamps and check live `list_migrations` first; new tables need their own `grant ... to authenticated`; revoke `anon` EXECUTE through `revoke ... from public`; splice only your own types into `database.types.ts`; write category-scoped RLS fresh for anything touching pregnancy data (pregnancy nutrition plans in 6.9); prove RLS with a simulated session plus a control, then sabotage once.

## 4. Build plan

Recommended split. Each original session is too large for one agent pass once the audit and content work is counted, so each is cut into two stacked PRs. Keep the original ids with an a/b suffix so the INDEX still reads.

### Phase 0: unblock (before any of these start)
1. Confirm the S40 gate and S45 status (section 6, item 1).
2. Rebase onto current `origin/main-dev`, which is 19 commits ahead of this checkout.
3. One shared PR for what four sessions all touch, merged first: PROPOSED-config registry entries stub, `ci.manifest` ordering, and the observation type extension (see S47a). This avoids four sessions colliding on the same files.

### S46a: engine logic (3.11, 3.12, plus verify 3.13 to 3.14)
- Audit pathway suppression against each owning pathway; add one test per pathway.
- Add anti-HBs to the lab catalogue and the relevant panels (CMO-signed `lab.panels` config), the `immune` transition, and a rule in the scheduler that retires annual HBsAg once immunity is confirmed. HIV and hepatitis C stay annual. Test: immune patient's next-year schedule has no HBsAg, but HIV and HCV remain.
- Verify every released result carries explanation text, audio and one next step; verify sensitive positives never get audio (INV-04).
- Acceptance: the three module tests (cervical screening for a 45-year-old woman, report hidden until signed, sensitive positive never auto-releases).

### S46b: Health Report (3.15, 3.16), rewritten per R8
Competitor scope this must beat (all reported, not hands-on): Function Health (about 100 biomarkers in range views, clinician notes, action plan, follow-up retest about six months later), InsideTracker (optimal versus reference ranges, prioritised plan), Neko (body composition and a wearable-linked year plan, clinician explains every result), Healthtracka (results only, no follow-up). What none of them do for a Nigerian member: a short signed report with three priorities, home vitals and medicines in the same picture, audio, and a care-circle share.

Report contents (deterministic, no model):
1. Cover: member, year, reviewed-by clinician (null-gated `ReviewedByDoctor`), signed date, the not-a-diagnosis statement.
2. "Your year in one page": three priorities, what improved, what needs attention, what is on target.
3. Domain scorecards: heart and blood pressure, blood sugar, kidney, liver, thyroid, blood count, cholesterol, infection screening (non-sensitive items only), mental wellbeing screen result band.
4. Every biomarker: value, reference range, personal target band, last year's value, small trend line, one plain sentence on what it means, one action.
5. Home data: blood pressure control (share of readings in target), glucose time in range where logged, weight and waist trend, steps and sleep from S47 and S48, medicine adherence (S08).
6. Screening status: done, due, declined with reasons (S45 calendar).
7. Clinician note (signed free text) and agreed goals for next year.
8. Next steps: what to book, when the next draw is due, mid-year retest suggestion when a value was off.
9. Delivery: in-app view, PDF, audio read-through, share with Care Circle supporters who hold the permission (S29), clinician copy.
Left out on purpose: biological age, imaging, genetic or microbiome items, supplement sales, any positive HIV, hepatitis B surface antigen or hepatitis C result (a clinician discloses those personally, INV-04), reproductive and pregnancy data unless the member's own category grants allow it.
Also needed: report year-over-year history, "generated from these inputs" provenance, regeneration when a late result lands (new version, re-sign), and a hard test that nothing is visible before `signed_at`.

(Original S46b bullets follow.)
- Tables: `health_reports` as in the spec, plus a `health_report_versions` row for the signed snapshot. RLS: patient reads only signed reports; clinicians read through the audited path (INV-10).
- `health-report-build`: deterministic assembly from labs, vitals, device data, questionnaires; change-since-last-year and on-target logic in `packages/clinical` (pure, tested). Priorities chosen by rule from signed config. Any wording help from a model must go through `runGovernedAi()`, be registered in `ai_systems`, and still be signed. Recommendation: no model in v1.
- Route to clinician sign-off through the existing CMO and clinician review queues; patient sees nothing until `signed_at`.
- Reuse the react-pdf Passport document; add biomarker trend charts (existing biomarker categories as the grouping).
- `NotADiagnosisStatement` shared component with a test that fails if any result or report screen omits it.
- Audio via the S32 manifest, English and Pidgin.

### S47a: observation types and safety (4.2, 4.3, 4.7)
- Extend the observation set with waist, water_ml, mood, sleep_hours. Check every trigger and view that switches on `vital_type` before the enum change. Prove existing red-flag triggers are untouched.
- Plausibility limits per type in config; reject with a message (acceptance test: implausible glucose).
- Glucose timing tags and BP technique prompts.
- Append-only revision table for edits; chart shows current value.
- Inhaler use log (puffs, reason) as a lightweight type for asthma pathway users.

### S47b: Today, summaries (4.1, 4.5, 4.6). Voice (4.4) dropped per R1; the voice bullet below is void.
- `home_cards` and `today-build` ranking; test that never more than two primary actions show.
- Weekly summary cards, trend bands from target ranges, wearable readiness bands.
- Voice logging: device or vendor speech to text in English and Pidgin, result lands in the quick-log sheet pre-filled for the user to confirm; no save from audio alone. Vendor choice is open (section 6).

### S48a: steps and safety gate (5.1, 5.2, 5.5)
- Phone-sensor steps via the existing HealthKit and Health Connect bridge plus the platform pedometer fallback; weekly goal on `activity_goals`.
- Activity kinds with effort values, including farm and manual work (config).
- `workout-recommend` gate in `packages/clinical`: input is pathway state and recent triage events; output is allow, restrict or rest. Acceptance: red BP in the last 48 hours returns rest guidance.
- Decide alias or migrate: follow the S05 precedent (v5 names as views over the live tables) rather than a second activity store.

### S48b: content, routes, readiness (5.3, 5.4, 5.6, 5.7)
- Workout plans and chair-based classes: needs clinician-reviewed scripts and recorded audio (content budget, section 6). Seed a small starter set; the structure is the code deliverable.
- Training load, recovery and readiness for device users: build against stored `wearable_readings`; stays dormant until live provider credentials exist.
- Private route recording: off by default, stored encrypted or on device first, never shared, no sharing code path at all (test asserts the table is unreadable by anyone but the owner and has no export route). If the privacy review is not ready, defer 5.7 rather than ship it.
- 5.8 challenges are not built here (S69).

### S49a: logging foundation (6.1 to 6.6)
- Grow `nigerian_foods` to the 100 most eaten dishes with English and Pidgin names; add wrap and ladle units and per-size portion photos.
- v5 `food_logs`, `barcodes` as views or additive tables over `nutrition_log_entries`.
- Recents, favourites, one-tap repeat (acceptance test). Ship a compressed food list to the device for offline use.
- Targets for energy, macros, salt, sugar, fibre with safe minimums in config; hidden for pregnancy and for anyone a clinician flags (acceptance test).
- Photo suggestion uses the existing AI-008 path; keep the user-confirm step and re-run its eval after any change.
- Barcode: start with a curated Nigerian packaged-food list entered by the team (NAFDAC-numbered products); do not rely on an overseas open database for coverage here (bk).
- Water logging reuses the S47a `water_ml` type; one store.

### S50a: guidance that is safe by default (6.7, 6.8, 6.9, 6.12, 6.14)
- Per-meal plain summary, clinician-reviewed swap table, condition eating plans (hypertension, diabetes, kidney, pregnancy, weight) each as signed versioned config.
- Naira-budget planner and shopping list on top of the existing AI-011 meal plan, with a dated price table and a visible "prices as of" label; regional variants.
- Pregnancy plan reads pregnancy status only through the category-scoped path; do not copy an older sibling's RLS.
- 6.14: link to nutrition referrals now; real booking arrives with S64 and S65.

### S50b: higher-risk guidance, dormant by default (6.10, 6.11, 6.13)
- 6.13 Fasting safety: eligibility rules in `packages/clinical`; insulin or sulfonylurea users cannot start without a clinician-signed timing plan (acceptance test); also block or escalate for pregnancy, type 1 diabetes, kidney disease, eating-disorder flag, and age bands, per CMO rules. Religious calendar dates come from config, not code. Medicine timing plan is a `care_plan_changes` row signed under INV-02.
- 6.11 Glucose response: pair meals with fingerstick readings before and 2 hours after, show range and sample count, never label foods good or bad. CGM source stays dormant (Dexcom has no credentials today).
- 6.10 Low-carb T2D programme: build eligibility screen, check-in cadence, and titration proposals through the S24 engine; every medicine change signed. Go-live guard OFF until the CMO signs the protocol, a doctor and dietitian rota exist, and the cost of ketone testing is settled. Do not market it.

### Parallelism and merge order
- Run S46a, S47a, S48a and S49a in parallel worktrees (separate tables), stacked PRs, S47a merged first because S49a and S48b depend on its types.
- S46b after S46a. S47b after S47a. S48b after S48a. S50a and S50b after S49a, and S50b also after S47a and the S24 titration engine.
- All sessions touch `registry.ts`, `ci.manifest`, `packages/i18n` and `database.types.ts`; merge one at a time and rebase.

## 5. Risk register

| Risk | Where | Mitigation |
|---|---|---|
| Extending the vitals enum breaks a red-flag trigger | S47a | Grep every consumer first; run the existing glucose, SpO2 and pulse proofs on the migrated schema; add a sabotage test. |
| Health Report leaks a sensitive positive | S46b | Exclude those items from the generator by construction, plus a test that seeds one and asserts absence in text, PDF and audio. |
| Wearable "scores" read as medical claims | S47b, S48b | Plain bands, "estimate" label, no ranking against others. |
| GPS routes expose home location | S48b | Off by default, owner-only, no share path; defer if privacy review not done. |
| Calorie target pushes an at-risk user too low | S49a | Safe minimums in config, hidden for pregnancy and clinician-flagged users, tested. |
| Fasting or low-carb causes hypoglycaemia | S50b | Insulin and sulfonylurea gate, clinician signature, guard off until CMO sign-off. |
| CMO sign-off backlog | S46 to S50 | This batch adds many signed configs (screening rules, report priorities, plausibility, exercise rules, eating plans, fasting rules). Count them now and book CMO time; the sign-off hub at `/clinician/clinical-signoff` exists. |
| Content production stalls the build | S48b, S49a, S50a | Treat audio, portion photos and workout scripts as a separate content workstream with its own owner and budget. |
| Stale data presented as current | S50a | Price table and food rows carry dates and `data_quality`. |

## 6. Decisions needed from the founder

1. Is the Stage 1 gate (S40) closed and are S41 to S45 merged? main-dev shows no such entries. If not, S46 to S50 cannot start as written.
2. Add anti-HBs to the Essential package or a separate test? The spec lists HIV, HBsAg and anti-HCV only; the immunity rule in 3.12 needs anti-HBs from somewhere. CMO and lab partner input.
3. Health Report wording: deterministic only (recommended) or model-assisted with governance and signature?
4. Voice logging vendor and languages (English and Pidgin only per D.2). Accuracy on Nigerian-accented English and Pidgin is unproven; pilot before promising it.
5. Private GPS routes: build now or defer pending a privacy review?
6. Low-carb T2D programme (6.10): build the engine dormant now, or leave until a doctor and dietitian rota exists?
7. Content budget and owner for workout audio, chair-class scripts, portion photos and the 100-dish nutrient review.
8. Barcode data: team-curated list only, or pay for a commercial product database?
9. Confirm the a/b split of S46, S47, S48 and S50 into separate PRs.

## 7. Sources used today

- Function Health pricing and panel: https://superpower.com/biomarker-testing-companies/function-health , https://crowncounseling.com/reviews/function-health-review/
- Neko Health scan and June 2026 update: https://www.nekohealth.com/gb/en/press/neko-health-announces-advancements-to-its-health-scan-experience-fueling-the-future-of-proactive , https://www.eweek.com/news/neko-health-us-body-scan/
- HealthifyMe: https://techcrunch.com/2023/09/21/khosla-backed-healtifyme-introduces-ai-powered-image-recognition-for-indian-food/ , https://nutriscan.app/blog/posts/healthifyme-pricing-2026-india-plans-63a87b21d0
- ZOE and Levels: https://zoe.com/continuous-glucose-monitor , https://support.levels.com/article/359-about-app-insights-recommendations
- Repo reviews: `docs/research/competitor-review-global-2026-10.md`, `docs/research/competitor-review-africa-2026-10.md`
