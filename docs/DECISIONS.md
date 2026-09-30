# Decisions

Append-only log of decisions that shape the v5 build. Newest section first. A change to a
spec invariant (INV-01 to INV-16) needs a written founder decision here.

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
