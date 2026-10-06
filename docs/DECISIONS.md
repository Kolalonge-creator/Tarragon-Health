# Decisions

Append-only log of decisions that shape the v5 build. Newest section first. A change to a
spec invariant (INV-01 to INV-16) needs a written founder decision here.

## Design decisions, 2026-10-02

Answered in a prompt after the mobile design audit (`docs/design/MOBILE-DESIGN-AUDIT.md`). They settle DF-2 and set Phase 0 of the design plan.

| ID | Decision |
|---|---|
| DG-1 | **Device floor confirmed (settles DF-2): 4 GB RAM Android on Android 10 or later, and iPhone on iOS 16 or later.** Android `minSdkVersion` becomes 29 (from 26); iOS deployment target 16. Spec D.1 and the S06 budget tests are updated to this floor when the change is built. |
| DG-2 | **Dark mode ships in Phase 0**, built together with the light theme in the new kit, so every moved screen has both. |
| DG-3 | **Brand fonts in the app: Sora for headlines, Inter for the interface**, bundled (about 1 MB). |
| DG-4 | **One rounded 2 px outline icon set** replaces the mixed Ionicons, as brand guide section 7 says; screens change icons as they move onto the new kit. The specific set (for example Lucide) is chosen in Phase 0 and must be licence-checked. |
| DG-5 | **Charts use Skia** (animated trend charts with target bands and tap to inspect). |
| DG-6 | **One new native build and one runtime version bump (from `0.1.0-native3`) are approved for Phase 0**, carrying fonts, animation, gestures, haptics, charts and icons together. The build itself is not started without a further go-ahead. |

## Device floor decision, 2026-10-02

Founder, in chat after S06 merged: build a fully functioning, superior platform even if it needs more powerful phones; 2 GB Android phones are dropped.

| ID | Decision |
|---|---|
| DF-1 | **The minimum supported device is raised above a 2 GB Android phone.** This supersedes the 2 GB RAM, 40 MB install and 1 MB per day targets in spec D.1 as design constraints. Design for modern phones first (richer screens, charts, motion, more on-device data). |
| DF-2 | **The exact floor is not yet set.** Proposed for confirmation: 4 GB RAM Android on Android 10 or later, and iPhone on iOS 16 or later. Until confirmed, nothing is removed that currently works on lower devices. |
| DF-3 | **Unchanged by this decision:** offline logging, the outbox rules, emergency guidance working offline (INV-06), and the low-data habits (no auto-download of images or audio). They are safety and cost properties, not device-size properties. |
| DF-4 | **Consequences to carry out:** update spec D.1 and the S06 performance budget (`apps/mobile/src/lib/offline-budget.ts`, `offline-budget.test.ts`) to the new floor once it is set; run the device lab on the new floor device; check app store minimum OS settings and `app.json` / `eas.json` (Android `minSdkVersion`, iOS deployment target). |

## S06 open-question decisions, 2026-10-02

Answered in a prompt after S06 merged (PR #853). Full text in `docs/OPEN-QUESTIONS.md`.

| ID | Decision |
|---|---|
| OQ-59 | Leave the replayed-vitals gap; the next reading and nightly pass re-run the assessors. |
| OQ-60 | Offline tuning constants stay in code until a device lab run. |
| OQ-61 | Native Pidgin review of the eight `outbox.*` strings before the next store build. |
| OQ-62 | A dose log is accepted as logged even if the medicine was since amended or stopped. |

## S06 decisions, 2026-10-02

Answered in a prompt at the start of S06 (offline store and outbox sync). Reasoning is in `docs/design/S06.md`.

| ID | Decision |
|---|---|
| S06-1 | **Offline times are kept as two times.** The server stamp stays trusted. A new `client_recorded_at` is stored beside it. One defined effective time (the client time only when it is not in the future and within a window of the server receipt time, else the server time) is what trends and red-flag windows read. Window PROPOSED 72 hours, in versioned configuration, never in code. A patient still cannot backdate past the window. |
| S06-2 | **A stop or reminder change on a prescribed medicine never queues offline.** Offline the medication list is read-only. Only logs, readings and symptoms queue (INV-02). |
| S06-3 | **Stuck-row notice at 12 hours** (PROPOSED, versioned configuration): a row not synced after 12 hours tells the patient plainly it has not reached their care team, with Retry and a support code. A row that looks dangerous on device gets the notice at 1 hour. |
| S06-4 | **Pull cursor is `created_at` with an overlap window and an id tiebreak,** no migration. Overlap PROPOSED 10 minutes (configuration). The local store upserts by id so a repeat read is harmless. Pull from the live tables, not the S05 aliasing views. |

## S01d decisions, 2026-09-30

Answered in a prompt during S01d. Reasoning is in `docs/design/S01d.md`.

| ID | Decision |
|---|---|
| S01d-1 | **Console sessions are separate host-only sessions.** No parent-domain cookie. A staff token never travels to the marketing or patient host. Cost: staff sign in once more on the console at each area's cutover (announce it). |
| S01d-2 | **Shared code moves into `packages/` in tiers, per area,** not in one big extraction. Old `apps/web` import paths stay as one-line re-export shims (no import churn in patient code), retired later by a mechanical codemod. |
| S01d-3 | **Scope of this session:** shell plus the smallest areas. Delivered: `apps/console`, `@tarragon/auth`, `@tarragon/ui` (components, theme), `@tarragon/staff-core`, and the `ngo` area. `lab-liaison` and `lab-partner` were held back (OQ-33). Remaining areas follow in later sessions in the mapped order. |
| S01d-4 | **Console host is a `console.` subdomain** of the platform domain. Creating the Vercel project, DNS and env is a production action and waits for an explicit go-ahead (OQ-36). |

## Founder decisions, 2026-09-30

Source: `docs/v5-sessions/00-FOUNDER-DECISIONS.md`. These settle conflicts between the v5 spec
(`docs/BUILD-SPEC-v5.md`) and the live platform. Every session inherits them.

| ID | Decision | Consequence |
|---|---|---|
| F-01 | **Platform Credit is removed.** Patients pay per service at checkout, with no stored balance (v5 INV-09 stands). Reason: avoid stored-value regulation. | Removal is its own session, S01b. |
| F-02 | **WhatsApp is removed.** In-app, push and email only. SMS stays for verification codes only. | Removal is its own session, S01c. |
| F-03 | **Clinician model is hybrid.** Freelance verified clinicians (v5 credentialing, Next-task queue, per-task fees, on-call) work alongside Tarragon-employed doctors. Do not delete the employed-doctor tiers or auto-assignment. Both feed the same task queue and paging. Employed doctors are paid by salary, not per-task fees; `employment_type` (employed / freelance) decides the earnings path. | S15-S20, S30, S31 and S76-S78 must support both. Overrides Part C.2 "Salaried clinicians". |
| F-04 | **Staff console is split out (long-term choice).** `apps/web` keeps marketing and the patient web dashboard. A new `apps/console` (Next.js, staff only: clinician, ops, clinical lead, admin, partner areas) is extracted in S01d, on its own domain with stricter security headers. `apps/mobile` keeps its name. Shared code moves into `packages/`. | All new console work in S35, S36 and S76-S78 is built in `apps/console`. |
| F-05 | **Doctor tiers collapse to one, plus the CMO.** Tarragon employs doctors who work at the Senior Medical Officer level; there is a single doctor tier and every doctor can take any case. The Chief Medical Officer stays as the management tier and signs protocols. (Founder, 2026-09-30.) | Supersedes the four-value `doctor_tier` ladder for doctors: `medical_officer` goes away, `senior_medical_officer` becomes the one doctor tier, `chief_medical_officer` stays. Needs its own removal migration (count rows first, delete the enum value, rewrite tier gates `has_prescribing_authority` and `can_handle_emergency_escalation`). Care Coordinator (non-clinical) is kept but dormant until volume needs it (OQ-27). Read access remains tied-patients-only (OQ-02). |


## Open-question decisions, 2026-09-30

Answered in a single prompt session. Full options and reasoning are in `docs/OPEN-QUESTIONS.md`.

| ID | Decision |
|---|---|
| OQ-01 | One `clinical_tasks` table; employed doctors get tasks pushed, freelancers pull from the shared pool; `employment_type` selects salary vs per-task earnings. |
| OQ-02 | All doctors are qualified for all cases (single clinical pool), but read access is to TIED patients only (active task, assignment or on-call page) plus audited break-glass with a reason that alerts the CMO. Founder remark 2026-09-30: "we only have a single tier of doctor"; live `doctor_tier` still has four values, so confirm with the founder whether the tier ladder is being collapsed before S15. |
| OQ-03 | SECURITY DEFINER read RPCs for clinician chart views that write `audit_log`; direct table SELECT for patients only. |
| OQ-04 | Minimal identity fields in search; opening a record requires a typed reason and writes an audit row. |
| OQ-05 | Verification codes plus clinician paging (D-12). Deactivate patient SMS templates; remove the WhatsApp-to-voice remap. |
| OQ-06 | Generic copy everywhere (push, email, SMS, in-app) plus a lint; rewrite the sponsor nudge generically. |
| OQ-07 | Rebuild as order-linked sponsor checkout (no standing balance); get counsel input before live use. |
| OQ-08 | Keep points as non-monetary; remove the kobo conversion. |
| OQ-09 | Explicit `is_test` column on profiles, clinical_staff, orders and payments; backfill by @tarragon.test; lint on analytics and payout views. |
| OQ-10 | Both paths: item-level results with release_state and sensitive_positive for partner entry; uploaded documents forced through clinician review; block AI and audio for sensitive positives. |
| OQ-11 | New `prescriptions` and `care_plan_changes` tables with signature CHECKs; `medications` becomes a projection; tighten patient column allow-list. |
| OQ-12 | Opt-in conception-planning mode, off by default, disclaimer literally "not contraception". |
| OQ-13 | On-call roster plus page table with ack timer; channel per OQ-05. |
| OQ-14 | Versioned config table read by the classifiers plus `classifier_version` on alerts; current live values load unchanged as version 1. |
| OQ-15 | Create `packages/clinical`: re-export the triage engine first, then port remaining classifiers; test that no LLM import is reachable. |
| OQ-16 | Leave dormant; drop in a later removal batch using the count-first pattern. |
| OQ-17 | Mobile stays `apps/mobile`; console is `apps/console` after S01d; create `packages/queue` and `packages/clinical` when their sessions start. |
| OQ-18 | Reuse `platform_modules` and per-domain versioned tables; no `app_config`; move S01 registry reads into the database as each owning session lands. |
| OQ-19 | New strings go to `@tarragon/i18n`; old dictionary migrates later; clinical Pidgin needs clinician sign-off and native review first. |
| OQ-20 | Add gitleaks secret scanning to CI now; Sentry on each Edge Function when that function is next touched; mobile with the next native build. |
| OQ-21 | Build the Send SMS hook behind a provider interface with a mock; go live on Termii only when the sender ID is approved. |
| OQ-22 | `VideoProvider` interface with a Zoom adapter and a mock; pick a second vendor later. |
| OQ-23 | Mixed per the audit: live wins for identity, health record, commerce, notifications, audit; v5 wins for outbox, pages, rota, credentialing, earnings, scribe consent, proxy setup, outcome snapshots, care_plan_changes, triage_events. |
| OQ-24 | Keep the account-role rule; no `ops` role; add a separate credentialing-level column (not `doctor_tier`) and a clinician status column. |
| OQ-25 | Add `subject_patient_id` and `ip`; revoke TRUNCATE from service_role and postgres, as part of the OQ-03 work. |
| OQ-29 | Keep the compatibility shim (a whatsapp token in the signed ladder reads as email); the CMO publishes escalation_slas v9 naming email explicitly. Not signed or seeded by the agent. |
| OQ-30 | Keep the emergency-contact SMS as a named exception to OQ-05 for real emergencies, switched on once a sender ID is approved (OQ-21); until then the care team phones the contact. |
| OQ-31 | Publish new terms and consent versions without WhatsApp and Stripe after counsel review; notify users rather than forcing re-acceptance, since a data flow is being removed. Retire the WhatsApp vendor register row once counsel agrees. |
| OQ-32 | Remove all patient-facing SMS in its own session (count first, then remove), as the follow-on to OQ-05. |
| OQ-27 | Keep the Care Coordinator account but dormant until volume needs it; no migration now. |
| OQ-26 | Run the real drift script once in CI (release-integrity) before S02's first migration. |

## v5 spec decisions (Section 19), defaults until decided

D-02 to D-04 are not defined in the spec.

| ID | Decision | Default until decided |
|---|---|---|
| D-01 | Build order: Stage 1 is the blood pressure journey | Assumed confirmed |
| D-05 | Termii sender ID | Pre-whitelisted sender in production; own sender ID later |
| D-06 | Laboratory revenue model | Patient pays lab directly and uploads result |
| D-07 | Video provider | Build the interface and a mock; wire the chosen adapter in M5 |
| D-08 | Speech-to-text provider | Build the interface and a mock; wire the chosen adapter in M5 |
| D-09 | Clinician tax handling (withholding tax) and contractor status | Store data only; no tax calculation. Spec note: check Nigerian rules and build this |
| D-10 | Group indemnity for clinicians | Clinician-provided certificate required |
| D-11 | Percentage fees and fee-sharing under Nigerian medical ethics | Fixed fee per task type; consultation share configurable |
| D-12 | Clinician paging channel beyond push and email | Push, in-console alarm and email only; escalation to ops |
| D-13 | App text languages at launch | English and Pidgin |

## Session decisions

### S01, 2026-09-30
- v5 spec copied verbatim to `docs/BUILD-SPEC-v5.md`; never edited, later sessions cite its line numbers.
- PROPOSED values live in versioned configuration (`packages/shared/src/proposed-config`), never in code.
- Copy-lint starts in warn-only mode; existing violations are inventoried in `docs/RECONCILIATION.md`, not mass-edited.

### S07, 2026-10-03
- OQ-65: `patient_tasks` is a `security_invoker` view over `care_tasks` (+ nullable `kind`, `source_event_id`); the recurrence trigger is updated to copy `kind`; no second task table.
- OQ-66: keep the live BP plausibility limits (60-260 / 30-160, pathway TH-CP-HTN-001 s5.4); add a safety line to the blocked-value message only after CMO, house-voice and native Pidgin review.
- OQ-67: S07 does not change BP grading; S12 aligns the bands through versioned, CMO-signed thresholds.
- OQ-68: the dose reminder uses generic keyed copy with no medicine name (INV-07).
- OQ-80: the trends card reads the target through a small read-only server function (`my_home_bp_target()`) so it matches the alerts, labels a derived target as a standard starting target, and falls back to the old behaviour while the function is not applied. Built 2026-10-05, not applied to production.

### S11, 2026-10-05
- OQ-86: the engine keeps BP-P1 (pregnancy), BP-P2 (under 18) and BP-A6 (red-flag symptom below the severe line) in the draft rule set. The CMO edits or removes them before signing. Pregnancy severe-range lines, a low reading with no symptoms, symptom-only reports (S12) and per-session averaging stay CMO or S12 items.
- OQ-87: systolic maximum 299 so safety case 5 holds; codes TRI-002, TRI-003, TRI-005 and EMG-001L as drafted; the emergency wording is for CMO review, Pidgin held as English until signed. Note OQ-66 (S07) kept the live plausibility limits 60-260 / 30-160 for typed entry; the engine's 60-299 limit is wider and is the one the spec states, so a typed 270/150 reaches the engine and grades red, never silently rejected.
- S11 research follow-up (2026-10-05, `docs/research/S11-guidelines.md`): pregnancy lines built as BP-P3 (red at 160/110) and BP-P4 (red at 140/90 with a pre-eclampsia symptom) from NICE NG133, ACOG and the Nigerian guideline; `difficulty_speaking`, `back_pain`, `epigastric_pain` symptom codes added; averaging (all readings counted) and the 299 limit need no change; BP-R2 (200/130 red with no symptoms) is more cautious than any guideline and is flagged to the CMO; low reading with no symptoms and the postpartum state remain CMO or later items.

### S16, 2026-10-06
- Existing alert, escalation and small task tables stay as they are and are read through the adapter view `legacy_clinical_work_v` (OQ-114).
- The minimum-tier gate on a task is `doctor_tier` only; `credentialing_level` is not used.
- `fee_kobo_at_completion` and `fee_schedule_version_id` stay empty until S30.
- Paging fallback is email, not SMS (OQ-113).
- OQ-110: keep `adherence_follow_up`. OQ-111: `care_team_assignment` stands in for the lead until S18. OQ-112: S17 hides offered tasks from others; S18 adds working hours and rest.
### S14, 2026-10-06
- Adapters live in `supabase/functions/_shared/integrations` (an edge function cannot import a workspace package) and `@tarragon/integrations` re-exports them, the same layout as S10 and S13.
- Every adapter call returns `ProviderResult` and never throws. Money is integer kobo, NGN only. There is no balance, wallet or top-up method on `PaymentProvider` (INV-09), and a contract test fails if one appears.
- `selectProvider` never hands out a mock in production, and an unrecognised `APP_ENV` counts as production.
- Video: a Zoom adapter and a mock, per OQ-22 (founder, 2026-09-30). Speech to text: interface and mock only (D-08); no vendor chosen. Paystack and Resend adapters are real HTTP adapters for vendors already chosen in the spec; live code was not migrated onto them (S25 and S31 do that).
- Audio-only fallback is a pure function over a PROPOSED policy (`video.audio_fallback`): one bad sample never drops the call, and the app only offers video again, it does not switch back by itself.
- Patient email is checked against the INV-07 word list at the adapter boundary, in addition to the S13 template lint.
- OQ-95 to OQ-98 (2026-10-06): stay on Zoom pending the S21 live test; speech-to-text vendor chosen at S23 from a scoring set; Paystack naira only with foreign cards or sponsors for the diaspora, transfer OTP off with compensating limits; email from `mail.tarragonhealth.ng` with a monitored Reply-To and no patient detail in staff mail.
- Fees (2026-10-06): the payment processor fee is passed to the patient, shown and explained before payment (`pay.fee.*`); orders match on price, the fee is recorded separately.


### S17, 2026-10-06
- Founder accepted every S17 recommendation (OQ-115 to OQ-121 and OQ-123): minimal availability now, clinician-declared and automatic conflicts, the spec's five hand-back codes, idempotent retry, one extension and no heartbeat, employed doctors push and pull, strict class order, test isolation.
- Reliability and queue limits stay PROPOSED until the CMO signs them (OQ-122).
