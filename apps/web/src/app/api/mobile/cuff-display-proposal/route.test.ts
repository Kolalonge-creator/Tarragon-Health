/**
 * Item 6: the cuff display proposal route. Proves: 401 without a session; 404 while either switch is off (fail closed, also on an RPC error);
 * the kill switch and a model failure give "unavailable" (never an error the person cannot act on); a photo that cannot be read gives "retake";
 * a good photo gives a proposal; the route has no insert path to any table; and the audit summary never contains a number.
 */
const rpc = jest.fn();
const from = jest.fn();
let moduleOn = true;
let guard: { data: unknown; error: unknown } = { data: true, error: null };

jest.mock("@/lib/supabase/bearer", () => ({
  createBearerClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }) },
    rpc: (...a: unknown[]) => rpc(...a),
    from: (...a: unknown[]) => {
      from(...a);
      return { select: () => ({ in: async () => ({ data: [{ key: "device_photo_capture", is_enabled: moduleOn }], error: null }) }) };
    },
  }),
}));

const readCuffDisplay = jest.fn();
jest.mock("@/lib/vitals/cuff-display-vision", () => ({
  CUFF_VISION_MODEL_ID: "test-model",
  isCuffVisionConfigured: () => true,
  readCuffDisplay: (...a: unknown[]) => readCuffDisplay(...a),
}));

let killSwitch = false;
let lastSummary: string | null | undefined;
jest.mock("@/lib/ai-governance", () => ({
  AI_SYSTEMS: { cuffDisplayReader: { code: "AI-022" } },
  runGovernedAi: async (p: { run: () => Promise<{ value: unknown; outputSummary?: string | null }>; fallback: (r: string) => unknown }) => {
    if (killSwitch) return { value: p.fallback("kill_switch"), status: "fallback", fallbackReason: "kill_switch" };
    const out = await p.run();
    lastSummary = out.outputSummary;
    return { value: out.value, status: "completed", fallbackReason: null };
  },
}));

import { POST } from "./route";

function req(opts: { auth?: boolean; file?: File | null } = {}): Request {
  const form = new FormData();
  if (opts.file !== null) form.set("photo", opts.file ?? new File([new Uint8Array([1, 2, 3])], "p.jpg", { type: "image/jpeg" }));
  return new Request("http://localhost/api/mobile/cuff-display-proposal", {
    method: "POST",
    headers: opts.auth === false ? {} : { authorization: "Bearer t" },
    body: form,
  });
}
const good = { display_visible: true, systolic: 128, diastolic: 82, pulse: 71, confidence: "high", note: null };

beforeEach(() => {
  jest.clearAllMocks();
  moduleOn = true;
  killSwitch = false;
  lastSummary = undefined;
  guard = { data: true, error: null };
  rpc.mockImplementation(async () => guard);
  readCuffDisplay.mockResolvedValue({ ok: true, output: good });
});

describe("POST /api/mobile/cuff-display-proposal", () => {
  it("needs a session", async () => {
    expect((await POST(req({ auth: false }))).status).toBe(401);
  });

  it("is 404 while the cuff_camera_enabled guard is closed, and never reaches the model", async () => {
    guard = { data: false, error: null };
    expect((await POST(req())).status).toBe(404);
    expect(readCuffDisplay).not.toHaveBeenCalled();
  });

  it("fails closed when the guard cannot be read", async () => {
    guard = { data: null, error: { message: "boom" } };
    expect((await POST(req())).status).toBe(404);
    expect(readCuffDisplay).not.toHaveBeenCalled();
  });

  it("is 404 while the photo capture module is off", async () => {
    moduleOn = false;
    expect((await POST(req())).status).toBe(404);
  });

  it("refuses a missing photo, a wrong type and an oversized photo", async () => {
    expect((await POST(req({ file: null }))).status).toBe(400);
    expect((await POST(req({ file: new File([new Uint8Array([1])], "p.heic", { type: "image/heic" }) }))).status).toBe(415);
    const big = new File([new Uint8Array(6 * 1024 * 1024 + 1)], "p.jpg", { type: "image/jpeg" });
    expect((await POST(req({ file: big }))).status).toBe(413);
    expect(readCuffDisplay).not.toHaveBeenCalled();
  });

  it("returns a proposal for a readable photo, with lines for the existing confirm screen", async () => {
    const res = await POST(req());
    expect(await res.json()).toEqual({ status: "proposal", systolic: 128, diastolic: 82, pulse: 71, pulse_dropped: false, lines: ["128", "82", "71"] });
  });

  it("asks for a retake for an unreadable or impossible photo, and puts no number in the audit summary", async () => {
    readCuffDisplay.mockResolvedValue({ ok: true, output: { ...good, systolic: 70, diastolic: 128 } });
    expect(await (await POST(req())).json()).toEqual({ status: "retake", reason: "implausible" });
    expect(lastSummary).toBe("refused:implausible");
    readCuffDisplay.mockResolvedValue({ ok: true, output: good });
    await POST(req());
    expect(lastSummary).toBe("proposal_made");
    expect(lastSummary).not.toMatch(/\d/);
  });

  it("answers unavailable when the kill switch is on or the model fails, so the person types the numbers", async () => {
    killSwitch = true;
    expect(await (await POST(req())).json()).toEqual({ status: "unavailable", reason: "kill_switch" });
    killSwitch = false;
    readCuffDisplay.mockResolvedValue({ ok: false, reason: "error" });
    expect(await (await POST(req())).json()).toEqual({ status: "unavailable", reason: "fallback" });
  });

  it("only ever reads the platform_modules switch: it has no path that writes a reading", async () => {
    await POST(req());
    expect(from.mock.calls.map((c) => c[0])).toEqual(["platform_modules"]);
  });
});
