# Pediatric & Child Health Platform

Source: an external module spec (§48.1-§48.15, "Paediatric & Child Health Platform") describing a
longitudinal child health record — growth, development, prevention, vaccination, illness, chronic
care, transition to adult care — managed by a parent/guardian with permissions that evolve as the
child ages. This doc records what that spec asked for, what already existed on the platform before
this work, what was built to close the gap, and what is deliberately deferred. Read it alongside the
migrations it names rather than as a replacement for them.

**Acceptance-criteria arc from the source spec (§48.15): Growth → development → prevention →
vaccination → illness → chronic care → transition.** Status against each link below.

## What already existed (reused, not rebuilt)

A survey of the codebase before this work (see git history around
`20260829121652_pediatric_growth_monitoring.sql`) found the hard part of this platform — "how does
a parent manage a child's clinical record at all" — already solved:

- **`profiles.is_dependent_account` + `profile_access`** (`20260706084848_profile_access.sql`,
  `20260730025603_profiles_is_dependent_account.sql`): a child with no login of their own is
  provisioned as a real `profiles` row (synthetic, undeliverable email, no password) linked to a
  parent via a `profile_access` grant at `permission_level = 'manage'`. `private.can_act_for` /
  `private.can_read_clinical` / `private.stamp_acting_supporter` are the mechanisms every table in
  this doc's migrations reuses rather than re-inventing.
- **Vaccination (§48.6, "fully integrate with Module 43")** — already fully built and
  parent-access-aware: `vaccination_catalog`/`vaccination_records`/`vaccination_schedules`, the NPHCDA
  routine childhood schedule (`20260723200847_child_immunisation_nphcda.sql`), the DOB-anchored
  `age_schedule_weeks` shape in `apps/web/src/lib/rules/vaccination-status.ts`, and the
  "✓ Dose 1 / ✓ Dose 2 / ○ Dose 3 due" UI (`vaccination-registry.tsx`). Nothing in this pass touches
  it — §48.6 was already done.
- **Chronic programme scaffold (§48.13)** — `chronic_condition_programmes` /
  `condition_protocols` / `chronic_programme_enrolments` / `care_plans`
  (`20260716223124`-`20260716223642`) is condition-agnostic; asthma is already seeded there
  (`is_active = false`, pending Clinical Director protocol sign-off — the same structural gate every
  chronic condition goes through). This pass did not activate it or write paediatric-specific
  protocol content; it closed one RLS gap so a parent can actually *see* an enrolment once one exists
  (below).
- **Emergency escalation pathway** — `emergency_events` / `clinician_alerts`
  (`20260716224736_emergency_escalation.sql`) is the one owner of every emergency-tier alert on the
  platform. Every paediatric red-flag rule in this pass raises through this existing pathway; none of
  it invents a second alerting system.

## What was built

| §    | Area                          | What shipped |
|------|-------------------------------|---------------|
| 48.3/48.4 | Growth monitoring / charts | `child_growth_measurements` + `growth_reference_lms` (WHO/CDC LMS shape) + `private.growth_z_score` (the standard LMS formula) + a trajectory-change trigger — `20260829121652_pediatric_growth_monitoring.sql`. UI: `growth-tracking-card.tsx` (log form + recharts trend), wired into the Vitals section. |
| 48.5 | Developmental monitoring | `developmental_questionnaire_items` (60-item original starter bank, 6 age bands × 5 domains × 2 items) + `developmental_screenings` + scoring trigger — `20260829122052_pediatric_developmental_screening.sql`. UI: `developmental-screening-card.tsx`, wired into a new "Child health" Prevention tab (shown only for a subject under 18). |
| 48.8/48.9 | Paediatric symptom triage / emergency red flags | Age-aware `private.handle_symptom_red_flag()` (4 new symptom types, lower escalation bar under 5) + a WHO IMCI-based paediatric fever trigger on `vitals_readings` — `20260829122452_pediatric_symptom_and_vitals_red_flags.sql`. UI: `symptom-log-form.tsx` offers the paediatric options when acting for a dependent under 5; `danger-symptom-check.tsx` swaps to a parallel paediatric danger-sign checklist (`lib/validation/pediatric-emergency.ts`) for the same subject. Pure-logic mirror + tests: `lib/rules/pediatric-symptom-triage.ts`. |
| 48.10 | Medication safety | `apps/web/src/lib/rules/pediatric-drug-safety.ts` — weight-based mg/kg dosing check, a small 3-drug starter formulary, advisory only (never a block), composable with the existing `assessMedicationSafety`. DB gap-close: a parent can now self-report a medication for a child they manage (`medications.logged_by_profile_id` + RLS extension — `20260829122852_pediatric_medication_attribution.sql`); this was a confirmed pre-existing gap (vitals/symptoms had it since 2026-08-01, medications never did). |
| 48.12 | School-related health | Resolved as a **printable export**, not a school account — see below. |
| 48.13 | Chronic paediatric conditions | RLS gap-close only: `chronic_programme_enrolments` now honours `private.can_read_clinical` so a parent can see a child's enrolment — `20260829123252_pediatric_chronic_programme_access.sql`. The programme content itself (asthma) predates this pass and is still dormant pending sign-off; see "What already existed" above. |
| 48.14 | Transition to adult care | `dependent_transition_status` (materialised, daily-cron-refreshed, `child`/`adolescent`/`transition_prep`/`independent` by age) + automatic `manage` → `view` step-down on turning 18 (history kept, nothing deleted) + a `patient_timeline` record of the change + `activate_dependent_account_basics` RPC for the deliberate, separate "claim a real login" step — **corrected filename, 2026-09-03: `20260830103331_dependent_transition_to_adult_care.sql`** (the file cited here, `20260829123652_...`, does not exist; this is the same content renamed/re-timestamped during the 2026-09-02 mass-merge reconciliation, per `CLAUDE.md`'s documented migration filename/version drift pattern). **This migration's own header now carries a 2026-09-02 reconciliation note flagging unresolved overlap with PR #329's Adolescent Health module, which independently built `adolescent_transition_plans` (a clinician-driven staged readiness checklist covering the same product territory) — the two systems are unreconciled, a product decision for a human, not yet resolved.** |

### 48.12, resolved: a printable export, not a school account

Originally deferred (see below) because "vaccination evidence / health certificates / health
assessments... without giving schools unrestricted medical-record access" reads like it needs a new
institutional account type — exactly the kind of design decision this codebase's guardrails (I9:
institutions get aggregate-only access, ever) say not to default without asking. The actual resolution
is much smaller: **the school never touches the platform at all.** A parent generates a PDF from their
own account and hands it over themselves, the same way they'd hand over a paper vaccination card
today. No school login, no new RLS surface, no institutional-access question to resolve.

Shipped: `lib/school-health/school-health-summary-document.tsx` (a `@react-pdf/renderer` document,
same library/pattern as the existing referral-letter and Health Passport PDFs) +
`/api/patient/school-health-summary/[patientId]/route.ts` (cookie-session auth, RLS-scoped — a
patientId the caller has no `profile_access` grant for simply 404s) + a "Download school health
summary" link in `vaccination-for-family.tsx`'s existing "whose vaccinations?" subject picker.

Deliberately **vaccination status only** — not a Health Passport-style full clinical export, and not
a developmental-screening export either: a screening flag is a routing signal for a doctor, not
something to hand a school over an unvalidated, non-normed starter questionnaire (risk of
stigmatising a child on a false-positive routing signal). "Health certificates" (a doctor's
fitness-to-attend attestation) and formal "health assessments" are still not covered — those need a
real clinician sign-off workflow and remain deferred, not silently bundled into this document.

Full test coverage for every new pure-logic module: `lib/growth/zscore-to-percentile.test.ts`,
`lib/rules/pediatric-symptom-triage.test.ts`, `lib/rules/pediatric-drug-safety.test.ts`,
`lib/development/age-band.test.ts`. `pnpm typecheck` / `pnpm lint` / `pnpm test` all pass at the time
of writing.

## Deliberately deferred (not built this pass)

Each of these was excluded on purpose, not overlooked — matching this codebase's existing "explicit
ask before building" discipline for large product surfaces (see CLAUDE.md's Clinical Tier Ladder
guardrails):

- **A licensed/validated developmental screening instrument** (ASQ-3 or similar). What shipped is an
  original, unlicensed, non-normed 60-item starter bank explicitly stated as not equivalent to a
  validated tool — see the header of
  `20260829122052_pediatric_developmental_screening.sql`. Adopting a real licensed instrument is a
  clinical/licensing decision for the founder.
- **Full-resolution WHO Child Growth Standards / CDC Growth Charts reference data.**
  `growth_reference_lms` ships **empty** — the L/M/S parameters are precision-sensitive population
  statistics that must come from the actual published WHO/CDC data files, never approximated from
  memory (see that migration's header, and the precedent in `apps/web/src/lib/rules/egfr.ts`, which
  already refuses rather than guesses for exactly this reason). `private.growth_z_score` returns
  `null` — not a fabricated value — until real data is loaded, and the UI shows "reference data
  pending" for percentiles in that state. **This is the single most important follow-up**: raw growth
  tracking works today; percentile/z-score-based trajectory flagging only activates once someone
  loads the real reference table (a data-import task, not a code one).
- **A larger paediatric drug formulary.** `pediatric-drug-safety.ts` covers exactly three drugs
  (paracetamol, ibuprofen, amoxicillin) as a stated, honest starting point — see that file's SCOPE
  comment. Not a complete formulary and must never be presented as one.
- **Granular per-record adolescent privacy** (e.g. a "hide this from my parent" flag on a specific
  record/category once a dependent reaches the `adolescent`/`transition_prep` stage). What shipped is
  account-level access tapering only (the automatic `manage` → `view` step-down at 18). A
  record-level sensitivity model needs a product decision about which categories qualify (the
  spec text itself doesn't say) before it's buildable.
- **RESOLVED, confirmed 2026-09-03 — these have since merged and are live in production.** All six
  migrations now exist on `main-dev` and their tables are confirmed live against `koiplnmbgnqnbywhpjlf`:
  `child_growth_measurements`, `growth_reference_lms`, `developmental_screenings`,
  `dependent_transition_status` all present (each with 0 rows — schema is live, real usage hasn't
  started yet, not "not yet applied").

## Design decisions worth remembering

- **The parent/guardian access model was not rebuilt.** Every new table in this pass reuses
  `private.can_act_for` (write) / `private.can_read_clinical` (read) exactly as the existing
  eldercare and vaccination surfaces do — a dependent-account child and a `profile_access`-granted
  adult are handled by the identical mechanism throughout. Nothing paediatric-specific was added to
  RLS beyond following that existing pattern.
- **Every red-flag rule raises through the existing `clinician_alerts`/`emergency_events` pipeline.**
  No parallel alerting system was introduced for children — a paediatric fever or danger sign becomes
  the exact same kind of alert a BP crisis or an adult danger sign does, just with different trigger
  logic deciding when to raise one.
- **"Must not diagnose from a chart alone" (§48.4) is structural, not just copy.** The growth
  trajectory trigger raises a `clinician_review` alert; it never writes a diagnosis, a risk level, or
  a care-plan change. Same for the developmental screening's `overall_flag`.
- **Age is always server-derived from `profiles.date_of_birth`, never trusted from the client** — the
  growth-measurement and developmental-screening BEFORE INSERT triggers both compute age themselves
  and raise an exception if no DOB is on file, rather than accepting a client-supplied age or band.
