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
] as const;
export type GuardKey = (typeof GUARD_KEYS)[number];

/** The guard the consultation flow is wired to (INV-14). */
export const CONSULTATIONS_GUARD: GuardKey = "clinical_operations_enabled";
