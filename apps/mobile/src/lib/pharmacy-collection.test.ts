/**
 * S28 mobile: parsing, the offline rule (an offline send is a plain message, nothing is queued), and never reading a
 * delivery field. An unreadable answer is never treated as sent or as "nothing waiting".
 */
import { supabase } from "./supabase";
import { loadCollection, loadOptions, medicineNames, parseMine, parseOptions, sendToPharmacy, withdrawFromPharmacy } from "./pharmacy-collection";

jest.mock("./supabase", () => ({ supabase: { rpc: jest.fn(), from: jest.fn() } }));
const rpc = supabase.rpc as unknown as jest.Mock;
const from = supabase.from as unknown as jest.Mock;
const RX = "0b8f6d0e-3c1a-4f3e-9a52-1d6f6a9f7c11";
const P = "5c1d9f1e-8a2b-4d37-9c64-2e7b6a1d3f90";

beforeEach(() => {
  rpc.mockReset();
  from.mockReset();
});

describe("parsers", () => {
  it("reads options and rejects anything malformed", () => {
    const ok = { pharmacy_partner_id: P, name: "A", area: "Yaba", city: "Lagos", stock: "low_stock", is_preferred: true };
    expect(parseOptions([ok])).toEqual([{ id: P, name: "A", place: "Yaba, Lagos", stock: "low_stock", isPreferred: true }]);
    expect(parseOptions([{ ...ok, stock: "plenty" }])).toBeNull();
    expect(parseOptions([{ ...ok, name: 5 }])).toBeNull();
    expect(parseOptions("x")).toBeNull();
  });
  it("never reads a delivery field", () => {
    const ok = { pharmacy_partner_id: P, name: "A", area: null, city: null, stock: "in_stock", is_preferred: false, delivery: true, delivery_fee_kobo: 500, total_kobo: 380000 };
    expect(JSON.stringify(parseOptions([ok]))).not.toMatch(/deliver|kobo|price/i);
  });
  it("reads where it went, and refuses a half-formed state", () => {
    expect(parseMine({ sent: false, state: "signed" })).toEqual({ sent: false });
    expect(parseMine({ sent: true, state: "sent", pharmacy_name: "A", collection_code: "K7M2QX9P", needs_other_pharmacy: false })).toEqual({ sent: true, state: "sent", pharmacyName: "A", code: "K7M2QX9P", needsOther: false });
    expect(parseMine({ sent: true, state: "sent" })).toBeNull();
    expect(parseMine(null)).toBeNull();
  });
  it("lists names only", () => {
    expect(medicineNames([{ drug_name: "Amlodipine", dose: "5 mg" }, { x: 1 }])).toEqual(["Amlodipine"]);
    expect(medicineNames(null)).toEqual([]);
  });
});

describe("loadCollection", () => {
  const A = "0b8f6d0e-3c1a-4f3e-9a52-1d6f6a9f7c11";
  const B = "1b8f6d0e-3c1a-4f3e-9a52-1d6f6a9f7c12";
  const MINE = { sent: true, state: "sent", pharmacy_name: "A", collection_code: "K7M2QX9P", needs_other_pharmacy: false };
  const row = (id: string, state: string, current = true, remaining = 1) => ({ prescription_id: id, state, items: [{ drug_name: "Amlodipine" }], signed_at: "2026-10-01T00:00:00Z", is_current: current, supplies_remaining: remaining });
  function wire(available: unknown, list: unknown, mine: unknown = { data: MINE, error: null }) {
    rpc.mockImplementation(async (name: string) => {
      if (name === "pharmacy_collection_available") return available;
      if (name === "my_collection_prescriptions") return list;
      if (name === "my_prescription_pharmacy") return mine;
      throw new Error(`unexpected rpc ${name}`);
    });
  }
  const yes = { data: true, error: null };
  const no = { data: false, error: null };
  const list = (...r: object[]) => ({ data: r, error: null });

  it("offers a current signed prescription when collection is available, and never one whose medicine was changed or stopped", async () => {
    wire(yes, list(row(A, "signed"), row(B, "signed", false)));
    const r = await loadCollection();
    expect(r.ok && r.prescriptions.map((p) => p.id)).toEqual([A]);
  });
  it("offers nothing new when collection is off, but still shows a code she holds", async () => {
    wire(no, list(row(A, "signed"), row(B, "sent")));
    const r = await loadCollection();
    expect(r.ok && r.available).toBe(false);
    expect(r.ok && r.prescriptions.map((p) => p.id)).toEqual([B]);
    expect(rpc.mock.calls.filter((c) => c[0] === "my_prescription_pharmacy")).toHaveLength(1);
  });
  it("reports offline and failed reads, never an empty list", async () => {
    wire({ data: null, error: { message: "Network request failed" } }, list());
    await expect(loadCollection()).resolves.toEqual({ ok: false, offline: true });
    wire(yes, { data: null, error: { message: "boom" } });
    await expect(loadCollection()).resolves.toEqual({ ok: false, offline: false });
    wire(yes, { data: "nope", error: null });
    await expect(loadCollection()).resolves.toEqual({ ok: false, offline: false });
    wire(yes, list({ prescription_id: A, state: "weird", is_current: true, supplies_remaining: 1 }));
    await expect(loadCollection()).resolves.toEqual({ ok: false, offline: false });
  });
  it("an unreadable or failed pharmacy state fails the load rather than hiding the code", async () => {
    wire(yes, list(row(B, "sent")), { data: { weird: 1 }, error: null });
    await expect(loadCollection()).resolves.toEqual({ ok: false, offline: false });
    wire(yes, list(row(B, "sent")), { data: null, error: { message: "Network request failed" } });
    await expect(loadCollection()).resolves.toEqual({ ok: false, offline: true });
  });
});

describe("withdrawFromPharmacy", () => {
  it("takes it back, and never reports success on an unreadable answer or an offline call", async () => {
    rpc.mockResolvedValue({ data: { ok: true }, error: null });
    await expect(withdrawFromPharmacy(RX)).resolves.toEqual({ ok: true, key: "pharmacy.withdraw.done" });
    expect(rpc).toHaveBeenCalledWith("withdraw_prescription_from_pharmacy", { p_prescription: RX });
    rpc.mockResolvedValue({ data: { ok: "yes" }, error: null });
    await expect(withdrawFromPharmacy(RX)).resolves.toEqual({ ok: false, key: "pharmacy.error" });
    rpc.mockResolvedValue({ data: null, error: { message: "Network request failed" } });
    await expect(withdrawFromPharmacy(RX)).resolves.toEqual({ ok: false, key: "pharmacy.error.offline" });
    await expect(withdrawFromPharmacy("")).resolves.toEqual({ ok: false, key: "pharmacy.error" });
  });
});

describe("loadOptions and sendToPharmacy", () => {
  it("asks for this prescription only", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    await expect(loadOptions(RX)).resolves.toEqual({ ok: true, options: [] });
    expect(rpc).toHaveBeenCalledWith("pharmacies_for_prescription", { p_prescription: RX });
    await expect(loadOptions("")).resolves.toEqual({ ok: false, key: "pharmacy.error" });
  });
  it("sends with consent, re-routes through the other function", async () => {
    rpc.mockResolvedValue({ data: { collection_code: "K7M2QX9P", pharmacy_name: "A" }, error: null });
    await expect(sendToPharmacy("send", RX, P, true)).resolves.toEqual({ ok: true, code: "K7M2QX9P", pharmacyName: "A" });
    expect(rpc).toHaveBeenCalledWith("send_prescription_to_pharmacy", { p_prescription: RX, p_partner: P, p_consent: true });
    await sendToPharmacy("reroute", RX, P, true);
    expect(rpc).toHaveBeenLastCalledWith("reroute_prescription_pharmacy", { p_prescription: RX, p_partner: P, p_consent: true });
  });
  it("never reaches the server without consent", async () => {
    await expect(sendToPharmacy("send", RX, P, false)).resolves.toEqual({ ok: false, key: "pharmacy.error.consent" });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("an offline send is a plain message, and nothing else", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "Network request failed" } });
    await expect(sendToPharmacy("send", RX, P, true)).resolves.toEqual({ ok: false, key: "pharmacy.error.offline" });
  });
  it("maps refusals and never reports a short code as sent", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "pharmacy_not_available" } });
    await expect(sendToPharmacy("send", RX, P, true)).resolves.toEqual({ ok: false, key: "pharmacy.error.unavailable" });
    rpc.mockResolvedValue({ data: { collection_code: "SHORT", pharmacy_name: "A" }, error: null });
    await expect(sendToPharmacy("send", RX, P, true)).resolves.toEqual({ ok: false, key: "pharmacy.error" });
  });
});

describe("a repeat supply is a new send (OQ-260)", () => {
  const A = "0b8f6d0e-3c1a-4f3e-9a52-1d6f6a9f7c11";
  const MINE = { sent: true, state: "dispensed", pharmacy_name: "A", collection_code: null, needs_other_pharmacy: false };
  const row = (state: string, remaining: number, current = true) => ({ prescription_id: A, state, items: [{ drug_name: "Amlodipine" }], signed_at: "2026-10-01T00:00:00Z", is_current: current, supplies_remaining: remaining });
  function wire(available: boolean, r: object) {
    rpc.mockImplementation(async (name: string) => {
      if (name === "pharmacy_collection_available") return { data: available, error: null };
      if (name === "my_collection_prescriptions") return { data: [r], error: null };
      return { data: MINE, error: null };
    });
  }
  it("a collected prescription with a supply left can be sent again", async () => {
    wire(true, row("dispensed", 1));
    const r = await loadCollection();
    expect(r.ok && r.prescriptions[0]?.canRepeat).toBe(true);
  });
  it("not when no supply is left, the medicine changed, or collection is off", async () => {
    for (const [avail, r] of [[true, row("dispensed", 0)], [true, row("dispensed", 1, false)], [false, row("dispensed", 1)]] as const) {
      wire(avail, r);
      const out = await loadCollection();
      expect(out.ok && out.prescriptions[0]?.canRepeat).toBe(false);
    }
  });
  it("a signed prescription already supplied elsewhere is not offered at all", async () => {
    wire(true, row("signed", 0));
    const r = await loadCollection();
    expect(r.ok && r.prescriptions).toEqual([]);
  });
});

describe("the bell line", () => {
  it("is neutral: no medicine, pharmacy or code, whatever the payload carries", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { describeNotification } = require("./notifications") as typeof import("./notifications");
    const line = describeNotification({ id: "n", template: "pharmacy_collection_update", payload: { drug_name: "Amlodipine", collection_code: "K7M2QX9P", pharmacy: "Yaba" }, created_at: "2026-10-06T00:00:00Z", read_at: null } as never);
    expect(line.text).toBe("Your pharmacy has an update. Open the app to see it");
    expect(line.section).toBe("medications");
    expect(line.text).not.toMatch(/amlodipine|K7M2|Yaba/i);
  });

  it("the refill reminder opens the Medicines tab, where the pharmacy card is, and stays neutral", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { describeNotification } = require("./notifications") as typeof import("./notifications");
    const line = describeNotification({ id: "n", template: "medication_refill_reminder", payload: { drug_name: "Amlodipine" }, created_at: "2026-10-06T00:00:00Z", read_at: null } as never);
    expect(line.section).toBe("medications");
    expect(line.text).not.toMatch(/amlodipine/i);
  });
});
