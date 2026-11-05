/**
 * What the no-login prescription check page says, kept out of the page so it is unit-tested.
 *
 * The function behind it (`verify_prescription_public`) returns proof only: never a patient name, date of
 * birth, number or contact detail. So the page cannot tell a pharmacist WHO the prescription is for; it
 * says so plainly and tells them to check the person's identity against the paper.
 */

export type PublicPrescriptionStatus = "active" | "superseded" | "expired" | "cancelled" | "controlled_medicine";

export interface PublicPrescriptionProof {
  status: PublicPrescriptionStatus;
  rx_number: string;
  drug_name: string;
  dose: string | null;
  frequency: string | null;
  quantity: string | null;
  duration_days: number | null;
  repeats_allowed: number;
  repeats_used: number;
  repeats_remaining: number;
  supplies_dispensed: number;
  supplies_permitted: number;
  supply_available: boolean;
  last_supplied_on: string | null;
  signed_at: string;
  expires_at: string | null;
  version: number;
  prescriber_name: string;
  prescriber_credential: string | null;
  /** T2-11c: supplies the patient reported themselves (no pharmacy recorded them). Optional so an older response still parses. */
  self_reported_supplies?: number;
  last_self_report_on?: string | null;
  /** A patient report from the last 7 days that a pharmacy recording now would confirm rather than add to. */
  self_report_awaiting_pharmacy?: boolean;
}

export const TOKEN_PATTERN = /^[0-9a-f]{64}$/;

export interface StatusPresentation {
  headline: string;
  tone: "good" | "bad";
  guidance: string;
}

export function presentStatus(status: PublicPrescriptionStatus): StatusPresentation {
  switch (status) {
    case "active":
      return {
        headline: "Genuine and current",
        tone: "good",
        guidance: "This prescription was issued by TarragonHealth and is valid today.",
      };
    case "superseded":
      return {
        headline: "Replaced by a newer prescription",
        tone: "bad",
        guidance: "Do not dispense from this one. Ask the patient for their current prescription.",
      };
    case "expired":
      return {
        headline: "Expired",
        tone: "bad",
        guidance: "This prescription is past its valid-until date. Do not dispense. The patient can ask their care team to renew it.",
      };
    case "cancelled":
      return {
        headline: "Stopped by the prescriber",
        tone: "bad",
        guidance: "This prescription has been stopped. Do not dispense.",
      };
    case "controlled_medicine":
      // OQ-276: the same list the counter and signing use. The prescription is genuine; it is just not supplied through Tarragon.
      return {
        headline: "Controlled medicine: not supplied through Tarragon",
        tone: "bad",
        guidance: "This medicine is on the controlled medicines list, and Tarragon does not supply controlled medicines. Nothing can be recorded here. Do not dispense it against this prescription.",
      };
  }
}

export const NOT_FOUND_MESSAGE =
  "We could not find a prescription for this code. It may be mistyped, or the document may not have been issued by TarragonHealth. Do not dispense on the strength of this document alone.";

export const RATE_LIMITED_MESSAGE = "Too many checks from this connection. Please wait a minute and try again.";

export const IDENTITY_NOTICE =
  "This check shows the prescription and its current state. It does not show who it was issued to: check the person in front of you against the name on the paper.";

export type SupplyOutcome =
  | "recorded"
  | "duplicate"
  | "no_supply_available"
  | "not_active"
  | "controlled_medicine"
  | "not_found"
  | "invalid"
  | "rate_limited"
  | "error";

export const SUPPLY_OUTCOME_MESSAGE: Record<SupplyOutcome, { tone: "good" | "bad"; text: string }> = {
  recorded: { tone: "good", text: "Recorded. This supply is now on the prescription. Thank you." },
  duplicate: { tone: "bad", text: "A supply was recorded for this prescription a few minutes ago, so this was not recorded again." },
  no_supply_available: { tone: "bad", text: "No supply is available on this prescription now, so nothing was recorded. Do not dispense." },
  not_active: { tone: "bad", text: "This prescription can no longer be supplied. Nothing was recorded. Do not dispense." },
  controlled_medicine: { tone: "bad", text: "This medicine is on the controlled medicines list, and Tarragon does not supply controlled medicines. Nothing was recorded. Do not dispense it against this prescription." },
  not_found: { tone: "bad", text: "We could not find this prescription, so nothing was recorded." },
  invalid: { tone: "bad", text: "Enter the pharmacy name, the pharmacist's name and the pharmacist's registration number." },
  rate_limited: { tone: "bad", text: "Too many attempts from this connection. Please wait a while and try again." },
  error: { tone: "bad", text: "That could not be recorded just now. Please try again shortly." },
};

export function isSupplyOutcome(value: unknown): value is SupplyOutcome {
  return typeof value === "string" && value in SUPPLY_OUTCOME_MESSAGE;
}

/** What the supply panel says for an ACTIVE prescription, from the three numbers the check returns. */
export function describeSupply(
  proof: Pick<PublicPrescriptionProof, "supplies_dispensed" | "supplies_permitted" | "supply_available" | "repeats_allowed" | "repeats_remaining" | "self_report_awaiting_pharmacy">,
): string {
  if (proof.supply_available) return "A supply is available on this prescription.";
  if (proof.self_report_awaiting_pharmacy) {
    return "No further supply is available. Record a supply below only if your pharmacy is the one that supplied the collection the patient reported.";
  }
  if (proof.repeats_remaining > 0) {
    return "No supply is available now. The patient can request their next supply in the TarragonHealth app, and a doctor has to approve it.";
  }
  return "Every supply of this prescription has been dispensed. Do not dispense again.";
}

export function isProof(value: unknown): value is PublicPrescriptionProof {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    (v.status === "active" || v.status === "superseded" || v.status === "expired" || v.status === "cancelled" || v.status === "controlled_medicine") &&
    typeof v.rx_number === "string" &&
    typeof v.drug_name === "string" &&
    typeof v.supplies_dispensed === "number" &&
    typeof v.supply_available === "boolean"
  );
}

/** The first row of the function's result, or null for "nothing": a malformed response is treated as not found, never as valid. */
export function parseProof(data: unknown): PublicPrescriptionProof | null {
  const row = Array.isArray(data) ? data[0] : data;
  return isProof(row) ? row : null;
}

export { stripDoctorTitle } from "./doctor-name";

/**
 * T2-11b (safety case HZ-RX-06/11): a pharmacist without a camera types the Rx number and the verification code printed on the form.
 * Only the shape is checked here; the database (public.verify_prescription_by_code) does the lookup and locks a number after ten wrong
 * codes in an hour. Spaces are dropped and letters upper-cased, so "trg-rx-2026-000123" and " ab12cd" are read as printed.
 */
export function normaliseRxLookup(rxNumber: string, code: string): { rxNumber: string; code: string } | null {
  const rx = rxNumber.replace(/\s+/g, "").toUpperCase();
  const c = code.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  if (!/^[A-Z0-9-]{4,40}$/.test(rx) || !/^[A-Z0-9]{4,12}$/.test(c)) return null;
  return { rxNumber: rx, code: c };
}

export type CodeLookupNotice = "invalid" | "not_found" | "rate_limited" | "locked" | "unavailable";

export const CODE_LOOKUP_MESSAGE: Record<CodeLookupNotice, string> = {
  invalid: "That does not look like an Rx number and code. Type them exactly as printed on the prescription.",
  not_found: "No prescription matches that Rx number and code. Check both against the printed form, or call TarragonHealth.",
  rate_limited: "Too many checks from this connection. Please wait a few minutes and try again.",
  locked: "This Rx number has had too many wrong codes in the last hour, so it is locked for now. Scan the QR code instead, or call TarragonHealth.",
  unavailable: "The check is not available just now. Please try again shortly, or call TarragonHealth.",
};

export function isCodeLookupNotice(value: unknown): value is CodeLookupNotice {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(CODE_LOOKUP_MESSAGE, value);
}
