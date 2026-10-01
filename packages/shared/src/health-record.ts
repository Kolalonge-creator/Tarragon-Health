/**
 * v5 health-record vocabulary over the live tables (S05, docs/design/S05.md).
 *
 * The live schema keeps its own names (vitals_readings, symptoms, medication_logs, clinical_encounter_notes, ...) and exposes the
 * v5 names as security_invoker views (observations, symptom_reports, dose_events, notes, ...). This module is the thin shared
 * mapping so app code can speak v5 without a second source of truth. Every constant here mirrors a database rule; the
 * database stays the enforcer and these only keep the clients honest.
 */
import { Constants, type Enums } from "./database.types";

/** v5 provenance (4.3). Stored as `public.record_source`; views map the older per-table source enums onto it. */
export const RECORD_SOURCES = ["patient", "device", "ussd", "clinician", "partner", "system"] as const satisfies readonly Enums<"record_source">[];
export type RecordSource = (typeof RECORD_SOURCES)[number];

export const PRESCRIPTION_STATES = ["draft", "signed", "sent", "dispensed", "cancelled"] as const satisfies readonly Enums<"prescription_state">[];
export type PrescriptionState = (typeof PRESCRIPTION_STATES)[number];

/** INV-02: forward only, cancelled is terminal. Mirrors private.enforce_prescription_rules. */
const PRESCRIPTION_NEXT: Record<PrescriptionState, readonly PrescriptionState[]> = {
  draft: ["signed", "cancelled"],
  signed: ["sent", "cancelled"],
  sent: ["dispensed", "cancelled"],
  dispensed: [],
  cancelled: [],
};
export function canTransitionPrescription(from: PrescriptionState, to: PrescriptionState): boolean {
  return PRESCRIPTION_NEXT[from].includes(to);
}
/** INV-02: states that require a signature. Mirrors the CHECK prescriptions_signed_before_send. */
export function prescriptionStateRequiresSignature(state: PrescriptionState): boolean {
  return state !== "draft" && state !== "cancelled";
}

/** The observation `type` v5 uses for each live `vital_type` (view `observations`). New vital types pass through unchanged. */
export function observationTypeFromVitalType(vitalType: Enums<"vital_type">): string {
  if (vitalType === "blood_pressure") return "bp";
  if (vitalType === "waist_circumference") return "waist";
  return vitalType;
}
const OBSERVATION_TO_VITAL: Record<string, Enums<"vital_type">> = {
  bp: "blood_pressure",
  waist: "waist_circumference",
};
/** Inverse of observationTypeFromVitalType; null when the type is not a known live vital type. */
export function vitalTypeFromObservationType(type: string): Enums<"vital_type"> | null {
  const mapped = OBSERVATION_TO_VITAL[type] ?? type;
  return (Constants.public.Enums.vital_type as readonly string[]).includes(mapped) ? (mapped as Enums<"vital_type">) : null;
}

/**
 * Sections of `public.read_patient_chart_audited` (INV-10) and the care-access category each one is gated by. Mirrors the CASE in
 * the function. reproductive_health is deliberately not a section: break-glass never reaches it and its reads need their own
 * category-scoped path.
 */
export const CHART_SECTIONS = [
  "vitals", "symptoms", "medications", "dose_events", "prescriptions", "conditions",
  "allergies", "family_history", "documents", "notes", "referrals",
] as const;
export type ChartSection = (typeof CHART_SECTIONS)[number];

export const CHART_SECTION_CATEGORY: Record<ChartSection, Enums<"care_access_category">> = {
  vitals: "vitals_readings",
  symptoms: "medical_history",
  medications: "medications",
  dose_events: "medications",
  prescriptions: "medications",
  conditions: "medical_history",
  allergies: "medical_history",
  family_history: "medical_history",
  documents: "medical_history",
  notes: "appointments_care_plan",
  referrals: "appointments_care_plan",
};

/** The audited reads refuse a reason shorter than this (private.audit_patient_read). */
export const AUDITED_READ_MIN_REASON_LENGTH = 10;
export function isValidAuditReason(reason: string | null | undefined): boolean {
  return typeof reason === "string" && reason.trim().length >= AUDITED_READ_MIN_REASON_LENGTH;
}
