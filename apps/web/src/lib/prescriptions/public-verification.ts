/**
 * What the no-login prescription check page says, kept out of the page so it is unit-tested.
 *
 * The function behind it (`verify_prescription_public`) returns proof only: never a patient name, date of
 * birth, number or contact detail. So the page cannot tell a pharmacist WHO the prescription is for; it
 * says so plainly and tells them to check the person's identity against the paper.
 */

export type PublicPrescriptionStatus = "active" | "superseded" | "expired" | "cancelled";

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
  | "not_found"
  | "invalid"
  | "rate_limited"
  | "error";

export const SUPPLY_OUTCOME_MESSAGE: Record<SupplyOutcome, { tone: "good" | "bad"; text: string }> = {
  recorded: { tone: "good", text: "Recorded. This supply is now on the prescription. Thank you." },
  duplicate: { tone: "bad", text: "A supply was recorded for this prescription a few minutes ago, so this was not recorded again." },
  no_supply_available: { tone: "bad", text: "No supply is available on this prescription now, so nothing was recorded. Do not dispense." },
  not_active: { tone: "bad", text: "This prescription can no longer be supplied. Nothing was recorded. Do not dispense." },
  not_found: { tone: "bad", text: "We could not find this prescription, so nothing was recorded." },
  invalid: { tone: "bad", text: "Enter the pharmacy name and the pharmacist's name (at least two letters each)." },
  rate_limited: { tone: "bad", text: "Too many attempts from this connection. Please wait a while and try again." },
  error: { tone: "bad", text: "That could not be recorded just now. Please try again shortly." },
};

export function isSupplyOutcome(value: unknown): value is SupplyOutcome {
  return typeof value === "string" && value in SUPPLY_OUTCOME_MESSAGE;
}

/** What the supply panel says for an ACTIVE prescription, from the three numbers the check returns. */
export function describeSupply(proof: Pick<PublicPrescriptionProof, "supplies_dispensed" | "supplies_permitted" | "supply_available" | "repeats_allowed" | "repeats_remaining">): string {
  if (proof.supply_available) return "A supply is available on this prescription.";
  if (proof.repeats_remaining > 0) {
    return "No supply is available now. The patient can request their next supply in the TarragonHealth app, and a doctor has to approve it.";
  }
  return "Every supply of this prescription has been dispensed. Do not dispense again.";
}

export function isProof(value: unknown): value is PublicPrescriptionProof {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    (v.status === "active" || v.status === "superseded" || v.status === "expired" || v.status === "cancelled") &&
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
