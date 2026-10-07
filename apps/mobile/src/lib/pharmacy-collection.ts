import type { MessageKey } from "@tarragon/i18n";
import { supabase } from "./supabase";
import { isOfflineError } from "./care-changes";

/**
 * The patient's side of pharmacy collection (S28): the same database functions as the web app. Sending a prescription
 * shares her record with a pharmacy, so it needs a connection and is NEVER queued: an offline send shows a plain message
 * and nothing is kept on the phone. Collection only; no delivery field is read anywhere.
 */

export type Stock = "in_stock" | "low_stock" | "unavailable" | "unknown";
export type PharmacyOption = {
  id: string;
  name: string;
  place: string;
  stock: Stock;
  isPreferred: boolean;
};
export type MyPharmacy = { sent: false } | { sent: true; state: string; pharmacyName: string; code: string | null; needsOther: boolean };
export type CollectionPrescription = {
  id: string;
  state: "signed" | "sent" | "dispensed";
  medicines: string[];
  pharmacy: MyPharmacy | null;
  /** Collected, and the medicine still permits another supply (a repeat): it is sent again as a new send. */
  canRepeat: boolean;
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const STOCKS: readonly string[] = ["in_stock", "low_stock", "unavailable", "unknown"];

export function parseOptions(data: unknown): PharmacyOption[] | null {
  if (!Array.isArray(data)) return null;
  const out: PharmacyOption[] = [];
  for (const row of data) {
    if (!isObj(row)) return null;
    const { pharmacy_partner_id: id, name, area, city, stock, is_preferred } = row;
    if (typeof id !== "string" || typeof name !== "string" || typeof stock !== "string" || !STOCKS.includes(stock) || typeof is_preferred !== "boolean") return null;
    out.push({
      id, name, stock: stock as Stock, isPreferred: is_preferred,
      place: [area, city].filter((p): p is string => typeof p === "string" && p !== "").join(", "),
    });
  }
  return out;
}

export function parseMine(data: unknown): MyPharmacy | null {
  if (!isObj(data)) return null;
  if (data.sent === false) return { sent: false };
  if (data.sent !== true || typeof data.state !== "string" || typeof data.pharmacy_name !== "string" || typeof data.needs_other_pharmacy !== "boolean") return null;
  const code = typeof data.collection_code === "string" ? data.collection_code : null;
  return { sent: true, state: data.state, pharmacyName: data.pharmacy_name, code, needsOther: data.needs_other_pharmacy };
}

export function errorKey(message: string | null | undefined, offline: boolean): MessageKey {
  if (offline) return "pharmacy.error.offline";
  const m = message ?? "";
  if (m.includes("consent_required")) return "pharmacy.error.consent";
  if (m.includes("pharmacy_not_available") || m.includes("same_pharmacy")) return "pharmacy.error.unavailable";
  if (m.includes("prescription_not_current")) return "pharmacy.error.not_current";
  if (m.includes("prescription_not_waiting") || m.includes("prescription_not_sendable")) return "pharmacy.error.not_waiting";
  return "pharmacy.error";
}

export function medicineNames(items: unknown): string[] {
  if (!Array.isArray(items)) return [];
  return items.flatMap((i) => (isObj(i) && typeof i.drug_name === "string" ? [i.drug_name] : []));
}

export type LoadResult = { ok: true; available: boolean; prescriptions: CollectionPrescription[] } | { ok: false; offline: boolean };

/**
 * A prescription waiting at a pharmacy, or already collected, is always shown (a code she holds must stay visible and
 * withdrawable, even if collection is later switched off). One not yet sent is offered only while collection is available AND
 * it is still current: an amended or stopped medicine leaves its old prescription signed, and offering it would send a stale
 * dose. A failed or unreadable read is reported, never turned into an empty list.
 */
export async function loadCollection(): Promise<LoadResult> {
  const avail = await supabase.rpc("pharmacy_collection_available");
  if (avail.error) return { ok: false, offline: isOfflineError(avail.error) };

  const { data, error } = await supabase.rpc("my_collection_prescriptions");
  if (error) return { ok: false, offline: isOfflineError(error) };
  if (!Array.isArray(data)) return { ok: false, offline: false };

  const rows: CollectionPrescription[] = [];
  for (const row of data) {
    if (!isObj(row) || typeof row.prescription_id !== "string" || typeof row.is_current !== "boolean" || typeof row.supplies_remaining !== "number") return { ok: false, offline: false };
    const state = row.state;
    if (state !== "signed" && state !== "sent" && state !== "dispensed") return { ok: false, offline: false };
    // already supplied elsewhere (QR check or phone desk): nothing left to send, so not offered
    if (state === "signed" && !(avail.data === true && row.is_current && row.supplies_remaining > 0)) continue;
    let pharmacy: MyPharmacy | null = null;
    if (state !== "signed") {
      const mine = await supabase.rpc("my_prescription_pharmacy", { p_prescription: row.prescription_id });
      if (mine.error) return { ok: false, offline: isOfflineError(mine.error) };
      pharmacy = parseMine(mine.data);
      if (!pharmacy) return { ok: false, offline: false };
    }
    const canRepeat = state === "dispensed" && avail.data === true && row.is_current && row.supplies_remaining > 0;
    rows.push({ id: row.prescription_id, state, medicines: medicineNames(row.items), pharmacy, canRepeat });
  }
  return { ok: true, available: avail.data === true, prescriptions: rows };
}

export async function loadOptions(prescriptionId: string): Promise<{ ok: true; options: PharmacyOption[] } | { ok: false; key: MessageKey }> {
  if (!prescriptionId) return { ok: false, key: "pharmacy.error" };
  const { data, error } = await supabase.rpc("pharmacies_for_prescription", { p_prescription: prescriptionId });
  if (error) return { ok: false, key: errorKey(error.message, isOfflineError(error)) };
  const options = parseOptions(data);
  return options ? { ok: true, options } : { ok: false, key: "pharmacy.error" };
}

export type SendOutcome = { ok: true; code: string; pharmacyName: string } | { ok: false; key: MessageKey };

export async function sendToPharmacy(kind: "send" | "reroute", prescriptionId: string, partnerId: string, consent: boolean): Promise<SendOutcome> {
  if (!prescriptionId || !partnerId) return { ok: false, key: "pharmacy.error" };
  // The tick is the consent: never send a missing one on as true.
  if (consent !== true) return { ok: false, key: "pharmacy.error.consent" };
  const args = { p_prescription: prescriptionId, p_partner: partnerId, p_consent: true };
  const { data, error } =
    kind === "send" ? await supabase.rpc("send_prescription_to_pharmacy", args) : await supabase.rpc("reroute_prescription_pharmacy", args);
  if (error) return { ok: false, key: errorKey(error.message, isOfflineError(error)) };
  if (!isObj(data) || typeof data.collection_code !== "string" || data.collection_code.length !== 8 || typeof data.pharmacy_name !== "string") {
    return { ok: false, key: "pharmacy.error" };
  }
  return { ok: true, code: data.collection_code, pharmacyName: data.pharmacy_name };
}

/** "Take it back": consent to share is revocable. Needs a connection; nothing is queued. */
export async function withdrawFromPharmacy(prescriptionId: string): Promise<{ ok: true; key: MessageKey } | { ok: false; key: MessageKey }> {
  if (!prescriptionId) return { ok: false, key: "pharmacy.error" };
  const { data, error } = await supabase.rpc("withdraw_prescription_from_pharmacy", { p_prescription: prescriptionId });
  if (error) return { ok: false, key: errorKey(error.message, isOfflineError(error)) };
  if (!isObj(data) || data.ok !== true) return { ok: false, key: "pharmacy.error" };
  return { ok: true, key: "pharmacy.withdraw.done" };
}
