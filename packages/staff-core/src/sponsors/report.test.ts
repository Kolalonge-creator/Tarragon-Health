import { describe, expect, it } from "@jest/globals";
import { parseCohortList, parseSponsorReport, sponsorReportToCsv } from "./report";

const shown = { suppressed: false, n: 40, controlled: 20, uncontrolled: 10, insufficient_data: 10, rate_strict_pct: 50, rate_among_measured_pct: 66.7, missing_pct: 25 };
const base = {
  cohort: { name: "=Acme staff", sponsor: "Acme Corp", valid_from: "2026-10-01", valid_to: "2026-12-01" }, minimum_cell: 20,
  members: { suppressed: false, joined: 60, agreed_to_share: 40, agreed_pct: 66.7 },
  bp_control_90d: shown, change_among_measured: { suppressed: true, reason: "under_minimum", minimum: 20 },
  adherence_separate: { suppressed: false, n: 30, mean_pct: 71.5 }, engagement_separate: { suppressed: false, n: 40, logged_a_reading_in_30_days_pct: 62.5 },
  range: { from: null, to: null }, definition: "People whose average, with a, comma.", limitations: "Descriptive only.", not_a_causal_claim: true, generated_at: "2026-10-07T00:00:00Z",
};

describe("sponsor report", () => {
  const r = parseSponsorReport(base)!;
  const csv = sponsorReportToCsv(r);
  it("parses a well-formed report and rejects a malformed one", () => {
    expect(r.cohort.sponsor).toBe("Acme Corp");
    expect(parseSponsorReport({ ...base, not_a_causal_claim: false })).toBeNull();
    expect(parseSponsorReport({ ...base, members: { suppressed: true } })).toBeNull();
  });
  it("writes shown figures and writes a withheld one as 'withheld', never blank or zero", () => {
    expect(csv).toContain("bp_control_90d,controlled_pct_of_everyone_due,50");
    expect(csv).toContain("change_from_day_0,status,withheld");
    expect(csv).not.toMatch(/change_from_day_0,people,/);
  });
  it("neutralises a formula in the programme name and quotes a comma", () => {
    expect(csv).toContain("report,programme,'=Acme staff");
    expect(csv).toContain('"People whose average, with a, comma."');
  });
  it("lists no individual and says there is no causal claim", () => {
    expect(csv).toContain("causal_claim,none");
    expect(csv).not.toMatch(/patient_id|full_name|phone|subject/i);
  });
  it("parses the cohort list and drops a row that does not match", () => {
    const row = { id: "11111111-1111-4111-8111-111111111111", name: "A", code: "ABCDEFGH", sponsor: "S", valid_from: "2026-10-01", valid_to: "2026-12-01", max_uses: 10, uses: 1, status: "active" };
    expect(parseCohortList([row])).toHaveLength(1);
    expect(parseCohortList([{ ...row, status: "weird" }])).toEqual([]);
    expect(parseCohortList("x")).toEqual([]);
  });
});
