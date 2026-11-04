jest.mock("server-only", () => ({}));

import { googleSignInAvailable } from "./google-sign-in";

const realFetch = global.fetch;
const env = { ...process.env };

function respond(body: unknown, ok = true) {
  global.fetch = jest.fn().mockResolvedValue({ ok, json: async () => body }) as unknown as typeof fetch;
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
});
afterAll(() => {
  global.fetch = realFetch;
  process.env = env;
});

describe("googleSignInAvailable", () => {
  it("is true only when Supabase reports the Google provider switched on", async () => {
    respond({ external: { google: true, email: true } });
    await expect(googleSignInAvailable()).resolves.toBe(true);
    expect((global.fetch as jest.Mock).mock.calls[0][0]).toBe("https://example.supabase.co/auth/v1/settings");
    respond({ external: { google: false, email: true } });
    await expect(googleSignInAvailable()).resolves.toBe(false);
  });

  it("hides the button on any failure instead of throwing", async () => {
    respond({}, false);
    await expect(googleSignInAvailable()).resolves.toBe(false);
    global.fetch = jest.fn().mockRejectedValue(new Error("network")) as unknown as typeof fetch;
    await expect(googleSignInAvailable()).resolves.toBe(false);
    respond({ external: "nonsense" });
    await expect(googleSignInAvailable()).resolves.toBe(false);
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    await expect(googleSignInAvailable()).resolves.toBe(false);
  });
});
