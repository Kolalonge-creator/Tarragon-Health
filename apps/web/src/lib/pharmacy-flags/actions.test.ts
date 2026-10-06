const rpc = jest.fn();
const redirect = jest.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
jest.mock("next/navigation", () => ({ redirect: (u: string) => redirect(u) }));
jest.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc }) }));

import { flagPrescriptionAction } from "./actions";

const ID = "11111111-1111-4111-8111-111111111111";
const fd = (o: Record<string, string>) => {
  const f = new FormData();
  Object.entries(o).forEach(([k, v]) => f.set(k, v));
  return f;
};
const goes = async (p: Promise<void>) => p.then(() => "no redirect", (e: Error) => e.message);
const good = { prescription: ID, kind: "out_of_stock", reason: "We do not have this in stock" };

beforeEach(() => {
  rpc.mockReset();
  redirect.mockClear();
});

describe("flagPrescriptionAction", () => {
  it("sends the kind and trimmed reason to the one database door and reports success", async () => {
    rpc.mockResolvedValue({ data: ID, error: null });
    expect(await goes(flagPrescriptionAction(fd({ ...good, reason: "  We do not have this in stock  " })))).toBe("REDIRECT:/pharmacist/prescriptions?n=flagged");
    expect(rpc).toHaveBeenCalledWith("pharmacist_flag_prescription", { p_prescription: ID, p_kind: "out_of_stock", p_reason: "We do not have this in stock" });
  });
  it("never calls the database with a short reason", async () => {
    expect(await goes(flagPrescriptionAction(fd({ ...good, reason: "short" })))).toBe("REDIRECT:/pharmacist/prescriptions?n=flag_reason");
    expect(rpc).not.toHaveBeenCalled();
  });
  it("never calls the database with an unknown kind", async () => {
    expect(await goes(flagPrescriptionAction(fd({ ...good, kind: "dispensed" })))).toBe("REDIRECT:/pharmacist/prescriptions?n=flag_failed");
    expect(rpc).not.toHaveBeenCalled();
  });
  it("a refusal is a failure notice, never a success", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "Prescription not found for this pharmacy", code: "42501" } });
    expect(await goes(flagPrescriptionAction(fd(good)))).toBe("REDIRECT:/pharmacist/prescriptions?n=flag_failed");
  });
  it("a prescription no longer waiting gets its own notice", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "pharmacy_flag_not_open", code: "22023" } });
    expect(await goes(flagPrescriptionAction(fd(good)))).toBe("REDIRECT:/pharmacist/prescriptions?n=flag_not_open");
  });
  it("only ever calls the flag function, never anything that dispenses or edits", async () => {
    rpc.mockResolvedValue({ data: ID, error: null });
    await goes(flagPrescriptionAction(fd(good)));
    expect(rpc.mock.calls.map((c) => c[0])).toEqual(["pharmacist_flag_prescription"]);
  });
});
