# DUP-1 research note: duplicate lab values

Method: read the live definitions of `private.biomarker_points`, `private.hr_biomarker_points`, `private.guard_lab_result` and `private.lab_analyte_readings_current` (Supabase `pg_get_functiondef`, 2026-10-20), the S43/S44/S46/S47/S47b migrations, and both writers of `lab_analyte_readings` (`confirm_lab_result_extraction`, the Nigerian ingestion engine filer).

Findings
- Two stores of lab values: `lab_result_items` (released through `lab_results`, held until a clinician releases) and `lab_analyte_readings` (staff-filed). No bridge writes one from the other. Readers union them.
- Live `hr_biomarker_points` and `biomarker_points` read the base table `public.lab_analyte_readings`, not `private.lab_analyte_readings_current`, so a corrected-away reading also counted (fixed in the same migration).
- `lab_results.received_at` is immutable (guard); a result can only be inserted held, then released by a clinician, so links written on item insert pair before release and readers apply the release filter at read time.
- `private.lab_analyte_readings_current` was created before `sensitive_positive` was added to the table, so the view lacks that column; the matcher reads the base table for it and uses the code-based exclusion `private.report_excluded_code` as the INV-04 guard.
- Withdrawal is one-way (`lab_result_withdraw_invalid`), which is why a duplicate must not delete the paper row.
- No published Nigerian standard fixes a duplicate window or tolerance; the numbers are PROPOSED engineering defaults for the CMO or lab liaison to confirm (OQ-DUP-1-1). Units are never converted anywhere on this platform (S43 rule), so a unit difference is a disagreement.
