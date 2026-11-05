import { getProposedConfig } from "@tarragon/shared";

/**
 * T2-11c (founder decision 2026-11-05): a patient can say "I've got this medicine" for their own signed prescription, for the many
 * pharmacies that will not scan the QR or record a supply. The rules live in the database (public.confirm_prescription_collected,
 * public.undo_prescription_collected); this file holds the wording, so every screen labels the supply as patient-reported the same way.
 *
 * Plain, educated copy and no em dashes (docs/BRAND_GUIDE.md).
 */

/** The fields of a pharmacy_order_dispenses row these helpers read. */
export interface SupplyRecordLike {
  source: "patient" | "pharmacy";
  recorded_via: string;
  dispensed_on: string;
  created_at: string;
  pharmacy_name: string | null;
  pharmacy_town?: string | null;
  withdrawn_at?: string | null;
  matched_dispense_id?: string | null;
  disputed_at?: string | null;
  /** T2-11d: who recorded it, for whom, and (for a caregiver) how they relate to the patient. */
  patient_id?: string | null;
  recorded_by?: string | null;
  reported_by_relationship?: string | null;
}

/** True when a caregiver, not the patient, recorded the confirmation. */
export function reportedByCaregiver(row: Pick<SupplyRecordLike, "patient_id" | "recorded_by" | "reported_by_relationship">): boolean {
  if (row.reported_by_relationship) return true;
  return !!row.recorded_by && !!row.patient_id && row.recorded_by !== row.patient_id;
}

function relationshipText(row: Pick<SupplyRecordLike, "reported_by_relationship">): string {
  const r = row.reported_by_relationship?.trim();
  return r ? r.toLowerCase() : "caregiver";
}

export const PATIENT_CONFIRMATION = "patient_confirmation";

/**
 * How long after confirming the patient may take it back. The database reads the same value from prescription_supply_config
 * (public.undo_prescription_collected); this mirrors it through the proposed-config registry, never a literal.
 */
export const UNDO_WINDOW_HOURS = (getProposedConfig("prescriptions.patient_supply_windows").value as { patient_undo_hours: number })
  .patient_undo_hours;

export function isPatientConfirmation(row: Pick<SupplyRecordLike, "recorded_via">): boolean {
  return row.recorded_via === PATIENT_CONFIRMATION;
}

/** A supply that counts against the prescription: mirrors private.dispense_counts_as_supply. */
export function countsAsSupply(row: SupplyRecordLike): boolean {
  if (row.source === "pharmacy") return !row.disputed_at;
  return isPatientConfirmation(row) && !row.withdrawn_at && !row.matched_dispense_id;
}

/** True while the patient's own confirmation can still be taken back. */
export function canUndoConfirmation(row: SupplyRecordLike, now: Date = new Date()): boolean {
  if (!isPatientConfirmation(row) || row.withdrawn_at || row.matched_dispense_id) return false;
  const age = now.getTime() - new Date(row.created_at).getTime();
  return age >= 0 && age < UNDO_WINDOW_HOURS * 60 * 60 * 1000;
}

function formatDay(isoDate: string): string {
  // a date column (YYYY-MM-DD) is a calendar day; read it at noon UTC so no time zone moves it to another day
  const d = /^\d{4}-\d{2}-\d{2}$/.test(isoDate) ? new Date(`${isoDate}T12:00:00Z`) : new Date(isoDate);
  return d.toLocaleDateString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", year: "numeric" });
}

function where(row: Pick<SupplyRecordLike, "pharmacy_name" | "pharmacy_town">): string {
  const parts = [row.pharmacy_name?.trim(), row.pharmacy_town?.trim()].filter((p): p is string => !!p);
  return parts.length ? ` at ${parts.join(", ")}` : "";
}

/** The care team's wording: "Patient says they collected it on 5 Nov 2026 at Corner Chemist, Ikeja". */
export function describeForCareTeam(row: SupplyRecordLike): string {
  if (!isPatientConfirmation(row)) {
    return `${formatDay(row.dispensed_on)}${row.pharmacy_name ? ` · ${row.pharmacy_name}` : ""}`;
  }
  const base = reportedByCaregiver(row)
    ? `The patient's ${relationshipText(row)} says it was collected on ${formatDay(row.dispensed_on)}${where(row)}`
    : `Patient says they collected it on ${formatDay(row.dispensed_on)}${where(row)}`;
  if (row.withdrawn_at) return `${base} (taken back)`;
  if (row.matched_dispense_id) return `${base} (since recorded by the pharmacy)`;
  return base;
}

/** The patient's own wording for their confirmation. */
export function describeForPatient(row: SupplyRecordLike): string {
  const base = reportedByCaregiver(row)
    ? `Your ${relationshipText(row)} told us this was collected on ${formatDay(row.dispensed_on)}${where(row)}`
    : `You told us you collected this on ${formatDay(row.dispensed_on)}${where(row)}`;
  if (row.withdrawn_at) return `${base}. You took this back.`;
  if (row.matched_dispense_id) return `${base}. The pharmacy has since recorded it too.`;
  return `${base}.`;
}

export type ConfirmOutcome =
  | "recorded"
  | "matched_pharmacy_record"
  | "already_recorded"
  | "duplicate"
  | "no_supply_available"
  | "not_active"
  | "invalid"
  | "not_found";

export const CONFIRM_OUTCOME_MESSAGE: Record<ConfirmOutcome, { ok: boolean; text: string }> = {
  recorded: {
    ok: true,
    text: `Thank you. This supply is now marked as collected on your prescription, so another pharmacy cannot fill it again. You can undo this for ${UNDO_WINDOW_HOURS} hours if you tapped it by mistake.`,
  },
  matched_pharmacy_record: {
    ok: true,
    text: "Thank you. The pharmacy had already recorded this supply, so we have noted that you received it.",
  },
  already_recorded: { ok: true, text: "This supply is already recorded on your prescription. Nothing more is needed." },
  duplicate: { ok: false, text: "You confirmed this a few minutes ago, so it was not recorded again." },
  no_supply_available: {
    ok: false,
    text: "Every supply on this prescription is already recorded. If that looks wrong, message your care team in the app.",
  },
  not_active: { ok: false, text: "This prescription has been replaced, stopped or has expired, so a collection cannot be recorded on it." },
  invalid: { ok: false, text: "Check the date: it cannot be in the future or before the prescription was signed." },
  not_found: { ok: false, text: "We could not find this prescription on your account." },
};

export function isConfirmOutcome(value: unknown): value is ConfirmOutcome {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(CONFIRM_OUTCOME_MESSAGE, value);
}

export type UndoOutcome = "undone" | "window_passed" | "confirmed_by_pharmacy" | "not_found";

export const UNDO_OUTCOME_MESSAGE: Record<UndoOutcome, string> = {
  undone: "Taken back. This supply is available on your prescription again.",
  window_passed: `This can only be undone within ${UNDO_WINDOW_HOURS} hours. If it is wrong, message your care team in the app.`,
  confirmed_by_pharmacy: "A pharmacy has since recorded this supply, so it cannot be undone here. If it is wrong, message your care team in the app.",
  not_found: "This could not be undone. It may already have been taken back.",
};

export function isUndoOutcome(value: unknown): value is UndoOutcome {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(UNDO_OUTCOME_MESSAGE, value);
}

/** What the anonymous QR page says about patient-reported supplies. No patient identity: dates only. */
export function describePatientReportForPharmacist(proof: {
  self_reported_supplies?: number | null;
  last_self_report_on?: string | null;
  last_self_report_pharmacy?: string | null;
  self_report_awaiting_pharmacy?: boolean | null;
}): string | null {
  if (!proof.self_reported_supplies || proof.self_reported_supplies < 1) return null;
  const when = proof.last_self_report_on ? ` on ${formatDay(proof.last_self_report_on)}` : "";
  const where = proof.last_self_report_pharmacy?.trim() ? ` at ${proof.last_self_report_pharmacy.trim()}` : "";
  const head = `Collected, as reported by the patient or their caregiver${when}${where}. No pharmacy recorded this supply.`;
  return proof.self_report_awaiting_pharmacy
    ? `${head} Only the pharmacy that supplied it may record it below, by ticking "We supplied this". Anyone else: do not dispense.`
    : head;
}

/** The checkbox a pharmacist ticks to say they supplied the collection the patient reported. */
export function suppliedReportedCollectionLabel(proof: { last_self_report_on?: string | null; last_self_report_pharmacy?: string | null }): string {
  const when = proof.last_self_report_on ? ` on ${formatDay(proof.last_self_report_on)}` : "";
  const where = proof.last_self_report_pharmacy?.trim() ? ` (the patient named ${proof.last_self_report_pharmacy.trim()})` : "";
  return `We supplied this${when}${where}. This is the collection the patient reported, not a new supply.`;
}
