# Tarragon Health — Clinical Trust & Attribution Model Spec

**Status:** Source document — add to `docs/` alongside FEATURE_SPEC.md and BRAND_GUIDE.md. Conflicts resolve in favor of this document for anything touching clinician attribution, escalation branding, or care-team UI.

**Reconciliation note (added 2026-07-12):** This spec's cross-references — "Master Plan §10/§11/§25/§26/§27" and Build Guide "Stage 3/5/6/7/13" — point to the original pre-reconciliation planning docs (`docs/source/Tarragon Health Master Plan.docx`, `docs/source/Tarragon_Health_Master_Brand_Package.docx`), not to `docs/FEATURE_SPEC.md`'s live Sprint 1–7 structure. Approximate mapping onto the current sprint plan (`docs/FEATURE_SPEC.md` §4):
- Stage 3 (Patient Profile) → Sprint 1–2
- Stage 5 (Risk Scoring/Escalation) → Sprint 2 (abnormal-result handling is an explicit Sprint 2 deliverable)
- Stage 6/7 (Clinician/Doctor Dashboard) → Sprint 2 (dashboards)
- Stage 11 (Family Dashboard) / Stage 13 (notification model) → Sprint 3 (WhatsApp/SMS + family portal)
- §25 Outcome Evidence Engine → Sprint 7 (outcomes)
- §26 Early Team → staffing/ops, not a build sprint
- §27 Launch Gates → `docs/FEATURE_SPEC.md` §7 (Launch Gates / Pre-Launch Security Checklist)

Read this spec's own §7 build-sequencing table against these Sprint numbers, not the literal Stage/§ numbers.

**Superseded 2026-07-15 — Tarragon now directly employs its own doctors.** The day-to-day care-team role (Tier 2 below) is staffed by Tarragon-employed, MDCN-licensed doctors, not contracted nurses/clinicians, and is branded to patients as "your doctor," not "your clinician." This is a deliberate business-model change, not a copy typo: the earlier "clinician is the default face, doctor attribution is earned per-case" framing (§9, previously carried into CLAUDE.md's "Never" list) is retired. What's preserved from the original model: the underlying `clinical_staff.role` DB value for this tier remains `clinician` for schema/backward-compatibility reasons only — that is an internal identifier, not something a patient ever sees, and it does not need to match the customer-facing word. The three-tier structure, the null-gated `ReviewedByDoctor` attribution component, and the escalation SLA machinery are all still real and still required; only the brand word for Tier 2 changes.

**Superseded 2026-07-30 — never promise ONE continuous named doctor; the Tier 2 relationship is a team, not an individual.** Patient feedback flagged the original framing below (a single named, photographed doctor as "the primary relationship the patient has") as something the platform can't honestly deliver at real scale with shift-based staffing — a real team covers day-to-day review across shifts, and promising one fixed person either becomes a lie or overloads one doctor. §1's Tier 2 table row and §9's non-negotiable are rewritten below to match. **Unchanged:** per-case attribution stays mandatory and real — whichever Tier 2 doctor actually reviewed a specific reading/case is still named on that case, with a timestamp (the one-line principle immediately below is fully intact); the Clinical Director's protocol authorship stays named; the Escalation Doctor pool's per-case attribution is untouched. **Changed:** patient-facing copy (onboarding, dashboard, marketing) says "your care team," never "your doctor" as a singular continuous person, and every "doctor" reference in this section that used to mean one fixed individual now means "whichever doctor on the team actually did the reviewing."

**One-line principle:** Every trust claim shown to a patient or family must be backed by a real, timestamped database record. No UI element may say "Dr. X reviewed this" unless Dr. X actually reviewed that specific case. The halo comes from real protocol authorship and real escalation review, not from borrowed titles.

This directly extends Master Plan §10 (Clinical Operating Model) and §11 (Clinical Protocols). Brand Package's existing voice line — *"a doctor who knows your name, not a hospital PA system"* — is best read post-2026-07-30 as **care that knows your name and history**: a named, employed Tarragon care team at the center of the patient relationship, with a separate escalation pool reserved for cases that need a second, more senior review. Continuity lives in the shared record and the team, not in one fixed individual. This spec makes that architecture concrete enough to build.

---

## 1. Role Architecture — Three Tiers, Not Two

| Tier | Role | What they actually do | What gets branded |
| --- | --- | --- | --- |
| 1 | **Clinical Director** | One named, licensed doctor (or small named panel) who designs, approves, and version-signs every clinical protocol: BP/glucose thresholds, escalation triggers, red-flag rules, care plan templates. Reviewed quarterly, not per-patient. | Visible on marketing site, onboarding, and Health Passport footer as protocol author. Photo, bio, MDCN number. |
| 2 | **Doctor (Care Team)** *(2026-07-30: a team, not one assigned individual — see the banner above)* | A team of Tarragon-employed, MDCN-licensed doctors who do the actual day-to-day work between them, with coverage shared across shifts so no single doctor carries an unsustainable caseload: reviews readings, calls patients, checks adherence, documents notes, follows protocol, escalates when rules trigger. The patient's primary relationship is with the *team* and the *record*, not with one fixed person. Internal DB role value stays `clinician` (schema/backward-compat only — not patient-facing). | **Per action, not as a standing badge:** whichever doctor actually reviewed a reading or handled a check-in is named and credentialed (MDCN number) on that specific action — dashboard review, call intro — the same real, non-hardcoded attribution rule as Tier 3 below, just applied to routine care instead of only escalations. Never a single photo/name presented as "your doctor" ahead of any review actually happening. |
| 3 | **Escalation Doctor (Pool)** | Reviews only cases a Tier 2 doctor or the risk engine actually escalates — Amber/Red/Emergency tier. Writes a documented review note and action plan; typically a more senior/specialist doctor than whichever Tier 2 doctor handled the case day-to-day. | Named and shown **only on the specific case that was escalated**, with a timestamp — "Reviewed by Dr. Y, 14 Jul, 09:12." Never shown on cases that weren't escalated. |

The day-to-day care-team role and the escalation pool are both staffed by real, employed/credentialed doctors, distinguished by seniority and per-case involvement rather than by title: Tier 2 carries day-to-day trust through real, per-action attribution (named on the specific review, not as a fixed standing relationship); the Clinical Director carries protocol credibility; the escalation doctor carries case-specific credibility exactly where it's earned. What makes all three trustworthy is the same thing — a real name tied to a real, timestamped record — not that one particular name follows a patient everywhere.

---

## 2. Attribution Rules by Touchpoint

| Touchpoint | What's shown | Copy pattern | DB requirement |
| --- | --- | --- | --- |
| Marketing site — About/Founder page | Clinical Director photo, bio, MDCN number | "Care protocols developed and supervised by Dr. [Name], MDCN [number]" | Static, editable via CMS/Content module |
| Onboarding — "Your Care Team" screen *(2026-07-30: team framing, no single assigned doctor named ahead of any review)* | Clinical Director badge (real, standing — protocol authorship, not per-case) + a plain description of how the care team works | "A team of MDCN-registered doctors on your care team follow your readings and check in with you — your care protocols are supervised by Dr. [Name]." No individual Tier 2 doctor's name/photo is shown here; that only appears once they've actually reviewed something (see the dashboard/escalation rows below). | `care_team_assignment` still exists for internal routing/rota purposes, but its `clinician_id` is not rendered on this screen as "your doctor"; `clinical_director_id` still powers the Clinical Director badge |
| Patient/family dashboard | Persistent small badge, not a rotating claim | "Care protocols supervised by Dr. [Name]" — static, same for every patient | Pulled from `clinical_staff` where role = clinical_director |
| A logged reading/reminder that was actually reviewed | Signed by whichever doctor actually reviewed it | "— Dr. Amaka, Tarragon Care Team" | `message_log.sender_id` → `clinical_staff`, only ever set once a real review happened |
| Escalation notification (Amber/Red/Emergency only) | Named doctor, only after real review | "Dr. [Name] reviewed your case on 14 Jul and recommends..." | `escalations.reviewed_by`, `escalations.reviewed_at` must be non-null before this template can render |
| Monthly / quarterly Health Passport & family report | Footer disclosure, plus a separate escalation line item only if one occurred | "Protocols supervised by Dr. [Name]." + conditionally: "This period included direct doctor review on [date] for [reason]." | Same escalation table, queried at report generation time |
| Corporate / HMO reports | Clinical Director named as protocol owner; aggregate escalation stats, no individual doctor attribution needed | "Reviewed under protocols developed by Dr. [Name], Tarragon Clinical Director" | Aggregation query, no new fields |

**Engineering rule:** the "Reviewed by Dr. X" component must be a single shared UI component that takes an `escalation_id` and renders nothing (or a clinician-attributed fallback) if `reviewed_by` is null. It must never be a hardcoded string set by marketing or ops. This is the guardrail that makes the false-attribution risk structurally impossible rather than a policy that can be quietly overridden later.

---

## 3. Escalation → Doctor Attribution Flow

Ties directly into Master Plan §11 (red-flag escalation protocol) and the Stage 5/7 build tasks already scoped (risk categories, escalation queue, doctor dashboard, close-escalation function).

1. Risk engine or clinician flags a reading/symptom as Amber, Red, or Emergency.
2. Case enters `escalations` table: `status = open`, `assigned_doctor_id = null`.
3. Doctor pool rota picks it up (see §6). SLA clock starts at creation.
4. Doctor documents a review note and action plan in the doctor dashboard (Stage 7, steps 62–65).
5. On save: `reviewed_by`, `reviewed_at`, `review_note` populate. Only now can any "Dr. X reviewed" UI render for this case.
6. Clinician receives doctor's instruction, closes the loop with the patient, documents the handover.
7. If family consent allows, family dashboard shows the escalation event with the same real attribution.

Amber-tier cases where the clinician is confident and protocol permits clinician-only resolution should **not** force doctor attribution — don't manufacture escalations just to generate doctor-branded moments. That defeats the cost logic and cheapens the signal when it's real.

---

## 4. Platform / Data Model Additions

New or extended tables, on top of what's already scoped in the Build Guide:

| Table | Key fields | Purpose |
| --- | --- | --- |
| `clinical_staff` | id, role (`clinical_director` / `clinician` / `escalation_doctor`), full_name, photo_url, credential_type, credential_number (MDCN/NMCN), specialty, bio, active, license_verified_at | Single source of truth for every named clinician shown anywhere in the product |
| `care_team_assignment` | patient_id, clinician_id, clinical_director_id, assigned_at | Powers the onboarding "Your Care Team" screen and dashboard clinician identity |
| `protocol_versions` | protocol_id, version_number, approved_by (→ clinical_staff), approved_at, change_summary | Makes "protocols supervised by Dr. X" literally auditable, not just a claim |
| `escalations` (extends existing escalation queue from Stage 5) | ...existing fields..., assigned_doctor_id, reviewed_by, reviewed_at, review_note, sla_target_at, sla_met (bool) | Gates all doctor-attribution UI; also feeds SLA reporting |
| `message_log` (extends existing notification model, Stage 13) | sender_id → clinical_staff | Lets WhatsApp/SMS messages carry a real clinician signature instead of a generic "Tarragon" sender |

This slots into the existing Stage 3 (Patient Profile), Stage 5 (Risk Scoring/Escalation), Stage 6 (Clinician Dashboard), Stage 7 (Doctor Dashboard), and Content module — no new stage number needed, just additional build tasks inside those stages.

---

## 5. Compliance & Legal Guardrails

- **License verification, not self-attestation.** Every `clinical_staff` record with role `clinical_director` or `escalation_doctor` requires MDCN registration number verified before `license_verified_at` is set. Re-verify annually. Clinicians similarly verified against NMCN.
- **Indemnity/malpractice insurance** required for the Clinical Director and every escalation doctor before they're activated in the rota — this is what actually protects them, not the disclaimer text.
- **No retroactive attribution.** `reviewed_by` and `reviewed_at` are set once, by the reviewing doctor, at time of review. No admin tooling should allow backfilling these fields after the fact.
- **Consent screen honesty.** Onboarding consent copy should plainly state the real model: day-to-day monitoring by a team of Tarragon-employed physicians, doctor-designed protocols, a separate senior/escalation doctor review triggered by specific clinical criteria. *(Note: "doctor-led" itself was retired as a brand/marketing claim 2026-07-18, see CLAUDE.md's Brand section — describe the actual process instead of using that phrase as a headline adjective.)* This satisfies MDCN telemedicine disclosure expectations and, per the earlier discussion, is itself a trust asset — Nigerian consumers already distrust ambiguity (see the pricing-transparency principle in the Master Plan), and a plainly stated care model reads as more credible than a vague one.
- **NDPR data residency** already covers `clinical_staff` credential data — no separate infrastructure needed, just make sure it lives in the same eu-west-1 Supabase project as everything else (Supabase has no Africa region; eu-west-1 is the closest available — see CLAUDE.md's Architecture section for the accepted NDPR-residency gap).

---

## 6. Staffing & Logistics

| Role | Ratio / structure | Payment model | Notes |
| --- | --- | --- | --- |
| Clinical Director | 1 (founder/clinical lead for pilot, per Master Plan §26 Early Team) | Founder equity / salary once funded | Formal external hire only when protocol volume or credibility needs exceed founder bandwidth — consistent with the capital-efficiency principle already locked in |
| Clinician | 1 : 120 patients (existing ratio) | Salary or per-caseload | Primary trust surface — invest in professionalizing this role's presentation (real photos, titles, structured call scripts) rather than routing trust through borrowed doctor credit |
| Escalation Doctor Pool | Sized to escalation *volume*, not patient count — start with minimum 2 doctors for pilot so there's rota backup from day one | Per-case-reviewed or per on-call shift, not FTE salary | Matches the "backend logistics" cost logic from the original idea — doctors are paid for actual clinical work, not for appearing on every screen |

**Sizing the doctor pool (to tune during pilot, no reliable Nigeria-specific benchmark to assume yet):** track actual Amber/Red/Emergency escalation rate per 100 active patients during the 100-patient pilot, multiply by average review time, and back into required doctor-hours per week. Rebuild this ratio with real pilot data before scaling past pilot size — don't guess a fixed ratio now and lock it into the cost model.

**Escalation SLA targets** (tie to Stage 5/7 build and the Outcome Evidence Engine, §25 of Master Plan, which already tracks "time to doctor review"):

| Tier | Target review time |
| --- | --- |
| Amber | Within 24 hours |
| Red | Within 2 hours |
| Emergency | Immediate — patient is simultaneously directed to emergency care, doctor review is for documentation/follow-up, not gatekeeping urgent action |

---

## 7. Build Sequencing (maps onto existing 7-sprint / 16-week plan)

| When | Task | Fits existing stage |
| --- | --- | --- |
| Month 1 (Foundation) | Build `clinical_staff` and `protocol_versions` tables; write and version-sign first protocol set | Stage 3 / §11 protocols |
| Month 1–2 | Build "Your Care Team" onboarding screen; extend patient profile with `care_team_assignment` | Stage 3 |
| Month 2 (Core Monitoring) | Extend escalation queue (`escalations` table) with `assigned_doctor_id`, `reviewed_by`, `reviewed_at`, `sla_target_at` | Stage 5 |
| Month 2 | Build the shared "Reviewed by Dr. X" UI component with the null-gate rule from §2 | Stage 6/7 |
| Month 2–3 | Wire clinician signature into WhatsApp/SMS templates via `message_log.sender_id` | Stage 13 |
| Month 3 (Revenue/Partner) | Add escalation attribution line to Health Passport and family report generation | Stage 11 (Family Dashboard), §25 Outcome Evidence |
| Ongoing | Verify and log MDCN/NMCN credentials for every clinical_staff record before activation | Compliance, pre-launch gate |

Add to the Launch Gates table (Master Plan §27): **"Clinical attribution" — every doctor-branded UI element is backed by a verified `reviewed_by` record; no hardcoded doctor claims exist anywhere in the codebase.**

---

## 8. Metrics to Track

- SLA compliance by escalation tier (Amber/Red/Emergency) — already partially scoped in Outcome Evidence Engine §25
- Doctor cost per reviewed case (validates the per-case payment model vs. FTE)
- % of patients who can correctly recall their clinician's name in post-onboarding survey (proxy for whether the clinician-centered trust model is landing)
- Zero tolerance metric: count of any "Dr. X reviewed" UI render with a null `reviewed_by` backing record — this should structurally be impossible, but track it as a QA canary during build and pilot

---

## 9. Non-Negotiables (candidates for CLAUDE.md)

- No UI element may claim escalation-doctor review of a specific case without a corresponding `reviewed_by`/`reviewed_at` database record.
- **(Superseded 2026-07-30)** ~~A Tarragon-employed doctor (Tier 2, Care Team) is the default face of the day-to-day patient relationship — not a rotating or unnamed clinician.~~ Tarragon's day-to-day care is delivered by a **team** of Tarragon-employed, MDCN-registered doctors with coverage shared across the team — never promise or design toward one fixed, continuously-assigned individual doctor as "the" face of a patient's relationship. What stays non-negotiable: never present the team as anonymous or unaccountable either — every actual review, call, or note is attributed to the real doctor who did it, per the rule immediately above and the one below.
- A named *escalation* doctor's involvement in a specific case is still earned through real escalation review, never applied uniformly as a branding layer — a Tier 2 doctor's attribution is real whenever they actually act on a case (named on that action, not standing in as "the" doctor beforehand), and the additional "reviewed by Dr. Y" escalation credit only appears when that specific case was actually escalated and reviewed.
