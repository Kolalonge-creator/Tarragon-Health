import type { PublicPrescriptionStatus } from "./public-verification";

/**
 * The prescription desk: what a TarragonHealth staff member reads out to a pharmacist who phoned about a prescription.
 * The database function (public.desk_verify_prescription) never returns the patient's name; the pharmacist reads the name off the paper,
 * the staff member types it in, and the function only says whether it matches.
 */

export interface DeskLookup {
  found: true;
  status: PublicPrescriptionStatus;
  rx_number: string;
  drug_name: string;
  dose: string | null;
  frequency: string | null;
  quantity: string | null;
  duration_days: number | null;
  repeats_allowed: number;
  supplies_dispensed: number;
  supplies_permitted: number;
  supply_available: boolean;
  last_supplied_on: string | null;
  signed_at: string;
  expires_at: string | null;
  version: number;
  prescriber_name: string;
  prescriber_credential: string | null;
  name_checked: boolean;
  name_matches: boolean;
}

export type DeskResult = { kind: "found"; lookup: DeskLookup } | { kind: "not_found" } | { kind: "error"; message: string };

const STATUSES = new Set(["active", "superseded", "expired", "cancelled"]);

/** The first row of the function's answer. A malformed answer is an error, never a valid prescription. */
export function parseDeskResult(data: unknown): DeskResult {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object") return { kind: "error", message: "The desk lookup returned nothing usable." };
  const r = row as Record<string, unknown>;
  if (r.found === false) return { kind: "not_found" };
  if (r.found !== true || typeof r.status !== "string" || !STATUSES.has(r.status) || typeof r.rx_number !== "string" || typeof r.drug_name !== "string") {
    return { kind: "error", message: "The desk lookup returned an unexpected answer." };
  }
  return { kind: "found", lookup: row as DeskLookup };
}

export const NOT_FOUND_ON_DESK =
  "No prescription matches that Rx number and verification code. Ask the pharmacist to read both again from the paper. If they still do not match, tell them not to dispense on the strength of that document.";

/** What to say about the name the pharmacist read from the paper. */
export function describeNameCheck(lookup: Pick<DeskLookup, "name_checked" | "name_matches">): { tone: "good" | "bad" | "neutral"; text: string } {
  if (!lookup.name_checked) {
    return { tone: "neutral", text: "Ask the pharmacist to read the patient's name from the paper, type it above and check again." };
  }
  return lookup.name_matches
    ? { tone: "good", text: "The name matches the patient this prescription was issued to." }
    : { tone: "bad", text: "The name does NOT match the patient this prescription was issued to. Tell the pharmacist not to dispense and to check the person's identity." };
}

/** Whether the staff member may record a supply for this lookup: only an active prescription with a supply available. */
export function canRecordFromDesk(lookup: Pick<DeskLookup, "status" | "supply_available">): boolean {
  return lookup.status === "active" && lookup.supply_available;
}

/** The sentence to read back to the pharmacist. */
export function deskVerdict(lookup: Pick<DeskLookup, "status" | "supply_available" | "name_checked" | "name_matches">): string {
  if (lookup.status !== "active") {
    const why = { superseded: "has been replaced by a newer prescription", expired: "has expired", cancelled: "has been stopped by the prescriber" }[lookup.status];
    return `Do not dispense: this prescription ${why}.`;
  }
  if (lookup.name_checked && !lookup.name_matches) return "Do not dispense: the name does not match.";
  if (!lookup.supply_available) return "Do not dispense: every available supply has already been dispensed.";
  return lookup.name_checked
    ? "This prescription is genuine, valid, the name matches and a supply is available."
    : "This prescription is genuine, valid and a supply is available. The patient's name has not been checked yet.";
}
