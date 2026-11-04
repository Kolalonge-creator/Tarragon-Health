# Tarragon Health 2.0: Phase 0 discovery report

Date: 2026-11-04. Read against `origin/main-dev` at `0af768e9c` and the live project `koiplnmbgnqnbywhpjlf`.
Source brief: `docs/plans/tarragon-2-0-founder-brief-2026-11-04.md` (verbatim).
Nothing in this report changes code, data or prices. It answers the brief's Phase 0 question: what exists, what to reuse, what to change, what is missing, what to retire.

## 1. The short answer

Most of Tarragon 2.0 is already built. The platform has a lab report upload, an AI extraction step, a test catalogue with synonyms and units, a clinician filing queue, raw vs corrected vs confirmed provenance, biomarker trends, a CMO-signed screening scheduler, request-form PDFs, a lab directory with reviews, monthly check-ins and worklists.

The foundational gap is the one the brief names as the release test. **A result filed from an uploaded report does not reach the abnormal-result alert engine.** There are three result paths today and they end in three different places:

| Path | Where values land | What an abnormal value triggers |
|---|---|---|
| Patient or staff upload, AI draft, clinician files it (`lab_result_documents` → `lab_report_extractions` → `confirm_lab_report_extraction` → `lab_analyte_readings`) | `lab_analyte_readings` | Nothing automatic, except the eGFR/ACR kidney trigger. The doctor writes any abnormal finding by hand. `reference_range_*` and `abnormal_flag` are never filled by the filing RPC. |
| Structured partner/portal/LOINC push (S27, `lab_results` / `lab_result_items`) | `lab_result_items` | A clinical task (`critical_result_review` / `routine_result_review`), not a `clinician_alerts` row. Classified against `lab_panel_versions` `membership_annual` v4, whose ranges and critical limits ARE signed (sign-off v5, approved 2026-10-30; the row notes still say "unsigned" and are stale). |
| Screening results (`screening_results`) | `screening_results` | `handle_abnormal_screening_result` → `abnormal-result-handler` → `clinician_alerts`, on the signed `escalation_slas` v9 (12 h critical, 24 h abnormal). |

So "upload alert parity" is not met today, and it is the right first build.

Two live facts make Phase 1 low-risk to change and high-priority to get right:
- `lab_result_documents` has **0 rows ever**. No patient has used the upload path yet.
- Both live memberships (`plus`, `evergreen`) belong to **test accounts**. No real member is affected by retiring Plus.

## 2. AI vendor agreement (decided: proceed, T2-03)

AI-005 "Lab report extraction" (`apps/web/src/lib/lab-reports/extract.ts`) is live, enabled, high risk, assist-only, and sends the whole report (PDF or image, which carries the patient's name and date of birth) to Anthropic's API in the United States. The `ai_vendors` row records: *"A Data Processing Agreement and an NDPR-facing transfer assessment are outstanding."* AI-005 is also grandfathered with validation, evaluation and bias assessment outstanding.

The brief says not to send patient documents to an external AI without an approved data-processing arrangement. The founder, acting as DPO, decided on 2026-11-04 to proceed on the current commercial terms (T2-03). The DPA and transfer assessment remain an open compliance item; they are not a blocker for Phase 1 or its rollout, and the `ai_vendors` row must keep saying they are outstanding until they are done.

## 3. Stage-by-stage map of the lab intelligence engine

| Brief stage | State | Where it is | What Phase 1 changes |
|---|---|---|---|
| Ingestion, ownership, type, size, storage, doc ID | Exists | bucket `lab-result-documents` (private, 10 MB, jpeg/png/webp/heic/pdf); `lib/lab-results/actions.ts` upload actions; mobile `api/mobile/lab-result-upload` | Check file signature (magic bytes), not only the browser-declared type. |
| Malware scan | Missing | none | Add a scan step or a strict re-encode of images and PDF sanitising. Decision needed on vendor. |
| Patient-visible processing status | Partial | `ai_summary_status` on the document | Add the brief's status list as one state field. |
| OCR / vision extraction | Exists | Claude via `withStructuredOutput`, PDFs as document blocks, HEIC converted, 30 s timeout | Keep. Put it behind a small provider interface so another OCR can be tried on the test set; do not add a second vendor until the test set shows a need. |
| Structured schema | Exists | `rawRowSchema`, `ExtractedRow` statuses (ready / unknown_unit / implausible / unmapped / unreadable_value), `lab_report_extractions.rows` | Add model + prompt version per row if missing. |
| Catalogue mapping, synonyms, LOINC, UCUM | Exists | `ANALYTE_CATALOGUE`, `resolveAnalyteCode`, `lab_report_templates.hints`, `reference_concepts` / synonyms / maps, LOINC seed, `units_of_measure`, `unit_conversions` | Reuse. No new catalogue. |
| Confidence and validation | Exists (coarse) | model low/medium/high → `low_confidence`; deterministic QC in `qc.ts` (lab's own range, PCV≈3×Hb, differential = 100, Friedewald); AI-005 golden eval | The brief's 98 / 90 % numbers do not map onto a 3-level model score. Use the per-row status + QC + golden-set accuracy instead, and calibrate on the test set. |
| Patient confirmation | Exists, separate store | `confirm_my_lab_report()` → `patient_reported_lab_values` (own trend only, never flags) | Keep as is. It correctly cannot substitute for clinical validation. |
| Human verification queue | Exists | every upload raises a `clinician_review` alert; `lab-report-extraction-panel.tsx`; `confirm_lab_report_extraction()` | Keep. |
| Raw / corrected / verified / interpreted provenance | Exists | `lab_report_extractions.rows`, `lab_extraction_corrections`, `confirmed_by`, `audit_log`, `ai_interaction_log`, supersede-not-edit | Add "interpreted" (the rule result and rule version) once Phase 1 lands. |
| Deterministic rules, ranges, critical limits | Partial, split | `reference-ranges.ts` critical bands (queue priority only); S27 `lab_panel_versions` + `private.classify_lab_result` (yearly-panel ranges signed 2026-10-30; nothing signed for tests outside the panel) | **Make one classifier the only one**, fed by CMO-signed ranges, and call it from every path. An analyte with no signed range is "cannot interpret" and goes to a doctor, never "normal". |
| One central alert engine for every source | Missing | three endings, see §1 | **The Phase 1 build.** |
| Escalation SLA | Partial | `raise_lab_extraction_alert` hard-codes 120 / 1440 min; upload trigger sets no `sla_due_at`; no lab-upload pathway in `escalation_slas` v9 | Read `escalation_slas`; add the pathway rows; CMO signs. |
| Critical path cannot be lost | Partial | `abnormal-result-handler` edge function | Prove retry / dead-letter / unacknowledged escalation on the converged path with a DB proof and a sabotage step. |
| Longitudinal record and trends | Exists | `patient_biomarker_trend` / `_list`, `biomarker_points` (dedupes `lab_result_items` with legacy readings), `trend-chart.tsx`, `lab-trend-card.tsx` | Reuse. |
| AI trend detection | Missing | deterministic display only | Phase 2, deterministic rules first (e.g. rising HbA1c across 3 points), CMO-signed, not an AI model. |

## 4. The rest of the brief against what exists

| Brief area | State | Notes |
|---|---|---|
| Free + Membership only, Plus retired | Two paid tiers live | Membership `membership_annual_no_panel` ₦84,000; Plus `membership_annual` ₦129,000; upgrade ₦45,000. Plus = 17-test yearly panel at a testing day or Tarragon collection in Lagos, Oyo, Osun, Ogun. About 43 non-test files say "Membership Plus" (19 marketing, 5 mobile), 29 strings in `packages/i18n/src/en.ts`, about 14 migrations and 9 DB tests. The self-arranged annual bundle (`start_annual_bundle`, patient pays lab) is already open to every plan. |
| ₦100,000 single price | Not in code | Versioned `prices` rows and `commerce.membership_prices` in `proposed-config/registry.ts`; a new version row, never an edit. Renewals are dormant (`membership_auto_renew` OFF), instalments already removed. |
| Monthly doctor check-in | Exists | 12 follow-up months a year, one per month, extra meeting 8,000 naira (raised from 5,000 on 2026-11-03); `clinician/followups`. |
| Doctor result review within SLA | Exists for screening | results inbox, S27 release machine. |
| Annual health report | Partial, OFF | S46 `health_reports`, guard `health_report_generation_enabled` off, config unsigned. |
| Personal preventive plan | Mostly exists | risk questionnaire (signable), `screening_schedules`, S45 CMO-signed `screening_rule_sets`, nightly scheduler (live since 2026-10-30), S47 risk-based HIV/HCV, HPV DNA, S98 automatic test requests with sensitive-test opt-in. Missing: a single "baseline at enrolment" step that ties these together. |
| Request form PDF | Exists, no verification | `lib/lab-results/lab-request-document.tsx`. Missing verification code + QR; copy the prescription `/verify-rx/[token]` pattern. Must not say the lab is contracted. |
| Reminders and overdue chase | Exists | upcoming → due → overdue (+6 d) → escalated (+20 d); weekly cap in rule set v4 (unsigned). Brief's 14/7/1/+7/+30 days differ. WhatsApp and SMS in the brief cannot be used (F-02, OQ-05). |
| Lab directory | Mostly exists | 4 lab providers seeded, 1 active (Synlab, 39 branches in 15 states, no coordinates); `list_lab_test_locations`, reviews, freshness and re-verification queues; activation refuses a lab without licence + accreditation. Missing: structured MLSCN / ISO 15189 / EQA fields with source per claim, GPS, a partner-blind patient view. Guard `directory_enabled` OFF. |
| Command centre | Exists | `clinical_worklist`, ops desk, operations wall, worklists. Add "uploads awaiting verification" and "deteriorating trends" counts. |
| Employer ₦90,000 | Not in code | Seats default ₦129,000 and `grant_org_seat` grants Plus; OQ-GAP-D04 already asks about a ₦100k seat. Seats must be remapped to Membership when Plus goes. |
| On-site employer screening, separately costed | Exists | testing days (`employer_visit`), point-of-care tables, `employer_visit_summary` with small-cell suppression; outreach screening days (₦15,000 a place). |
| Sponsorship | Exists | Care Circle `pay_for_care`, gift acceptance, gift page offers both tiers; sponsor gets no record access by default. Care vouchers cannot hold a Membership. |
| Care Circle | Exists | S29 consent, permissions, revocable, audited. |
| Health status by domain (no composite score) | Conflict to check | a Health Score with a trend already exists (`health-score/`). The brief says no arbitrary composite score until validated. |
| Stack | Conflict | the brief suggests Django / Celery / WhatsApp; Stack A is final (Next.js + Supabase + the Python ML service). Use pg_cron + edge functions for background work. |

## 5. Conflicts with standing rules (to log in OPEN-QUESTIONS, not to build past)

1. **WhatsApp and SMS reminders** in the brief: WhatsApp was removed (F-02) and SMS is phone verification only (OQ-05). Use in-app, push and email. Note: `escalation_slas` v9 `channel_sequence` still names whatsapp/sms as text; the sender ignores the dead channel, but the config should be cleaned in its next version.
2. **Django / Celery stack**: Stack A is final.
3. **Anthropic DPA and transfer assessment outstanding** (see §2; proceeding by founder decision T2-03, kept as an open compliance item).
4. **Reference ranges and critical limits**: the agent must not sign them (standing rule). The 17 yearly-panel tests already have signed ranges and critical limits (sign-off v5, 2026-10-30); three of them (HIV, HBsAg, anti-HCV) are qualitative and every reactive result is held for a doctor. Ranges for anything else the brief lists (urine ACR, PSA, thyroid, LFT extras) need a new panel version the CMO signs; until then those results go to a doctor unclassified.
5. **Health Score**: existing composite score vs the brief's "no score until validated".
6. **Testing days**: founder answered 2026-11-04, stop Tarragon-run testing days and collection for new bookings, honour existing ones. Employer visits and outreach screening days are a separate question (§7).
7. **Prices**: no production price change until the migration and commercial decisions are approved (brief §18 rule 14).

## 6. Proposed build order (each phase ends with proof, not only code)

**Phase 1: one alert engine for every result source** (the brief's release criterion)
1. One classifier: `private.classify_lab_result` becomes the single deterministic function, taking (analyte concept, value, canonical unit, patient age/sex/pregnancy/conditions, context) and returning normal / borderline / abnormal / significant / critical / cannot-interpret, with the rule version. Uses the lab's printed range alongside, never instead of, Tarragon's range.
2. Filing an upload (`confirm_lab_report_extraction`) and the S27 push both write their values through the same entry point, which fills `reference_range_*`, `abnormal_flag`, the rule version, and raises the same `clinician_alerts` row the screening path raises, on `escalation_slas` pathway rows (new: lab result critical / abnormal).
3. An unfiled draft whose AI reading looks critical raises an urgent verification alert immediately (already partly there in `raise_lab_extraction_alert`; move its SLA to `escalation_slas`).
4. File signature check; malware/sanitise step.
5. Parity proof in `packages/db/tests/`: the same HbA1c / potassium / creatinine / Hb values entered as (a) a filed upload, (b) an S27 item, (c) a screening result each produce the same alert severity and SLA; plus multiple abnormalities, duplicate upload, wrong unit, missing range, wrong patient; with a sabotage step. Jest for the extractor on the golden set.
6. Gated by one feature guard under `clinical_operations_enabled`; the new `escalation_slas` pathway rows need the CMO's signature before it opens. The yearly-panel ranges are already signed.

**Phase 2: longitudinal record**: reuse the biomarker trend; add deterministic deterioration rules (CMO-signed); add the counts to the command centre.

**Phase 3: preventive plan**: a baseline-at-enrolment step joining the risk questionnaire and screening schedule; request form verification code + QR; reminder timings as versioned config.

**Phase 4: commercial**: one Membership at ₦100,000 (new price version), Plus closed to new purchase, testing days closed to new bookings, employer seat remapped to Membership at the chosen price, ~43 files of copy, i18n strings, mobile. Test accounts only today, so no member migration.

**Phase 5 onward**: annual health report switch-on, lab directory structured accreditation + partner-blind view + GPS, sponsorship at the new price, employer programme.

## 7. Founder answers (2026-11-04) and what is still open

Answered in chat, logged as T2-01 to T2-06 in `docs/DECISIONS.md`:
- Testing days and Tarragon-arranged collection stop taking new bookings when Plus is retired; existing bookings are honoured.
- The only live Plus and Membership holders are test accounts; no member migration is needed.
- AI-005 proceeds on the current Anthropic commercial terms, recorded as a DPO decision; the DPA and transfer assessment stay an open compliance item.
- Phase 1 starts now on a branch, switched off until the CMO signs the new SLA rows.
- Employer seat price ₦90,000, seats remapped to Membership (applied in Phase 4, not now).
- The composite Health Score is replaced by per-domain status, trends and outstanding actions (Phase 2).

Still open: whether employer visits and outreach screening days continue as separately priced services (outreach days were decided 2026-11-04, OD-01 to OD-06, and are unaffected unless the founder says otherwise).
