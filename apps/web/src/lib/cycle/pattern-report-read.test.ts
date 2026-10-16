import { loadCyclePatternReport, PATTERN_REPORT_READ_REASON, type RpcClient } from "./pattern-report-read";

const ok = {
  status: "ok",
  window_months: 12,
  life_stage: "menstruating",
  cycles: [
    { period_start_date: "2026-07-01", period_end_date: "2026-07-05" },
    { period_start_date: "2026-07-29", period_end_date: null },
  ],
  logs: [{ log_date: "2026-07-01", flow: "heavy", symptoms: ["cramps"], moods: [] }],
  menopause_logs: [{ logged_at: "2026-08-01", symptom_types: ["hot_flashes"], severity: 4, postmenopausal_bleeding: true }],
};

function client(result: { data: unknown; error: { message?: string } | null }): RpcClient & { calls: unknown[] } {
  const calls: unknown[] = [];
  return { calls, rpc: (fn, args) => (calls.push([fn, args]), Promise.resolve(result)) };
}

describe("loadCyclePatternReport", () => {
  it("builds the report from the audited rows, asking with a fixed reason", async () => {
    const c = client({ data: ok, error: null });
    const r = await loadCyclePatternReport(c, "p1", "2026-09-01");
    expect(c.calls).toEqual([["read_reproductive_pattern_report_audited", { p_patient: "p1", p_reason: PATTERN_REPORT_READ_REASON }]]);
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") {
      expect(r.report.cycles).toHaveLength(2);
      expect(r.report.length.meanDays).toBe(28);
      expect(r.menopause[0]).toMatchObject({ bleeding: true, severity: 4 });
      expect(JSON.stringify(r.report).toLowerCase()).not.toContain("fertile");
    }
  });
  it("a refusal is 'denied', never an empty report", async () => {
    expect((await loadCyclePatternReport(client({ data: { status: "denied", cycles: [], logs: [], menopause_logs: [] }, error: null }), "p1", "2026-09-01")).kind).toBe("denied");
  });
  it("the closed go-live guard is its own case", async () => {
    expect((await loadCyclePatternReport(client({ data: null, error: { message: "reproductive_content_guard_off" } }), "p1", "2026-09-01")).kind).toBe("not_open");
  });
  it("a failed read and a malformed reply are errors, never 'no cycle data'", async () => {
    expect((await loadCyclePatternReport(client({ data: null, error: { message: "boom" } }), "p1", "2026-09-01")).kind).toBe("error");
    expect((await loadCyclePatternReport(client({ data: { status: "ok" }, error: null }), "p1", "2026-09-01")).kind).toBe("error");
    expect((await loadCyclePatternReport(client({ data: { ...ok, logs: [{ log_date: "x", flow: "torrent", symptoms: [], moods: [] }] }, error: null }), "p1", "2026-09-01")).kind).toBe("error");
  });
  it("an empty but successful report is an ok report with no cycles", async () => {
    const r = await loadCyclePatternReport(client({ data: { ...ok, cycles: [], logs: [], menopause_logs: [] }, error: null }), "p1", "2026-09-01");
    expect(r.kind).toBe("ok");
  });
});
