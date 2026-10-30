import { describe, expect, it } from "@jest/globals";
import { allStrings, causalWordingHits } from "@tarragon/shared";
import { categoryLabel, cellWithheldText, isReliableChangeWithheld, parseReliableChangeReport, reliableChangeWithheldText, RELIABLE_CHANGE_REQUESTS } from "./reliable-change-report";

const rate = { suppressed: false, n: 14, reached: 3, not_reached: 8, insufficient_data: 3, rate_strict_pct: 21.4, rate_among_measured_pct: 27.3, missing_pct: 21.4 };
const report = {
  measure: "phq9", day: 90, config_version: 4, reliable_change_config_version: 1, minimum_cell: 20, reliable_change_points: 6,
  reliable_change: {
    suppressed: false, n: 14,
    categories: [
      { key: "reliable_improvement", suppressed: false, n: 4, pct_of_group: 28.6 },
      { key: "no_reliable_change", suppressed: true, reason: "complementary", minimum: 20 },
      { key: "reliable_deterioration", suppressed: true, reason: "under_minimum", minimum: 20 },
      { key: "insufficient_data", suppressed: false, n: 0, pct_of_group: 0 },
    ],
  },
  response: rate, remission: { suppressed: true, reason: "small_cell", minimum: 20, n: 14 },
  group: "The same people the response figures count.", source: "A source.", note: "Descriptive, not causal.",
  comparison_group: "none", not_a_causal_claim: true,
};

describe("parseReliableChangeReport (D4)", () => {
  it("reads a report where some categories are withheld, and a withheld one carries no number", () => {
    const r = parseReliableChangeReport(report);
    expect(r).not.toBeNull();
    if (!r || isReliableChangeWithheld(r) || r.reliable_change.suppressed) throw new Error("unexpected");
    const withheld = r.reliable_change.categories.filter((c) => c.suppressed);
    expect(withheld).toHaveLength(2);
    expect(JSON.stringify(withheld)).not.toMatch(/"n"/);
  });
  it("reads the unsigned reply as withheld and nothing else", () => {
    const r = parseReliableChangeReport({ withheld: true, reason: "awaiting_cmo_signature", measure: "gad7" });
    expect(r && isReliableChangeWithheld(r)).toBe(true);
  });
  it("refuses a reply that is not the shape, that claims a cause, or that names a comparison group", () => {
    for (const bad of [null, "x", {}, { ...report, not_a_causal_claim: false }, { ...report, comparison_group: "matched" }, { ...report, measure: "hba1c" }, { ...report, reliable_change: { suppressed: false, n: 3 } }]) {
      expect(parseReliableChangeReport(bad)).toBeNull();
    }
  });
  it("asks for the two instruments only, and no text it produces claims a cause", () => {
    expect(new Set(RELIABLE_CHANGE_REQUESTS.map((r) => r.measure))).toEqual(new Set(["phq9", "gad7"]));
    const text = [reliableChangeWithheldText("awaiting_cmo_signature"), reliableChangeWithheldText("measures_not_active"), cellWithheldText("under_minimum", 20), cellWithheldText("complementary", 20), categoryLabel("reliable_improvement"), categoryLabel("reliable_deterioration")];
    expect(causalWordingHits(allStrings(text))).toEqual([]);
  });
});
