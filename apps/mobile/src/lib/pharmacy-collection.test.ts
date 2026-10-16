/**
 * S28e on the phone (OQ-277): the pure parts of choosing a pharmacy and showing the collection code. No screen is rendered (see jest.config.mjs).
 * The database is the protection; these tests pin what the phone sends and how it reads the answers.
 */
jest.mock("./supabase", () => ({ supabase: { rpc: jest.fn() } }));

import { supabase } from "./supabase";
import {
  choosePharmacy, loadOptions, loadWaiting, MAX_VISIT_ITEMS, newCode, newVisitCode, noticeForError, parseOptions, parseWaiting, sentGroups, toggleSelection, unsent, withdraw, withdrawMessage,
  type WaitingItem,
} from "./pharmacy-collection";

const rpc = (supabase as unknown as { rpc: jest.Mock }).rpc;
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";
const P = "44444444-4444-4444-8444-444444444444";
const L = "55555555-5555-4555-8555-555555555555";
const V = "66666666-6666-4666-8666-666666666666";

const row = (over: Record<string, unknown> = {}) => ({
  prescription_id: A, medicine: "Amlodipine", state: "signed", visit_id: null, pharmacy_name: null, location_name: null, address: null, code: null, code_expires_at: null,
  locked: false, expired: false, stock_confirmed_at: null, other_pharmacy_needed: false, controlled: false, pharmacy_partner_id: null, pharmacy_location_id: null, ...over,
});
const item = (over: Partial<WaitingItem> = {}): WaitingItem => ({ ...(parseWaiting([row()]) as WaitingItem[])[0], ...over });

beforeEach(() => rpc.mockReset());

describe("reading what is waiting", () => {
  it("reads a row and keeps the medicine name, state and visit", () => {
    const [r] = parseWaiting([row({ state: "sent", visit_id: V, code: "ABCD2345", pharmacy_name: "A Pharmacy", pharmacy_partner_id: P, pharmacy_location_id: L })]) as WaitingItem[];
    expect(r).toMatchObject({ prescriptionId: A, medicine: "Amlodipine", state: "sent", visitId: V, code: "ABCD2345", partnerId: P, locationId: L });
  });
  it("a malformed row makes the whole read fail: a half-read list would hide a medicine", () => {
    expect(parseWaiting([row(), { prescription_id: B }])).toBeNull();
    expect(parseWaiting([row({ state: "draft" })])).toBeNull();
    expect(parseWaiting("none")).toBeNull();
    expect(parseWaiting(null)).toBeNull();
  });
  it("a failed read is a failure, not an empty list, and a closed go-live guard is reported as off", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "boom", code: "XX000" } });
    expect(await loadWaiting()).toEqual({ ok: false, off: false });
    rpc.mockResolvedValue({ data: null, error: { message: "pharmacy_collection_off", code: "55000" } });
    expect(await loadWaiting()).toEqual({ ok: false, off: true });
    rpc.mockResolvedValue({ data: [row()], error: null });
    expect(await loadWaiting()).toMatchObject({ ok: true });
    rpc.mockResolvedValue({ data: [{ nope: 1 }], error: null });
    expect(await loadWaiting()).toEqual({ ok: false, off: false });
  });
  it("reads the pharmacy options and refuses a malformed one", () => {
    expect(parseOptions([{ partner_id: P, partner_name: "A", location_id: L, location_name: "Lekki", address: null, state: "Lagos" }])).toEqual([
      { partnerId: P, partnerName: "A", locationId: L, locationName: "Lekki", address: null, state: "Lagos" },
    ]);
    expect(parseOptions([{ partner_id: P }])).toBeNull();
  });
  it("loads the options for one waiting prescription", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    expect(await loadOptions(A)).toEqual({ ok: true, data: [] });
    expect(rpc).toHaveBeenCalledWith("patient_collection_pharmacies", { p_prescription: A });
  });
});

describe("sending several medicines together (one code per visit)", () => {
  it("one medicine is the plain single choice", async () => {
    rpc.mockResolvedValue({ data: "ABCD2345", error: null });
    expect(await choosePharmacy([A], P, L)).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("patient_choose_pharmacy", { p_prescription: A, p_partner: P, p_location: L });
  });
  it("two or more go in ONE call so they share a code and a refusal stops them all", async () => {
    rpc.mockResolvedValue({ data: "ABCD2345", error: null });
    expect(await choosePharmacy([A, B, B, C], P, L)).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("patient_choose_pharmacy_for_visit", { p_prescriptions: [A, B, C], p_partner: P, p_location: L });
  });
  it("a refusal is a short notice, never a success, and the code is not returned", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "pharmacy_not_available", code: "22023" } });
    expect(await choosePharmacy([A, B], P, L)).toEqual({ ok: false, notice: "pharmacy_not_available" });
    rpc.mockResolvedValue({ data: null, error: { message: "weird", code: "XX000" } });
    expect(await choosePharmacy([A], P, L)).toEqual({ ok: false, notice: "failed" });
    rpc.mockResolvedValue({ data: "ABCD2345", error: null });
    expect(JSON.stringify(await choosePharmacy([A, B], P, L))).not.toContain("ABCD2345");
  });
  it("nothing is sent for no medicine or for more than the visit limit", async () => {
    expect(await choosePharmacy([], P, L)).toEqual({ ok: false, notice: "visit_size_invalid" });
    const many = Array.from({ length: MAX_VISIT_ITEMS + 1 }, (_, i) => `77777777-7777-4777-8777-${String(i).padStart(12, "0")}`);
    expect(await choosePharmacy(many, P, L)).toEqual({ ok: false, notice: "visit_size_invalid" });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("ticking stops at the visit limit and unticking always works", () => {
    const ids = Array.from({ length: MAX_VISIT_ITEMS }, (_, i) => `88888888-8888-4888-8888-${String(i).padStart(12, "0")}`);
    expect(toggleSelection(ids, "extra")).toEqual(ids);
    expect(toggleSelection(ids, ids[0])).toHaveLength(MAX_VISIT_ITEMS - 1);
    expect(toggleSelection([], A)).toEqual([A]);
  });
  it("refusals map to their notices", () => {
    expect(noticeForError("visit_size_invalid")).toBe("visit_size_invalid");
    expect(noticeForError("collection_already_started")).toBe("collection_already_started");
    expect(noticeForError(undefined)).toBe("failed");
  });
});

describe("the code on screen", () => {
  const sent = (id: string, over: Partial<WaitingItem> = {}) => item({ prescriptionId: id, state: "sent", visitId: V, code: "ABCD2345", pharmacyName: "A Pharmacy", partnerId: P, locationId: L, ...over });
  it("medicines sent together share one code shown once; one sent alone is a group of its own", () => {
    const groups = sentGroups([sent(A), sent(B), sent(C, { visitId: null, code: "ZZZZ9999" }), item({ prescriptionId: "d" })]);
    expect(groups.map((g) => [g.items.length, g.code])).toEqual([[2, "ABCD2345"], [1, "ZZZZ9999"]]);
  });
  it("a group is locked or expired if any medicine in it is", () => {
    expect(sentGroups([sent(A), sent(B, { locked: true })])[0].locked).toBe(true);
    expect(sentGroups([sent(A, { expired: true }), sent(B)])[0].expired).toBe(true);
  });
  it("only the medicines not yet sent can be ticked", () => {
    expect(unsent([item(), sent(B)]).map((i) => i.prescriptionId)).toEqual([A]);
  });
  it("a new code for a visit is one call for the whole visit, not a resend to the pharmacy", async () => {
    rpc.mockResolvedValue({ data: "WXYZ6789", error: null });
    expect(await newVisitCode(A)).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("patient_new_visit_code", { p_prescription: A });
    rpc.mockResolvedValue({ data: null, error: { message: "collection_not_open", code: "22023" } });
    expect(await newVisitCode(A)).toEqual({ ok: false, notice: "collection_not_open" });
  });
  it("taking back says how many were taken back, and names a cause only when the database gave it", () => {
    expect(withdrawMessage({ ok: true }, 3)).toEqual({ key: "pharmmob.notice.withdrawn" });
    expect(withdrawMessage({ ok: false, notice: "collection_already_started", done: 1 }, 3)).toEqual({ key: "pharmmob.partly_withdrawn", params: { done: 1, total: 3 } });
    // a dropped connection after the first call is not "the pharmacy has started to supply": it asks to try again
    expect(withdrawMessage({ ok: false, notice: "failed", done: 1 }, 3)).toEqual({ key: "pharmmob.partly_withdrawn_retry", params: { done: 1, total: 3 } });
    expect(withdrawMessage({ ok: false, notice: "failed", done: 0 }, 3)).toEqual({ key: "pharmmob.failed" });
    expect(withdrawMessage({ ok: false, notice: "collection_already_started", done: 0 }, 1)).toEqual({ key: "pharmcollect.notice.collection_already_started" });
  });
  it("a missing database function is treated as 'not open' (quiet), a real failure is not", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "Could not find the function public.patient_collection_overview", code: "PGRST202" } });
    expect(await loadWaiting()).toEqual({ ok: false, off: true });
    rpc.mockResolvedValue({ data: null, error: { message: "network request failed" } });
    expect(await loadWaiting()).toEqual({ ok: false, off: false });
  });
  it("the visit limit comes from the versioned configuration, not from this file", () => {
    expect(MAX_VISIT_ITEMS).toBeGreaterThanOrEqual(2);
  });
  it("a new code for one medicine, and taking back, call the patient's own database doors", async () => {
    rpc.mockResolvedValue({ data: "ABCD2345", error: null });
    expect(await newCode(A)).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("patient_new_collection_code", { p_prescription: A });
    rpc.mockResolvedValue({ data: { ok: true }, error: null });
    expect(await withdraw([A, B])).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("patient_withdraw_from_pharmacy", { p_prescription: B });
  });
  it("taking back reports a failure if any one could not be taken back", async () => {
    rpc.mockResolvedValueOnce({ data: { ok: true }, error: null }).mockResolvedValueOnce({ data: null, error: { message: "collection_already_started", code: "22023" } });
    // and it says how many WERE taken back, so the screen never reads as "nothing changed"
    expect(await withdraw([A, B])).toEqual({ ok: false, notice: "collection_already_started", done: 1 });
  });
});
