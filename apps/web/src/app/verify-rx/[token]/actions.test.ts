const redirectMock = jest.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
jest.mock("next/navigation", () => ({ redirect: (url: string) => redirectMock(url) }));
const rateLimitMock = jest.fn();
jest.mock("@/lib/rate-limit", () => ({
  getClientIp: async () => "1.2.3.4",
  rateLimit: (...args: unknown[]) => rateLimitMock(...args),
}));
const rpcMock = jest.fn();
jest.mock("@supabase/supabase-js", () => ({ createClient: () => ({ rpc: rpcMock }) }));

import { recordSupplyAction } from "./actions";

const TOKEN = "a".repeat(64);

function form(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}
const valid = { token: TOKEN, pharmacyName: "City Pharmacy", pharmacistName: "Ada Obi", pharmacistRegistration: "PCN-1234", confirmed: "on" };

async function run(fields: Record<string, string>): Promise<string> {
  try {
    await recordSupplyAction(form(fields));
  } catch (error) {
    return (error as Error).message;
  }
  return "no redirect";
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
  rateLimitMock.mockReset().mockResolvedValue({ success: true, retryAfterSeconds: 0 });
  rpcMock.mockReset();
  redirectMock.mockClear();
});

describe("recordSupplyAction", () => {
  it("passes the typed names to the database and redirects with the outcome", async () => {
    rpcMock.mockResolvedValue({ data: [{ outcome: "recorded", supplies_dispensed: 1, supplies_permitted: 1 }], error: null });
    expect(await run(valid)).toBe(`REDIRECT:/verify-rx/${TOKEN}?result=recorded`);
    expect(rpcMock).toHaveBeenCalledWith("record_prescription_supply_public", {
      p_token: TOKEN,
      p_pharmacy_name: "City Pharmacy",
      p_pharmacist_name: "Ada Obi",
      p_pharmacist_registration: "PCN-1234",
    });
  });

  it("requires the confirmation box, a name of at least two letters, and never calls the database otherwise", async () => {
    expect(await run({ ...valid, confirmed: "" })).toBe(`REDIRECT:/verify-rx/${TOKEN}?result=invalid`);
    expect(await run({ ...valid, pharmacyName: "A" })).toBe(`REDIRECT:/verify-rx/${TOKEN}?result=invalid`);
    expect(await run({ ...valid, pharmacistRegistration: "" })).toBe(`REDIRECT:/verify-rx/${TOKEN}?result=invalid`);
    expect(await run({ ...valid, pharmacistRegistration: "!!" })).toBe(`REDIRECT:/verify-rx/${TOKEN}?result=invalid`);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("sends a malformed token to the index, not to a page keyed on it", async () => {
    expect(await run({ ...valid, token: "nope" })).toBe("REDIRECT:/verify-rx");
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("is rate limited before it touches the database", async () => {
    rateLimitMock.mockResolvedValue({ success: false, retryAfterSeconds: 60 });
    expect(await run(valid)).toBe(`REDIRECT:/verify-rx/${TOKEN}?result=rate_limited`);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("treats a database error or an unknown outcome as an error, never as recorded", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "boom" } });
    expect(await run(valid)).toBe(`REDIRECT:/verify-rx/${TOKEN}?result=error`);
    rpcMock.mockResolvedValue({ data: [{ outcome: "something_new" }], error: null });
    expect(await run(valid)).toBe(`REDIRECT:/verify-rx/${TOKEN}?result=error`);
  });

  it("relays a refusal from the database unchanged", async () => {
    rpcMock.mockResolvedValue({ data: [{ outcome: "no_supply_available" }], error: null });
    expect(await run(valid)).toBe(`REDIRECT:/verify-rx/${TOKEN}?result=no_supply_available`);
  });
});
