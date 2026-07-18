# Obesity Programme + Lifestyle Coaching Pathway — Planning Spec

> **Status: BUILT (2026-07-17) on explicit ask.** Lifestyle layer + entitlement shipped; obesity
> delivered via the existing `care_plans`/review machinery (no new obesity schema needed). Obesity
> **pharmacotherapy is deferred** (§7). See the CLAUDE.md "Current Sprint" 2026-07-17 entry for the
> as-built log and verification. This doc remains the design of record. Branch:
> `claude/obesity-lifestyle-pathway` (off `main-dev`). The decisions/design below were the plan;
> where the build refined them (e.g. not coupling to `chronic_condition_programmes`), the sprint
> log is authoritative.

## 1. Positioning decisions (locked with founder)

1. **Neither is a standalone plan.**
   - **Obesity** = a doctor-led **chronic-care programme**, architecturally identical to hypertension/diabetes.
   - **Lifestyle coaching** = a cross-cutting **engagement/feature layer** delivered *inside* obesity/HTN/diabetes programmes.
2. **Bundled into one branch** — obesity and lifestyle share the weight (`vitals_readings`) and review-engine machinery, so they ship together.
3. **Entitlement:** lifestyle coaching is included in **`complete`**, **`family`**, and **ParentCare** tiers, **plus an à-la-carte add-on for `essential`** patients (mirrors the `extra-family-member` add-on precedent).
4. **Obesity launches lifestyle-managed only.** No pharmacotherapy (GLP-1 etc.) at launch — the drug-class monitoring rules and prescribing surface are deferred to a later, explicitly-asked pass. This keeps launch clear of the open MDCN tier-authority question.

## 2. What already exists (reuse, do not rebuild)

| Artifact | State | Role in this pathway |
|---|---|---|
| `care_plan_condition` enum | includes `"obesity"` | Obesity is already a first-class care-plan condition |
| `care_plans` (`patient`, `condition`, `assigned_clinician_id`, `target_ranges` JSON, `status` draft→active) | built | The obesity programme *is* a `care_plans` row |
| `care_plan_recommendations` + rules engine (`lib/rules/care-programme-recommendations.ts`) | built — recommends obesity at **BMI ≥ 30** (high ≥ 35) | Recommendation path already emits obesity |
| `medication_review_cadences` / `medication_reviews` (keyed by `care_plan_condition`) | built | Obesity needs one cadence row; review engine reused for lifestyle reviews |
| `chronic_condition_programmes` + `chronic_programme_enrolments` (protocol-signed activation gate) | on remote | Admin catalogue + clinician enrolment machinery |
| `vitals_readings` (`weight` vital_type, `source` manual/device/wearable) | built | Single source of truth for weight — never duplicated |
| `has_feature_access(feature)` RPC + `RequiresEntitlement` | built | The lifestyle-tier gate |
| `care_team_assignment` / `YourCareTeam` | built | Coordinator relationship for coaching |
| `medication_adherence_checkins` cadence pattern (Day 3 / Wk 2 / Mo 1 / Mo 3 + daily reminder cron) | built | Copied verbatim for lifestyle check-ins |

## 3. Plan A — Obesity chronic programme

Reuses every existing chronic-programme pattern. **No new prescribing surface at launch.**

- **A1 — Protocol + catalogue (config, not new tables):**
  - Author an obesity `condition_protocols` row (WHO BMI staging, comorbidity screen, escalation thresholds — lifestyle-managed, no pharmacotherapy).
  - Add an obesity `chronic_condition_programmes` catalogue row, `is_active = false` until a Clinical Director signs a `protocol_versions` row (existing DB activation gate).
  - Add one `medication_review_cadences` row for `obesity` (recommend 3-month periodic review — this is a *care review*, not a medication review, since no meds at launch; reuse the same table/engine).
- **A2 — Enrolment + recommendation (≈90% done):** verify the existing recommendation → `care_plan_recommendations` → `/clinician/recommendations` accept-flow creates the obesity `care_plans` row (condition-agnostic today; needs a verification click-through, not a build). `target_ranges` JSON carries target weight / BMI / waist.
- **A3 — Weight-centric dashboard view:** obesity-aware card on clinician + patient dashboards (weight/BMI trend, % change from baseline, progress vs `target_ranges`). No schema change — reads `vitals_readings`.
- **A4 — Pharmacotherapy (DEFERRED, explicit ask only):** when asked, add `drug_monitoring_rules` rows for the GLP-1/anti-obesity drug class + route all prescribing through the existing `medications` + `has_prescribing_authority` (Tier 2+ / Clinical Director) gate. Documented here so it's not forgotten; not in the launch branch.

## 4. Plan B — Lifestyle coaching layer

The net-new schema. Sits inside obesity/HTN/diabetes programmes; entitlement-gated.

- **B1 — New tables** (all `organisation_id` + RLS, patient-owned + org-staff, standard pattern):
  - `lifestyle_assessments` — baseline capture (reuses `RiskAssessmentForm` inputs + diet/activity/sleep/stress questionnaire). Re-takeable.
  - `lifestyle_goals` — SMART goals: `domain` (diet | exercise | weight | sleep | stress), target, target_date, status. The spine of the flow.
  - `lifestyle_programmes` (admin-managed template catalogue, like `chronic_condition_programmes`) + `lifestyle_programme_enrolments` (patient ↔ template).
  - `lifestyle_checkins` — periodic progress logs. **Reuse the `medication_adherence_checkins` cadence + daily-reminder-cron pattern verbatim** (Day 3 / Wk 2 / Mo 1 / Mo 3). Sleep & stress log as `domain` values here — **no parallel sleep/stress tables**.
  - **Weight is NOT a new table** — stays in `vitals_readings`.
- **B2 — Progress review:** reuse the `medication_reviews` review-engine pattern as `lifestyle_reviews` — rolls the next review on completion, null-gated attribution (`reviewed_by`/`completed_at`), surfaced on a `/clinician` worklist. This is the flow's final "Progress review" node.
- **B3 — Delivery model:** check-ins are **Care Coordinator** work (logistics/adherence — explicitly permitted). Anything clinical (plateau interpretation, comorbidity flags, any future med change) routes to Tier 1+. Reuse `care_team_assignment` for the coordinator link. **Never** grant a coordinator write access to medications/escalation/protocols.
- **B4 — Entitlement gating:**
  - Add a `lifestyle_coaching` feature flag to `complete` / `family` / ParentCare plan `features[]`.
  - Add a `lifestyle-coaching` **add-on** (one row per currency/interval variant, matching `extra-family-member`) so `essential` patients can buy in à la carte. No new billing plumbing — reuse `add_ons` / `subscription_add_ons`.
  - Wrap every lifestyle surface in `RequiresEntitlement feature="lifestyle_coaching"` with an `UpgradePrompt` fallback.
- **B5 — Patient UI (`/patient/lifestyle`)** maps the founder's flow 1:1:
  `Assessment → Goals → Diet programme → Exercise programme → Weight (existing chart) → Sleep → Stress → Progress review.`
  Assessment + weight reuse existing components; the rest are new cards over B1/B2 tables.

## 5. Guardrails carried into build

- **Doctor-led.** Obesity is a clinician-owned `care_plans` programme; a coordinator never closes clinical judgment. Any future pharmacotherapy is Tier 2+ only.
- **No duplicate source of truth.** Weight → `vitals_readings`; sleep/stress/diet/exercise → new lifestyle tables; reviews/check-ins reuse existing engines.
- **Attribution null-gated** everywhere (`reviewed_by`/`completed_at`) — never a hardcoded "reviewed by" string.
- **WhatsApp/SMS = reminders only** for check-ins/reviews; all entry is app/web.
- **RLS + `organisation_id`** on every new table.
- **Recommendation ≠ care plan.** Lifestyle/obesity recommendations stay "pending your care team's review" until a clinician promotes them.

## 6. Build sequencing (when authorised)

1. Migration: obesity protocol/catalogue/cadence rows + all B1/B2 lifestyle tables + RLS (one branch).
2. Entitlement: `lifestyle_coaching` feature flag + `lifestyle-coaching` add-on rows (all currency variants).
3. Rules/engine wiring: lifestyle review cadence; check-in cron; verify obesity recommendation → care_plan accept-flow.
4. UI: `/patient/lifestyle` flow; obesity weight-trend cards; `/clinician` lifestyle-review + coordinator worklists.
5. Verify: `pnpm typecheck`/`lint`/`test`; live rollback-SQL for RLS + triggers; browser click-through as patient/clinician/coordinator test accounts.

## 7. Deferred (explicit ask required, not in launch branch)

- Obesity **pharmacotherapy** (GLP-1s): `drug_monitoring_rules` + prescribing surface — Plan A4.
- Any wearable-driven auto-population of sleep/HRV into `lifestyle_checkins` (consumer wearable ingestion is itself unbuilt).
