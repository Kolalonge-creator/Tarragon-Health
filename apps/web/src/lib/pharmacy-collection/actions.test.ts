const rpc = jest.fn();
const redirect = jest.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
jest.mock("next/navigation", () => ({ redirect: (u: string) => redirect(u) }));
jest.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc }) }));

import { acceptSuggestionAction, choosePharmacyAction, declineSuggestionAction, newCodeAction, newVisitCodeAction, withdrawAction } from "./actions";

const RX = "11111111-1111-4111-8111-111111111111";
const P = "22222222-2222-4222-8222-222222222222";
const L = "33333333-3333-4333-8333-333333333333";
const fd = (o: Record<string, string>) => {
  const f = new FormData();
  Object.entries(o).forEach(([k, v]) => f.set(k, v));
  return f;
};
const goes = async (p: Promise<void>) => p.then(() => "no redirect", (e: Error) => e.message);

beforeEach(() => {
  rpc.mockReset();
  redirect.mockClear();
});

describe("choosePharmacyAction", () => {
  it("sends the three ids to the one database door and reports success without carrying the code in the address", async () => {
    rpc.mockResolvedValue({ data: "ABCD2345", error: null });
    expect(await goes(choosePharmacyAction(fd({ prescription: RX, partner: P, location: L })))).toBe(`REDIRECT:/patient/pharmacy/collect/${RX}?n=chosen`);
    expect(rpc).toHaveBeenCalledWith("patient_choose_pharmacy", { p_prescription: RX, p_partner: P, p_location: L });
  });
  it("never calls the database with a malformed id", async () => {
    expect(await goes(choosePharmacyAction(fd({ prescription: RX, partner: "nope", location: L })))).toBe(`REDIRECT:/patient/pharmacy/collect/${RX}?n=failed`);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("a refusal is a notice, never a success", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "pharmacy_not_available", code: "22023" } });
    expect(await goes(choosePharmacyAction(fd({ prescription: RX, partner: P, location: L })))).toBe(`REDIRECT:/patient/pharmacy/collect/${RX}?n=pharmacy_not_available`);
    rpc.mockResolvedValue({ data: null, error: { message: "collection_already_started", code: "22023" } });
    expect(await goes(choosePharmacyAction(fd({ prescription: RX, partner: P, location: L })))).toBe(`REDIRECT:/patient/pharmacy/collect/${RX}?n=collection_already_started`);
    rpc.mockResolvedValue({ data: null, error: { message: "boom", code: "XX000" } });
    expect(await goes(choosePharmacyAction(fd({ prescription: RX, partner: P, location: L })))).toBe(`REDIRECT:/patient/pharmacy/collect/${RX}?n=failed`);
  });
});

describe("newCodeAction", () => {
  it("asks for a new code and reports it", async () => {
    rpc.mockResolvedValue({ data: "WXYZ6789", error: null });
    expect(await goes(newCodeAction(fd({ prescription: RX })))).toBe(`REDIRECT:/patient/pharmacy/collect/${RX}?n=new_code`);
    expect(rpc).toHaveBeenCalledWith("patient_new_collection_code", { p_prescription: RX });
  });
  it("a refusal is a notice", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "collection_not_open", code: "22023" } });
    expect(await goes(newCodeAction(fd({ prescription: RX })))).toBe(`REDIRECT:/patient/pharmacy/collect/${RX}?n=collection_not_open`);
  });
  it("sends a bad id home without calling the database", async () => {
    expect(await goes(newCodeAction(fd({ prescription: "x" })))).toBe("REDIRECT:/patient");
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("acting for someone, and taking it back (S28c)", () => {
  const WHO = "44444444-4444-4444-8444-444444444444";
  it("passes who it is for on to the database, which checks the permission, and keeps them in the address", async () => {
    rpc.mockResolvedValue({ data: "ABCD2345", error: null });
    expect(await goes(choosePharmacyAction(fd({ prescription: RX, partner: P, location: L, for: WHO })))).toBe(`REDIRECT:/patient/pharmacy/collect/${RX}?n=chosen&for=${WHO}`);
    expect(rpc).toHaveBeenCalledWith("patient_choose_pharmacy", { p_prescription: RX, p_partner: P, p_location: L, p_beneficiary: WHO });
  });
  it("ignores a 'for' that is not an id, without calling the database", async () => {
    expect(await goes(choosePharmacyAction(fd({ prescription: RX, partner: P, location: L, for: "someone" })))).toBe(`REDIRECT:/patient/pharmacy/collect/${RX}?n=failed`);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("a missing permission is a notice, never a success", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "not_permitted_for_this_person", code: "42501" } });
    expect(await goes(choosePharmacyAction(fd({ prescription: RX, partner: P, location: L, for: WHO })))).toBe(`REDIRECT:/patient/pharmacy/collect/${RX}?n=not_permitted_for_this_person&for=${WHO}`);
  });
  it("a closed go-live guard is a calm notice", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "pharmacy_collection_off", code: "55000" } });
    expect(await goes(choosePharmacyAction(fd({ prescription: RX, partner: P, location: L })))).toBe(`REDIRECT:/patient/pharmacy/collect/${RX}?n=pharmacy_collection_off`);
  });
  it("takes it back, for the patient or for someone she is acted for", async () => {
    rpc.mockResolvedValue({ data: { ok: true }, error: null });
    expect(await goes(withdrawAction(fd({ prescription: RX })))).toBe(`REDIRECT:/patient/pharmacy/collect/${RX}?n=withdrawn`);
    expect(rpc).toHaveBeenCalledWith("patient_withdraw_from_pharmacy", { p_prescription: RX });
    expect(await goes(withdrawAction(fd({ prescription: RX, for: WHO })))).toBe(`REDIRECT:/patient/pharmacy/collect/${RX}?n=withdrawn&for=${WHO}`);
    expect(rpc).toHaveBeenLastCalledWith("patient_withdraw_from_pharmacy", { p_prescription: RX, p_beneficiary: WHO });
  });
  it("a refused take-back is a notice and a bad id goes home", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "collection_already_started", code: "22023" } });
    expect(await goes(withdrawAction(fd({ prescription: RX })))).toBe(`REDIRECT:/patient/pharmacy/collect/${RX}?n=collection_already_started`);
    expect(await goes(withdrawAction(fd({ prescription: "x" })))).toBe("REDIRECT:/patient");
  });
});

const SG = "44444444-4444-4444-8444-444444444444";
describe("suggestion actions (S54c)", () => {
  it("accepting goes through the one database door by suggestion id and reports success without the code in the address", async () => {
    rpc.mockResolvedValue({ data: "ABCD2345", error: null });
    expect(await goes(acceptSuggestionAction(fd({ prescription: RX, suggestion: SG })))).toBe(`REDIRECT:/patient/pharmacy/collect/${RX}?n=chosen`);
    expect(rpc).toHaveBeenCalledWith("patient_accept_pharmacy_suggestion", { p_suggestion: SG });
  });
  it("a closed suggestion or an unavailable pharmacy is a notice and changes nothing", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "suggestion_not_open", code: "22023" } });
    expect(await goes(acceptSuggestionAction(fd({ prescription: RX, suggestion: SG })))).toBe(`REDIRECT:/patient/pharmacy/collect/${RX}?n=suggestion_not_open`);
    rpc.mockResolvedValue({ data: null, error: { message: "pharmacy_not_available", code: "22023" } });
    expect(await goes(acceptSuggestionAction(fd({ prescription: RX, suggestion: SG })))).toBe(`REDIRECT:/patient/pharmacy/collect/${RX}?n=pharmacy_not_available`);
  });
  it("declining closes the suggestion and sends nothing", async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    expect(await goes(declineSuggestionAction(fd({ prescription: RX, suggestion: SG })))).toBe(`REDIRECT:/patient/pharmacy/collect/${RX}?n=suggestion_declined`);
    expect(rpc).toHaveBeenCalledWith("patient_decline_pharmacy_suggestion", { p_suggestion: SG });
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    expect(await goes(declineSuggestionAction(fd({ prescription: RX, suggestion: SG })))).toBe(`REDIRECT:/patient/pharmacy/collect/${RX}?n=failed`);
  });
  it("declining a suggestion that was already settled says so, never that nothing was sent", async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    expect(await goes(declineSuggestionAction(fd({ prescription: RX, suggestion: SG })))).toBe(`REDIRECT:/patient/pharmacy/collect/${RX}?n=suggestion_not_open`);
  });
  it("never calls the database with a malformed id", async () => {
    expect(await goes(acceptSuggestionAction(fd({ prescription: RX, suggestion: "x" })))).toBe(`REDIRECT:/patient/pharmacy/collect/${RX}?n=failed`);
    expect(await goes(declineSuggestionAction(fd({ prescription: "x", suggestion: SG })))).toBe("REDIRECT:/patient");
    expect(rpc).not.toHaveBeenCalled();
  });
});

const RX2 = "55555555-5555-4555-8555-555555555555";
const RX3 = "66666666-6666-4666-8666-666666666666";
describe("one pharmacy for several medicines (S28e, OQ-275)", () => {
  const many = (o: { also?: string[]; choice?: string; for?: string } = {}) => {
    const f = new FormData();
    f.set("prescription", RX);
    f.set("choice", o.choice ?? `${P}:${L}`);
    (o.also ?? []).forEach((a) => f.append("also", a));
    if (o.for) f.set("for", o.for);
    return f;
  };
  it("ticked medicines go to the one visit door together, this one first, and the code is never in the address", async () => {
    rpc.mockResolvedValue({ data: "ABCD2345", error: null });
    expect(await goes(choosePharmacyAction(many({ also: [RX2, RX3] })))).toBe(`REDIRECT:/patient/pharmacy/collect/${RX}?n=chosen_many`);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("patient_choose_pharmacy_for_visit", { p_prescriptions: [RX, RX2, RX3], p_partner: P, p_location: L });
  });
  it("with no ticks it is the same single choice as before", async () => {
    rpc.mockResolvedValue({ data: "ABCD2345", error: null });
    expect(await goes(choosePharmacyAction(many()))).toBe(`REDIRECT:/patient/pharmacy/collect/${RX}?n=chosen`);
    expect(rpc).toHaveBeenCalledWith("patient_choose_pharmacy", { p_prescription: RX, p_partner: P, p_location: L });
  });
  it("this medicine ticked as well, or ticked twice, is counted once", async () => {
    rpc.mockResolvedValue({ data: "ABCD2345", error: null });
    await goes(choosePharmacyAction(many({ also: [RX, RX2, RX2] })));
    expect(rpc).toHaveBeenCalledWith("patient_choose_pharmacy_for_visit", { p_prescriptions: [RX, RX2], p_partner: P, p_location: L });
  });
  it("passes who it is for, and keeps them in the address", async () => {
    const WHO = "44444444-4444-4444-8444-444444444444";
    rpc.mockResolvedValue({ data: "ABCD2345", error: null });
    expect(await goes(choosePharmacyAction(many({ also: [RX2], for: WHO })))).toBe(`REDIRECT:/patient/pharmacy/collect/${RX}?n=chosen_many&for=${WHO}`);
    expect(rpc).toHaveBeenCalledWith("patient_choose_pharmacy_for_visit", { p_prescriptions: [RX, RX2], p_partner: P, p_location: L, p_beneficiary: WHO });
  });
  it("one refusal is a notice for the whole visit, never a success", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "collection_not_open", code: "22023" } });
    expect(await goes(choosePharmacyAction(many({ also: [RX2] })))).toBe(`REDIRECT:/patient/pharmacy/collect/${RX}?n=collection_not_open`);
    rpc.mockResolvedValue({ data: null, error: { message: "visit_size_invalid", code: "22023" } });
    expect(await goes(choosePharmacyAction(many({ also: [RX2] })))).toBe(`REDIRECT:/patient/pharmacy/collect/${RX}?n=visit_size_invalid`);
  });
  it("someone acting for the patient only ever renews the one prescription, never the visit-wide code (that code opens every medicine in the visit)", async () => {
    const WHO2 = "44444444-4444-4444-8444-444444444444";
    rpc.mockResolvedValueOnce({ data: "WXYZ6789", error: null });
    expect(await goes(newCodeAction(fd({ prescription: RX, for: WHO2 })))).toBe(`REDIRECT:/patient/pharmacy/collect/${RX}?n=new_code&for=${WHO2}`);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("patient_new_collection_code", { p_prescription: RX, p_beneficiary: WHO2 });
  });
  it("a new code for the whole visit goes through its own door and reports a new code, never the code itself", async () => {
    rpc.mockResolvedValue({ data: "WXYZ6789", error: null });
    expect(await goes(newVisitCodeAction(fd({ prescription: RX })))).toBe(`REDIRECT:/patient/pharmacy/collect/${RX}?n=new_code`);
    expect(rpc).toHaveBeenCalledWith("patient_new_visit_code", { p_prescription: RX });
    rpc.mockResolvedValue({ data: null, error: { message: "collection_not_open", code: "22023" } });
    expect(await goes(newVisitCodeAction(fd({ prescription: RX })))).toBe(`REDIRECT:/patient/pharmacy/collect/${RX}?n=collection_not_open`);
    expect(await goes(newVisitCodeAction(fd({ prescription: "x" })))).toBe("REDIRECT:/patient");
  });
  it("never calls the database with a malformed id, choice or tick, or with more than ten", async () => {
    expect(await goes(choosePharmacyAction(many({ choice: "nope" })))).toBe(`REDIRECT:/patient/pharmacy/collect/${RX}?n=failed`);
    expect(await goes(choosePharmacyAction(many({ also: ["x"] })))).toBe(`REDIRECT:/patient/pharmacy/collect/${RX}?n=failed`);
    const ten = Array.from({ length: 10 }, (_, i) => `77777777-7777-4777-8777-${String(i).padStart(12, "0")}`);
    // too many gets the size message, not a generic failure
    expect(await goes(choosePharmacyAction(many({ also: ten })))).toBe(`REDIRECT:/patient/pharmacy/collect/${RX}?n=visit_size_invalid`);
    expect(rpc).not.toHaveBeenCalled();
  });
});
