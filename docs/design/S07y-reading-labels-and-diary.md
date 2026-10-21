# S07y design note: home cuff vs clinic cuff check

Written 2026-10-20 on `s07y/home-cuff-vs-clinic-check`, off `origin/main-dev`. Builds on S07x (`docs/design/S07x.md`: `clinic_bp_readings`, `record_clinic_bp_reading`, the governed-table pattern, `bp_pattern_flags`). An original gap-closer, not in the S06-S10 plan. Cheap unvalidated cuffs are common in Nigeria; every home average and every S07x pattern flag assumes the home cuff is right. This asks the question the platform otherwise never asks: does the patient's cuff agree with ours?

Invariants kept: INV-01 (no model), INV-02 (never changes a medicine), INV-07 (nothing about this in a notification or task text), INV-12 (tied staff reads and writes), INV-14 (guards born off), INV-16 (every number in a versioned, signed row).

## Data model (migration `20261020184217_s07y_home_cuff_vs_clinic_check.sql`, additive)
- `cuff_check_rules`: governed single-active-row table. v1 seeded UNSIGNED and INACTIVE, every number PROPOSED (`bp.cuff_check` in `packages/shared/src/proposed-config`, mirror test). `sign_cuff_check_rules` is Chief Medical Officer only. The supersede guard trigger is on it.
- `cuff_check_pairs` (append-only): own cuff minus clinic cuff, from either source. `same_visit`: the care team enters both readings from one visit plus a device label (`record_cuff_check_pair`, the "cuff_check reading kind"). `home_log`: made when a clinic reading is saved, from the mean of the patient's own manual or device readings within the window either side of it (at least the minimum number).
- `cuff_check_flags` (append-only): consistently off in one direction. One class 8 routine task `cuff_check_review` per patient and direction (open task merges; no second flag while one is open).
- Rule: among the newest `maxPairs` pairs inside the look-back, at least `minPairs`, and at least the share, off in the SAME direction (either number reaching its threshold). Mixed pairs count for neither. Written three times that cannot drift: `packages/clinical/src/cuff-check.ts` (100 percent branch coverage), the SQL twin (`private.cuff_pair_class`, `cuff_home_mean`, `cuff_check_kind`), and one 31-case parity block inside the DB proof that Jest also reads.
- Guards (both OFF): `cuff_check_flag` (the rule) and `cuff_visit_prompt` (the neutral patient line). Entering a pair is never behind a guard; evaluating one is, and also needs a signed configuration (fail closed).

## Events and failure handling
Clinic reading saved -> trigger (additive, `record_clinic_bp_reading` is not edited) -> home-log pair -> evaluate. Same-visit pair saved -> evaluate. Each step is wrapped: a failure never rolls back the clinician's data and opens one ops incident (`cuff_check_rule`), never silent.

## Screens
Clinician chart, beside the S07x clinic reading form: `CuffCheckPanel` (flags, recent pairs with own-minus-clinic and device label, the paired entry form). Sign-off hub: `cuff_check_rules` panel (`CONFIG_PANELS`, queue, `GOVERNED_CONFIG_TABLES`), plus two attestation lines. `/clinician/cuff-check-rules` and read-only `/admin/settings/cuff-check-rules`. Search entries added.

## Safety rules
- No patient policy on pairs or flags; tied staff reads only; no patient screen, export or notification. The task holds no value, label or direction.
- The only patient-visible fact is `cuff_visit_prompt_open()`: a boolean that is identical for every patient with that guard on and the wording attested. It reads no pair or flag table, so it cannot reveal a flag. The sentence is the unsigned string `cuff.visit_prompt`; no patient screen shows it yet.
- Wording is "consider a cuff check", about the cuff, never a diagnosis or a label.

## What the CMO must sign (nothing is signed or on)
1. `cuff_check_rules` v1: how far apart (10 over 5 mmHg), how many pairs (3 of the newest 5, 75 percent, 365 days), how near a home reading must be to a clinic reading (24 hours, 2 readings), task due in 7 days. All proposals; no guideline fixes them.
2. Attestation `flag_is_clinician_only`, then switch `cuff_check_flag`.
3. Attestation `visit_prompt_wording_signed` for the exact sentence, then switch `cuff_visit_prompt` (only after a patient screen exists).

## Open
OQ-S07YL-1: a home-log pair sees only home readings before the clinic reading is saved. OQ-S07YL-2: whether a subject-access request must include pairs and flags (DPO). OQ-S07YL-3: no patient screen for the neutral line yet. OQ-S07YL-4: no look-back sweep at switch-on and no way to void a wrong pair. The attestation is recorded against the exact text of `cuff.visit_prompt`, which a Jest test pins (changing it means re-attesting).
