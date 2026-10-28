import { describe, expect, it } from "@jest/globals";
import { chaseRowsSchema, scoreBand } from "./chase";

describe("directory chase list", () => {
  it("bands scores for reading only", () => {
    expect(scoreBand(100)).toBe("fresh");
    expect(scoreBand(50)).toBe("ageing");
    expect(scoreBand(0)).toBe("stale");
  });

  it("parses a database row and rejects a score outside 0 to 100", () => {
    const row = {
      listing_table: "lab_providers",
      listing_id: "7d1f6b0e-3a52-4c1a-9a53-0f5f2a9d1b11",
      name: "A lab",
      last_verified_at: null,
      days_since_verified: null,
      freshness_score: 0,
      can_notify: false,
      last_partner_notice_on: null,
      would_be_hidden: false,
    };
    expect(chaseRowsSchema.safeParse([row]).success).toBe(true);
    expect(chaseRowsSchema.safeParse([{ ...row, freshness_score: 140 }]).success).toBe(false);
  });
});
