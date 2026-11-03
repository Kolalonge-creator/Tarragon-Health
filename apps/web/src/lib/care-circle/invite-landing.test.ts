jest.mock("server-only", () => ({}));
const rpc = jest.fn();
jest.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: () => ({ rpc: (...a: unknown[]) => rpc(...a) }) }));
let allowed = true;
const rateLimit = jest.fn(async () => ({ success: allowed }));
jest.mock("@/lib/rate-limit", () => ({ getClientIp: async () => "203.0.113.9", rateLimit: (...a: unknown[]) => rateLimit(...(a as [])) }));

import { loadInviteLanding } from "./invite-landing";

const TOKEN = "abcdefghijklmnopqrstuvwxyz0123456789_-AB";
const VALID = { ok: true, inviter_first_name: "Ngozi", permissions: ["weekly_bp_trend", "red_alerts"], contact_kind: "email", contact_hint: "a***@x.com" };

beforeEach(() => {
  rpc.mockReset();
  rateLimit.mockClear();
  allowed = true;
});

describe("loadInviteLanding (signed-out Care Circle landing)", () => {
  it("asks the database with the token, behind a per-address limit, and returns only what it parsed", async () => {
    rpc.mockResolvedValue({ data: VALID, error: null });
    expect(await loadInviteLanding(TOKEN)).toEqual(VALID);
    expect(rpc).toHaveBeenCalledWith("care_circle_invite_landing", { p_token: TOKEN });
    expect(rateLimit).toHaveBeenCalledWith("circle:landing:203.0.113.9", { limit: 30, windowSeconds: 600 });
  });

  it("never calls the database for a malformed token", async () => {
    expect(await loadInviteLanding("not a token")).toEqual({ ok: false });
    expect(rpc).not.toHaveBeenCalled();
    expect(rateLimit).not.toHaveBeenCalled();
  });

  it("says it is rate limited without calling the database", async () => {
    allowed = false;
    expect(await loadInviteLanding(TOKEN)).toEqual({ ok: false, rate_limited: true });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("turns an error, a throw or an odd shape into the same { ok: false }", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    expect(await loadInviteLanding(TOKEN)).toEqual({ ok: false });
    rpc.mockRejectedValueOnce(new Error("network"));
    expect(await loadInviteLanding(TOKEN)).toEqual({ ok: false });
    rpc.mockResolvedValueOnce({ data: { ok: true, patient_id: "x" }, error: null });
    expect(await loadInviteLanding(TOKEN)).toEqual({ ok: false });
  });
});
