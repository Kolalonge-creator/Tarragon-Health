/**
 * Versioned clinical rulesets (WHO HEARTS) + device validation rules, plus the clinical
 * accountability model (build spec v3 §4, §5.4, §7.1). Pure data/validation helpers -- no I/O.
 *
 * accountability.ts is built at M2 (the note signature block a patient reads under either
 * accountability model). Device validation (packages/protocol/devices.ts) is still M4 and the
 * who_hearts ruleset shape is still M5 -- both remain stubs, do not build ahead of their
 * milestone. The M1 DB migrations already encode the v0-provisional classification fallback as
 * a Postgres trigger (private.classify_reading_conservatively) -- packages/triage will hold the
 * real, unit-testable TypeScript mirror once M5 needs it.
 */
export * from "./accountability";
