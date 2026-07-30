/**
 * Classification engine -- pure functions, no I/O, no database access, fully unit-testable.
 * Build spec v3 §7. classify(reading, patientContext, ruleset) -> { classification, rule_fired }.
 *
 * Not yet built (M5). The M1 database migrations already enforce invariant I2 (every reading
 * gets exactly one triage_classifications row) via a Postgres trigger using a hardcoded
 * v0-provisional "everything needs_review" fallback -- this package replaces that trigger's
 * logic with the real, clinician-approved WHO HEARTS thresholds once §7.1's 200-reading
 * golden file exists, without changing I2's guarantee.
 */
export {};
