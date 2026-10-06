/**
 * OQ-158: both mobile consultation routes share one auth/deps path and hand off to the same pure functions the web room uses.
 * These prove the edges that belong to the routes themselves: bearer check, input validation, the vendor being unconfigured,
 * the outcome passing through untouched, and that nothing is cacheable (a response may hold a join link or a passcode).
 */
const getUser = jest.fn();
const userRpc = jest.fn();
jest.mock("@/lib/supabase/bearer", () => ({
  createBearerClient: () => ({ auth: { getUser: (...a: unknown[]) => getUser(...a) }, rpc: (...a: unknown[]) => userRpc(...a) }),
}));
jest.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: () => ({ rpc: jest.fn() }) }));
const videoProvider = jest.fn();
jest.mock("@/lib/consultations/providers", () => ({ videoProvider: () => videoProvider() }));
const joinConsultation = jest.fn();
const requestDialIn = jest.fn();
jest.mock("@/lib/consultations/room", () => ({
  joinConsultation: (...a: unknown[]) => joinConsultation(...a),
  requestDialIn: (...a: unknown[]) => requestDialIn(...a),
}));

import { POST as join } from "./join/route";
import { POST as dialIn } from "./dial-in/route";

const ID = "5d1f6c1e-8a43-4b0e-9d6a-1c2b3d4e5f60";

function req(path: string, body: unknown, token: string | null = "tok"): Request {
  return new Request(`https://app.tarragonhealth.ng/api/mobile/consultations/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  userRpc.mockResolvedValue({ data: { role: "patient" }, error: null });
  getUser.mockResolvedValue({ data: { user: { id: "patient-1" } }, error: null });
  videoProvider.mockReturnValue({ ok: true, data: { name: "mock" } });
  joinConsultation.mockResolvedValue({ ok: true, url: "https://zoom.example/j/1", mediaMode: "video", audioOnlyEnforced: false, recorded: true });
  requestDialIn.mockResolvedValue({ ok: true, dialIn: { numbers: [{ number: "+234 1 000 0000" }], meetingId: "123", passcode: "9" } });
});

describe.each([
  ["join", join, { encounterId: ID, media: "video" }],
  ["dial-in", dialIn, { encounterId: ID }],
] as const)("%s route", (path, handler, goodBody) => {
  it("refuses a request with no bearer token", async () => {
    expect((await handler(req(path, goodBody, null))).status).toBe(401);
    expect(joinConsultation).not.toHaveBeenCalled();
    expect(requestDialIn).not.toHaveBeenCalled();
  });

  it("refuses an expired or invalid session", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: { message: "expired" } });
    expect((await handler(req(path, goodBody))).status).toBe(401);
    expect(joinConsultation).not.toHaveBeenCalled();
    expect(requestDialIn).not.toHaveBeenCalled();
  });

  it("rejects a malformed body without calling the room logic", async () => {
    expect((await handler(req(path, "{nope"))).status).toBe(400);
    expect((await handler(req(path, { encounterId: "not-a-uuid", media: "video" }))).status).toBe(400);
    expect(joinConsultation).not.toHaveBeenCalled();
    expect(requestDialIn).not.toHaveBeenCalled();
  });

  it.each([
    ["a clinician on the consultation", { data: { role: "clinician" }, error: null }],
    ["a stranger or an unknown id (the view is null)", { data: null, error: null }],
  ])("refuses %s: this room is the patient's, and nothing is issued", async (_label, answer) => {
    userRpc.mockResolvedValue(answer);
    const res = await handler(req(path, goodBody));
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(false);
    expect(userRpc).toHaveBeenCalledWith("consultation_room_view", { p_encounter: ID });
    expect(joinConsultation).not.toHaveBeenCalled();
    expect(requestDialIn).not.toHaveBeenCalled();
  });

  it("answers a failed role check with a 500 (retryable), not a definitive refusal", async () => {
    userRpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    const res = await handler(req(path, goodBody));
    expect(res.status).toBe(500);
    expect(joinConsultation).not.toHaveBeenCalled();
    expect(requestDialIn).not.toHaveBeenCalled();
  });

  it("answers with a reason code, not a vendor message, when the vendor is not configured", async () => {
    videoProvider.mockReturnValue({ ok: false, error: { code: "not_configured", message: "ZOOM_SECRET missing" } });
    const res = await handler(req(path, goodBody));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, reason: "provider" });
  });
});

describe("join route", () => {
  it("rejects a media value the room does not offer", async () => {
    expect((await join(req("join", { encounterId: ID, media: "phone" }))).status).toBe(400);
  });

  it("passes the signed-in person, the encounter and the media to joinConsultation and returns its outcome uncached", async () => {
    const res = await join(req("join", { encounterId: ID, media: "audio_only" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect((await res.json()).url).toBe("https://zoom.example/j/1");
    const [deps, id, media] = joinConsultation.mock.calls[0];
    expect(deps.userId).toBe("patient-1");
    expect([id, media]).toEqual([ID, "audio_only"]);
  });

  it("passes a refusal through as is (the window is the server's call)", async () => {
    joinConsultation.mockResolvedValue({ ok: false, reason: "not_open", opensAt: "2026-10-07T09:00:00Z" });
    expect(await (await join(req("join", { encounterId: ID, media: "video" }))).json()).toEqual({ ok: false, reason: "not_open", opensAt: "2026-10-07T09:00:00Z" });
  });
});

describe("dial-in route", () => {
  it("returns the numbers, meeting id and passcode uncached", async () => {
    const res = await dialIn(req("dial-in", { encounterId: ID }));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ ok: true, dialIn: { numbers: [{ number: "+234 1 000 0000" }], meetingId: "123", passcode: "9" } });
    expect(requestDialIn.mock.calls[0][1]).toBe(ID);
  });

  it("passes a refusal through", async () => {
    requestDialIn.mockResolvedValue({ ok: false, reason: "phone_unavailable" });
    expect(await (await dialIn(req("dial-in", { encounterId: ID }))).json()).toEqual({ ok: false, reason: "phone_unavailable" });
  });
});
