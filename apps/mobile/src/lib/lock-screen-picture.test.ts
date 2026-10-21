/**
 * LSI-1 on the phone: the lock-screen picture controls appear only when the person's own switch is on (a failed read counts as off), and the
 * picture URL carries confirm=1, the chosen options and the session token, nothing about the person.
 */
import { getLockScreenImageUrl, loadLockScreenOptIn } from "./emergency";
import { supabase } from "./supabase";

jest.mock("./supabase", () => ({ supabase: { from: jest.fn(), auth: { getSession: jest.fn() } } }));
jest.mock("./api", () => ({ API_BASE_URL: "https://app.example.test" }));

const mockFrom = supabase.from as unknown as jest.Mock;
const mockSession = supabase.auth.getSession as unknown as jest.Mock;

function row(result: { data: unknown; error: unknown }) {
  mockFrom.mockReturnValue({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve(result) }) }) });
}

describe("loadLockScreenOptIn", () => {
  it("is true only when the person's own switch is on", async () => {
    row({ data: { lock_screen_opt_in: true }, error: null });
    await expect(loadLockScreenOptIn("p1")).resolves.toBe(true);
  });

  it("is false when it is off, when there is no row, and when the read fails or throws", async () => {
    row({ data: { lock_screen_opt_in: false }, error: null });
    await expect(loadLockScreenOptIn("p1")).resolves.toBe(false);
    row({ data: null, error: null });
    await expect(loadLockScreenOptIn("p1")).resolves.toBe(false);
    row({ data: { lock_screen_opt_in: true }, error: { message: "x" } });
    await expect(loadLockScreenOptIn("p1")).resolves.toBe(false);
    mockFrom.mockImplementation(() => {
      throw new Error("offline");
    });
    await expect(loadLockScreenOptIn("p1")).resolves.toBe(false);
  });
});

describe("getLockScreenImageUrl", () => {
  it("builds the URL with confirm, both options and the token", async () => {
    mockSession.mockResolvedValue({ data: { session: { access_token: "a b" } } });
    const r = await getLockScreenImageUrl({ minimum: true, qr: false });
    expect(r).toEqual({
      ok: true,
      url: "https://app.example.test/api/mobile/emergency-card/lock-screen-image?confirm=1&minimum=1&qr=0&token=a%20b",
    });
  });

  it("refuses when not signed in", async () => {
    mockSession.mockResolvedValue({ data: { session: null } });
    await expect(getLockScreenImageUrl({ minimum: true, qr: true })).resolves.toEqual({ ok: false, error: "Not signed in" });
  });
});
