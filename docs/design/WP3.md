# WP3 design note: cascade of care and the selection-bias panel

2026-10-23. Builds on S75 (`docs/design/S75.md`, `docs/design/S75-outcome-measures.md`). One migration: `20261023175612_wp3_cascade_of_care_and_selection_panel.sql`. Proof: `packages/db/tests/wp3_cascade_of_care_and_selection_panel.sql`.

## What is reused, not rebuilt
The single minimum-cell rule (`private.min_cell_floor`, `suppress_cell`, `suppress_difference`, `suppress_groups`), `private.outcome_cohort_json` (strict rate, completers rate, missing share), `private.v_bp_cohort_day` (day 90 and 180 control), `private.sponsor_agreed_members` (only members who agreed), `private.sponsor_pack_build` and its causal-wording refusal in the database and again in the app, the audited admin and CMO gate, `/admin/outcomes`, the sponsor page and the pack route (the pack flattens every leaf, so the new sections reach the CSV and PDF with no change to the route).

## 1. Cascade of care
Stages (config `outcome_cascade_config`, mirrored as `outcomes.cascade_rules`): enrolled, screened, diagnosed, on a recorded medicine, controlled. All counted from real tables.
- enrolled: adult (18+, date of birth known) with a joining date (`private.outcome_anchor`), active, not a test account (INV-13), not pregnant.
- screened: hypertension, a cleared blood pressure reading; diabetes, a cleared glucose reading or an HbA1c result. It is a share of enrolled Members, not population screening coverage.
- diagnosed: an active care plan for the condition, or a problem-list entry with the ICD-10 prefix and an active, controlled or uncontrolled status. Includes people with no reading yet.
- on treatment: diagnosed, and an active, current medicine recorded under that care plan. The medicine class is not held, so any medicine under the plan counts.
- controlled: on treatment and the most recent 7-day home average (at least 3 cleared readings, last 90 days) under 140/90; diabetes, the most recent HbA1c in 180 days under 7.0 percent. Anyone on treatment without a readable recent value is UNKNOWN: kept in the figure, never "uncontrolled", never dropped.
- Differences from the S38 reports: S38 judges each person against their own home target (else 140/90) at fixed days after joining; the cascade uses the fixed line, as at the report day. Every output says so (`difference_from_bp_outcome_reports`). This is the HEDIS CBP and national programme threshold.
- Not available, stated in every output: population screening coverage, undiagnosed raised blood pressure or glucose, prevalence.
- Suppression: the enrolled count must pass `suppress_cell`; each later stage must pass it and its gap to its parent must not be 1 to minimum-1 people (`suppress_difference`), else it is withheld and its children with it; the control split goes through `suppress_groups` (zero is shown as zero). Months of joining go through `suppress_groups` on their enrolled counts.
- Governance: config born unsigned and inactive, immutable, only `sign_outcome_cascade_config` (CMO) activates it; until then every function returns `awaiting_cmo_signature`. Hub line `cascade_config` and inline panel on `/clinician/clinical-signoff`.

## 2. Selection-bias panel
For a sponsor programme: who is in the figures against who is not, on age band at joining, sex (not recorded is a category), baseline blood pressure band (day-0 average; "no baseline average" is a category) and how they joined (membership source). Two comparisons: in the figures against other adult Members who are not in the programme (all audiences), and in the figures against members who joined but did not agree (internal admin view only; the pack says `not_shown_to_sponsors`, because those members declined to share). The eligible roster is "not available"; seats are shown labelled as seats. Intent to treat (everyone who joined; missing counted as not controlled, shown as missing, split into membership ended and still a Member) beside the completers rate, at day 90 and day 180. Fixed note: descriptive, not causal. No per-clinician view: the proof scans keys and function bodies.

## 3. Roles
Admin and the active CMO (as the existing S75 pack functions). Sponsor staff, clinicians, patients and anon are refused (invariant I9: institutions get aggregate-only access through the pack, never individuals).
