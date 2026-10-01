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
  "This check shows the prescription and its current state. It does not show who it was issued to: check the person in front of you against the name on the paper. It does not record that you have dispensed it.";

export function isProof(value: unknown): value is PublicPrescriptionProof {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    (v.status === "active" || v.status === "superseded" || v.status === "expired" || v.status === "cancelled") &&
    typeof v.rx_number === "string" &&
    typeof v.drug_name === "string"
  );
}

/** The first row of the function's result, or null for "nothing": a malformed response is treated as not found, never as valid. */
export function parseProof(data: unknown): PublicPrescriptionProof | null {
  const row = Array.isArray(data) ? data[0] : data;
  return isProof(row) ? row : null;
}
