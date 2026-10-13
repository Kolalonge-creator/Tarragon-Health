import { describe, expect, it } from "@jest/globals";
import { parseFairnessHistory } from "./fairness-history";

describe("parseFairnessHistory", () => {
  it("reads the history and refuses a reply that is not a list", () => {
    expect(parseFairnessHistory([{ month: "2026-09-01", generated_at: "x", reviewed: false, reviewed_at: null, review_note: null, reviewed_by_name: null,
      payload: { total_scored: null, minimum_cell: 20, by: { sex: [], age_band: [], region: [] } } }])).toHaveLength(1);
    expect(parseFairnessHistory({})).toBeNull();
  });
});
