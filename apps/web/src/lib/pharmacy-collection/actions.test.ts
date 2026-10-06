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
  answerPharmacyQuestion,
  dispensePrescription,
  flagPrescription,
  loadPrescriberOverview,
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
  const base = { prescriptionId: RX, code: "k7m2 qx9p", pharmacistName: "Ada Pharmacist", batchNumber: "B7", batchExpiry: "2027-06-30" };

  it("sends only the fields given and records a full supply", async () => {
    rpc.mockResolvedValue({ data: { ok: true, partial: false }, error: null });
    await expect(dispensePrescription({ ...base, registration: "PCN-1" })).resolves.toEqual({ ok: true, partial: false });
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

  it("will not record a supply without the batch and its expiry, and never asks the database", async () => {
    const { batchNumber: _b, batchExpiry: _e, ...noBatch } = base;
    const batchWords = "Please enter the batch number and its expiry date. They are your record of what was handed over.";
    await expect(dispensePrescription(noBatch)).resolves.toEqual({ ok: false, error: batchWords });
    await expect(dispensePrescription({ ...noBatch, batchNumber: "B7" })).resolves.toEqual({ ok: false, error: batchWords });
    await expect(dispensePrescription({ ...base, batchNumber: "   " })).resolves.toEqual({ ok: false, error: batchWords });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("explains an expired batch the database refuses, and the screen never calls a batch genuine", async () => {
    rpc.mockResolvedValue({ data: { ok: false, reason: "batch_expired" }, error: null });
    const r = await dispensePrescription(base);
    expect(r).toEqual({ ok: false, error: "That batch has already expired, so it cannot be recorded as supplied." });
    expect(JSON.stringify(r)).not.toMatch(/genuine|verified|authentic/i);
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
  it("flags out of stock with no reason", async () => {
    rpc.mockResolvedValue({ data: { ok: true }, error: null });
    await expect(flagPrescription({ prescriptionId: RX, kind: "out_of_stock" })).resolves.toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("pharmacy_flag_prescription", { p_prescription: RX, p_kind: "out_of_stock" });
  });
  it("a question to the prescriber is one of a fixed list, never free text", async () => {
    const words = "Please choose what you need to ask the prescriber.";
    await expect(flagPrescription({ prescriptionId: RX, kind: "query_to_prescriber" })).resolves.toEqual({ ok: false, error: words });
    await expect(flagPrescription({ prescriptionId: RX, kind: "query_to_prescriber", reason: "Please confirm the strength for Ada Obi." })).resolves.toEqual({ ok: false, error: words });
    expect(rpc).not.toHaveBeenCalled();
    rpc.mockResolvedValue({ data: { ok: true }, error: null });
    await flagPrescription({ prescriptionId: RX, kind: "query_to_prescriber", reason: "dose_unclear" });
    expect(rpc).toHaveBeenCalledWith("pharmacy_flag_prescription", { p_prescription: RX, p_kind: "query_to_prescriber", p_reason: "dose_unclear" });
  });
  it("refuses a kind it does not know", async () => {
    await expect(flagPrescription({ prescriptionId: RX, kind: "delivery_problem" })).resolves.toMatchObject({ ok: false });
    expect(rpc).not.toHaveBeenCalled();
  });
});

const QUESTION = "7a4e2c1b-5d3f-4e8a-b6c9-0f1e2d3c4b5a";
const PATIENT = "9d8c7b6a-1e2f-4a3b-8c4d-5e6f7a8b9c0d";

describe("acting for someone (a caregiver with the pharmacy permission)", () => {
  it("passes who it is for on to the database, which checks the permission", async () => {
    rpc.mockResolvedValue({ data: { collection_code: "K7M2QX9P", pharmacy_name: "A" }, error: null });
    await expect(sendToPharmacy({ prescriptionId: RX, partnerId: PARTNER, consent: true, beneficiaryId: PATIENT })).resolves.toMatchObject({ ok: true });
    expect(rpc).toHaveBeenCalledWith("send_prescription_to_pharmacy", { p_prescription: RX, p_partner: PARTNER, p_consent: true, p_beneficiary: PATIENT });
  });
  it("sends nothing extra when the patient acts for themselves", async () => {
    rpc.mockResolvedValue({ data: { collection_code: "K7M2QX9P", pharmacy_name: "A" }, error: null });
    await sendToPharmacy({ prescriptionId: RX, partnerId: PARTNER, consent: true });
    expect(rpc).toHaveBeenCalledWith("send_prescription_to_pharmacy", { p_prescription: RX, p_partner: PARTNER, p_consent: true });
  });
  it("still needs the consent tick when acting for someone", async () => {
    await expect(sendToPharmacy({ prescriptionId: RX, partnerId: PARTNER, consent: false, beneficiaryId: PATIENT })).resolves.toEqual({ ok: false, key: "pharmacy.error.consent" });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("says plainly when the permission is missing", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "not_permitted_for_this_person" } });
    await expect(loadPharmacyOptions(RX, PATIENT)).resolves.toEqual({ ok: false, key: "pharmacy.error.not_permitted" });
    expect(rpc).toHaveBeenCalledWith("pharmacies_for_prescription", { p_prescription: RX, p_beneficiary: PATIENT });
  });
  it("can take it back for them, and refuses a malformed id", async () => {
    rpc.mockResolvedValue({ data: { ok: true }, error: null });
    await expect(withdrawFromPharmacy(RX, PATIENT)).resolves.toMatchObject({ ok: true });
    expect(rpc).toHaveBeenCalledWith("withdraw_prescription_from_pharmacy", { p_prescription: RX, p_beneficiary: PATIENT });
    await expect(withdrawFromPharmacy(RX, "not-an-id")).resolves.toEqual({ ok: false, key: "pharmacy.error" });
  });
});

describe("the prescriber's view", () => {
  const overview = {
    questions: [{ question_id: QUESTION, prescription_id: RX, asked_at: "2026-10-07T09:00:00Z", pharmacy_name: "A", reason_code: "dose_unclear", patient_name: "Ada", medicines: ["Amlodipine"], answered_at: null, answer_code: null }],
    collection: [{ prescription_id: RX, state: "sent", patient_name: "Ada", sent_at: "2026-10-07T09:00:00Z", dispensed_at: null, pharmacy_name: "A", medicines: ["Amlodipine"] }],
  };
  it("reads the overview", async () => {
    rpc.mockResolvedValue({ data: overview, error: null });
    const r = await loadPrescriberOverview();
    expect(r.ok && r.overview.questions[0]?.reason_code).toBe("dose_unclear");
    expect(rpc).toHaveBeenCalledWith("prescriber_pharmacy_overview");
  });
  it("an unreadable overview is a failed read, never an empty list", async () => {
    for (const data of [null, [], { questions: "none" }, { questions: [], collection: [{ state: "weird" }] }]) {
      rpc.mockResolvedValue({ data, error: null });
      await expect(loadPrescriberOverview()).resolves.toMatchObject({ ok: false });
    }
  });
  it("a patient or a stranger gets plain words, not the database's", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "This is for clinicians" } });
    await expect(loadPrescriberOverview()).resolves.toEqual({ ok: false, error: "This page is for clinicians." });
  });
  it("answers from the fixed list only, and revalidates the page", async () => {
    rpc.mockResolvedValue({ data: { ok: true }, error: null });
    await expect(answerPharmacyQuestion({ questionId: QUESTION, answer: "keep_as_written" })).resolves.toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("answer_pharmacy_question", { p_question: QUESTION, p_answer: "keep_as_written" });
    expect(revalidatePath).toHaveBeenCalledWith("/clinician/pharmacy");
  });
  it("refuses free text and a malformed id without calling the database", async () => {
    await expect(answerPharmacyQuestion({ questionId: QUESTION, answer: "Yes, that is fine" })).resolves.toMatchObject({ ok: false });
    await expect(answerPharmacyQuestion({ questionId: "x", answer: "keep_as_written" })).resolves.toMatchObject({ ok: false });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("tells a second answer it was already answered, and never treats an unreadable answer as recorded", async () => {
    rpc.mockResolvedValue({ data: { ok: false, reason: "already_answered" }, error: null });
    await expect(answerPharmacyQuestion({ questionId: QUESTION, answer: "keep_as_written" })).resolves.toEqual({ ok: false, error: "That question has already been answered." });
    rpc.mockResolvedValue({ data: "ok", error: null });
    await expect(answerPharmacyQuestion({ questionId: QUESTION, answer: "keep_as_written" })).resolves.toMatchObject({ ok: false });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
