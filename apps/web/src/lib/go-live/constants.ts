/**
 * Plain constants for the go-live guards, with no imports at all: client components (the booking card) read them, and they must not
 * drag a server-only module (model.ts uses node:crypto) into the browser bundle.
 */
export const GUARD_KEYS = [
  "clinical_operations_enabled",
  "on_call_cover_ok",
  "lab_booking_enabled",
  "prescribing_enabled",
  "scribe_enabled",
  "payouts_enabled",
  "public_signup_enabled",
  // Community groups (decisions COM-1 to COM-10). Born off; the Chief Medical Officer switches it on from the go-live page once its conditions are met.
  "community",
  // The S07x, S08x and S09x guards (migrations 20261013181946 and later). They were missing here, so the dashboard showed them while this list
  // refused attest_go_live_condition and set_go_live_guard before the database was reached (found 2026-10-13: the C4 cuff wording attestation
  // could not be recorded). research_export_enabled and symptom_checker_enabled had the same gap; both are listed now (2026-10-15).
  "wallet_pass",
  "home_bp_programme",
  "bp_pattern_flag",
  "prn_limits",
  // S07y: the clinician-only cuff flag and the neutral patient line. Both born off.
  "cuff_check_flag",
  "cuff_visit_prompt",
  "symptom_checker_enabled",
  "research_export_enabled",
  // S48a: private GPS route recording (5.7). Born off; no UI records a route yet, so this only gates the database insert policy.
  "private_route_recording",
  // S50b: the supervised low-carbohydrate programme for type 2 diabetes. Born off; never marketed (S50-2).
  "low_carb_t2d_programme",
] as const;
export type GuardKey = (typeof GUARD_KEYS)[number];

/** The guard the symptom checker is wired to (INV-14, F1). */
export const SYMPTOM_CHECKER_GUARD: GuardKey = "symptom_checker_enabled";

/** The guard the consultation flow is wired to (INV-14). */
export const CONSULTATIONS_GUARD: GuardKey = "clinical_operations_enabled";
