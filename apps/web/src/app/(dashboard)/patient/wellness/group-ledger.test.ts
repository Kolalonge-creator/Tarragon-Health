import { describe, expect, it } from "@jest/globals";
import { groupLedger } from "./group-ledger";

describe("groupLedger", () => {
  it("merges repeated reasons, keeping first-seen order", () => {
    const out = groupLedger([
      { id: "1", reason: "log_vital", points: 5 },
      { id: "2", reason: "read_article", points: 10 },
      { id: "3", reason: "log_vital", points: 5 },
    ]);
    expect(out).toEqual([
      { reason: "log_vital", points: 10, count: 2 },
      { reason: "read_article", points: 10, count: 1 },
    ]);
  });

  it("keeps points taken off apart from points earned", () => {
    const out = groupLedger([
      { id: "1", reason: "adjust", points: 5 },
      { id: "2", reason: "adjust", points: -5 },
    ]);
    expect(out).toHaveLength(2);
  });

  it("returns nothing for no entries", () => {
    expect(groupLedger([])).toEqual([]);
  });
});
