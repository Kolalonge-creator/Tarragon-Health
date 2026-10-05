import { parseWeeklyAdherencePayload, readWeeklyAdherence } from "./weekly-adherence";

const ok = {
  status: "ok",
  percent: 71,
  due: 14,
  taken: 9,
  late: 1,
  skipped: 1,
  missed: 3,
  unavailable: 0,
  below_threshold: true,
  threshold_percent: 80,
  window_start: "2026-09-29",
  window_end: "2026-10-05",
};

describe("parseWeeklyAdherencePayload", () => {
  it("reads a good response", () => {
    expect(parseWeeklyAdherencePayload(ok)).toEqual({
      status: "ok",
      adherence: {
        percent: 71,
        due: 14,
        taken: 9,
        late: 1,
        skipped: 1,
        missed: 3,
        unavailable: 0,
        belowThreshold: true,
        thresholdPercent: 80,
        windowStart: "2026-09-29",
        windowEnd: "2026-10-05",
      },
    });
  });

  it("keeps a null percent (too few doses) as null, never zero", () => {
    const r = parseWeeklyAdherencePayload({ ...ok, percent: null, below_threshold: false, due: 2 });
    expect(r).toMatchObject({ status: "ok", adherence: { percent: null, belowThreshold: false } });
  });

  it("passes a denial through as denied, not as an empty week", () => {
    expect(parseWeeklyAdherencePayload({ status: "denied" })).toEqual({ status: "denied" });
  });

  it.each([null, "x", {}, { ...ok, status: "nope" }, { ...ok, due: "14" }, { ...ok, percent: "71" }, { ...ok, below_threshold: "yes" }, { ...ok, window_end: 5 }])(
    "treats a malformed response as an error: %p",
    (payload) => {
      expect(parseWeeklyAdherencePayload(payload)).toMatchObject({ status: "error" });
    },
  );
});

describe("readWeeklyAdherence", () => {
  it("calls the audited RPC with the patient and a reason", async () => {
    const rpc = jest.fn().mockResolvedValue({ data: ok, error: null });
    const result = await readWeeklyAdherence({ rpc } as never, "p1", "reviewing the chart before a visit");
    expect(rpc).toHaveBeenCalledWith("medication_weekly_adherence", { p_patient: "p1", p_reason: "reviewing the chart before a visit" });
    expect(result.status).toBe("ok");
  });

  it("returns an error, not data, when the call fails", async () => {
    const rpc = jest.fn().mockResolvedValue({ data: null, error: { message: "boom" } });
    await expect(readWeeklyAdherence({ rpc } as never, "p1")).resolves.toEqual({ status: "error", message: "boom" });
  });
});
