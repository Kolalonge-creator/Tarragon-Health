/**
 * T2-11b: the "enter the code" box on /verify-rx. A match goes to the same page the QR opens; the typed code never goes into a URL;
 * a bad shape never reaches the database; the per-connection limit runs first; the database lock is told apart from other errors.
 */
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

import { checkPrescriptionCodeAction } from "./actions";

const TOKEN = "b".repeat(64);

function form(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

async function run(fields: Record<string, string>): Promise<string> {
  try {
    await checkPrescriptionCodeAction(form(fields));
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

describe("checkPrescriptionCodeAction", () => {
  it("normalises what was typed and sends a match to the same page the QR opens", async () => {
    rpcMock.mockResolvedValue({ data: TOKEN, error: null });
    expect(await run({ rxNumber: " trg-rx-2026-000123 ", code: "ab 12 cd" })).toBe(`REDIRECT:/verify-rx/${TOKEN}`);
    expect(rpcMock).toHaveBeenCalledWith("verify_prescription_by_code", { p_rx_number: "TRG-RX-2026-000123", p_code: "AB12CD" });
  });

  it("never puts the typed code in a URL", async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });
    const url = await run({ rxNumber: "TRG-RX-2026-000123", code: "AB12CD" });
    expect(url).toBe("REDIRECT:/verify-rx?n=not_found");
    expect(url).not.toMatch(/AB12CD|000123/);
  });

  it("refuses a bad shape without calling the database", async () => {
    expect(await run({ rxNumber: "", code: "AB12CD" })).toBe("REDIRECT:/verify-rx?n=invalid");
    expect(await run({ rxNumber: "TRG RX ; drop", code: "!!" })).toBe("REDIRECT:/verify-rx?n=invalid");
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("is rate limited per connection before it touches the database", async () => {
    rateLimitMock.mockResolvedValue({ success: false, retryAfterSeconds: 60 });
    expect(await run({ rxNumber: "TRG-RX-2026-000123", code: "AB12CD" })).toBe("REDIRECT:/verify-rx?n=rate_limited");
    expect(rpcMock).not.toHaveBeenCalled();
    expect(rateLimitMock).toHaveBeenCalledWith("verify-rx-code:ip:1.2.3.4", { limit: 10, windowSeconds: 600 });
  });

  it("tells the database lock apart from any other error, and never treats an error as a match", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "too_many_attempts" } });
    expect(await run({ rxNumber: "TRG-RX-2026-000123", code: "AB12CD" })).toBe("REDIRECT:/verify-rx?n=locked");
    rpcMock.mockResolvedValue({ data: TOKEN, error: { message: "boom" } });
    expect(await run({ rxNumber: "TRG-RX-2026-000123", code: "AB12CD" })).toBe("REDIRECT:/verify-rx?n=unavailable");
    rpcMock.mockResolvedValue({ data: "not-a-token", error: null });
    expect(await run({ rxNumber: "TRG-RX-2026-000123", code: "AB12CD" })).toBe("REDIRECT:/verify-rx?n=not_found");
  });
});
