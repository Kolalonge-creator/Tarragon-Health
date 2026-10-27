import { describe, expect, it } from "@jest/globals";
import { dayExceptions, dayRowsSchema, dayState, exceptionRowsSchema } from "./settlement-tieout";

const day = {
  settlement_date: "2026-10-26",
  matched_count: 3,
  matched_kobo: 1_500_000,
  missing_in_ledger_count: 0,
  missing_in_ledger_kobo: 0,
  missing_at_paystack_count: 0,
  missing_at_paystack_kobo: 0,
  other_break_count: 0,
  computed_at: "2026-10-27T06:10:00Z",
};

describe("settlement tie-out model", () => {
  it("a day with matches and no exceptions is clean", () => {
    expect(dayState(dayRowsSchema.parse([day])[0]!)).toBe("clean");
  });

  it("a day with nothing compared is not called clean", () => {
    expect(dayState({ ...day, matched_count: 0, matched_kobo: 0 })).toBe("nothing_compared");
  });

  it("any exception class makes the day an exception day", () => {
    expect(dayExceptions({ ...day, missing_at_paystack_count: 2, other_break_count: 1 })).toBe(3);
    expect(dayState({ ...day, missing_in_ledger_count: 1 })).toBe("exceptions");
  });

  it("rejects fractional kobo", () => {
    expect(dayRowsSchema.safeParse([{ ...day, matched_kobo: 10.5 }]).success).toBe(false);
  });

  it("parses an exception row", () => {
    const r = {
      break_id: "7d1f6b0e-3a52-4c1a-9a53-0f5f2a9d1b11",
      tieout_class: "missing_in_ledger",
      provider_reference: "ref1",
      provider_amount_kobo: 100,
      ledger_amount_kobo: null,
      difference_kobo: null,
      detail: null,
      first_seen_at: "2026-10-26T10:00:00Z",
      age_hours: 4,
    };
    expect(exceptionRowsSchema.safeParse([r]).success).toBe(true);
  });
});
