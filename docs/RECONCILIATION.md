# Reconciliation: v5 spec vs the live platform

Session S01, 2026-09-30. Read-only audit of `docs/BUILD-SPEC-v5.md` (Section 2 invariants, Section 3 stack and roles, Section 4 data model, Section 7 clinician network, Part C) against the repo at `origin/main-dev` (`bb33242b`) and the live Supabase project `koiplnmbgnqnbywhpjlf` (1,495 applied migrations, 585 public tables, latest version `20260925100910`). No behaviour was changed to produce it.

**Recommendations are not decisions.** Every "recommend" below is a proposal. Genuine conflicts are numbered in `docs/OPEN-QUESTIONS.md`; work on each affected piece stops until you answer. Conflicts already settled by the four founder decisions (`docs/DECISIONS.md`: Platform Credit removal, WhatsApp removal, hybrid clinician model, console split) are noted but not re-asked.

## 0. Headline findings

1. **The v5 data model is not a small delta.** Live covers roughly 60 percent of it in a different shape. Almost nothing is a clean match: `conditions`, `allergies` and push tokens are close; `observations` is `vitals_readings`, `dose_events` is `medication_logs`, `lab_results` is `lab_result_documents` plus `lab_analyte_readings`, `orders` is four per-domain purchase tables, there is no `patients` table (demographics are on `profiles`), and there is no unified `partners` table.
2. **Biggest architectural fork: pull queue versus push assignment.** v5 has clinicians pull the "Next task" and claim it; live auto-assigns every escalation to a named doctor, skipping doctors on leave. The hybrid decision (F-03) says both must feed the same queue. How they join is OQ-01 and must be decided before any table work in S15-S20.
3. **Two critical or high invariant gaps are live today.** INV-12/INV-10: `private.is_org_staff()` lets any active non-patient staff member in an org read every patient on about 110 tables, including menstrual, pregnancy and contraception rows, and clinical reads are not audit-logged (`audit_log` holds 4,689 rows, all from write triggers). INV-13: no `is_test` column exists on any public table.
4. **Other invariant gaps:** INV-07/08 (59 active SMS templates, some naming drugs, conditions and results; SMS used for reminders, payments and clinician alerts), INV-02/03/04 (no `prescriptions`, `care_plan_changes`, `release_state` or `sensitive_positive`), INV-09 (stored value in `care_vouchers` and `wellness_points_*` besides Platform Credit), INV-05/06/11/16 partial.
5. **Live migration state is healthy on the loss-risk measure.** 0 UNTRACED and 0 LOCAL-NOT-APPLIED among recent migrations; the 7 recent live rows with no file on `main-dev` all have a commit on a pushed `origin/*` branch (UNPUSHED: 0).
6. **Existing i18n differs from the spec.** Live has a wayfinding-only Pidgin dictionary keyed by the English string (`packages/shared/src/ui-language.ts`) with a deliberate boundary that forbids clinical copy. S01 added the key-based `@tarragon/i18n` catalogue the prompt asks for and left the old mechanism alone (OQ-19).

## 1. Exists and matches

### 1.1 Stack and platform
- Turborepo + pnpm (pnpm@11.10.0 pinned in root package.json, engines node >=20.9, CI uses Node 22).
- Supabase Postgres/Auth/RLS/Storage/Edge Functions (Deno)/pg_cron; 1483 migration files in supabase/migrations.
- Zod shared: zod ^4 in apps/web; @tarragon/shared is the shared package (src/index.ts, ui-language.ts, ml-client.ts, clinical-tier.ts, database.types.ts).
- Expo RN app (expo ~54, expo-sqlite ~16 present for offline store), Next.js 16 App Router on Vercel.
- Paystack: supabase/functions/paystack-webhook (handler.ts + Deno tests, run in CI), apps/web/src/lib/paystack.
- Expo Notifications (mobile dep expo-notifications; send path in send-pending-notifications edge fn calls exp.host).
- Resend: called from send-pending-notifications edge fn (api.resend.com).
- Sentry: apps/web (@sentry/nextjs, sentry.server/edge config, instrumentation-client, scrub-pii.ts, run-best-effort.ts), services/ml (sentry-sdk, opt-in by DSN).
- Claude API: via @langchain/anthropic in apps/web (governed by runGovernedAi, ai_systems registry).
- Design tokens exist (see Foundations 3).
- docs/DECISIONS.md, docs/BUILD-PROGRESS.md exist (untracked, new in this branch).

### 1.2 Invariant-related features that already hold
| Feature | Where |
|---|---|
| Deterministic triage engine, no LLM | `packages/symptom-triage-engine/src/{engine,protocols,types}`; grep for anthropic/openai/llm: none. Triage protocols signed, versioned (`triage_protocols`, `symptom_triage_assessments.protocol_version`) |
| Deterministic vitals red-flag classifiers | `private.classify_bp_level`, `classify_pulse_level`, `classify_spo2_level`, `classify_temperature_level` (IMMUTABLE SQL) |
| AI calls governed and audited | `runGovernedAi()` in `apps/web/src/lib/ai-governance`; `ai_assistant_turns` provenance rows written by `lib/ai-coach/audit.ts`; `ai_systems` kill switch |
| Keyword emergency bypass of the model | `apps/web/src/lib/ai-coach/index.ts` lines ~161-270 (emergency reply without model) |
| Offline emergency guidance on mobile | `apps/mobile/src/screens/emergency-guidance-modal.tsx` (bundled copy and numbers, no network) |
| Red alert SLA, ack, backup clinician, ack-escalation | `clinician_alerts.sla_due_at/acknowledged_at/backup_clinician_id`, `clinician_alert_ack_escalations`, `escalation_slas` (versioned) |
| Break-glass with reason | `emergency_access_grants`, `request_emergency_record_access`, `review_emergency_record_access`, `has_emergency_access()` |
| Patient self-RLS and category-scoped caregiver access | `can_read_clinical(patient, category)` in `medications_select`, `vitals_readings_select` |
| Reproductive data: employer sees aggregates only | `dashboard/corporate/wellbeing-cohort-summary.tsx` (percentages, min cohort size); `is_org_staff` excludes `corporate_admin`, `hmo_admin`, `finance`, `analyst`, `pharmacist`, `lab_partner`, `payer_admin`, `provider_org_staff`, `ngo_admin` |
| Money as bigint kobo (core tables) | `care_vouchers.*_kobo`, `platform_credit_balances.*_kobo`, `programme_purchases.price_kobo`, `subscriptions.amount_minor` all bigint |
| No auto-renewing billing in use | `subscriptions` 0 rows, `subscription_plans` 13 rows, 0 active; `programme_purchases` 0 rows; `pricing.ts` line 49 and 130 state nothing auto-renews; no `from("subscriptions").insert` in app or edge code |
| Fertile-window claims carry disclaimer | `cycle-thermal-shift.ts` ("confirms rather than predicts, not a contraceptive method"); `cycle-tracker.tsx` renders `FERTILE_WINDOW_DISCLAIMER` |
| No ads SDKs, no public leaderboard, no facial/voice scores, no virtual ward, no therapist matching UI | grep of apps/web/src and apps/mobile/src: nothing (only a marketing page `therapy/page.tsx` to review) |
| Pharmacy delivery is dormant | `pharmacy_order_delivery_attempts` 0 rows; `logistics_partners` 1 row, placeholder, inactive |
| Therapy dormant | `therapy_sessions` 0 rows; `therapy_directory` exists |
| Wellness challenges private | `wellness_challenges_select` is `is_active OR admin`; `patient_challenge_enrolments` per patient; no leaderboard code |
| Notification templates are keyed and clinically approved flag | `notification_templates.requires_clinical_approval`, `clinical_approved_by/at` |

## 2. Exists but differs

1. Repo layout. Spec: apps/patient, apps/console, packages/{shared,clinical,queue,i18n,ui}. Live: apps/web (marketing + patient web + clinician/admin/partner dashboards in one Next app via route groups and proxy.ts host routing) and apps/mobile (@tarragon/mobile), packages/{db,integrations,lifestyle-engine,notifications,shared,symptom-triage-engine}. RECOMMEND live wins (CLAUDE.md: apps/web is the platform; no rename). Map spec names: patient=apps/mobile, console=apps/web. Do NOT create apps/patient or apps/console. Spec packages/clinical = existing packages/symptom-triage-engine plus apps/web/src/lib/{rules,vitals,cv-risk,clinical} (not pure/I/O-free as one package). New packages (queue, i18n, ui) are optional; add only when a second consumer exists. Spec 100 percent branch coverage rule is not met or enforced anywhere today.
2. Platform mismatches: Spec "Android first, Expo Router". apps/mobile uses App.tsx/index.js with screens in src/screens (no Expo Router observed). Recommend live wins.
3. Web is not "console only": apps/web also serves the public marketing site and patient web app (CLAUDE.md contract). Live wins.
4. Termii: spec = Supabase Auth Send SMS hook. Live = sendTermiiSms() inside send-pending-notifications edge fn (notification channel, TERMII_API_KEY) and supabase/config.toml [auth.sms] uses Supabase's default provider with a template, no [auth.hook.send_sms]. CLAUDE.md also says Termii sender approval is off the near-term plan. Recommend: spec wins for auth OTP only if founder wants phone OTP now; otherwise keep as is (S01 must not build it; log as open question).
5. Video: spec = VideoProvider interface, candidates Daily/Agora/100ms. Live = Zoom hard-wired (apps/web/src/lib/zoom/{client,meetings}.ts, zoom-webhook edge fn, masked calls via Twilio proxy). No interface. Recommend live wins for now (Zoom is shipped); S01 may add only an interface file if needed, not new vendor.
6. Stripe already removed; Paystack only (matches spec). Spec Paystack transfers/payouts: not verified built; treat as later milestone.
7. Config: spec says config in `app_config`; live has no app_config table. Live tables: feature_flags/platform_feature_flags (20260829093236), escalation_slas (20260730105131), cv_risk_config (20260720122000), plus triage_protocols, platform_modules, alert-rules. Recommend live wins; map spec app_config.go_live guards to existing platform_feature_flags/platform_modules rather than a new table.
8. i18n: spec = packages/i18n with en.json/pcm.json, stable keys, build fails on missing keys. Live = packages/shared/src/ui-language.ts (`en`|`pcm`, dictionary keyed by the English source string, wayfinding only, explicitly NOT clinical/emergency copy, unreviewed by native speaker) plus profiles.language column and per-page tests (navigation-pidgin-coverage.test.ts, lifestyle-trackers-pidgin-coverage.test.ts). Recommend: extend the live mechanism; do not move to key-based catalogue in S01. If spec keys wanted, add a missing-key test, not a package. Note spec marks clinical strings pcm-translatable via audio IDs; live boundary forbids clinical strings in pcm without clinician sign-off. Live boundary wins until founder decides.
9. Spec folder /supabase/seed: live is supabase/seed/seed.sql (single file, `is_test` flagging not verified). /audio folder: absent (no manifest).
10. Analytics schema: live has `analytics` schema (Phase 1, per CLAUDE.md DATA_ARCHITECTURE_GAPS) - matches in spirit.
11. Sentry: spec "app, console, functions". Live = web + ml only (see Foundations 6).
12. Stub packages: packages/integrations and packages/notifications are empty `export {}` stubs whose header cites the abandoned v3 spec (adapter interfaces, rail router). Spec 10 adapters (VideoProvider, SpeechToText) would land in packages/integrations; recommend live wins on location.

## 3. Missing

- apps/patient, apps/console, packages/clinical, packages/queue, packages/i18n, packages/ui (by those names; see differs 1).
- docs/OPEN-QUESTIONS.md, docs/PROCESSORS.md (spec 13 processor register). DECISIONS.md present.
- /audio manifest, ElevenLabs asset pipeline (no elevenlabs reference in repo). No live TTS anyway.
- SpeechToText interface/adapter; VideoProvider interface.
- Supabase Auth Send SMS hook edge function (no [auth.hook.send_sms] in config.toml).
- Sentry in apps/mobile and in all 7 supabase edge functions; no Sentry in packages/*.
- app_config table and go_live guard JSON (equivalent mechanisms exist, not the spec shape).
- pilot_invites table/invitation gate (not checked live; no grep hit was done for it, verify before S01 relies on it).
- Missing-key build failure for i18n; copy-lint for spec-banned words (see 5).
- Dependency/secret scanning in CI: CodeQL workflow exists (codeql.yml), dependabot.yml exists; no secret scanning step (gitleaks etc.) in ci.yml. Dependabot covers deps.
- Rate-limit verification not done.

### 3.1 Missing data model (new in v5, nothing equivalent live)
1. proxy_setups (phone-proxy onboarding, Section 8.2)
2. scribe_consents (per-encounter AI scribe consent)
3. task_claims, task_handbacks (and the pull-based clinical_tasks queue with claim leases, min_tier, competencies, fee snapshot)
4. pages (paging record) and on_call_rota
5. clinician_applications, clinician_documents, competencies, clinician_competencies, conflicts
6. availability_blocks in the v5 sense (dated queue/on_call/bookable declared blocks with confirm state)
7. fee_schedules, earnings_ledger, payouts (clinician compensation), Paystack recipient/bank verification columns
8. domain_events internal transactional outbox + `process-events` handler
9. outcome_snapshots (per-patient day 0/30/90/180 controlled/adherence)
10. care_plan_changes as a proposed/signed proposal record (INV-02), triage_events as a per-grading record with rule/version ids
11. lab_results header with `release_state` and `lab_result_items.sensitive_positive` (INV-04 gate), entitlements.remaining_uses
12. clinicians columns: status (suspended/offboarded), max_concurrent_claims, max_lead_patients, reliability_score, languages[]
13. generic app_config (only if v5 task_types/SLA/claim timeouts must be data; else use feature_flags/platform_modules/versioned config rows)

## 4. Conflicts with an invariant or Part C

Founder-settled items excluded (Platform Credit, WhatsApp, hybrid clinicians, console split).

### 4.1 Verdict per invariant
Verdict per invariant: (a) satisfies, (b) partial, (c) violates, (d) n/a yet

| ID | Verdict | One line |
|---|---|---|
| INV-01 | b | Symptom-triage engine has no LLM import; BP/pulse/SpO2/temp classifiers are pure SQL. But `packages/clinical` does not exist (engine is `packages/symptom-triage-engine`), and the AI coach runs a keyword emergency check before the model (partial, not a rules engine) |
| INV-02 | c | No `prescriptions` or `care_plan_changes` table; no `signed_by`/`signed_at`. `medications_update` RLS gates on `has_prescribing_authority` (tier), not a signature |
| INV-03 | d/c | No `lab_results.release_state`; grep for `release_state` in packages/db and supabase finds nothing. Lab data is `lab_orders` + `lab_result_documents`; staff and patient release path is not a state machine |
| INV-04 | c | No `sensitive_positive` column anywhere. No forced clinician disclosure. Only a UI `confidential-result-notice.tsx` |
| INV-05 | b | `clinician_alerts.sla_due_at`, `acknowledged_at`, `backup_clinician_id`, `clinician_alert_ack_escalations`, `escalations.assigned_doctor_id` auto-assigned. No on-call table or page. Delivery is via `send-pending-notifications` outbox (queue-dependent) |
| INV-06 | b | Mobile `emergency-guidance-modal.tsx` is bundled, zero-network, fed by local red flags (BP, glucose). Covers only BP/glucose locally; pulse/SpO2/temp/symptom red rules are server-side only; web has no offline path |
| INV-07 | c | 59 active SMS templates plus email/in_app name conditions, drugs, readings (see evidence) |
| INV-08 | c | Termii used for clinician alerts, reminders, payment confirmations, sponsor nudges, patient links. See evidence |
| INV-09 | c | Stored balances: `platform_credit_balances`, `wellness_points_balances`, `care_vouchers` (face_value/redeemed). All empty or near empty except wellness (2 rows) |
| INV-10 | c | No read audit on clinical tables. `audit_row_change_trg` audits writes only. `analytics_log_patient_access` and `log_care_access` exist for specific paths, not clinical reads |
| INV-11 | b | AI outputs are separate tables with status (case_briefs generated/failed, care_message_draft_replies, lab_report_extractions, imaging_ai_assist_drafts). No scribe tables, no `scribe_consent`. `clinical_encounter_notes.status` is text with `auto_generated` flag and `finalized_by_staff`; patient view gating not verified |
| INV-12 | c | `private.is_org_staff(org)` is a blanket org-wide grant: any active non-patient, non-partner role in the org reads every patient row on roughly 110 tables. Admin reads all orgs. No per-patient task/assignment gating |
| INV-13 | c | No `is_test` or `is_test_account` column exists on any public table |
| INV-14 | b | `feature_flags`/`app_config` and go-live guards exist (triage protocol signed and active). Not audited per feature |
| INV-15 | b | Money columns are bigint kobo (`*_kobo`, `amount_minor`). Exceptions: `service_product_margins.*_kobo` are numeric, `platform_currency_settings.usd_processing_fee_pct` numeric, `wellness_points_config.points_to_kobo_rate` numeric |
| INV-16 | b | `symptom_triage_assessments.protocol_version`, `protocol_versions`, `triage_protocols`, `escalation_slas` versioned. BP/pulse/SpO2/temp thresholds hardcoded in `private.classify_*_level` with no version stamp on the resulting alert |

### 4.2 Conflict detail
| ID | What conflicts | Evidence | Severity | Recommended resolution |
|---|---|---|---|---|
| INV-12 / INV-10 | Staff read is org-wide, not per-patient, and reads are not logged. Also breaks the spec's admin-search remark only if admin search is unaudited | `private.is_org_staff` definition (role <> patient, excluding listed roles, `organisation_id = org` or `role='admin'`). Used in select policies of `vitals_readings`, `patient_conditions`, `medications`, `clinical_encounter_notes`, `patient_pregnancy`, `contraception_plans`, `menstrual_cycles`, `menstrual_daily_logs` (reproductive data readable by any org staff, no category check), `symptom_triage_assessments`, `lab_orders`. `audit_log` has 4,689 rows, all from `audit_row_change_trg` (writes) | Critical | Introduce `private.can_clinician_read(patient)` (active task, lead assignment, on-call page, or break-glass) and migrate policies in tiers, reproductive/mental/sexual health first. Add a SECURITY DEFINER read-logging wrapper (or view layer) for clinician chart reads. Keep admin patient search as an audited, PII-minimal RPC, matching the spec's inline note |
| INV-08 | SMS and Termii used far beyond verification codes | Termii fetches in `supabase/functions/send-pending-notifications/index.ts` (lines ~2657, 2692; generic SMS plus voice), `abnormal-result-handler/index.ts:151` (clinician alert SMS), `paystack-webhook/handler.ts:250`, `apps/web/src/lib/notifications/send-patient-link.ts:34`. 59 active SMS template rows. Remap whatsapp to voice (`private.remap_notification_channel`) | High | Decide D-12 scope (clinician paging only). Deactivate all patient SMS templates; keep one auth SMS hook; clinician page via separate path. Settled WhatsApp removal also covers `whatsapp-webhook` function, `send-support-reply`, 28 WhatsApp refs in `send-pending-notifications` |
| INV-07 | Templates name conditions, drugs, readings, results | `notification_template_locales`: `diabetes_complication_check_due` sms ("your diabetes eye screening is due"), `medication_adherence_checkin` sms ({{drug_name}}), `medication_refill_reminder` sms ({{drug_name}}), `medication_prescribed_patient` sms/email ({{details}}), `abnormal_result_clinician_alert` sms ({{condition_label}}, patient name), `sponsor_person_quiet` sms/in_app/email ("has not logged a reading", a sponsor learns a person is on a care plan), `result_document_available`, `result_interpretation_ready` in_app ("lab result"), `lab_order_requested_patient` email ("lab test order"), `cycle_period_due_*` (reproductive, in_app/push?). No lint test found | High | Rewrite to generic keyed copy ("You have an update in the app"); add a Jest lint that scans `notification_template_locales` seeds and code templates for a clinical-term list; decide whether in-app inbox previews (inside the app) are exempt, since INV-07 names "in-app previews" |
| INV-09 | Stored balances exist | `platform_credit_balances` (paid/promo/lifetime columns, config min_topup 100000 kobo), `platform_credit_topup_intents`, `platform_credit_ledger_entries`; `wellness_points_balances` (2 rows, integer `balance`), `wellness_points_ledger`, `wellness_points_redemptions.kobo_credited` (points convert to a voucher at 50 kobo/point); `care_vouchers` (face_value_kobo, redeemed_amount_kobo, 0 rows) | High (spec-settled for Platform Credit) | Platform Credit: already settled, drop in removal migration (0 balance rows, so no refund step). Care Vouchers: they are a pre-paid stored value; decide whether "pay for a loved one / sponsor-paid items" should be rebuilt as order-linked sponsor payments. Wellness points: decide keep (non-monetary) or remove the points-to-kobo conversion, since it mints spendable value |
| INV-13 | No `is_test` flag anywhere | information_schema query for `is_test`/`is_test_account` returns 0 columns. Memory notes show 45 test accounts were hard-deleted 2026-09-30 and QA accounts live at `@tarragon.test` | High | Add `is_test` on `profiles`, `clinical_staff`, orders/payments; backfill by email domain; filter in every `analytics.*` view and payout view; add a metric-view lint |
| INV-02 | Treatment changes not signature-gated in data | No `prescriptions` or `care_plan_changes` table. `medications_update` policy = patient self OR (staff AND has_prescribing_authority OR can_confirm_medication_refill). No `signed_by`/`signed_at` | High | Add `signed_by`, `signed_at` with CHECK on `medications` (or new `prescriptions`) plus `care_plan_changes`; trigger blocking status transitions without signature. Note patient can UPDATE own `medications` row (self-edit of dose?) needs a column allow-list |
| INV-03 / INV-04 | Lab release and HIV/HBsAg/HCV disclosure state machine absent | No `release_state`, no `sensitive_positive` in packages/db or supabase. Lab tables: `lab_orders`, `lab_result_documents`, `lab_result_interpretations`, `lab_report_extractions` (AI extraction) | High | Add `release_state` enum and `sensitive_positive` force-rule on result items; RLS for patients returns only released; block AI interpretation/audio on sensitive positives. Needs clinical design since results arrive as documents, not items |
| INV-05 | Red event is queue plus outbox, no on-call paging | No on_call/rota/page tables. `clinician_alerts` auto-assigned (pull-free, good) but delivery through `send-pending-notifications` (cron/outbox), `backup_clinician_id` is the only escalation target | Medium | Add on-call roster and a page record with ack timer; call from red trigger directly (edge function invoke), escalate via `clinician_alert_ack_escalations`. Interacts with D-12 (SMS for clinician paging) |
| INV-06 | Offline coverage partial | Mobile modal covers only locally red-flagged BP and glucose ("see glucose-red-flags.ts, bp-classification.ts"). Pulse, SpO2, temperature and symptom triage red rules have no on-device copy. Web has none | Medium | Port remaining classifiers and triage red rules to a shared TS module evaluated on device; bundle emergency audio |
| INV-11 | No scribe, consent or signing discipline on AI drafts | Tables: `case_briefs` (status failed/generated only, written by service role in `lib/case-briefs/generate.ts`), `care_message_draft_replies`, `imaging_ai_assist_drafts`, `lab_report_extractions`, `ecg_report_extractions`, `vaccination_card_extractions`. `clinical_encounter_notes` has `auto_generated`, `status text` (no enum/CHECK), RLS select is staff-only (patient view of drafts not confirmed) | Medium | Decide scribe as new build (Module 15/23); until then add CHECK on `clinical_encounter_notes.status` in (draft, signed) with `finalized_by_staff` required for signed; patient policy returns signed only; audit that extraction tables never write to `vitals_readings`/`medications` without clinician confirm |
| INV-16 | Vitals thresholds not versioned | `private.classify_bp_level`: hardcoded 135/85 amber, 160/100 red, 200/120 emergency. Same for pulse/SpO2/temp. `clinician_alerts` has no threshold or protocol version column (only `protocol_scope_exceeded*`) | Medium | Add `classifier_version` to `vitals_readings` red-flag outputs and `clinician_alerts`, or move thresholds to a versioned config table read by the function |
| INV-15 | Non-integer money-adjacent columns | `service_product_margins.contribution_kobo/delivery_cost_kobo/payment_fee_kobo` numeric; `wellness_points_config.points_to_kobo_rate` numeric; `platform_currency_settings.usd_processing_fee_pct` numeric | Low | Views computing margins may stay numeric if cast to bigint at the storage boundary; add a lint for `float`/`double` money and a bigint-only check on stored columns; make the points rate an integer |
| INV-01 | Spec names `packages/clinical`; does not exist | `ls packages`: db, integrations, lifestyle-engine, notifications, shared, symptom-triage-engine. BP/vitals red rules live in SQL and in mobile TS, triage engine in its own package. AI coach keyword list is a second, parallel deterministic layer | Low | Doc fix: rename the invariant's location, or create `packages/clinical` re-exporting the engine. Add a test asserting no LLM import reachable from the triage package |
| C.1 Cycle contraception | Fertile window and ovulation predicted and shown | `lib/rules/cycle-insights.ts:122-125` (phase "fertile" = ovulation-5..+1); `cycle-tracker.tsx:301-310` and `cycle-calendar.tsx:154` show "Fertile window dd to dd" with `FERTILE_WINDOW_DISCLAIMER`; `cycle-thermal-shift.ts` temperature-based ovulation confirmation. `contraception_plans`/`emergency_contraception_requests` tables exist | Medium | The spec allows "conception planning, labelled not contraception" so this is partial compliance. Open question whether to keep the prediction UI; ensure disclaimer text literally says not contraception and that no copy suggests avoiding pregnancy |
| C.1 Employer and reproductive data | Reproductive rows readable by broad org staff | `menstrual_cycles_select`, `menstrual_daily_logs_select`, `patient_pregnancy_select`, `contraception_plans_select` include `private.is_org_staff(organisation_id)` (any clinician or coordinator in the org, no category grant). Employer dashboards are aggregate-only (good), but corporate admins are excluded from `is_org_staff` so not exposed | Medium (same root as INV-12) | Fold into INV-12 fix; CLAUDE.md memory already warns reproductive tables need category-scoped checks written fresh |
| C.1 Auto-renewing | Capability exists, dormant | `subscriptions` has `cancel_at_period_end`, `current_period_end`, `interval`; 13 plans all inactive; 0 rows. `programme_purchases` has `cancelled_at`; no renewal job found | Low | Matches C.2 "built but switched off". Add CHECK or `app_config` guard so no subscription can be activated while the flag is off; add a test |
| C.1 Fasting timers | None found | grep for fasting timer/window: nothing (only glucose fasting readings) | None | n/a |
| C.1 Facial/voice scores, ads, public leaderboards | None found | no matches in apps; wellness challenges are private enrolments | None | n/a |
| C.2 Salaried clinicians | Overridden by settled hybrid decision | `clinical_staff.employment_type` employed/contracted exists | n/a | Update spec Part C.2 row to hybrid |
| C.2 Pharmacy delivery | Schema and UI exist but dormant | `pharmacy_order_delivery_attempts` (0 rows), `logistics_partners` (placeholder, inactive), `components/delivery-address-form.tsx`, `pharmacy-catalogue.tsx` | Low | Spec says prescription to partner pharmacy for collection. Confirm removal scope (drop delivery attempts table, keep address for lab home collection?) |
| C.2 Therapy | Directory and sessions tables dormant | `therapy_sessions` 0 rows, `therapy_directory`, marketing page `therapy/page.tsx`, admin references | Low | Decide remove or keep as referral-only directory (spec: onward referral) |
| C.2 Subscriptions | Dormant | as above | Low | Keep, switched off |

## 5. Role mapping

Live `profiles.role` type `user_role` (14 labels): patient, clinician, admin, hmo_admin, corporate_admin, care_coordinator, pharmacist, analyst, lab_liaison, finance, lab_partner, payer_admin, provider_org_staff, ngo_admin. (Column is `role`, not `user_role`; CLAUDE.md wording "profiles.user_role" refers to the enum type.)
`clinical_staff.doctor_tier` enum: care_coordinator, medical_officer, senior_medical_officer, chief_medical_officer. `clinical_staff.employment_type` enum `staff_employment_type`: employed, contracted.

| v5 role | live mapping | notes |
|---|---|---|
| patient | role=patient | match |
| supporter | profile_access grantee (grantee_user_id), no role; grantee is typically a `patient` role profile | v5 supporter = Care Circle member; live has no supporter role, correct per live "never split account role" rule; also caregiver via care_access_requests |
| clinician | role=clinician AND clinical_staff.doctor_tier in (medical_officer, senior_medical_officer) | v5 tier 1 ~ medical_officer; v5 tier 2 (on-call, lead, prescribing, titration) ~ senior_medical_officer; live unified account role, tier gates per action |
| clinical_lead | role=clinician AND doctor_tier=chief_medical_officer | confirmed: v5 clinical_lead maps to chief_medical_officer (governance, protocol sign-off, reassign, incident review, pause pilot). Live intentionally has no separate flag or account role |
| ops | role=care_coordinator (logistics, non-clinical) and/or admin; also lab_liaison, finance for specialised ops | v5 ops verifies licences/referees and runs payouts; live care_coordinator cannot interpret results (matches v5 ops "no clinical judgment"), but licence verification lives with admin/superadmin today. No single ops role |
| admin | role=admin (superadmin drill-in per I9) | match; `set_platform_module` is superadmin-gated |
| partner_lab | role=lab_partner (profiles.lab_provider_id) | match; lab_liaison is Tarragon-side staff |
| partner_pharmacy | role=pharmacist (profiles.pharmacy_partner_id) | match |
| (live-only) | hmo_admin, corporate_admin, payer_admin, provider_org_staff, ngo_admin, analyst, finance | B2B/institutional roles v5 does not model (v5 scope is Stage 1 consumer + clinician network); several modules dormant via platform_modules |

Tier caution: v5 "tier" is a 1/2 credentialing level (Tier 1 limited, first 20 tasks audited) while live doctor_tier is a 4-step seniority ladder with a non-clinical coordinator rung; do not conflate (same naming-collision class CLAUDE.md warns about). v5 `clinicians.status` suspended/offboarded needs a new column since live only has `active`.

### 5.1 `clinicians` (v5 7.2) versus `clinical_staff`
v5 `clinicians`: profile_id -> clinical_staff.profile_id (match); mdcn_folio -> credential_number (+credential_type); licence_expires_at -> license_expires_at; indemnity_expires_at -> indemnity_expires_at (match); tier (1,2) -> doctor_tier enum (4 values, different semantics); status (active/suspended/offboarded) -> `active` bool only (no suspended/offboarded); max_concurrent_claims, max_lead_patients, reliability_score -> absent; languages text[] -> absent (profiles.language single); paystack_recipient_code, bank_verified_at -> absent. Live extras: employment_type (employed/contracted), specialist_type, staff_number, photo_url, bio, red_flag_attested_at, indemnity_exempt*. Verdict DIFFERS, live wins; add missing columns.

## 6. Table mapping (every v5 table in Sections 4, 5 and 7)

| v5 table | live table(s) | verdict | notes | recommendation |
|---|---|---|---|---|
| profiles | profiles | DIFFERS | live: `role` (user_role enum, 14 values), `organisation_id`, `phone` (not phone_e164), no email/verified_at cols (email in auth.users), `language` text (not `preferred_language` en/pcm), no `is_test`, `is_active` bool instead of `status`; carries patient demographics (dob, sex, state, city, emergency contacts, height) | live wins; add `is_test`, verify `language` accepts `pcm`; expose v5 shape via view |
| patients | profiles (demographic cols) + patient_blood_profile, patient_cardiovascular_profile, patient_diabetes_profile | DIFFERS | no `patients` table. dob/sex/state/city on profiles; blood group/genotype in patient_blood_profile; `lga` missing (city/area instead); emergency contacts are flat columns not jsonb; no `discreet_mode`/`low_data_mode` (sexual_health_privacy_settings, patient_notification_preferences partial) | live wins; adapter view `patients` over profiles where role='patient'; add `discreet_mode`/`low_data_mode` |
| dependants | profiles (`is_dependent_account`, `dependent_kind`, `majority_review_at`), profile_access (grantee/profile, level view/manage), dependent_transition_status | DIFFERS | no guardian->dependant row with `relationship`/`ends_at`. Dependent is its own profile; guardian link is profile_access; majority handled by sweep cron + `majority_review_at` | live wins |
| proxy_setups | none (closest: care_access_requests, profile_access) | NEW | no pending/confirmed/expired phone-target proxy setup | v5 wins (new table) or map onto care_access_requests; founder decision |
| clinicians | clinical_staff (+ profiles.role='clinician') | DIFFERS | see 7.2 row below | live wins, extend |
| partners | lab_providers, pharmacy_partners, network_partner_organisations (+ lab_provider_locations, pharmacy_partner_locations, logistics_partners, imaging providers) | DIFFERS | v5 single `partners(type lab/pharmacy)` vs live split per type, each with own license/onboarding/contact cols; no `hours jsonb`, no unified `status` | live wins; adapter view `partners` (union) if a single API shape needed |
| partner_users | profiles.lab_provider_id / profiles.pharmacy_partner_id / profiles.is_partner_admin, imaging_provider_staff | DIFFERS | partner membership is a column on profiles, one partner per user, no join table (imaging has join table) | live wins; adapter view |
| consent_types | consent_versions (`consent_type` enum: data_processing, telehealth, terms_of_service, device_data, marketing, research, wearable_device_data) | DIFFERS | enum not table; codes differ: v5 `care`,`care_circle_sharing`,`sponsor_reporting`,`scribe_default` have no live equivalent; live has `telehealth`,`terms_of_service`,`device_data`,`marketing`, `data_processing`; body text stored in DB (v5 uses `text_key`) | live wins; add enum values for care_circle_sharing/scribe_default/sponsor_reporting (enum ADD VALUE needs its own txn) |
| consents | patient_consents | DIFFERS | live: `consent_type`, `consent_version_id`, `version`, `accepted_at`, `action` (grant/withdraw as rows); v5: `granted bool`, `granted_at`, `withdrawn_at` on one row | live wins (append-only event style); view for v5 shape |
| scribe_consents | none (clinical_encounter_notes has `identity_confirmed*`, `auto_generated`) | NEW | no per-encounter AI scribe consent | v5 wins |
| observations | vitals_readings | DIFFERS | live is wide table: `vital_type` enum (10 types incl. blood_pressure/glucose/weight/pulse), typed columns (systolic, diastolic, glucose_mmol_l, weight_kg, pulse_bpm...) not `value_numeric`/`unit`; has `position`, `arm`, `source` (manual/device/wearable/cgm/fhir_import; no ussd/clinician/partner/system), `client_reading_id` (= idempotency `client_id`), `validation_status`; no `triage_event_id` col; wearable_readings separate | live wins; add `triage_event_id` if triage_events built; view `observations` |
| symptom_reports | symptom_triage_assessments (+ symptoms, breast_symptom_reports etc.) | DIFFERS | live stores triage assessment with `initial_capture`/`red_flag_screen` jsonb, `presenting_complaint_key`, category; no `codes text[]`/`client_id` | live wins |
| conditions | patient_conditions | MATCH (close) | `condition_name`, `icd10_code`, `status`, `recorded_by`, `diagnosing_clinician_id`; no `verified_by_clinician` bool (diagnosing_clinician_id serves) | live wins |
| allergies | patient_allergies | MATCH (close) | allergen, reaction, severity, verification_status, verified_by | live wins |
| medications | medications | DIFFERS | live merges med + schedule: `drug_name`, `dose`, `frequency`, `schedule_times jsonb`, `source` (medication_source), `is_active`, versioning (`version`, `previous_version_id`); no `generic_name`/`strength`/`form`/`prescription_id`; no start/end date but `duration_days`, `stopped_at` | live wins |
| medication_schedules | medications.schedule_times + medication_refill_state + medication_dose_reminders | DIFFERS | no separate schedule table | live wins |
| dose_events | medication_logs | DIFFERS | live: `status` (medication_log_status), `scheduled_for_date`+`scheduled_time` (text) not `due_at`, `logged_at`, `missed_reason`; no `client_id` idempotency key; no pending rows pre-created (reminders in medication_dose_reminders) | live wins; add `client_id` for offline idempotency |
| documents | patient_documents (+ lab_result_documents, imaging_report_documents, ecg_report_documents, verified_documents) | DIFFERS | patient_documents: `document_type`, `file_path`, `uploaded_by`; multiple specialised doc tables | live wins |
| encounters | clinical_encounters (summary/sync index: encounter_type, source_table/source_id) + video_consultations + appointments tables | DIFFERS | clinical_encounters is an additive derived summary (9 sync triggers), not the source of truth; video_consultations has scheduled/started/ended; no `order_id`/`task_id`; no audio/phone/async type unification | live wins; do not make clinical_encounters authoritative |
| notes | clinical_encounter_notes | DIFFERS | live: SOAP-like text cols (history, examination_findings, assessment, plan), `status` text, `finalized_by_staff`/`finalized_at`, `auto_generated`; no `body jsonb`, `ai_drafted`, `amends_note_id`, draft/signed/amended state | live wins; add `ai_drafted`, `amends_note_id`, state values if scribe built |
| prescriptions | medications (source/rx_number/verification_code/prescriber_*) + pharmacy_orders (items jsonb, status) + prescription_renewal_requests | DIFFERS | no standalone prescription entity with signed/sent/dispensed/cancelled; `rx_number`+`verification_code` on medications; pharmacy_orders holds items jsonb; `pharmacy_order_dispenses` for dispense | live wins; decide whether v5 needs a prescription header table |
| referrals | specialist_referrals (live `referrals` is the patient-invite/referral-code table, name collision) | DIFFERS | specialist_referrals: rich 8-stage pipeline, `specialist_type`, `referral_reason`, `status`; no `letter_document_id`/`signed_by`; NAME COLLISION: live `public.referrals` = growth referrals | live wins; map v5 `referrals` -> specialist_referrals, never reuse the name `referrals` |
| lab_orders | lab_orders | DIFFERS | live: `provider_id`, `status` (lab_order_status), `total_kobo`, `payable_kobo`, payment fields, fulfilment, home visit, specimen link; no `panel_code` (panel_bundle_id, lab_tests), no `collection_site` (location_id/facility_id) | live wins |
| lab_results | lab_result_documents (per-document release/review) + lab_analyte_readings + lab_report_extractions | DIFFERS | no `lab_results` header with `release_state`; release gating is via `acknowledgement_status`, `reviewed_by/at`, `clinician_alert_id`; INV-04 sensitive-positive disclosure gate not present as a column | v5 wins for release_state semantics (add column/enum on lab_result_documents) or adapter view; verify gate before adopting |
| lab_result_items | lab_analyte_readings | DIFFERS | live: `code`, `value`, `value_text`, `unit`, `reference_range_low/high`, `abnormal_flag` (lab_analyte_flag); no `lab_result_id` FK (links via patient/order?), no `sensitive_positive` | live wins; add `sensitive_positive` + result link |
| protocols | protocol_versions (+ condition_protocols, protocol_drafts) | DIFFERS | `protocol_id` text, `version_number`, `content jsonb`, `approved_by/at`, effective/review/retirement dates; no `status` enum (derived from dates) | live wins |
| triage_rule_sets | triage_protocols (version, config jsonb, approved_by/at, is_active), escalation_slas (same shape) | DIFFERS | `config` not `rules`; `is_active` not status draft/approved/retired; no `code` (single row family); signed only via SECURITY DEFINER fn | live wins; note v5 `rules` JSON schema must fit `config` |
| pathway_enrolments | chronic_condition_programmes (catalogue) + chronic_programme_schedule_occurrences/templates + preventive_programme_enrolments + care_plans | DIFFERS | no single enrolment row with `state` (self_guided/care_pack_active/...) or `lead_clinician_id`; lead = care_team_assignment.clinician_id / care_plans.assigned_clinician_id | live wins; new table only if care-pack states needed |
| care_plans | care_plans (+ care_plan_versions, care_plan_goals, care_plan_interventions, care_plan_decisions, patient_bp_targets) | DIFFERS | live: `condition` enum, `status`, `target_ranges jsonb` (~ targets), `assigned_clinician_id`; versioned via care_plan_versions snapshot; no `reading_schedule jsonb` (monitoring_schedule_items), no `signed_by` | live wins |
| care_plan_changes | care_plan_versions (changed_by), care_plan_review_prompts, care_plan_recommendations, medication_change_requests | DIFFERS | no proposed/signed/rejected engine-vs-clinician proposal record (INV-02) | v5 wins (new) or extend care_plan_recommendations |
| patient_tasks | care_tasks (owner_role, owner_id, priority, status, escalation_stage), lpe_task_instances, medication_dose_reminders | DIFFERS | care_tasks is a generic owner-role task; no `kind` enum (log_bp, take_medicine, ...), no `source_event_id` | live wins; map kind via `source`/title or add column |
| triage_events | clinician_alerts (level/severity/type_code, vital_reading_id, screening_result_id), emergency_events, clinical_rule_events, symptom_triage_assessments | DIFFERS | grade green/amber/red is distributed: alert_level enum (routine..emergency), emergency_events for red; no row per graded observation, no `rule_id`/`rule_set_version_id`/`explanation_key` (clinical_rule_events may hold) | v5 wins as an audit log of every grading (new `triage_events`) or extend clinical_rule_events; founder decision |
| clinical_tasks | clinician_alerts + escalations (assigned_doctor_id, status) + alert_follow_up_tasks + care_outreach_tasks + chronic_programme_coordinator_tasks + care_tasks | DIFFERS | no unified priority queue with claim/lease/min_tier/competencies/fee. Live is push-assignment (auto_assign_escalation, responsible_clinician_id, backup_clinician_id) not pull "Next task" | conflict of model: v5 wins only if pull-queue is adopted; else live wins and adapter view `clinical_tasks` over alerts/escalations |
| task_claims | none | NEW | no claim log (live has assigned_at on alerts, acknowledged_by) | v5 wins if pull-queue adopted |
| task_handbacks | none | NEW | no handback/reason/count | v5 wins if pull-queue adopted |
| pages | none (closest: clinician_alert_ack_escalations hop/notified_role, notifications escalation_* cols, notification_escalation_failures, cron escalate-critical-notifications, clinician-alert-ack-timeout-escalation) | NEW (partly covered) | ack-timeout escalation exists as cron+hops, but no `pages` row with `to_clinician_id`/`acknowledged_at`; no on-call rota to target | v5 wins for pages + on_call_rota; reuse ack-escalation cron |
| care_circle_members | profile_access (grantee_user_id, permission_level view/manage, `permissions caregiver_permission[]`, `expires_at`, clinical_access) + profile_access_categories | DIFFERS | live permission set: view_appointments, book_appointments, view_medication, manage_pharmacy, view_results, view_care_plan, communicate_with_care_team, manage_payments, receive_alerts; v5: adherence_summary, weekly_bp_trend, appointments, red_alerts, pay_for_care. No `state` (invited/active/revoked) col; `expires_at` present | live wins; map names (red_alerts~receive_alerts, pay_for_care~manage_payments, appointments~view_appointments); add summary-level perms as enum values **Superseded by S29 (2026-10-06): built as a separate `care_circle_members` table, not on `profile_access`, because several live policies admit any `profile_access` grantee with no permission check (OQ-192); see `docs/design/S29.md`.** |
| care_circle_invites | care_access_requests | DIFFERS | request/approval model; verify token_hash/phone invite support | live wins (verify) **Superseded by S29: `care_circle_invites` (hashed token, bound to a verified contact) beside, not replacing, `care_access_requests`.** |
| catalog_items | service_products (code, name, price_kobo, currency, features, is_active) + chronic_condition_programmes.price_kobo + lab_tests + video_visit_prices + lab_result_consult_prices | DIFFERS | no unified `kind`; price embedded on product (`price_kobo`), plus `stripe_price_id` legacy column (Stripe removed) | live wins |
| prices | service_products.price_kobo, lab_test_price_versions (effective_from/to, price_type), video_visit_prices | DIFFERS | only labs have versioned pricing; no `components jsonb` partner/tarragon fee split (lab_tests.commission_rate, partner_cost_*) | live wins; add versioned prices table only if needed |
| orders | service_purchases, lab_orders, pharmacy_orders, specialist_referrals (booking_order_type/id), care_voucher redemptions | DIFFERS | no unified orders table; per-domain purchase tables each with `payment_provider`, `payment_provider_ref`, `payable_kobo`; service_purchases has `purchaser_profile_id` (= buyer) and `patient_id` (= beneficiary) | live wins; adapter view `orders` (union) |
| payments | payment_transactions (provider, provider_event_id, amount_minor, raw_payload, event_type) + care_voucher_payments, screening_day_payments, platform_credit_topup_intents | DIFFERS | transaction-event log keyed by provider event, `booking_order_type`/`booking_order_id` not `order_id`; no `status`/`verified_at`; Paystack only | live wins |
| refunds | lab_order_refunds, pharmacy_order_refunds, service_purchase_refund_queue, voucher_refund_queue (+ refund policies) | DIFFERS | per-domain refund tables, no unified | live wins |
| entitlements | service_purchases (status, expires_at, redeemed_at, scoped_entity) + care_vouchers + platform_credit_balances/ledger | DIFFERS | entitlement = purchase with expiry/redemption; no `remaining_uses`, no consultation_credit/care_pack kinds; care pack = chronic programme purchase | live wins; add remaining_uses only if credits needed |
| domain_events | integration_outbound_events (partner webhook outbox: event_type enum, dedupe_key, attempts, status, drain cron every minute) | DIFFERS | see Outbox section. Not an internal transactional domain-event bus; scoped to outbound partner webhooks, `event_type` is an enum | v5 wins: add internal `domain_events` outbox; keep integration_outbound_events as a subscriber target |
| notifications | notifications | DIFFERS | live: `recipient_id`, `channel` (notification_channel), `template`, `payload jsonb`, `status`, `attempts`, `last_error`, `content_class` (INV-07 style CHECK), priority, escalation_* hops, `send_after`; channels incl. whatsapp/sms/email (v5: push/in_app/email only) | live wins (superset); restrict channels by config |
| push_tokens | push_subscriptions (`profile_id`, `expo_push_token`, `platform`, `last_seen_at`, `disabled_at`, web push keys) | MATCH (close) | name differs, Expo token present | live wins |
| app_config | feature_flags (key, status, rollout_percent), feature_flag_rules, platform_modules (key, is_enabled, enabled_by, activation_note), escalation_slas/triage_protocols (versioned config rows), *_config tables (care_voucher_config, platform_credit_config, growth_config, cv_risk_config, finance_approval_settings) | DIFFERS | no generic `app_config(key, value jsonb, version)`; config scattered across typed tables; go-live guard = `platform_modules` via `set_platform_module()` | live wins for guards; add `app_config` only for v5 task_types/SLA/claim-timeout values, or adapter |
| audit_log | audit_log | DIFFERS | live: `actor_id`, `action`, `entity_type`, `entity_id`, `event jsonb`, `reason`, `result`, `organisation_id`, `created_at`; v5: `actor_profile_id`, `subject_patient_id`, `object_type/id`, `ip`, `at`. Append-only enforced (see below) | live wins; add `subject_patient_id` (+ `ip`) for patient-access audit |
| incidents | ops_incidents (+ clinical_incident_reports, data_breach_incidents, ai_safety_incidents, integration_incidents) | DIFFERS | live richer: severity/status enums, SLA due, links to clinical_incident_report; clinical_incident_reports has `reviewed_by_staff`, `root_cause_category` (= `learning`) | live wins |
| outcome_snapshots | outcome_reports (org period snapshot jsonb), patient_risk_scores, outcomes_contracts, risk_model_outcomes | DIFFERS | live = org-level period report; no per-patient day 0/30/90/180 snapshot with bp_avg_7d/controlled/adherence | v5 wins (new `outcome_snapshots`) |
| clinician_applications | none | NEW | no credentialing state machine table | v5 wins |
| clinician_documents | none (clinical_staff holds credential_number, license_expires_at, indemnity_*; clinical_staff_attestations, clinical_staff_indemnity_exemptions) | NEW (partial in columns) | documents are not stored per row; `provider-credential-ladder-advance` cron + license/indemnity lapse notification tables exist | v5 wins for documents |
| competencies / clinician_competencies | none (closest: clinical_staff.specialist_type enum, doctor_tier, clinical_governance_domain_owners) | NEW | no competency codes/grants; authority is tier-based per-action | v5 wins only if pull-queue needs competency matching; else skip |
| availability_blocks | provider_availability_rules (weekly recurring: day_of_week, start/end_time, consultation_method, slot minutes) + provider_time_off (kind leave/blocked) + consult_availability_slots | DIFFERS | live = recurring weekly patient-booking rules, not declared dated queue/on_call/bookable blocks with confirm state and minimum-guarantee flag | v5 wins for dated queue/on_call blocks; keep live rules for bookable consultations |
| on_call_rota | none | NEW | no rota; clinician_alerts has responsible_clinician_id/backup_clinician_id per alert | v5 wins |
| conflicts | none | NEW | no clinician-patient conflict list (hand-back reason "conflict_of_interest" has nowhere to persist) | v5 wins |
| fee_schedules / earnings_ledger / payouts | none (finance: platform_credit ledger, partner_statements for labs/pharmacy, revenue_recognition_schedules; no clinician payroll/payouts) | NEW | no per-task clinician fee/earnings/payout; Paystack transfer recipient absent (`paystack_recipient_code`, `bank_verified_at` not on clinical_staff) | v5 wins |
| safety_concerns | clinical_incident_reports, safeguarding_concerns, ai_safety_incidents | DIFFERS | clinical_incident_reports is closest; hidden-from-ops visibility unverified | live wins; verify RLS hides from ops |

### 6.1 Event outbox, go-live guard, audit shape
- Outbox: no `domain_events`-like internal outbox. Only `integration_outbound_events` (partner webhook delivery; dedupe_key, attempt_count, max_attempts, next_attempt_at; drained by pg_cron `integration-outbound-drain` every minute) and `notifications` (attempts/last_error/send_after, cron send-pending-notifications every 5 min, escalate-critical-notifications every 2 min). pg_cron and pg_net extensions are installed. Triage today is trigger-driven (vitals_readings triggers -> emergency_events/clinician_alerts), synchronous in-transaction, not event-bus based. v5 sec 5 (15 s process-events cron + pg_net immediate red trigger) would be new; shortest cron is currently every minute.
- Config/go-live guard: `platform_modules(key, is_enabled, enabled_by, activation_note)` with `public.set_platform_module()` checked in RLS/RPCs/route guards (payer_platform, provider_org_platform, ngo_funded_cohort dormant) = the go-live guard mechanism; `feature_flags(key, status, rollout_percent)` + `feature_flag_rules` for rollout. Versioned signed config: `escalation_slas`, `triage_protocols` (is_active, approved_by/at, no UPDATE policy). No generic `app_config`; v5 `clinical_operations_enabled` guard has no key yet (would be a new platform_modules row, recommend reuse instead of new table).
- audit_log: columns id, organisation_id, actor_id, action, entity_type, entity_id, event jsonb, created_at, reason, result. Grants: authenticated INSERT,SELECT only; service_role and postgres retain full DML grants. Append-only is enforced by BEFORE UPDATE and BEFORE DELETE row triggers calling `private.reject_mutation()` (audit_log_no_update / audit_log_no_delete), not by grant removal; TRUNCATE is not covered by row triggers and service_role/postgres hold TRUNCATE. RLS policies: audit_log_insert, audit_log_select. v5 says "no update or delete grants": live meets intent via triggers, differs in mechanism; missing `subject_patient_id`, `ip`.

### 6.2 Conclusions of the table audit
- v5 data model is a greenfield-style schema; live already covers roughly 60% in different shapes (mostly DIFFERS, few clean MATCH: conditions, allergies, push tokens, audit_log purpose).
- Biggest architectural conflict: v5 pull-queue ("Next task", claims, freelance fees) vs live push auto-assignment (auto_assign_escalation, responsible_clinician_id, on-leave aware). Decide before any table work; the pull-queue tables (clinical_tasks, task_claims, task_handbacks, pages, rota, earnings) are the largest NEW block.
- Naming hazards: live `public.referrals` is growth referrals (v5 referrals = specialist_referrals); live `profiles.role` vs v5 `profiles.role` same name, different value set; v5 `tier 1/2` vs live `doctor_tier`; v5 `partners` vs three live partner tables; live `clinical_encounters` is a derived index.
- Recommended default: live wins for identity, health record, commerce, notifications, audit (adapter views where v5 API shape is needed); v5 wins for outbox, pages/rota/credentialing/earnings, scribe consent, proxy setup, outcome snapshots, care_plan_changes, triage_events.

## 7. Schema check against the live database

Method: live `supabase_migrations.schema_migrations` (1495 rows, latest 20260925100910) vs `supabase/migrations/` on origin/main-dev worktree (1483 files). `scripts/release-integrity/check-migration-drift.mjs` exists (matches by version OR the 14-digit timestamp in the live row name, fails only on UNTRACED/UNPUSHED/LOCAL-NOT-APPLIED) but could not be run here: SUPABASE_ACCESS_TOKEN is not set. A full exact-version diff was not transcribed; bounds below come from per-day count comparison (files and live rows both begin 20260705).

Counts
- Live 1495, files 1483, net +12 live.
- Lower bound from per-day comparison: at least 119 live rows with no same-version file and at least 107 files with no same-version live row. Heaviest days: 20260902 (live 152 vs files 80), 20260908 (30 vs 2), 20260829 (173 vs 252), 20260828 (113 vs 123). This is mostly the known hand-typed-timestamp / re-stamped-version pattern (live row carries the filename timestamp in `name`), not loss.

Recent (version >= 20260915): live 158, files 151.
- Files with no live row (2, both are re-stamps, content IS live):
  - 20260917222259_deactivate_orphaned_mammography_screen_type.sql (live as 20260917222332)
  - 20260917222609_fix_daily_staleness_sweep_dedup_window.sql (live as 20260917222704)
- Live rows with no file on main-dev (7 genuine):
  - 20260918111442 account_lockout_after_repeated_failed_logins (committed 49c4cda4, branch only)
  - 20260922191934 fix_new_device_signin_missing_to_email (db20ef86, branch only)
  - 20260922201110 password_verification_hook_gotrue_level_lockout (fd27d3b3, branch only)
  - 20260925093444 enforce_profiles_is_active_in_core_authz (bcd0a714, branch only)
  - 20260925094425 users_suspend_permission (bcd0a714, branch only)
  - 20260925100329 set_member_active_atomic_rpc (315ca4f8, branch only)
  - 20260925100910 fix_is_org_staff_comment_stale_nurse_mention (315ca4f8, branch only)
  All 7 have a commit on some other local/remote ref (git log --all finds an add commit), none on main-dev. Not checked: whether those refs are pushed to origin. Note 20260924215642 on main-dev is a "backfill_migration_record" for account lockouts, so the lockout family was already partly recovered once.

Security-relevant checks (live)
- private.guard_profiles_self_update exists, SECURITY DEFINER, search_path '', attached to 1 trigger; 18 live migration records mention it and main-dev has files (e.g. 20260827203516_profiles_self_update_column_guard.sql). No untraced-function gap found for it.
- Newest 40 functions in private/public: no `public.*` function grants EXECUTE to anon. 10 newest `private.*` SECURITY DEFINER trigger functions do have anon EXECUTE = true (enforce_lab_location_review_moderation_only_update, enforce_doctor_testimonial_org_match, stamp_doctor_testimonial_review, reputation_review_on_* x4, activate_sponsored_service_reservation). Trigger functions cannot be invoked directly, so low risk, but activate_sponsored_service_reservation is not a trigger by name: verify its return type and revoke from PUBLIC if it is callable.
- Newest objects are account lockout, login suspend (set_member_active), reputation, sponsored reservations: consistent with the 7 branch-only migrations above.

Loss-risk classification (repo terminology)
- UNTRACED: 0 found (all 7 live-only recent rows trace to a commit).
- UNPUSHED: unknown for the 7 (need `git branch -r --contains <sha>` for 49c4cda4, db20ef86, fd27d3b3, bcd0a714, 315ca4f8). Treat as the only plausible FAIL class; the lockout and suspend work is auth-critical.
- LOCAL-NOT-APPLIED: 0 among recent files (every recent main-dev file is live by version or by re-stamp).
- Everything else: branch-owned warning inventory. Recommend: run the real script with a token in CI or locally, and confirm the 5 commits are on origin.

Checked by this session directly: `private.activate_sponsored_service_reservation` (flagged by the drift audit for anon EXECUTE) is a `trigger`-returning function and `anon` has no USAGE on schema `private`, so it cannot be invoked. Low risk, no action.

## 8. Foundations: what S01 added and what it left

| Item | State after S01 |
|---|---|
| CI lint, typecheck, tests for every workspace | `ci.yml` already ran unfiltered `turbo` typecheck, lint, test and build, so every workspace was covered **except lint for `packages/*`, which had no `lint` script**. S01 added `lint` (ESLint 9 + typescript-eslint, same flat-config shape as `apps/mobile`) to all 8 packages. `pnpm lint` and `pnpm typecheck` pass repo-wide (10 of 10 tasks). Existing required checks untouched. |
| `packages/i18n` (`en`, `pcm`) | New `@tarragon/i18n`: key-based catalogue, `t()`, and a test that fails on a key missing from either language, mismatched placeholders, empty strings, banned words and em dashes. Seeded with 7 neutral keys only. The old `ui-language.ts` dictionary is unchanged (OQ-19). |
| Design tokens | New `@tarragon/ui` exports the brand palette (Tarragon Green `#0E7C52`, Clinical Navy `#12324B`, and the rest of `docs/BRAND_GUIDE.md` section 5). A test fails if `apps/web/src/app/globals.css` drifts from it. Hex literals duplicated in `pdf-brand.ts`, the email renderer, `manifest.ts`, `layout.tsx`, `og-card.tsx` and mobile `theme.ts` were **not** migrated (behaviour-neutral but out of scope). |
| Versioned config loader for PROPOSED values | New `packages/shared/src/proposed-config`: registry (key, value, owner, status proposed/confirmed, version, effective date, source), `getProposedConfig`, `listUnconfirmed`, `validateRegistry`. Seeded only with the ten concrete Section 17 values (care pack price stored as `1_200_000` kobo). Triage thresholds, task windows and claim timeouts are deliberately absent until their sessions. A repo scan test fails if a guarded PROPOSED literal is hard-coded in `apps/` or `packages/` source; it passes today and includes a check that it would catch a sabotaged snippet. No existing live threshold was touched. |
| Copy-lint | New copy-lint scanner (`packages/shared/src/copy-lint/scan.ts`, deliberately not re-exported from the package barrel because it imports `node:fs` and the mobile and web client bundles import that barrel) and test in `@tarragon/shared`, **warn-only for the existing 889 violations, but ratcheted**: it fails if any rule's count rises above `baseline.ts`, and fails if a scan root is missing or the scan reads too few files. `COPY_LINT_ENFORCE=1` requires zero. Baseline below. |
| Sentry | **Not added.** `apps/web` and `services/ml` are covered. `apps/mobile` needs a native rebuild and `runtimeVersion` bump (the repo's own OTA caution); the 7 Edge Functions would each need a redeploy and would move the edge-drift job. Neither is a "safe foundation". See OQ-20. |
| Secret scanning in CI | Not present (CodeQL and Dependabot are). Not added; listed in OQ-20. |

### 8.1 Conventions the foundations follow
### Toolchain and scripts
- Root package.json scripts: dev, build, lint, typecheck, test (all `turbo run <task>`), db:test (`./scripts/run-db-proofs.sh`), clean. devDep only turbo ^2.5.0.
- turbo.json tasks: build (dependsOn ^build; outputs .next/**, dist/**), dev (persistent), lint/typecheck/test (each dependsOn ^build), clean. No `outputs`/cache tuning for test. No turbo `test:e2e` tasks.
- pnpm-workspace.yaml: apps/*, packages/*; `allowBuilds` map (pnpm 11), large `overrides` block (security pins; jest-environment-node/jest-mock pinned 30.4.1), patchedDependencies for @xmldom/xmldom. Add any new package under packages/* automatically included.
- Node: no .nvmrc; engines >=20.9; CI Node 22; local here v24.20.0. pnpm 11.10.0 via packageManager (CI uses pnpm/action-setup@v4 reading it).
- Single-package test: `pnpm --filter @tarragon/shared test` (verified works, ESM jest via NODE_OPTIONS=--experimental-vm-modules). Also `pnpm --filter @tarragon/web test -- <path>`, `pnpm --filter @tarragon/mobile test`.
- Per-package scripts:
  - apps/web: dev/build/start, lint=`eslint`, typecheck=`tsc --noEmit`, test=`jest`, test:a11y, test:e2e (jest.e2e.config.mjs, hits live DB), e2e (playwright smoke), test:e2e-browser (playwright), eval scripts via tsx. Jest: ts-jest CJS, testMatch src/**/*.test.ts(x), `@/` alias, server-only stub, jsdom opt-in per file docblock. ESLint flat config: eslint-config-next core-web-vitals + typescript only (no custom rules, no no-restricted-syntax).
  - apps/mobile: lint=`eslint .`, typecheck, test=`jest` (jest-expo preset, Jest 29 line, pure-logic only, no component rendering), test:e2e-mobile (maestro). eslint.config.mjs present.
  - packages/shared: typecheck, test (ESM ts-jest, testMatch src/**/*.test.ts). NO lint script.
  - packages/symptom-triage-engine, lifestyle-engine: typecheck + test (jest.config.mjs present). NO lint.
  - packages/integrations, notifications: typecheck + test with `--passWithNoTests` and NO jest config (stubs, zero tests). NO lint.
  - packages/db: typecheck only (no test script; SQL proofs live in packages/db/tests, run by scripts/run-db-proofs.sh with ci.manifest/ci.excluded).
- services/ml: Python 3.12, uv, ruff + mypy strict + pytest, pip-audit in CI.

### 1. CI (.github/workflows)
Files: ci.yml (418 lines), codeql.yml, e2e-browser.yml, mobile-ota-publish.yml, release-integrity.yml, plus dependabot.yml.
ci.yml triggers: push to main, all pull_request. Jobs:
- `TypeScript (web + shared)`: pnpm install --frozen-lockfile, then UNFILTERED `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build` via turbo, so every workspace that defines the script is covered (name is stale; mobile and packages included for typecheck/test). Gap: no package under packages/* has a `lint` script, so packages are not linted at all; packages/db has no test; integrations/notifications tests are empty.
- `TypeScript (mobile)`: path-filtered step-level skips (apps/mobile, packages/shared, lockfile); `pnpm --filter @tarragon/mobile typecheck` + `lint` + Maestro YAML lint. Redundant with the job above, exists for named gating. Mobile jest runs only in the first job.
- `Python ML service`: uv sync, pip-audit, ruff, mypy, pytest.
- `Browser E2E (Playwright)`: local supabase start, db reset, playwright (path-filtered). Also e2e-browser.yml separately.
- `Edge functions (Deno)`: path-filtered; `deno test` + `deno lint` ONLY in paystack-webhook/; other 6 functions untested/unlinted (6 pre-existing require-await findings).
- `Supabase migration replay`: supabase start, db reset, ./scripts/run-db-proofs.sh.
release-integrity.yml: Vercel promotion check, edge function drift, migration drift (loss-risk classes), anon EXECUTE on SECURITY DEFINER.
Required checks (per CLAUDE.md, 2026-09-03 verified): main-dev requires `Supabase migration replay`, `Python ML service`, `TypeScript (web + shared)`, enforce_admins true. Not required: mobile job, edge-functions job, Browser E2E, Vercel. I could not re-verify branch protection (read-only, no gh call made).
S01 gap for CI: add a `lint` script to each packages/* (or a root eslint), a real test in db/integrations/notifications, and add `Edge functions (Deno)` and mobile to required checks only via founder/admin action. Follow convention: add jobs in ci.yml with dorny/paths-filter step-level skips, never a separate path-filtered workflow (a never-triggered workflow leaves required check "expected").

### 2. i18n
- Mechanism: packages/shared/src/ui-language.ts exports UI_LANGUAGES ["en","pcm"], DEFAULT_UI_LANGUAGE, UI_LANGUAGE_LABEL, dictionary keyed by the exact English source string (wayfinding only: nav labels, buttons, tabs, get-started steps). Test: ui-language.test.ts. Stored in profiles.language. UI: patient/ui-language-form.tsx + ui-language-actions.ts. Web consumers: app-shell.tsx, dashboard layout.tsx, get-started-card.tsx; mobile: overview-screen.tsx, get-started-card.tsx, tracker-screens.tsx. Coverage tests: apps/web/src/lib/navigation-pidgin-coverage.test.ts, patient/lifestyle-trackers-pidgin-coverage.test.ts.
- No i18n library (no next-intl/i18next/expo-localization). No en.json/pcm.json. No missing-key build gate. Strings are otherwise hard-coded English in JSX/TS. Pidgin marked as unreviewed in file header (spec wants `needs_native_review` marker; equivalent comment exists, no data flag).
- DB side: notification_template_locales table (migrations 20260830002641..815) carries per-locale notification templates.
- Format helpers: apps/web/src/lib/format-date.ts, format-money.ts (tests exist). `en-NG` and naira not audited.
- Recommendation: S01 adds only a key-parity/missing-translation test and optional `needs_native_review` constant in the existing file; does not introduce packages/i18n.

### 3. Design tokens
- Web: apps/web/src/app/globals.css :root `--brand-green: #0e7c52; --clinical-navy: #12324b;` plus charcoal-ink, sprout-gold, soft-sage, warm-ivory, deep-forest, chart colours; mapped in `@theme inline` to Tailwind `--color-brand-green`, `--color-clinical-navy`. Also duplicated as literals in apps/web/src/lib/pdf/pdf-brand.ts, broadcasts/render-email-template.ts, manifest.ts, layout.tsx, og-card.tsx, offline.html.
- Mobile: apps/mobile/src/ui/theme.ts (`brand: "#0E7C52"`; navy not confirmed there, only brand/success hit).
- No shared token package. Recommendation: S01 should NOT create packages/ui; at most one TS constants module in packages/shared (brand hex) consumed by pdf-brand.ts and mobile theme.ts, optional.

### 4. Versioned config / hard-coded thresholds
- DB-config tables (live, admin UI exists): cv_risk_config (/admin/settings/cv-risk-config), escalation_slas (v7 active, /admin/settings/escalation-slas; clinician/escalation-slas view), platform_feature_flags + feature_flags (/admin/settings/feature-flags), triage_protocols (signed, /admin/settings/triage-protocols), alert-rules, risk-questionnaire-config, mental-health-screening, provider-quality-policy, platform_modules (public.set_platform_module), service_products (prices). No generic `app_config` and no "PROPOSED" status concept or generic loader in TS.
- TS loaders: none generic. Each feature reads its own table (e.g. lib/cv-risk/assess.ts, lib/escalations/what-happens-next.ts reads escalation_slas).
- Hard-coded clinical thresholds in TS (intentional mirrors of DB triggers, versioned): apps/web/src/lib/vitals/glucose-red-flags.ts (GLUCOSE_THRESHOLDS + GLUCOSE_THRESHOLDS_VERSION), apps/web/src/lib/rules/bp-classification.ts (BP_THRESHOLDS + BP_THRESHOLDS_VERSION), aggregated by lib/vitals/mobile-thresholds.ts and served at /api/mobile/vitals-thresholds; mobile bundles defaults in apps/mobile/src/lib/{bp-classification,glucose-red-flags}.ts (BP emergency 200/120, red 160/100, amber 135/85) with threshold-sync override. Authoritative classifiers are DB triggers (private.classify_bp_level, classify_pulse_level). Plus symptom-triage-engine package. Fees: kobo hard-coded in pricing.ts (marketing copy; one reward_kobo=50000 mirror of a DB function). Spec values (e.g. 6.2 thresholds, 17 table) DIFFER from shipped thresholds possibly; S01 must not overwrite any live threshold; load spec values only as PROPOSED rows and diff against existing.

### 5. Copy-lint
- No repo-wide copy lint. Only ad-hoc per-surface tests: apps/web/src/app/signup/signup-copy.test.ts (no em dashes), apps/web/src/lib/marketing/page-metadata.test.ts (no em dashes in visitor prose, scoped), ai-coach/prompts.test.ts, patient/emergency-guidance.test.ts, auth/auth-error-message.test.ts, lib/copy/condition-language.test.ts.
- No test for banned words: "cure", "instant doctor", "free healthcare", "your doctor" (CLAUDE.md says never promise one named doctor; "doctor-led" retired as headline). Em-dash rule exists in memory/feedback as marketing+dashboard copy rule but enforced only in the two files above.
- Recommendation: S01 adds one scanning Jest test in apps/web (glob marketing pages/_content, patient dashboard copy, mobile src/screens) with an allowlist; convention = plain Jest file next to code reading source text (as signup-copy.test.ts does). Expect many existing violations; scope to marketing + patient-facing strings first.

### 6. Sentry coverage
- apps/web: yes (config files listed above; PII scrubbing beforeSend; withSentryConfig in next.config.ts with source maps; opt-in by SENTRY_DSN; runBestEffort helper reports to Sentry).
- services/ml: yes (opt-in by settings.sentry_dsn).
- apps/mobile: NO (no @sentry dependency in package.json or app.json).
- packages/*: none.
- supabase/functions (7): abnormal-result-handler, integration-outbound-drain, paystack-webhook, send-pending-notifications, send-support-reply, whatsapp-webhook, zoom-webhook: NO Sentry in any (grep "sentry" case-insensitive returned no hits in supabase/functions index/handler files).
- Spec requires app, console, functions. S01 gap: mobile + edge functions (Deno: use npm:@sentry/deno or sentry via fetch; keep PII scrub from apps/web/src/lib/sentry/scrub-pii.ts). Mobile native Sentry needs an EAS build and runtimeVersion bump per CLAUDE.md OTA note, so treat as a native-affecting change, not S01 "safe".

### Conventions to follow
- kebab-case files, co-located `*.test.ts`, Zod validation, no `any`, strict TS, pnpm only, feature branch off origin/main-dev, PR to main-dev, never hand-type migration timestamps, run /code-review high before PR, regression test per bug fix.
- Packages are `type: module`, main = ./src/index.ts (no build step), devDeps jest ^30.4.2 + ts-jest ^29.4.11 + @jest/globals + @types/jest.
- New package recipe: copy packages/shared (package.json, jest.config.mjs, tsconfig.json), name `@tarragon/<x>`, add typecheck+test scripts, pnpm install to update lockfile (frozen-lockfile in CI).

## 9. Copy-lint baseline (warn-only, existing violations, not edited)

The S01 scanner (`packages/shared/src/copy-lint`) reports **889** candidate lines across `apps/web/src`, `apps/mobile/src` and `packages/notifications/src`: em dash 818, "your doctor" 67, "cure" 4 (all "miracle cures" anti-claims, false positives), "instant doctor" 0, "free healthcare" 0. The audit agent's broader ripgrep scan (also covering `supabase/functions` and `packages/*`) found the figures below; the two differ only in scope and comment-stripping heuristics.

Scope: rg over apps/web/src, apps/mobile/src, packages/*/src, supabase/functions (ts, tsx, js, jsx, mdx); excluded test/spec/e2e/.d.ts/database.types; dropped lines beginning with //, *, /*, and lines with console.*. Heuristics, so counts are upper bounds (code comments trailing a line, prompt text and dev-only admin UI are still included). SQL seed scan done separately. No supabase/seed.sql exists.

Counts per term per area
| term | apps/web | apps/mobile | packages | supabase/functions | total |
|---|---|---|---|---|---|
| cure / cures / cured | 4 | 0 | 0 | 0 | 4 |
| instant doctor | 0 | 0 | 1 (i18n test file) | 0 | 1 |
| free healthcare | 0 | 0 | 1 (i18n test file) | 0 | 1 |
| your doctor | 61 | 7 | 1 (i18n test file) | 1 | 70 |
| em dash U+2014 (raw, after comment filter) | 928 | 68 | 15 (lifestyle-engine 8, triage 4, shared 2, i18n 1) | 34 | 1045 |
| em dash (tighter string/JSX heuristic) | 884 | 66 | 10 (lifestyle-engine 6, triage 4) | 30 | 990 |

Em dash by area within apps/web tight set: patient dashboard 88, marketing 13 (mostly none left, marketing already cleaned), ai-coach/prompts.ts 21 (LLM prompt, not user copy), send-pending-notifications/index.ts 15.

Top examples
cure (all 4 are anti-cure messaging, so false positives):
1. apps/web/src/app/(marketing)/resources/page.tsx:34 "miracle cures. Just what the evidence supports..."
2. apps/web/src/app/(marketing)/_content/resources.ts:287 "...marketed in Nigeria as diabetes cures..."
3. apps/web/src/app/(marketing)/_content/resources.ts:1385 "...marketed as cancer cures that aren't."
4. apps/web/src/app/(dashboard)/admin/settings/resources/resources-manager.tsx:325 "miracle cures, no medical advice claims." (admin hint)

instant doctor / free healthcare: only packages/i18n/src/i18n.test.ts:5 (the BANNED list itself). Zero real hits.

your doctor (samples; 70 total, natural phrasing, see judgement below):
1. supabase/functions/send-pending-notifications/index.ts:968 "Your doctor offered different times for your video visit..."
2. apps/web/src/components/shell/notification-bell.tsx:243 "Your doctor can no longer make your lab-result consultation..."
3. apps/mobile/src/screens/sections/overview-screen.tsx:398 "...once your doctor confirms the time."
4. apps/mobile/src/screens/sections/video-visit-screen.tsx:194 placeholder "...anything you want your doctor to know beforehand"
5. apps/mobile/src/screens/sections/video-visit-booking-section.tsx:51 label "Your doctor offered different times"
6. apps/web/src/app/(marketing)/annual-health-check/page.tsx:104 title "A video consult with your doctor"
7. apps/web/src/app/(marketing)/chronic-care/page.tsx:104 "your doctor reviews your cholesterol..."
8. apps/web/src/app/(marketing)/pricing... _content/pricing.ts:483 "...If anything needs attention, your doctor..."
9. apps/web/src/app/(marketing)/care-coordination/page.tsx:47 "...or your doctor recommends a check."
10. apps/web/src/app/(marketing)/_components/screening-journey.tsx:81 "...schedule your doctor sets..."
11. apps/web/src/app/(marketing)/obesity/page.tsx:67, advanced-diagnostics/page.tsx:60
12. apps/web/src/app/(marketing)/_content/resources.ts lines 79, 206, 299, 421, 641, 704, 965, 1108, 1482 (health-education articles, "ask your doctor" advice)

em dash (samples):
1. apps/mobile/src/lib/mental-health.ts:23 PHQ-style item text
2. apps/web/src/lib/worklist/referral-status-badge.ts:6 label "Draft [em-dash] not yet submitted"
3. apps/web/src/components/ai-imaging-summary.tsx:46 "This isn't a diagnosis [em-dash] you'll need to follow up..."
4. apps/web/src/lib/payer/board-report.ts:103 "Draft [em-dash] not attested"
5. apps/web/src/lib/validation/mens-health.ts:64 question text "Nocturia [em-dash] how many times..."
6. apps/web/src/lib/rules/diabetes-drug-safety.ts:79 warning text (11 in file)
7. apps/web/src/components/shell/ai-governance-signoff-banner.tsx:42
8. apps/web/src/components/delivery-status-timeline.tsx:130 template literal
9. apps/mobile/src/screens/sections/screening-days-screen.tsx:84
10. apps/web/src/app/(dashboard)/clinician/fhir-review/actions.ts:84 "Confirmed [em-dash] added to the patient's record."
11. apps/web/src/app/(dashboard)/admin/support/view-as/support-view-as-console.tsx:127
12. apps/web/src/app/(dashboard)/pharmacist/orders/pharmacist-orders.tsx:513
13. apps/web/src/app/(dashboard)/analytics/_components/service-levels-dashboard.tsx:56 (13 hits, mostly a "[em-dash]" null placeholder)
14. apps/web/src/app/(dashboard)/clinician/device-operations/device-operations-dashboard.tsx:97 (null placeholder)
15. apps/web/src/app/(marketing)/pricing/how-it-works/page.tsx:208 {row.tarragon ? "check" : "[em-dash]"} placeholder
Heaviest files: ai-coach/prompts.ts 21, send-pending-notifications/index.ts 15, service-levels-dashboard.tsx 13, view-as/[sessionId]/page.tsx 13, fhir/parse-resource.ts 12, diabetes-drug-safety.ts 11, doctor-income-dashboard.tsx 11, cv-risk.ts 10, patient/(sections)/page.tsx 10, ai-governance-console.tsx 10.

SQL notification-template seeds (supabase/migrations): "your doctor" appears in notification_template_locales (20260830002748, 20260830002722, 20260830002641); em dashes in 20260830002641 (diabetes eye screening reminder). Raw scan of all migrations: 11 template-related lines, but most are COMMENT ON text; real template-body hits ~3 to 5. Not exhaustive.

Terms that are almost all false positives
- cure: 4 of 4 are negations ("miracle cures", "marketed as cures"). Real claim hits: 0. Use a rule that flags `cure` only outside the phrases "miracle cure(s)" and "marketed as ... cures", or allowlist resources.ts.
- instant doctor / free healthcare: 0 real hits; the only match is the existing BANNED constant.
- em dash: large share are (a) "[em-dash]" null/empty-value placeholders in dashboards, (b) staff-only admin/clinician/analytics screens, (c) LLM prompt text, (d) code-comment tails the heuristic misses. Patient-facing marketing is already near zero, so a warn-only lint should target (marketing), patient dashboard, mobile, and notification templates first.
- your doctor: natural, non-claim phrasing ("ask your doctor"); arguably not a brand-risk term except where it implies a single named doctor relationship (CLAUDE.md retired the one-continuous-doctor promise). Highest-signal subset: notification and appointment copy ("Your doctor offered different times", notification-bell.tsx:243, overview-screen.tsx:398) and marketing body copy (chronic-care/page.tsx:104, annual-health-check/page.tsx:104). Consider narrowing to "your doctor" in marketing and notifications only, or rewording to "a doctor on your care team".

Existing precedent: packages/i18n/src/i18n.test.ts already enforces the same six-term BANNED list over i18n strings only (hard fail). The new lint would extend that scope to web, mobile and edge functions as warn-only.

Judgement on the baseline: "your doctor" (about 70) is mostly natural phrasing in patient copy and health-education articles ("ask your doctor") that the rule says to replace with "your care team"; it needs a copy pass, not a search-and-replace, because the health-education articles are clinician-reviewed content. Most em dashes are `—` null placeholders in tables, staff-only screens and LLM prompts rather than patient marketing, which is already near zero. Do not mass-edit in S01.
