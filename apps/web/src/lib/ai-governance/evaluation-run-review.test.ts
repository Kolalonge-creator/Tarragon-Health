import { latestUnreviewedRuns, type EvaluationRunRow } from "./evaluation-run-review";

function run(over: Partial<EvaluationRunRow> & { id: string }): EvaluationRunRow {
  return {
    ai_system_id: "sys-1",
    suite_id: "suite-1",
    started_at: "2026-10-30T10:00:00Z",
    completed_at: "2026-10-30T10:01:00Z",
    outcome: "pass",
    total_cases: 2,
    passed_cases: 2,
    failed_cases: 0,
    pass_rate_pct: "100.00",
    environment: "evaluation",
    model_identifier: null,
    reviewed_at: null,
    ai_systems: { name: "System", system_code: "AI-001", is_enabled: true },
    ai_evaluation_suites: { name: "Suite", kind: "safety", is_active: true, is_required_for_release: true },
    ...over,
  };
}

describe("latestUnreviewedRuns", () => {
  it("lists the newest run of a pair once, not the older ones behind it", () => {
    const rows = [run({ id: "new" }), run({ id: "old", started_at: "2026-10-01T10:00:00Z" })];
    expect(latestUnreviewedRuns(rows).map((r) => r.id)).toEqual(["new"]);
  });
  it("drops an older unreviewed run when the newest run of the pair is already reviewed", () => {
    const rows = [run({ id: "new", reviewed_at: "2026-10-30T11:00:00Z" }), run({ id: "old", started_at: "2026-10-01T10:00:00Z" })];
    expect(latestUnreviewedRuns(rows)).toEqual([]);
  });
  it("keeps separate systems and separate suites apart", () => {
    const rows = [run({ id: "a" }), run({ id: "b", ai_system_id: "sys-2" }), run({ id: "c", suite_id: "suite-2" })];
    expect(latestUnreviewedRuns(rows).map((r) => r.id)).toEqual(["a", "b", "c"]);
  });
  it("never lists an unfinished run or one with no outcome, and does not let it hide the run behind it", () => {
    const rows = [run({ id: "open", completed_at: null, outcome: null }), run({ id: "done", started_at: "2026-10-01T10:00:00Z" })];
    expect(latestUnreviewedRuns(rows).map((r) => r.id)).toEqual(["done"]);
  });
  it("skips systems that are off and suites that are inactive or not required for release", () => {
    const rows = [
      run({ id: "off", ai_systems: { name: "S", system_code: "AI-002", is_enabled: false } }),
      run({ id: "inactive", suite_id: "s2", ai_evaluation_suites: { name: "x", kind: "safety", is_active: false, is_required_for_release: true } }),
      run({ id: "optional", suite_id: "s3", ai_evaluation_suites: { name: "x", kind: "safety", is_active: true, is_required_for_release: false } }),
    ];
    expect(latestUnreviewedRuns(rows)).toEqual([]);
  });
  it("lists a failing run too, so the person reads it rather than only the passes", () => {
    expect(latestUnreviewedRuns([run({ id: "bad", outcome: "fail", passed_cases: 0, failed_cases: 2 })]).map((r) => r.id)).toEqual(["bad"]);
  });
});
