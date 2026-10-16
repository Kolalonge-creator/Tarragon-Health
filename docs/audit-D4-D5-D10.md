# Audit: clinical and AI governance (spec D.4, D.5, D.10) - S84, audit half

Date: 2026-10-07. Branch fix/content-approval-reviewer-role (based on origin/main-dev, 4 ahead, 23 behind at start).
Method: repo search for every model, embedding and ML call; `ai_systems`, governed-object tables, `go_live_guards` and function definitions read from live project koiplnmbgnqnbywhpjlf with SELECT only. Nothing was written, signed, approved or seeded. Live state was read at audit time and is not a claim about any other branch.

## 1. AI call-site register

Governance verdict key. GOVERNED = through `runGovernedAi` (kill switch, fallback, `ai_interaction_log` row). GATE+LOG = calls `decideAiGovernance` (reads `ai_runtime_config`) and `recordAiInteraction` itself, equivalent in effect, but a different code path. GATE-ONLY = consults the switch but writes no audit row. NONE = no consult.

| # | Site (path) | AI id | Governed how | Kill switch | INV-01 | INV-11 / D.10 (no AI output in record without clinician) |
|---|---|---|---|---|---|---|
| 1 | apps/web/src/lib/ai-coach/index.ts + graph.ts + model.ts + tools.ts | AI-001 (live, high) | GOVERNED | `ai_systems.is_enabled`; fail closed | Deterministic `keyword-guardrail.ts` runs first. The model then also returns an emergency tier (graph.ts llmTurn), additive only. Pass, see G-09 | Pass. Tools are read-only (documented hard invariant); escalation writes `clinician_alerts`, not the record |
| 2 | apps/web/src/lib/ai-coach/handoff-summary.ts (claude-haiku-4-5, direct ChatAnthropic) | AI-001 | GATE-ONLY: `decideAiGovernance`, no `recordAiInteraction` | Yes (AI-001 switch) | Runs after an escalation already exists. Pass | Pass (summary for a clinician). Fails D.10 "every call logged", see G-07 |
| 3 | apps/web/src/lib/ai-coach/referral-tool.ts | AI-001 | Part of coach turn | Yes | n/a | Writes `clinician_alerts` only (type `referral_requested`), never `specialist_referrals`. Pass |
| 4 | apps/web/src/lib/lifestyle/coaching-proposer.ts | AI-002 (live, moderate) | GOVERNED | Yes | Not in triage path. Pass | Message draft screened by tone guard, deterministic fallback. Pass |
| 5 | apps/web/src/lib/patient-explainer/generate.ts (2 call sites, lines 170 and 271) | AI-003 (live, moderate) | GOVERNED | Yes, fail closed | Not in triage path | Patient-facing, not the record. Reads `lab_analyte_readings` with no release-state or sensitive-positive check: possible INV-03/INV-04 exposure, see G-02 |
| 6 | apps/web/src/lib/case-briefs/generate.ts | AI-004 (live, high) | GOVERNED | Yes | Pass | Draft for clinician; `draftReviewNote` needs clinician edit and confirm. Pass |
| 7 | apps/web/src/lib/lab-reports/extract.ts (+ extraction-actions.ts) | AI-005 (live, high) | GATE+LOG | Yes | Pass | Draft in `lab_report_extractions`, filed only by confirm RPC for active `clinical_staff`. Pass |
| 8 | apps/web/src/lib/ecg-reports/extract.ts (+ extraction-actions.ts) | AI-006 (live, high) | GATE+LOG | Yes | Pass | Same draft then confirm pattern. Pass |
| 9 | apps/web/src/lib/medications/pack-vision.ts (+ pack-actions.ts) | AI-007 (live, moderate) | GOVERNED | Yes | Pass | Result is for the PATIENT to confirm ("pack_read_for_patient_confirmation"). No clinician signature on a medicine entry, see G-05 |
| 10 | apps/web/src/lib/nutrition/meal-vision.ts via nutrition-actions.ts and app/api/mobile/nutrition/meal-photo-estimate/route.ts | AI-008 (live, low) | GOVERNED (both entry points) | Yes, fail open | Pass | Not clinical record |
| 11a | apps/web/src/lib/lifestyle/find-relevant-content.ts + voyage-embedder.ts (query time) | AI-009 (live, low) | GATE+LOG | Yes | Pass | n/a |
| 11b | apps/web/src/app/api/cron/ai-coach-embed-content and lpe-embed-content (index time, Voyage) | AI-009 | NONE | Not honoured: switching AI-009 off does not stop these two crons | Pass | Content is clinician-reviewed library text, no PHI. See G-08 |
| 12 | services/ml via apps/web/src/lib/ml/governed-ml-client.ts (callers: screening-result-actions, load-cohort-analytics, coaching-run, assess-bp-control) | AI-010 (live, high) | GOVERNED client wrapper | Yes | Advisory only. Pass | Advisory, never a gate. Pass. packages/shared status ping uses raw `createMlClientFromEnv` but sends no patient data |
| 13 | apps/web/src/lib/nutrition/meal-plan-generate.ts via nutrition-actions.ts | AI-011 (live, moderate) | GOVERNED | Yes | Pass | Pass |
| 14 | apps/web/src/lib/vaccination-cards/extract.ts (+ extraction-actions.ts) | AI-012 (live, moderate) | GATE+LOG | Yes, fail closed | Pass | Patient confirms into the vaccination record, no clinician. See G-05 |
| 15 | apps/web/src/lib/appointment-prep/generate.ts | AI-013 (live, moderate) | GOVERNED | Yes | Pass | Suggestions only. Pass |
| 16 | apps/web/src/lib/care-messages/generate-draft-reply.ts | AI-014 (live, high) | GOVERNED | Yes | Prompt defers anything clinical to a holding reply. Pass | Draft for a human Care Coordinator to edit and send, never auto-sent. Pass |
| 17 | apps/web/src/lib/service-navigation/generate.ts | AI-015 (live, low) | GOVERNED | Yes | Pass | n/a |
| 18 | apps/web/src/lib/imaging-reports/extract.ts (+ extraction-actions.ts) | AI-016 (in_evaluation, DISABLED, high) | GATE+LOG | Off at registry | Pass | Nothing is filed. Pass |
| 19 | supabase/functions/scribe-draft/index.ts | AI-017 (in_evaluation, DISABLED, high) | Edge function consults `ai_runtime_config` directly and logs to `ai_interaction_log` itself | Yes, plus `scribe_enabled` guard closes consent | Not triage. Pass | INV-11: consent row per encounter checked; draft only. Pass. But `ai_systems.runtime_governed = false` while code does consult it, see G-10 |
| 20 | apps/web/src/lib/scribe/note-draft.ts (raw `fetch` to api.anthropic.com, lines 108 and 143) | AI-017 | NONE (evaluation harness only; sole callers are run-scribe-eval-suites.ts and run-scribe-facts-eval.ts) | n/a | Pass | Offline eval with fixtures, no patient data. Needs a scan-test allow-list entry, see G-01 |
| 21 | apps/web/scripts/eval-ai0xx-*.ts, ai-coach-*-eval.ts, lib/scope-guardrail-judge.ts | eval only | n/a (offline CLI) | n/a | n/a | No patient data. Allow-list |
| 22 | apps/mobile | none | Mobile has no model or ML call; the coach and meal photo go through the web API (ai-coach.ts, lifestyle-trackers.ts) | Inherits web | n/a | Pass |

Result of the registry comparison: all 17 registered systems AI-001..AI-017 map to code; I found NO unregistered production AI call site (every `ChatAnthropic`, `messages.create`/`api.anthropic.com` and Voyage use belongs to a registered code). `AI_SYSTEMS` in system-codes.ts has 17 keys and `ai_systems` has 17 rows. The weakness is structural: nothing in CI would fail if the 18th call site appeared, see G-01.

INV-01 verdict: no language model in the triage engine. `packages/symptom-triage-engine`, `packages/clinical` and the protocol-api `bp-triage` route import no model or ai-governance code. The only model-influenced emergency classification is the coach (row 1), where the deterministic regex list is a floor and the model can only add an escalation, never remove one. `symptom_triage_assessments` has 0 rows live, so the engine has not run in production yet.

INV-11 verdict: no violation found for scribe, lab, ECG, case brief, draft reply (all draft then clinician action). Two edge cases are patient-confirmed self-record entries (rows 9 and 14) and one display path may show unreleased results (row 5); these need founder decisions, not code fixes (see G-02, G-05).

## 2. Clinical governed-object register

Live counts at audit time. "Owner" means a named clinical lead recorded on the object. "Kill" means a way to switch the object off without a deploy.

| Object (table) | Versioned | Dated | Owner named | Signed by | Signer role enforced | Kill-switchable | Live state / finding |
|---|---|---|---|---|---|---|---|
| triage_protocols | `version` | `approved_at`, `created_at` | No owner column | `approved_by` via `sign_triage_protocols`/`sign_triage_protocol` | CMO (`doctor_tier = 'chief_medical_officer'`) | Deactivate row (`is_active`) | 2 rows, v2, 1 active, 2 signed. OK except owner |
| triage_rule_sets | `code`+`version` | `approved_at` | No owner | `approve_triage_rule_set` | CMO (`credential_is_cmo`, trigger `triage_rule_sets_approver_is_cmo`) | `status` | 3 rows, 0 active, 3 signed. All three signed but none active; engine has no active rule set |
| protocols | `code`+`version` | `approved_at` | No owner | `approve_protocol` | CMO | `status` | 0 rows. Legacy or unused |
| protocol_versions | `version_number` | `effective_date`, `review_date`, `retirement_date`, `approved_at` | No owner (`approved_by` only) | `approved_by` stamped by trigger `stamp_protocol_version_approver` | Trigger-stamped | `retirement_date` | 8 rows, all v1, all signed. Best-shaped object (has review and retirement dates) |
| risk_questionnaire_configs | `version` | `approved_at` | No owner | `sign_risk_questionnaire_config` | CMO | `is_active` | 2 rows, 1 active, 2 signed |
| result_release_policies | `version` | `approved_at` | No owner | `sign_result_release_policies` | CMO | `is_active` | 1 row, active, signed |
| escalation_slas | `version` | `approved_at` | No owner | `sign_escalation_slas` | CMO | `is_active` | 8 rows, v8, 1 active, only 3 of 8 carry a signature (older versions superseded unsigned) |
| alert_rules | `version` | `approved_at` | No owner | `sign_alert_rules` | CMO | `is_active` | 6 rows, 1 active, 2 signed |
| condition_protocols | none | none | none | none | none | none | 7 rows, no version, date, owner or signature. Static clinical text, ungoverned, see G-06 |
| health_education_content | `content_version`, `version` | `reviewed_at`, `approved_at`, `next_review_due`, `review_due_at` | `clinical_author_name`, `reviewed_by_name` (free text, not a profile FK) | `clinician_reviewed` boolean | No role check on the boolean | `is_active` | 249 rows. 219 published and active; 213 of those have `clinician_reviewed = false`, no review date, no approval, no review-due date. 6 reviewed, none with `approved_at` or review-due. Retrieval for the assistant filters on `clinician_reviewed = true` (good) but the public and patient learning screens show all 219. Violates D.4 line 1, see G-03 |
| lpe_content_blocks | none | `reviewed_at` | `reviewed_by` (profile) | `sign_lpe_content_block` | CMO | RLS hides unreviewed from non-admins | 58 rows, all 58 reviewed and signed. No version or review-due date |
| ai_knowledge_sources (assistant knowledge sources) | none | `approved_at`, `review_due_on` | No owner | `approved_by` | Unknown (no sign RPC found) | `is_active` | 5 rows, 5 active, 0 approved. `approved_ai_knowledge_sources()` exists but NO application code reads either table (only generated types), so the coach cites content by its own retrieval path, not by an approved source. See G-04 |
| ai_prompt_versions | `version` | `approved_at`, `activated_at` | n/a | `activate_ai_prompt_version` | CMO | `is_active` | 1 row, active, signed |
| ai_systems (+ ai_system_versions) | version table | `next_review_due` | `owner_role` only; `owner_profile_id` NULL for all 17 | `approve_ai_system_version` | CMO | `set_ai_system_enabled` (CMO or admin) | Kill switch is real. No named owner anywhere, see G-06 |
| ai_evaluation_runs | per run | yes | n/a | `reviewed_by` | n/a | n/a | 63 runs, 41 `ai_interaction_log` rows, 0 `ai_bias_assessments`, 0 `ai_drift_observations`. Bias and drift monitoring are unexercised |
| go_live_guards | key | `changed_at` | `switch_role` | `set_go_live_guard` logs who, when, why; `go_live_guard_log` append-only | admin or CMO per guard | Yes (it is the switch) | See section 4 |
| protocol_drafts, protocol_draft_comments | draft workflow | yes | author | n/a | n/a | n/a | Present. Not audited further |

Cross-cutting finding: no governed protocol, threshold or rule table carries a named clinical-lead (owner) column. The signature proves who approved a version, not who owns the object between versions, and `ai_systems.owner_profile_id` is null for every system. D.4 line 1 asks for "owned by a named clinical lead".

Signer-role finding: all sign and approve functions that were read require the CMO tier. This matches INV-16 and the "only CMO signs protocols" rule. `set_ai_system_enabled` also allows `private.is_admin`, appropriate for a kill switch (turning off), but confirm that admin cannot turn a system ON (see G-11).

## 3. Other D.4, D.5, D.10 checks

| Requirement | Finding |
|---|---|
| Three output kinds labelled (automated information, clinician-reviewed guidance, clinician decision) | NOT implemented as a system. Each surface invents its own badge: `case-brief-card.tsx`, `result-explainer.tsx` ("AI-drafted, never a diagnosis"), `ai-summary-card.tsx`, `ai-ecg-summary.tsx`, `ai-imaging-summary.tsx`, `draft-reply-card.tsx`, `meal-plan-section.tsx`, `service-navigation-assistant.tsx`, `appointment-prep-helper.tsx`, `vaccination-card-import.tsx`. Clinician attribution exists separately (`reviewed-by-doctor.tsx`, `reviewed-result-line.tsx`, `staff-attribution-line.tsx`). Nothing guarantees every output carries one of exactly three kinds. See G-02b and design note |
| Monthly symptom-checker accuracy audit by age, sex, region | Partial. `public.triage_accuracy_report(p_from, p_to)` (S38e) exists, groups by age band, sex and state, suppresses small cells, excludes test and shadow rows, admin or CMO only. But: no monthly schedule (no cron route, no `vercel.json` entry), no stored monthly snapshot, no sign-off, and it compares clinician agreement on triage reviews, not the final diagnosis the spec names. 0 `triage_reviews` and 0 `symptom_triage_assessments` exist, so the first audit would be empty. See G-04b |
| Clinical safety incident reporting, root-cause review, change control | Incident reporting exists: `clinical_incident_reports` (category, severity, status, review outcome, corrective action, `root_cause_category`) and `ai_safety_incidents` (harm flags, kill-switch-applied). Both have 0 rows. Change control is partial: versioned approvals exist per object, but there is no change-request record linking an incident to the protocol change that fixed it. See G-12 |
| Accountability model switchable by configuration (doctor's own MDCN licence vs Tarragon as care provider) | NOT found. No `accountability_model` or equivalent in code, migrations, `app_config`, `platform_modules` or docs. Only the unrelated indemnity trigger exists. See G-05b |
| Go-live guards | See section 4 |
| AI never prescribes or changes a dose | Pass. Coach tools are read-only; no AI site writes `prescriptions` or `care_plan_changes`; AI-003 prompt forbids dose advice; AI-010 is advisory |
| Sources shown, answer from reviewed knowledge | Coach retrieval filters `clinician_reviewed = true` and `is_active`; but only 6 of 249 education items qualify, and `ai_knowledge_sources` is not wired in (G-04). Source citation in the answer is not verified here |
| Every model call logged with model, tokens, cost (D.10) | `ai_interaction_log` has `model_identifier`, `input_token_count`, `output_token_count`, latency; NO cost column, NO cached-token fields. AI-001 handoff summary and AI-009 index-time embeddings write no row at all |
| Prompt caching and routing simple requests to smaller models (D.5, D.10) | Partial. `cache_control` is set in graph.ts and ecg-reports/extract.ts only. One site (handoff summary) uses Haiku; every other site uses claude-sonnet-5 or a configured id. No router. See G-13 |

## 4. Go-live guards (S37, OQ-184)

Seven rows in `go_live_guards`, all `is_on = false`, never changed.

| Guard | Enforced in code/DB today | Verdict |
|---|---|---|
| clinical_operations_enabled | Yes, partially: hold_appointment_slot, confirm_appointment_booking, service_get_encounter_room, video_visit_requests insert, accept_video_visit_request, select_video_visit_alternate_slot, booking screen. Clinical tasks (live since S16) and lab-result consult requests are NOT behind it | Partial |
| scribe_enabled | Yes: scribe_consents insert, `scribe_may_start`, `record_scribe_consent`. The edge function does not read the guard (closed via consent) | Enforced (indirect) |
| prescribing_enabled | Only `private.pharmacy_collection_on`. Prescribing itself (S24) is not behind it | Partial |
| lab_booking_enabled | Not wired. Health checks are live with SYNLAB active; wiring would stop running behaviour | Not enforced |
| on_call_cover_ok | Not wired. Care pack sales not built | Not enforced |
| payouts_enabled | Not wired (the payout guard is recorded OFF in the S31 checklist but no code reads this key) | Not enforced |
| public_signup_enabled | Not wired. Pilot allow-list not behind it | Not enforced |

Count: 1 fully enforced (scribe, by indirect route), 2 partially, 4 not enforced. This is OQ-184, still open. The spec says "a clinical feature cannot be switched on until its legal and safety conditions are met" and INV-14: today only consultations and the scribe are gated, while clinical tasks, lab results consults and prescribing run or would run without a guard.

## 5. Gap list

Severity: Critical (patient harm or breach of an invariant now), High (breach of a spec requirement, live), Medium, Low. Size: S under half a day, M 1 to 2 days, L more than 2 days or needs a founder or CMO decision first.

| ID | Severity | Gap | Proposed fix | Size |
|---|---|---|---|---|
| G-01 | High | No CI check ties call sites to `ai_systems`. A new `ChatAnthropic`, `fetch` to a model host, or Voyage call with no registered code ships silently (this already happened for AI-013/014/015 in Sept 2026) | Add the scan test in docs/design/S84.md: every model-host call must sit in a file listed against an `AI_SYSTEMS` code or an allow-list with a reason; fail on unknown files; sabotage step proves it discriminates | S |
| G-02 | High | AI-003 explainer reads `lab_analyte_readings` with no `release_state` or `sensitive_positive` filter; patient SELECT policy has no release clause either. If any unreleased or HIV/HBsAg/HCV-positive value reaches that table, the model explains it to the patient (INV-03, INV-04) | First verify whether `lab_analyte_readings` can hold unreleased results (it predates the `lab_results.release_state` machine). If yes, route the explainer through released items only and hard-exclude `sensitive_positive`. Founder or CMO decision on legacy rows. Add a regression test | M |
| G-02b | High | No shared three-kind output label (D.4 line 2); ten components each invent wording | Build `OutputKindLabel` component and a `kind` field on every AI-bearing surface (design note); scan test that every component importing an AI result renders it | M |
| G-03 | High | 213 of 219 live, published education items are `clinician_reviewed = false` with no review date, no approval, no review-due date. D.4 line 1 says every content item is reviewed, versioned, dated, owned | Product decision: unpublish the 213 until reviewed, or label them "automated information" at minimum (G-02b). Add a CHECK that `is_active and content_status = 'published'` requires reviewed_by profile, `reviewed_at`, `next_review_due`. Needs CMO review capacity | L |
| G-04 | High | `ai_knowledge_sources` (5 rows, 0 approved) and `approved_ai_knowledge_sources()` are not read by any application code; D.5 says the assistant answers from reviewed, sourced knowledge | Wire coach and AI-013/AI-015 retrieval to `approved_ai_knowledge_sources(code)`; CMO approves sources (never seeded by an agent) | M |
| G-04b | High | Monthly accuracy audit is a manual report only; no schedule, snapshot, sign-off; measures reviewer agreement not final diagnosis | Add `triage_accuracy_audits` snapshot table and monthly cron (design note); extend with `final_diagnosis_agreement` once `triage_reviews` carries it | M |
| G-05 | Medium | AI-007 (medication pack) and AI-012 (vaccination card) write into the patient's own record after patient confirmation, with no clinician signature. D.10 says no AI output reaches the clinical record without a clinician signature. INV-02 only covers prescriptions and care plan changes | Founder decision (OQ): allow patient-confirmed self-reported entries but mark them `source = ai_read_patient_confirmed` and show as unverified until a clinician reviews. Do not change code before the decision | S (after decision) |
| G-05b | High | Accountability model switch (own MDCN licence vs Tarragon as care provider) does not exist anywhere | New `care_accountability_model` row in `app_config` or `platform_modules` (admin cannot flip, CMO plus founder attestation), read by consultation, prescription and attribution UI. Needs a legal decision first | L |
| G-06 | Medium | No governed object has a named clinical lead; `ai_systems.owner_profile_id` null for all 17; `condition_protocols` (7 rows) has no version, date or signature | Add `clinical_lead_profile_id` (FK, required before activate) to governed tables; backfill by the CMO naming leads; bring `condition_protocols` under `protocol_versions` or retire it | M |
| G-07 | Medium | AI-001 handoff summary (Haiku) calls the model with no `ai_interaction_log` row | Route through `runGovernedAi` or call `recordAiInteraction`; test | S |
| G-08 | Low | AI-009 index-time embedding crons ignore the AI-009 switch | Call `decideAiGovernance` at the top of both crons; no-op when off | S |
| G-09 | Medium | Coach lets the model classify an emergency tier in addition to the keyword floor. Not a violation (the model can only add escalation) but INV-01 says red-flag rules never depend on AI output. Keyword list is regex only; negation and misspelling gaps remain | Record in OQ-register that the floor is deterministic and the model tier is additive; add safety-case tests for negation and Nigerian phrasing; do not let the model downgrade a keyword hit (already so) | M |
| G-10 | Low | `ai_systems.runtime_governed = false` for AI-017 although its edge function consults `ai_runtime_config` | Flip only after confirming the edge function matches the contract; this is a registry write, CMO or admin action, not an agent action | S |
| G-11 | Medium | `set_ai_system_enabled` accepts admin as well as CMO. Verify admin can disable but not enable a high-risk system | Read the full function body; if admin can enable, restrict enabling to CMO and add a BEGIN/ROLLBACK test | S |
| G-12 | Medium | No change-control record linking an incident to a protocol or rule change. `clinical_incident_reports` and `ai_safety_incidents` have 0 rows so the loop is untested | Add `change_request` table (incident FK, object type and id, from_version, to_version, approved_by CMO); simulate one incident end to end | M |
| G-13 | Low | D.10 cost control: no cost column, no cached-token capture, prompt caching on 2 sites, no routing | Add `cost_micro_usd` and `cache_read_tokens` to `ai_interaction_log`; a `modelFor(systemCode, complexity)` helper with Haiku for simple extraction and navigation; record per system cost on the governance console | M |
| G-14 | High | Go-live guards: 4 of 7 not enforced, 2 partial (OQ-184). Clinical tasks, prescribing and lab consults run without a guard | Each owning session wires its guard (prescribing in S24 follow-up, public sign-up with pilot allow-list, payouts in S31). Add a scan test that every key in `go_live_guards` has at least one `go_live_open` caller or an explicit waiver row | M |
| G-15 | Medium | `ai_bias_assessments` and `ai_drift_observations` empty; no evaluation for moderate or high systems tied to a signed approval beyond 63 runs | CMO-run evaluation sessions; not an agent task (never seed an evaluation) | L |
| G-16 | Low | `triage_rule_sets` has 3 signed, 0 active, and `protocols` has 0 rows: the triage engine has no active rule set row in these tables (it may read `triage_protocols` instead, 1 active) | Confirm which table the engine reads; retire the other to avoid two sources of truth | S |

## 6. Top items to carry into the build half

1. G-01 scan test (fast, protects everything else).
2. G-02 verify and close the unreleased-result path in the AI-003 explainer.
3. G-02b shared three-kind label.
4. G-03 content governance (213 unreviewed live items) and G-04 knowledge-source wiring.
5. G-04b monthly accuracy audit table and cron.
6. G-05b and G-14: accountability switch and remaining go-live guards, both blocked on founder or legal decisions; log in OQ file.

Nothing here was changed in code or data. No evaluation, prompt approval or knowledge-source approval was created, signed or seeded.
