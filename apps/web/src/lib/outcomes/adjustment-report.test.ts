import { describe, expect, it } from "@jest/globals";
import { allStrings, causalWordingHits } from "@tarragon/shared";
import { adjustmentWithheldText, groupWithheldText, isAdjustmentWithheld, isGroupShown, parseAdjustmentReport } from "./adjustment-report";

const shown = { code: "adjusted", label: "Adjusted", suppressed: false, n: 8, controlled: 5, uncontrolled: 3, control_unknown: 0, rate_strict_pct: 62.5, rate_among_known_pct: 62.5, missing_pct: 0 };
const report = {
  condition: "hypertension", config_version: 1, cascade_config_version: 1, minimum_cell: 20, as_at: "2026-10-28", window_days: 90,
  adjusted: shown,
  not_adjusted: { code: "not_adjusted", label: "Not adjusted", suppressed: true, reason: "complementary", minimum: 20 },
  on_recorded_medicine: { suppressed: true, reason: "a_group_is_withheld", minimum: 20 },
  not_on_recorded_medicine: { suppressed: false, n: 0 },
  limitations: "People who are not on a recorded medicine are shown separately.", note: "Descriptive, not causal.",
  comparison_group: "none", not_a_causal_claim: true,
};

describe("parseAdjustmentReport (D3)", () => {
  it("reads a report where one group is withheld, and the withheld group carries no number", () => {
    const r = parseAdjustmentReport(report);
    expect(r).not.toBeNull();
    if (!r || isAdjustmentWithheld(r)) throw new Error("unexpected");
    expect(isGroupShown(r.adjusted)).toBe(true);
    expect(isGroupShown(r.not_adjusted)).toBe(false);
    expect(JSON.stringify(r.not_adjusted)).not.toMatch(/"n"|controlled/);
  });
  it("reads each withheld reply as withheld", () => {
    for (const reason of ["awaiting_cmo_signature", "cascade_not_signed", "snapshot_pending"] as const) {
      const r = parseAdjustmentReport({ withheld: true, reason, condition: "hypertension" });
      expect(r && isAdjustmentWithheld(r)).toBe(true);
    }
  });
  it("refuses a reply that is not the shape, that claims a cause, or that names a comparison group", () => {
    for (const bad of [null, "x", {}, { ...report, not_a_causal_claim: false }, { ...report, comparison_group: "matched" }, { ...report, condition: "diabetes" }, { ...report, as_at: "yesterday" }]) {
      expect(parseAdjustmentReport(bad)).toBeNull();
    }
  });
  it("no word it produces claims a cause", () => {
    const text = [adjustmentWithheldText("awaiting_cmo_signature"), adjustmentWithheldText("cascade_not_signed"), adjustmentWithheldText("snapshot_pending"), groupWithheldText("under_minimum", 20), groupWithheldText("a_group_is_withheld", 20), groupWithheldText("complementary", 20)];
    expect(causalWordingHits(allStrings(text))).toEqual([]);
  });
});
