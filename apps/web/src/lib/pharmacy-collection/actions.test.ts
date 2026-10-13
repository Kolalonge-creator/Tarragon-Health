const rpc = jest.fn();
const redirect = jest.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
jest.mock("next/navigation", () => ({ redirect: (u: string) => redirect(u) }));
jest.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc }) }));

import { choosePharmacyAction, newCodeAction, withdrawAction } from "./actions";

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
