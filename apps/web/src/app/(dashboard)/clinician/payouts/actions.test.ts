const rpc = jest.fn();
const invoke = jest.fn();
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn().mockResolvedValue({
    rpc: (...args: unknown[]) => rpc(...args),
    functions: { invoke: (...args: unknown[]) => invoke(...args) },
  }),
}));

import { saveBankAccount, saveTaxProfile } from "./actions";

const form = (entries: Record<string, string>): FormData => {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
};
beforeEach(() => {
  rpc.mockReset();
  invoke.mockReset();
});

describe("saveBankAccount", () => {
  it("refuses a short account number without calling anything", async () => {
    const r = await saveBankAccount(undefined, form({ bank_code: "044", account_number: "12345" }));
    expect(r?.error).toMatch(/ten digits/);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("passes only the bank and number to the function, and says verified", async () => {
    invoke.mockResolvedValue({ data: { verified: true, resolved_name: "ADA OKAFOR" }, error: null });
    const r = await saveBankAccount(undefined, form({ bank_code: "044", account_number: "0123 456 789" }));
    expect(invoke).toHaveBeenCalledWith("payouts", { body: { action: "verify_bank", bank_code: "044", account_number: "0123456789" } });
    expect(r).toMatchObject({ verified: true });
  });

  it("a different name is an explained refusal, not a save", async () => {
    invoke.mockResolvedValue({ data: { verified: false, resolved_name: "SOMEONE ELSE" }, error: null });
    const r = await saveBankAccount(undefined, form({ bank_code: "044", account_number: "0123456789" }));
    expect(r?.verified).toBe(false);
    expect(r?.error).toMatch(/does not match the name on your registration/);
  });

  it("a bank that cannot find the account is said in words", async () => {
    invoke.mockResolvedValue({ data: null, error: { message: "x", context: { json: async () => ({ error: "account_not_resolved" }) } } });
    expect((await saveBankAccount(undefined, form({ bank_code: "044", account_number: "0123456789" })))?.error).toMatch(/could not find that account/);
  });
});

describe("saveTaxProfile", () => {
  it("stores the details and calculates nothing", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    const r = await saveTaxProfile(undefined, form({ tin: "12345678-0001", status: "individual", registered_name: "", note: "", vat: "on" }));
    expect(r?.message).toMatch(/Saved/);
    expect(rpc).toHaveBeenCalledWith("save_my_tax_profile", { p_tin: "12345678-0001", p_status: "individual", p_registered_name: "", p_vat: true, p_note: "" });
  });

  it("refuses an unknown status and a malformed TIN", async () => {
    expect((await saveTaxProfile(undefined, form({ tin: "", status: "freelancer" })))?.error).toBeDefined();
    expect((await saveTaxProfile(undefined, form({ tin: "!!", status: "unknown" })))?.error).toMatch(/tax identification number/);
    expect(rpc).not.toHaveBeenCalled();
  });
});
