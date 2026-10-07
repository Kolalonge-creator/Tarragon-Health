/**
 * S28: what the Medicines screen is told. A failed or unreadable read is reported (never an empty list); a prescription not
 * yet sent is offered only while collection is available AND it is still current; one waiting at a pharmacy or collected is
 * always shown (a code she holds must stay visible and withdrawable, even if collection has since been switched off).
 */
const rpc = jest.fn();
jest.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ rpc: (...a: unknown[]) => rpc(...a) }),
}));

import { loadMyCollection } from "./load";

const A = "0b8f6d0e-3c1a-4f3e-9a52-1d6f6a9f7c11";
const B = "1b8f6d0e-3c1a-4f3e-9a52-1d6f6a9f7c12";
const C = "2b8f6d0e-3c1a-4f3e-9a52-1d6f6a9f7c13";
const MINE = { sent: true, state: "sent", pharmacy_name: "A", collection_code: "K7M2QX9P", needs_other_pharmacy: false };

function wire(available: unknown, rows: unknown, mine: unknown = { data: MINE, error: null }) {
  rpc.mockImplementation(async (name: string) => {
    if (name === "pharmacy_collection_available") return available;
    if (name === "my_collection_prescriptions") return rows;
    if (name === "my_prescription_pharmacy") return mine;
    throw new Error(`unexpected rpc ${name}`);
  });
}
const yes = { data: true, error: null };
const no = { data: false, error: null };
const list = (...r: object[]) => ({ data: r, error: null });
const row = (id: string, state: string, current = true, items: unknown = [{ drug_name: "Amlodipine" }], remaining = 1) => ({ prescription_id: id, state, items, signed_at: "2026-10-01T00:00:00Z", is_current: current, supplies_remaining: remaining });

beforeEach(() => rpc.mockReset());

describe("loadMyCollection", () => {
  it("offers a current signed prescription when collection is available", async () => {
    wire(yes, list(row(A, "signed")));
    await expect(loadMyCollection()).resolves.toEqual({ ok: true, available: true, prescriptions: [{ id: A, state: "signed", medicines: ["Amlodipine"], pharmacy: null, canRepeat: false }] });
  });

  it("never offers a prescription whose medicine was changed or stopped", async () => {
    wire(yes, list(row(A, "signed", false)));
    const r = await loadMyCollection();
    expect(r.ok && r.prescriptions).toEqual([]);
  });

  it("does not offer anything new while collection is off or no pharmacy can be chosen", async () => {
    wire(no, list(row(A, "signed")));
    const r = await loadMyCollection();
    expect(r.ok && r.available).toBe(false);
    expect(r.ok && r.prescriptions).toEqual([]);
  });

  it("still shows a code she holds and a collected one when collection is off", async () => {
    wire(no, list(row(B, "sent"), row(C, "dispensed")));
    const r = await loadMyCollection();
    expect(r.ok && r.prescriptions.map((p) => p.id)).toEqual([B, C]);
    expect(rpc.mock.calls.filter((c) => c[0] === "my_prescription_pharmacy")).toHaveLength(2);
  });

  it("fetches pharmacy state only for the ones past signed", async () => {
    wire(yes, list(row(A, "signed"), row(B, "sent")));
    await loadMyCollection();
    expect(rpc.mock.calls.filter((c) => c[0] === "my_prescription_pharmacy")).toEqual([["my_prescription_pharmacy", { p_prescription: B }]]);
  });

  it("reports a failed availability read, a failed list, an unreadable list, a failed state and an unreadable state", async () => {
    wire({ data: null, error: { message: "x" } }, list());
    await expect(loadMyCollection()).resolves.toEqual({ ok: false });
    wire(yes, { data: null, error: { message: "x" } });
    await expect(loadMyCollection()).resolves.toEqual({ ok: false });
    wire(yes, { data: [{ prescription_id: "nope", state: "weird" }], error: null });
    await expect(loadMyCollection()).resolves.toEqual({ ok: false });
    wire(yes, list(row(B, "sent")), { data: null, error: { message: "x" } });
    await expect(loadMyCollection()).resolves.toEqual({ ok: false });
    wire(yes, list(row(B, "sent")), { data: { weird: 1 }, error: null });
    await expect(loadMyCollection()).resolves.toEqual({ ok: false });
  });

  it("acting for someone: asks the database for their list and their pharmacy, not the caller's", async () => {
    wire(yes, list(row(A, "sent")));
    const WHO = "9d8c7b6a-1e2f-4a3b-8c4d-5e6f7a8b9c0d";
    await loadMyCollection(WHO);
    expect(rpc).toHaveBeenCalledWith("my_collection_prescriptions", { p_beneficiary: WHO });
    expect(rpc).toHaveBeenCalledWith("my_prescription_pharmacy", { p_prescription: A, p_beneficiary: WHO });
  });

  it("acting for someone without the pharmacy permission: the card is simply not offered, no error card", async () => {
    wire(yes, { data: null, error: { message: "not_permitted_for_this_person" } });
    await expect(loadMyCollection("9d8c7b6a-1e2f-4a3b-8c4d-5e6f7a8b9c0d")).resolves.toEqual({ ok: true, available: false, prescriptions: [] });
  });

  it("but any other failure is still a failure, and the patient's own list never hides a permission error", async () => {
    wire(yes, { data: null, error: { message: "boom" } });
    await expect(loadMyCollection("9d8c7b6a-1e2f-4a3b-8c4d-5e6f7a8b9c0d")).resolves.toEqual({ ok: false });
    wire(yes, { data: null, error: { message: "not_permitted_for_this_person" } });
    await expect(loadMyCollection()).resolves.toEqual({ ok: false });
  });

  it("a collected prescription with a supply left can be sent again (a repeat is a new send)", async () => {
    wire(yes, list(row(A, "dispensed")), { data: { ...MINE, state: "dispensed", collection_code: null }, error: null });
    const r = await loadMyCollection();
    expect(r.ok && r.prescriptions[0]?.canRepeat).toBe(true);
  });

  it("...not when no supply is left, the medicine changed, or collection is off", async () => {
    for (const [avail, r] of [[yes, row(A, "dispensed", true, undefined, 0)], [yes, row(A, "dispensed", false)], [no, row(A, "dispensed")]] as const) {
      wire(avail, list(r), { data: { ...MINE, state: "dispensed", collection_code: null }, error: null });
      const out = await loadMyCollection();
      expect(out.ok && out.prescriptions[0]?.canRepeat).toBe(false);
    }
  });

  it("a signed prescription already supplied elsewhere (QR or phone desk) is not offered", async () => {
    wire(yes, list(row(A, "signed", true, undefined, 0)));
    const r = await loadMyCollection();
    expect(r.ok && r.prescriptions).toEqual([]);
  });
});
