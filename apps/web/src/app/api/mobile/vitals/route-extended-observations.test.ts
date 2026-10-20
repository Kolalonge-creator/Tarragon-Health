/**
 * S47a: water, sleep, mood and inhaler use through POST /api/mobile/vitals.
 * - refused with 403 and a plain sentence while the extended_observations module is off (nothing is written);
 * - an implausible number is refused with the plain sentence (400) before any write;
 * - a good log is written to value_numeric with no red-flag assessor run (these types have no rule set, nothing pages anyone);
 * - a replayed client id (23505) is a success; the inhaler log goes through the log_inhaler_use function with the client id.
 */
jest.mock("@sentry/nextjs", () => ({ captureException: jest.fn() }));

const assessBp = jest.fn();
const assessHr = jest.fn();
const assessGlucose = jest.fn();
const assessScore = jest.fn();
jest.mock("@/lib/ml/assess-bp-control", () => ({ assessBpControlBestEffort: (...a: unknown[]) => assessBp(...a) }));
jest.mock("@/lib/vitals/assess-heart-rate", () => ({ assessHeartRateBestEffort: (...a: unknown[]) => assessHr(...a) }));
jest.mock("@/lib/vitals/assess-glucose", () => ({ assessGlucoseBestEffort: (...a: unknown[]) => assessGlucose(...a) }));
jest.mock("@/lib/health-score/assess-health-score", () => ({ assessHealthScoreBestEffort: (...a: unknown[]) => assessScore(...a) }));

const insert = jest.fn();
const single = jest.fn();
const getUser = jest.fn();
const moduleRow = jest.fn();
const rpc = jest.fn();

jest.mock("@/lib/supabase/bearer", () => ({
  createBearerClient: () => ({
    auth: { getUser: (...a: unknown[]) => getUser(...a) },
    from: (table: string) => {
      if (table === "profiles") return { select: () => ({ eq: () => ({ single }) }) };
      if (table === "vitals_readings") return { insert };
      if (table === "platform_modules") return { select: () => ({ eq: () => ({ maybeSingle: moduleRow }) }) };
      throw new Error(`unexpected table ${table}`);
    },
    rpc: (...a: unknown[]) => rpc(...a),
  }),
}));

import { POST } from "./route";

const CLIENT_ID = "5b1f1b6e-2d6c-4b7e-8d57-1f0e7d0c9a11";
function request(body: Record<string, unknown>): Request {
  return new Request("https://app.tarragonhealth.ng/api/mobile/vitals", {
    method: "POST",
    headers: { authorization: "Bearer token-1", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/mobile/vitals: water, sleep, mood, inhaler (S47a)", () => {
  beforeEach(() => {
    [assessBp, assessHr, assessGlucose, assessScore, rpc].forEach((m) => m.mockReset());
    assessScore.mockResolvedValue(undefined);
    getUser.mockResolvedValue({ data: { user: { id: "patient-1" } }, error: null });
    single.mockResolvedValue({ data: { organisation_id: "org-1" } });
    insert.mockReset().mockResolvedValue({ error: null });
    moduleRow.mockReset().mockResolvedValue({ data: { is_enabled: true }, error: null });
    rpc.mockResolvedValue({ data: "log-id", error: null });
  });

  it("writes water to value_numeric and runs no red-flag assessor", async () => {
    const res = await POST(request({ vital_type: "water_ml", water_ml: 250, taken_at: "2026-10-02T08:00:00.000Z", client_reading_id: CLIENT_ID }));
    expect(res.status).toBe(200);
    expect(insert.mock.calls[0][0]).toMatchObject({
      patient_id: "patient-1",
      organisation_id: "org-1",
      source: "manual",
      vital_type: "water_ml",
      value_numeric: 250,
      client_recorded_at: "2026-10-02T08:00:00.000Z",
      client_reading_id: CLIENT_ID,
    });
    expect(assessBp).not.toHaveBeenCalled();
    expect(assessHr).not.toHaveBeenCalled();
    expect(assessGlucose).not.toHaveBeenCalled();
  });

  it("is refused with a plain 403 and writes nothing while the module is off", async () => {
    moduleRow.mockResolvedValue({ data: { is_enabled: false }, error: null });
    const res = await POST(request({ vital_type: "sleep_hours", sleep_hours: 7 }));
    expect(res.status).toBe(403);
    expect(insert).not.toHaveBeenCalled();
    expect(((await res.json()) as { error: string }).error).toContain("not switched on");
  });

  it("an unreadable switch is an off switch (fails closed)", async () => {
    moduleRow.mockResolvedValue({ data: null, error: { message: "boom" } });
    const res = await POST(request({ vital_type: "mood", mood: 4 }));
    expect(res.status).toBe(403);
    expect(insert).not.toHaveBeenCalled();
  });

  it.each([
    [{ vital_type: "water_ml", water_ml: 5000 }, "millilitres"],
    [{ vital_type: "sleep_hours", sleep_hours: 30 }, "hours"],
    [{ vital_type: "mood", mood: 6 }, "1 to 5"],
    [{ vital_type: "mood", mood: 2.5 }, "1 to 5"],
    [{ vital_type: "inhaler_use", puffs: 25, reason: "other" }, "1 to 20"],
  ])("rejects %j with a plain message before writing", async (body, word) => {
    const res = await POST(request(body));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain(word);
    expect(insert).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("a replayed client id is a success", async () => {
    insert.mockResolvedValue({ error: { code: "23505", message: "duplicate" } });
    const res = await POST(request({ vital_type: "mood", mood: 4, client_reading_id: CLIENT_ID }));
    expect(res.status).toBe(200);
  });

  it("the database CHECK answering is the same plain refusal, not a 500", async () => {
    insert.mockResolvedValue({ error: { code: "23514", message: "check" } });
    const res = await POST(request({ vital_type: "water_ml", water_ml: 250 }));
    expect(res.status).toBe(400);
  });

  it("the inhaler log goes through log_inhaler_use with the client id and the supporter's person", async () => {
    const res = await POST(request({ vital_type: "inhaler_use", puffs: 2, reason: "before_exercise", client_reading_id: CLIENT_ID }));
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("log_inhaler_use", { p_puffs: 2, p_reason: "before_exercise", p_client_log_id: CLIENT_ID });
    expect(insert).not.toHaveBeenCalled();
  });

  it("an inhaler log without a reason is refused", async () => {
    const res = await POST(request({ vital_type: "inhaler_use", puffs: 2 }));
    expect(res.status).toBe(400);
  });
});
