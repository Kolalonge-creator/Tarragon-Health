# DUP-1 design note: duplicate lab value safety

Invariants in play: INV-02 (nothing outside the record is silently chosen), INV-03/04 (released, non-sensitive results only; sensitive codes are never linked), INV-10/12 (the clinician note is audited and tied), INV-16 (match rule is versioned). Research: `docs/research/DUP-1.md`. Migration `20261020214837_duplicate_lab_value_safety.sql`, later than the newest file on `origin/main-dev` and the newest live version (`20261020173600`). Not applied by this session; merging the PR applies it.

## 1. The question and the answer
Can the same lab value, arriving once as a structured result (S27 writer, S44 partner push: `lab_result_items`) and once as a clinician-filed photo or PDF of the paper report (`lab_analyte_readings`), be counted twice? **Yes, before this change.** `private.biomarker_points` (trend, list) and `private.hr_biomarker_points` (Health Report facts and trend) both `UNION ALL` the two tables with no match. Live row counts were 0 in all three lab tables, so there is no data conversion. The S43 patient photo capture (`patient_documents.extracted`) is not a path in: it holds suggestions only and nothing reads it (scan test), so it cannot double count. The record exports (S44 FHIR snapshot, S47b record export) list both rows with an `origin` label as evidence; they are unchanged here (OQ-DUP-1-3).

## 2. The rule (deterministic, no AI, versioned)
`lab_value_match_config` v1 (PROPOSED, mirrored in `packages/shared` registry key `lab_value.duplicate_match`, drift test): `window_days` 2, `value_tolerance_pct` 0.5, `require_same_unit` true. A pair is the same patient, same analyte code (case-insensitive), dates within the window (Lagos days; structured side the lab order's `sample_collected_at` else `received_at`, paper side `specimen_collected_at` else `taken_at`), numeric on both sides, neither sensitive. Then:
- same unit and value inside the tolerance: `duplicate`
- anything else inside the window (value outside tolerance, or unit differs, never converted): `disagreement`

## 3. What is stored and shown
`lab_value_links` is append-only evidence (update trigger refuses; NO client read or write at all, because a link copies a value before release; not in the patient export); the rule in force is the latest CONFIRMED config version, else the seeded v1, so an unconfirmed draft is inert; both source rows are untouched. Triggers on both source tables write links loudly (a failure aborts the insert).
- Trend: a duplicate is one point (the structured result) with `also_from = legacy_report`. The paper row is hidden only while the structured result is itself visible (released, not withdrawn, not replaced), so a withdrawn or held structured result brings the paper value back.
- Disagreement: both points are shown, each `disagrees = true`, the series is `disputed`, and the screen says nothing has been chosen.
- Health Report: duplicates count once; an analyte with a disputed reading is left out of the report's facts entirely (neither value picked, no older reading promoted to latest) (OQ-DUP-1-2).
- Clinician note: `public.lab_value_disagreements(patient, reason)`: self, or an active clinician through the tie with a reason and an audit row (anyone else is refused before anything is written; reproductive-hormone and confidential-domain analytes are withheld from the staff view); a refusal returns `{denied:true}` and is audited. Shown in the case file ("Results that disagree"; unavailable is never "none").
- Red-flag logic is NOT de-duplicated: a critical value arriving twice may page twice. Two pages are safe, a suppressed one is not.

## 4. Proof
`packages/db/tests/dup1_duplicate_lab_value_safety.sql` (39 checks, 3 sabotage steps: links removed, triggers dropped, visibility check bypassed; each flips a check). Run against live inside a rolled-back transaction with the migration spliced in (no local Docker was available). Jest: trend parser, disagreement parser, registry mirror.

## 5. Not built
A staff screen to confirm or edit the match config; merging disputed pairs (a clinician files a correction through the existing correction path); export de-duplication.

## 6. Review findings fixed (code-review high)
Links readable by the person before release (removed the read); matcher read the base table (now `_current`); date window used receipt not collection (now the lab order's collection date); unconfirmed config draft went live (now inert); any user could write audit rows about another patient (now staff-only, refused early); Health Report promoted an older reading when the newest was disputed (now the analyte is omitted). Not fixed, recorded: no resolve or dismiss for a disagreement caused only by a unit label (OQ-DUP-1-4); AI explainer and exports still list both rows (OQ-DUP-1-3); the case-file note writes one audit row per open (OQ-DUP-1-5).
