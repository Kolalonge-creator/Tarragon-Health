import { getProposedConfig } from "@tarragon/shared";
import { supabase } from "./supabase";

/**
 * Collecting medicines from a pharmacy, on the phone (S28e, OQ-277; the web page is /patient/pharmacy/collect). Every rule lives in the database:
 * only the patient (or someone she gave the pharmacy permission) can choose, only a verified licensed pharmacy is offered, the code is checked and locked
 * there, and the go-live guard decides whether any of it is open. This file only reads the answers and sends the patient's choice. Collection only: no
 * delivery, no payment (she pays the pharmacy), no prices, no chat.
 *
 * The functions are not in the generated database types yet, so the client is used through a narrow, explicit call shape rather than `any`.
 */
type RpcError = { message?: string; code?: string } | null;
type Rpc = (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: RpcError }>;
const rpc: Rpc = (fn, args) => (supabase as unknown as { rpc: Rpc }).rpc(fn, args);

/** The most prescriptions sent together. Read from the versioned configuration pharmacy.collection_rules (max_items_per_visit); the database refuses more. */
export const MAX_VISIT_ITEMS: number = (() => {
  const v = (getProposedConfig("pharmacy.collection_rules").value as unknown as { max_items_per_visit?: number }).max_items_per_visit;
  // a missing key is a drift between the registry and the database, so it fails loudly here (and in the drift test), never as "no limit"
  if (typeof v !== "number" || v < 2) throw new Error("pharmacy.collection_rules is missing max_items_per_visit");
  return v;
})();

export interface WaitingItem {
  prescriptionId: string;
  medicine: string;
  /** signed = not sent yet; sent = with a pharmacy, waiting to be collected. */
  state: "signed" | "sent";
  visitId: string | null;
  pharmacyName: string | null;
  locationName: string | null;
  address: string | null;
  code: string | null;
  codeExpiresAt: string | null;
  locked: boolean;
  expired: boolean;
  /** When the pharmacy said it has this. A plain yes; there is no price and no "maybe". */
  stockConfirmedAt: string | null;
  otherPharmacyNeeded: boolean;
  controlled: boolean;
  partnerId: string | null;
  locationId: string | null;
}

export interface PharmacyOption {
  partnerId: string;
  partnerName: string;
  locationId: string;
  locationName: string;
  address: string | null;
  state: string | null;
}

export type LoadResult<T> = { ok: true; data: T } | { ok: false; off: boolean };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const bool = (v: unknown): boolean => v === true;

/** Reads the overview rows. A row that is not shaped as expected makes the whole read fail: a half-read list would hide a medicine. */
export function parseWaiting(data: unknown): WaitingItem[] | null {
  if (!Array.isArray(data)) return null;
  const out: WaitingItem[] = [];
  for (const r of data) {
    if (!isRecord(r)) return null;
    const id = str(r.prescription_id);
    const state = r.state;
    if (!id || (state !== "signed" && state !== "sent")) return null;
    out.push({
      prescriptionId: id,
      medicine: str(r.medicine) ?? "-",
      state,
      visitId: str(r.visit_id),
      pharmacyName: str(r.pharmacy_name),
      locationName: str(r.location_name),
      address: str(r.address),
      code: str(r.code),
      codeExpiresAt: str(r.code_expires_at),
      locked: bool(r.locked),
      expired: bool(r.expired),
      stockConfirmedAt: str(r.stock_confirmed_at),
      otherPharmacyNeeded: bool(r.other_pharmacy_needed),
      controlled: bool(r.controlled),
      partnerId: str(r.pharmacy_partner_id),
      locationId: str(r.pharmacy_location_id),
    });
  }
  return out;
}

export function parseOptions(data: unknown): PharmacyOption[] | null {
  if (!Array.isArray(data)) return null;
  const out: PharmacyOption[] = [];
  for (const r of data) {
    if (!isRecord(r)) return null;
    const partnerId = str(r.partner_id);
    const locationId = str(r.location_id);
    if (!partnerId || !locationId) return null;
    out.push({ partnerId, partnerName: str(r.partner_name) ?? "-", locationId, locationName: str(r.location_name) ?? "", address: str(r.address), state: str(r.state) });
  }
  return out;
}

/** The go-live guard is closed, or the app is a little ahead of its database (the function is not there yet): either way there is nothing to show and nothing to retry. */
const isOff = (e: RpcError) =>
  (e?.message ?? "").includes("pharmacy_collection_off") || e?.code === "PGRST202" || e?.code === "42883" || (e?.message ?? "").includes("Could not find the function");

export async function loadWaiting(): Promise<LoadResult<WaitingItem[]>> {
  const { data, error } = await rpc("patient_collection_overview", {});
  if (error) return { ok: false, off: isOff(error) };
  const parsed = parseWaiting(data);
  return parsed ? { ok: true, data: parsed } : { ok: false, off: false };
}

/** The pharmacies she can choose for a waiting prescription (the same list for any of hers). */
export async function loadOptions(prescriptionId: string): Promise<LoadResult<PharmacyOption[]>> {
  const { data, error } = await rpc("patient_collection_pharmacies", { p_prescription: prescriptionId });
  if (error) return { ok: false, off: isOff(error) };
  const parsed = parseOptions(data);
  return parsed ? { ok: true, data: parsed } : { ok: false, off: false };
}

export const CHOOSE_NOTICES = ["pharmacy_not_available", "collection_already_started", "collection_not_open", "pharmacy_collection_off", "visit_size_invalid"] as const;
export type ChooseNotice = (typeof CHOOSE_NOTICES)[number] | "failed";
/** Maps a database refusal to a short code; anything unknown is a plain failure that changed nothing. */
export function noticeForError(message: string | undefined): ChooseNotice {
  return CHOOSE_NOTICES.find((n) => message?.includes(n)) ?? "failed";
}

export type ActionResult = { ok: true } | { ok: false; notice: ChooseNotice };

/**
 * Sends the chosen prescriptions to the pharmacy. One prescription is the plain single choice; two or more go in ONE call, so they share one code and
 * a refusal stops them all (nothing is half sent). The code is not returned here: the screen reads it back from the database.
 */
export async function choosePharmacy(prescriptionIds: string[], partnerId: string, locationId: string): Promise<ActionResult> {
  const ids = [...new Set(prescriptionIds)];
  if (ids.length === 0 || ids.length > MAX_VISIT_ITEMS) return { ok: false, notice: "visit_size_invalid" };
  const { error } =
    ids.length === 1
      ? await rpc("patient_choose_pharmacy", { p_prescription: ids[0], p_partner: partnerId, p_location: locationId })
      : await rpc("patient_choose_pharmacy_for_visit", { p_prescriptions: ids, p_partner: partnerId, p_location: locationId });
  return error ? { ok: false, notice: noticeForError(error.message) } : { ok: true };
}

/** A new code for one medicine. The old code stops working at once. If it was sent with others it leaves that visit and gets a code of its own. */
export async function newCode(prescriptionId: string): Promise<ActionResult> {
  const { error } = await rpc("patient_new_collection_code", { p_prescription: prescriptionId });
  return error ? { ok: false, notice: noticeForError(error.message) } : { ok: true };
}

/**
 * A new code for everything sent together in one visit (the old code stops working at once). It keeps the medicines together and sends nothing to the
 * pharmacy again; `newCode` above is for one medicine and takes it out of its visit. Pass any one prescription of the visit.
 */
export async function newVisitCode(prescriptionId: string): Promise<ActionResult> {
  const { error } = await rpc("patient_new_visit_code", { p_prescription: prescriptionId });
  return error ? { ok: false, notice: noticeForError(error.message) } : { ok: true };
}

export type WithdrawResult = { ok: true } | { ok: false; notice: ChooseNotice; done: number };

/**
 * Takes prescriptions back from the pharmacy (consent to share is revocable). Each one is its own database call, so some can succeed and some not (one
 * already partly supplied cannot be taken back): a failure says how many WERE taken back, so the screen never reads as "nothing changed".
 */
export async function withdraw(prescriptionIds: string[]): Promise<WithdrawResult> {
  let failed: ChooseNotice | null = null;
  let done = 0;
  for (const id of prescriptionIds) {
    const { error } = await rpc("patient_withdraw_from_pharmacy", { p_prescription: id });
    if (error) {
      if (!failed) failed = noticeForError(error.message);
    } else {
      done += 1;
    }
  }
  return failed ? { ok: false, notice: failed, done } : { ok: true };
}

/**
 * What to tell the patient after taking a group back. Never states a cause the phone does not know: "already started to supply" only when the database said
 * so (collection_already_started); any other partial failure says how many were taken back and to try again.
 */
export function withdrawMessage(result: WithdrawResult, total: number): { key: string; params?: Record<string, number> } {
  if (result.ok) return { key: "pharmmob.notice.withdrawn" };
  if (result.done > 0) {
    return { key: result.notice === "collection_already_started" ? "pharmmob.partly_withdrawn" : "pharmmob.partly_withdrawn_retry", params: { done: result.done, total } };
  }
  return { key: result.notice === "failed" ? "pharmmob.failed" : `pharmcollect.notice.${result.notice}` };
}

export interface CollectionGroup {
  /** The visit id, or the prescription id for one sent on its own. */
  key: string;
  items: WaitingItem[];
  /** What the pharmacy says: the shared code and where. Same for every item of a visit. */
  code: string | null;
  codeExpiresAt: string | null;
  pharmacyName: string | null;
  locationName: string | null;
  address: string | null;
  locked: boolean;
  expired: boolean;
}

/** The medicines already sent, grouped by visit so one code is shown once for everything sent together. Single ones are a group of one. */
export function sentGroups(items: WaitingItem[]): CollectionGroup[] {
  const groups = new Map<string, WaitingItem[]>();
  for (const it of items) {
    if (it.state !== "sent") continue;
    const key = it.visitId ?? it.prescriptionId;
    groups.set(key, [...(groups.get(key) ?? []), it]);
  }
  return [...groups.entries()].map(([key, list]) => {
    const first = list[0];
    return {
      key, items: list, code: first.code, codeExpiresAt: first.codeExpiresAt, pharmacyName: first.pharmacyName, locationName: first.locationName,
      address: first.address, locked: list.some((i) => i.locked), expired: list.some((i) => i.expired),
    };
  });
}

/** The medicines still to be sent: the ones she can tick. */
export const unsent = (items: WaitingItem[]): WaitingItem[] => items.filter((i) => i.state === "signed");

/** Ticks or unticks one medicine, never going over the visit limit. */
export function toggleSelection(selected: readonly string[], id: string): string[] {
  if (selected.includes(id)) return selected.filter((s) => s !== id);
  return selected.length >= MAX_VISIT_ITEMS ? [...selected] : [...selected, id];
}
