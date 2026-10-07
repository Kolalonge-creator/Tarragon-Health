# S47: CMO and founder choices applied (2026-10-07)

Source: `docs/plans/S41-S46-cmo-decisions-2026-10-07.md` (decisions 1 to 16), `docs/plans/S41-S46-signoff-items.md`, and later chat selections. **These are chat choices, not signatures.** Every signable value is loaded as an UNSIGNED, PROPOSED new version for the CMO to sign. Nothing is applied to production, nothing is pushed, the S40 gate was waived for this session by the founder. Migrations are dated after every file on the branch (newest 20261007233237) and after the newest live version read (20261007231528).

## What changed, by migration

| Migration | Decision | Change |
|---|---|---|
| `20261008012315_s47_report_settings_v2_comorbidity_min_readings` | 1 to 6 | `health_report_config_versions` v2 (unsigned): BP target below 140/90, below 130/80 with diabetes, CKD, known CVD or an elevated risk band, care-plan target overrides. 12 readings on at least 3 distinct days; "based on N readings over D days" always printed. No 5 mmHg or 5 percent margin: borderline is the 130-139 / 80-89 band only, labs only outside the lab's own range or flag. Product rules (not guideline facts): max 3 priorities, 3 percent tolerance, recheck 4 weeks, windows, trends. Collector counts days and returns four booleans (no condition name leaves it, INV-04); honesty guard enforces the minimums. New statement and emergency wording (text keys, `statementApprovedByCmo` stays false). |
| `20261008014742_s47_risk_based_hiv_hcv_cervical_hpv_dna_packages` | 7, 8, 13, 14 | Serology rule v3 (active; v2 legacy): HIV and hepatitis C risk-based; anti-HBs 10 mIU/mL PROPOSED and unconfirmed, a numeric titre alone never sets immunity (the trigger lost its titre path); immunity stops routine HBsAg unless a new exposure is on record. Screening rule set v3 (unsigned) with risk criteria (11 hepatitis C from the FMOH 2016 list, 2 for HIV), HPV DNA milestones 35 and 45 (5 year window), women living with HIV flagged to the care team (`screening_care_team_flags`, event with an id only) and never auto-scheduled. `screening_risk_flags` (self-reported or doctor-recorded, 12 months, revocable). Tier bundles lose hiv, hep_b, hep_c. Patients can still order any test. |
| `20261008021158_s47_share_view_cap_and_risk_band_actions` | S43, S45 | Share config v2: view cap 10 by default. S45 band actions as unsigned `risk_instrument_versions` v2 (review wording only, the app never prescribes, thresholds unverified against WHO PEN / HEARTS, instrument stays held). |
| `20261008023634_s47_handover_grace_period_and_auto_end` | 6 | At 18 the guardian is view-only for 90 days (`handover_config`), notices on days 1, 30, 60, 85 (neutral template, queued non_clinical so quiet hours and discreet mode apply), then guardian access ENDS automatically (state `expired`, audited, event with counts). A guardian the young person kept stays view-only. Emergency card untouched. |
| `20261008030051_s47_go_live_conditions_for_clinical_guards` | 7, 8, 9 | `private.go_live_conditions` restated FROM THE LIVE DEFINITION (it has branches main-dev lacks: research_export_enabled, symptom_checker_enabled and the rest, all kept) plus the seven new guards, each also needing `clinical_safety_case_current`. `attest_go_live_condition` restated from live with the new codes. Unknown key still fails closed. |
| `20261008032719_s47_consent_matrix_optional_per_use` | chat | `required_for_care` only for vitals and documents; reproductive, mental health and device data care cells are optional per use. |
| `20261008035104_s47_emergency_card_defaults` | chat | Card defaults and the "not shared" wording on every surface. |

Counts stated in the migration headers: 0 withdrawn matrix consents, 0 emergency-card field rows (S42 and S43 are unapplied), so no data conversion.

## Decided in chat after the first list (recorded, same rules)

1. The failing `no-other-readers` test: S44's `components/item-note.tsx` is allow-listed by name (one file, with a comment and a test that it queries nothing). Every other file stays covered.
2. Consent matrix: required for care applies ONLY to vitals and documents. Reproductive, mental health and device data are optional per use: asked when the feature is first used (`feature_consent_state`, `grantFeatureConsentAction`), withdrawable, withdrawing stops that feature only. The care-access functions still never read the matrix (the S42 proof scans their source).
3. Emergency card: on by default blood group and genotype, allergies, current medicines, emergency contacts; off until chosen conditions or diagnoses, reproductive health, mental health. The live link (database wrapper), printed page, QR text and the phone's offline card all use one list; hidden reads "not shared".
4. Recorded, no code: AI-018 and AI-019 stay off (AI-018 test accounts first, AI-019 after a quarter of real report data). Lab code mappings: the lab liaison proposes, the CMO confirms (as built, S44).

## Things worth knowing

- The "elevated" risk band flag is named `elevatedRisk`, not "high CV risk": a key containing `hcv` is rejected by the INV-04 honesty regex ("highCv" contains "hcv"). The proof caught it.
- A "borderline" blood pressure is now only possible when the target is stricter than the band (130/80 target, 134/84 reading). With the default 140/90 target, 134/84 is on target.
- The scheduler's cervical rule is HPV DNA by method, but the calendar item is still the `cervical_smear` screen type: no new catalogue row was invented. The HPV DNA sale stays behind `hpv_dna_enabled`.
- Not decided here: see `docs/OPEN-QUESTIONS.md`, section S47.

## Review fixes (2026-10-08), what was edited and what was added

Edited IN PLACE, because the migration was created on this branch and never applied: `20261008030051` (go-live: the two research export attestation pairs the first restatement dropped are back, and a proof compares all 16 live pairs), `20261008012315` (the report collector now skips rejected BP readings; condition matching is by ICD-10 prefix or an anchored name with an exclusion list, in the unsigned settings), `20261008014742` (anti-HBs immunity needs a released, non-withdrawn, non-superseded result and is taken back when that result is withdrawn or replaced), `20261008023634` (a hand-over row first seen after its grace has run out gets a 30 day notice window instead of ending silently; Africa/Lagos dates), `20261008035104` (emergency card medicines honour the reproductive and mental health switches).

Added as NEW migrations, because they restate functions from the integration branch: `20261008044519_s47b_review_fixes` (phone key, anonymiser, INV-04 variants and legacy branches, FHIR adolescent gate) and `20261008051236_s47c_report_build_backoff_and_precheck`.

Things worth knowing: the FHIR export classifies by name (a condition word or a medicine word), so it is best effort and says so in `limits`; a staff reader is not held to the guardian gate. The build route now asks `health_report_build_allowed` before any AI draft. The report no longer tells a shared copy or a caregiver why a target is lower, only the number.

