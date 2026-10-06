/**
 * S28: the patient's send and the pharmacist's supply and flags. Input is validated, the RPC runs on the caller's own
 * server client, every refusal maps to plain words, and an unreadable answer is never treated as "recorded" or "sent".
 */
const rpc = jest.fn();
jest.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ rpc: (...args: unknown[]) => rpc(...args) }),
}));
const revalidatePath = jest.fn();
jest.mock("next/cache", () => ({ revalidatePath: (...args: unknown[]) => revalidatePath(...args) }));

import {
  dispensePrescription,
  flagPrescription,
  loadPharmacyOptions,
  openPharmacyPrescription,
  reroutePharmacy,
  sendToPharmacy,
  withdrawFromPharmacy,
} from "./actions";

const RX = "0b8f6d0e-3c1a-4f3e-9a52-1d6f6a9f7c11";
const PARTNER = "5c1d9f1e-8a2b-4d37-9c64-2e7b6a1d3f90";

beforeEach(() => {
  rpc.mockReset();
  revalidatePath.mockReset();
});

describe("loadPharmacyOptions", () => {
  it("returns the parsed options and asks the database for this prescription only", async () => {
    rpc.mockResolvedValue({
      data: [{ pharmacy_partner_id: PARTNER, name: "A", address: null, city: "Lagos", state: "Lagos", area: "Yaba", latitude: null, longitude: null,
        items_total: 1, items_priced: 1, total_kobo: 380000, stock: "in_stock", is_preferred: false }],
      error: null,
    });
    const r = await loadPharmacyOptions(RX);
    expect(r.ok && r.options[0]?.total_kobo).toBe(380000);
    expect(rpc).toHaveBeenCalledWith("pharmacies_for_prescription", { p_prescription: RX });
  });

  it("refuses an invalid id without calling the database", async () => {
    for (const bad of [undefined, null, "x", 5, {}]) {
      await expect(loadPharmacyOptions(bad)).resolves.toEqual({ ok: false, key: "pharmacy.error" });
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it("treats an unreadable answer as an error, never as an empty list", async () => {
    rpc.mockResolvedValue({ data: [{ name: 5 }], error: null });
    await expect(loadPharmacyOptions(RX)).resolves.toEqual({ ok: false, key: "pharmacy.error" });
  });

  it("maps a database refusal to a plain message", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "prescription_not_found" } });
    await expect(loadPharmacyOptions(RX)).resolves.toEqual({ ok: false, key: "pharmacy.error" });
  });
});

describe("sendToPharmacy and reroutePharmacy", () => {
  it("sends with consent and returns the code and pharmacy name", async () => {
    rpc.mockResolvedValue({ data: { collection_code: "K7M2QX9P", pharmacy_name: "A" }, error: null });
    await expect(sendToPharmacy({ prescriptionId: RX, partnerId: PARTNER, consent: true })).resolves.toEqual({ ok: true, code: "K7M2QX9P", pharmacyName: "A" });
    expect(rpc).toHaveBeenCalledWith("send_prescription_to_pharmacy", { p_prescription: RX, p_partner: PARTNER, p_consent: true });
    expect(revalidatePath).toHaveBeenCalledWith("/patient/medications");
  });

  it("re-routes through the other function", async () => {
    rpc.mockResolvedValue({ data: { collection_code: "ABCDEFGH", pharmacy_name: "B" }, error: null });
    await reroutePharmacy({ prescriptionId: RX, partnerId: PARTNER, consent: true });
    expect(rpc).toHaveBeenCalledWith("reroute_prescription_pharmacy", { p_prescription: RX, p_partner: PARTNER, p_consent: true });
  });

  it("never reaches the database without a ticked consent", async () => {
    for (const consent of [false, undefined, "true", 1]) {
      const r = await sendToPharmacy({ prescriptionId: RX, partnerId: PARTNER, consent });
      expect(r.ok).toBe(false);
    }
    await expect(sendToPharmacy({ prescriptionId: RX, partnerId: PARTNER, consent: false })).resolves.toEqual({ ok: false, key: "pharmacy.error.consent" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["pharmacy_not_available", "pharmacy.error.unavailable"],
    ["same_pharmacy", "pharmacy.error.unavailable"],
    ["prescription_not_current", "pharmacy.error.not_current"],
    ["prescription_not_waiting", "pharmacy.error.not_waiting"],
    ["prescription_not_sendable", "pharmacy.error.not_waiting"],
    ["consent_required", "pharmacy.error.consent"],
    ["something unexpected", "pharmacy.error"],
  ])("maps %s to %s", async (message, key) => {
    rpc.mockResolvedValue({ data: null, error: { message } });
    await expect(sendToPharmacy({ prescriptionId: RX, partnerId: PARTNER, consent: true })).resolves.toEqual({ ok: false, key });
  });

  it("does not report success when the answer has no readable code", async () => {
    rpc.mockResolvedValue({ data: { collection_code: "SHORT", pharmacy_name: "A" }, error: null });
    await expect(sendToPharmacy({ prescriptionId: RX, partnerId: PARTNER, consent: true })).resolves.toEqual({ ok: false, key: "pharmacy.error" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("openPharmacyPrescription", () => {
  const detail = {
    prescription_id: RX, collection_code: "K7M2QX9P", state: "sent", sent_at: null, dispensed_at: null, signed_at: null, signed_by_name: "Dr A",
    patient: { full_name: "Ada", age_years: 40 }, allergies: [], items: [{ drug_name: "Amlodipine" }], supplies_recorded: 0, supplies_permitted: 1, is_test: false,
  };
  it("returns the parsed detail", async () => {
    rpc.mockResolvedValue({ data: detail, error: null });
    const r = await openPharmacyPrescription(RX);
    expect(r.ok && r.detail.items[0]?.drug_name).toBe("Amlodipine");
    expect(rpc).toHaveBeenCalledWith("pharmacy_prescription_detail", { p_prescription: RX });
  });
  it("says so when it is not this pharmacy's", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "prescription_not_found" } });
    await expect(openPharmacyPrescription(RX)).resolves.toEqual({ ok: false, error: "That prescription could not be found at your pharmacy." });
  });
  it("refuses a malformed id and an unreadable answer", async () => {
    await expect(openPharmacyPrescription("x")).resolves.toMatchObject({ ok: false });
    rpc.mockResolvedValue({ data: { state: "weird" }, error: null });
    await expect(openPharmacyPrescription(RX)).resolves.toMatchObject({ ok: false });
  });
});

describe("dispensePrescription", () => {
  const base = { prescriptionId: RX, code: "k7m2 qx9p", pharmacistName: "Ada Pharmacist" };

  it("sends only the fields given and records a full supply", async () => {
    rpc.mockResolvedValue({ data: { ok: true, partial: false }, error: null });
    await expect(dispensePrescription({ ...base, registration: "PCN-1", batchNumber: "B7", batchExpiry: "2027-06-30" })).resolves.toEqual({ ok: true, partial: false });
    expect(rpc).toHaveBeenCalledWith("pharmacy_mark_dispensed", {
      p_prescription: RX, p_collection_code: "k7m2 qx9p", p_pharmacist_name: "Ada Pharmacist", p_pharmacist_registration: "PCN-1",
      p_batch_number: "B7", p_batch_expiry: "2027-06-30", p_is_partial: false,
    });
    expect(revalidatePath).toHaveBeenCalledWith("/pharmacist/prescriptions");
  });

  it("needs a note to say what is outstanding on a partial supply", async () => {
    await expect(dispensePrescription({ ...base, partial: true })).resolves.toEqual({ ok: false, error: "Please say what is still outstanding." });
    expect(rpc).not.toHaveBeenCalled();
    rpc.mockResolvedValue({ data: { ok: true, partial: true }, error: null });
    await expect(dispensePrescription({ ...base, partial: true, note: "Remainder on Friday" })).resolves.toEqual({ ok: true, partial: true });
  });

  it.each([
    ["code_mismatch", "That code does not match. Check it with the patient and try again."],
    ["too_many_attempts", "Too many wrong codes. Please wait ten minutes, then try again."],
    ["not_waiting", "This prescription is no longer waiting at your pharmacy."],
    ["no_supply_available", "The permitted supplies for this prescription have already been recorded."],
  ])("explains %s in plain words and does not revalidate", async (reason, text) => {
    rpc.mockResolvedValue({ data: { ok: false, reason }, error: null });
    await expect(dispensePrescription(base)).resolves.toEqual({ ok: false, error: text });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("falls back to a generic message for a reason it does not know", async () => {
    rpc.mockResolvedValue({ data: { ok: false, reason: "brand_new_reason" }, error: null });
    await expect(dispensePrescription(base)).resolves.toEqual({ ok: false, error: "That could not be recorded. Please try again." });
  });

  it("never treats an unreadable answer as recorded", async () => {
    for (const data of [null, "ok", { ok: "yes" }, []]) {
      rpc.mockResolvedValue({ data, error: null });
      const r = await dispensePrescription(base);
      expect(r.ok).toBe(false);
    }
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("refuses bad input without calling the database", async () => {
    for (const bad of [{}, { ...base, code: "ab" }, { ...base, pharmacistName: "A" }, { ...base, batchExpiry: "June 2027" }, { ...base, prescriptionId: "x" }]) {
      await expect(dispensePrescription(bad)).resolves.toMatchObject({ ok: false });
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it("reports a database error without leaking its text", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "relation prescriptions row 123 secret" } });
    await expect(dispensePrescription(base)).resolves.toEqual({ ok: false, error: "That could not be done. Please try again." });
  });
});

describe("flagPrescription", () => {
  it("flags out of stock with no note", async () => {
    rpc.mockResolvedValue({ data: { ok: true }, error: null });
    await expect(flagPrescription({ prescriptionId: RX, kind: "out_of_stock" })).resolves.toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("pharmacy_flag_prescription", { p_prescription: RX, p_kind: "out_of_stock" });
  });
  it("needs a question for the prescriber", async () => {
    await expect(flagPrescription({ prescriptionId: RX, kind: "query_to_prescriber" })).resolves.toEqual({ ok: false, error: "Please write what you need to ask the prescriber." });
    expect(rpc).not.toHaveBeenCalled();
    rpc.mockResolvedValue({ data: { ok: true }, error: null });
    await flagPrescription({ prescriptionId: RX, kind: "query_to_prescriber", note: "Confirm the strength." });
    expect(rpc).toHaveBeenCalledWith("pharmacy_flag_prescription", { p_prescription: RX, p_kind: "query_to_prescriber", p_note: "Confirm the strength." });
  });
  it("refuses a kind it does not know", async () => {
    await expect(flagPrescription({ prescriptionId: RX, kind: "delivery_problem" })).resolves.toMatchObject({ ok: false });
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("withdrawFromPharmacy", () => {
  it("takes it back and says the pharmacy can no longer see it", async () => {
    rpc.mockResolvedValue({ data: { ok: true }, error: null });
    await expect(withdrawFromPharmacy(RX)).resolves.toEqual({ ok: true, key: "pharmacy.withdraw.done" });
    expect(rpc).toHaveBeenCalledWith("withdraw_prescription_from_pharmacy", { p_prescription: RX });
    expect(revalidatePath).toHaveBeenCalledWith("/patient/medications");
  });
  it("refuses a malformed id without calling the database", async () => {
    await expect(withdrawFromPharmacy("x")).resolves.toEqual({ ok: false, key: "pharmacy.error" });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("never reports success on an unreadable answer or a refusal", async () => {
    rpc.mockResolvedValue({ data: { ok: "yes" }, error: null });
    await expect(withdrawFromPharmacy(RX)).resolves.toEqual({ ok: false, key: "pharmacy.error" });
    rpc.mockResolvedValue({ data: null, error: { message: "prescription_not_waiting" } });
    await expect(withdrawFromPharmacy(RX)).resolves.toEqual({ ok: false, key: "pharmacy.error.not_waiting" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
