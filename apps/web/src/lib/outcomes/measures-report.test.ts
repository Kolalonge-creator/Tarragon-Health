import { minutes, parseFairnessHistory, parseMeasureReport, parseQuality, parseResponse, parseRetention, withheldWords, isPairsShown } from "./measures-report";

const shownPairs = { suppressed: false, n: 24, improved: 20, improved_pct: 83.3, mean_change: -1.4, at_goal_pct: 40 };
const day = { due_day: 90, pairs: shownPairs, coverage: { suppressed: false, due: 30, with_usable_pair: 24, with_usable_pair_pct: 80, no_reading_pct: 20 }, excluded: { suppressed: true, reason: "under_minimum", minimum: 20 }, by_baseline_band: null };

describe("parseMeasureReport", () => {
  it("reads the unsigned, the no-data and the full report", () => {
    expect(parseMeasureReport({ measure: "hba1c", withheld: true, reason: "awaiting_cmo_signature", has_data: true })).not.toBeNull();
    expect(parseMeasureReport({ measure: "weight", withheld: false, has_data: false })).not.toBeNull();
    const full = parseMeasureReport({ measure: "hba1c", withheld: false, has_data: true, minimum_cell: 20, by_day: { "90": day }, definition: "d", limitations: "l", config_version: 1 });
    expect(full).not.toBeNull();
    if (full && "by_day" in full) expect(isPairsShown(full.by_day["90"]!.pairs)).toBe(true);
  });
  it("refuses a report that is half there, rather than half-render it", () => {
    for (const bad of [null, {}, { measure: "hba1c", withheld: false, has_data: true }, { measure: "hba1c", withheld: false, has_data: true, minimum_cell: 20, by_day: { "90": { ...day, pairs: { suppressed: false, n: 3 } } }, definition: "d", limitations: "l", config_version: 1 }]) {
      expect(parseMeasureReport(bad)).toBeNull();
    }
  });
});

describe("the other reports", () => {
  it("reads retention with a withheld day and a shown one", () => {
    const r = parseRetention({ by_day: [{ day: 30, suppressed: true, reason: "under_minimum", minimum: 20 }, { day: 90, suppressed: false, due: 28, retained: 21, retained_pct: 75, engaged_pct: 60 }],
      programme_completion: { suppressed: true, reason: "under_minimum", minimum: 20 }, definition: "d", limitations: "l", minimum_cell: 20 });
    expect(r?.by_day).toHaveLength(2);
  });
  it("reads programme completion as fully used, with its label", () => {
    const r = parseRetention({ by_day: [], programme_completion: { suppressed: false, ended_entitlements: 30, fully_used: 21, fully_used_pct: 70, label: "fully used" }, definition: "d", limitations: "l", minimum_cell: 20 });
    expect(r?.programme_completion).toMatchObject({ fully_used: 21 });
  });
  it("reads response times and carries no clinician field", () => {
    const r = parseResponse({ range: { from: "2026-07-01", to: "2026-10-01" }, minimum_cell: 20, minimum_clinicians_per_tier: 3,
      by_priority_band: [{ priority_band: "soon", suppressed: false, tasks: 25, completed_pct: 100, completed_on_time_pct: 90, escalation_rate_pct: 8, handed_back_pct: 0, median_minutes_to_first_claim: 10, p90_minutes_to_first_claim: 40, median_minutes_to_completion: 55 }],
      by_finisher_tier: [{ doctor_tier: "medical_officer", suppressed: true, reason: "few_clinicians" }], follow_up: { type: "adherence_follow_up", suppressed: true, minimum: 20 }, what_this_is: "w", limitations: "l" });
    expect(r).not.toBeNull();
    expect(JSON.stringify(r)).not.toMatch(/clinician_id|full_name/);
  });
  it("reads data quality and the fairness history", () => {
    expect(parseQuality({ range: { from: "a", to: "b" }, minimum_cell: 20, snapshot_completeness: [], reading_sources: [], sync_lag: { suppressed: true, minimum: 20 }, what_this_is: "w", limitations: "l" })).not.toBeNull();
    expect(parseFairnessHistory([{ month: "2026-09-01", generated_at: "x", reviewed: false, reviewed_at: null, review_note: null, reviewed_by_name: null,
      payload: { total_scored: null, minimum_cell: 20, by: { sex: [], age_band: [], region: [] } } }])).toHaveLength(1);
    expect(parseFairnessHistory({})).toBeNull();
  });
});

describe("wording", () => {
  it("explains every withheld reason in plain words and formats minutes", () => {
    for (const k of ["under_minimum", "small_cell", "complementary", "few_clinicians", "awaiting_cmo_signature"]) expect(withheldWords(k)).not.toBe("Withheld.");
    expect(minutes(45)).toBe("45 min");
    expect(minutes(190)).toBe("3 h 10 min");
    expect(minutes(null)).toBe("not enough data");
  });
});
