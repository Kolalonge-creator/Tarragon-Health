import { describe, expect, it } from "@jest/globals";
import { parseQuote } from "../../../supabase/functions/_shared/commerce/quote.ts";

const line = (rule: string, amount: number, running: number, extra: Record<string, unknown> = {}) => ({
  rule, label_key: `quote.line.${rule}`, amount_kobo: amount, running_kobo: running, applied: true, reason_key: null, ...extra,
});
const base = {
  item_code: "membership_annual", list_kobo: 10_000_000, sponsor_share_kobo: 0, discount_kobo: 1_000_000, points_applied: 0, points_reduction_kobo: 0,
  discount_code_ok: true, amount_due_kobo: 9_000_000,
  lines: [line("list", 10_000_000, 10_000_000), line("discount_code", -1_000_000, 9_000_000)],
};

describe("parseQuote (S73)", () => {
  it("accepts a quote whose lines add up to the amount due", () => {
    const q = parseQuote(base);
    expect(q?.amountDueKobo).toBe(9_000_000);
    expect(q?.lines.map((l) => l.rule)).toEqual(["list", "discount_code"]);
    expect(q?.discountCodeOk).toBe(true);
    expect(q?.rateLimited).toBe(false);
  });

  it("counts the sponsor's share as a negative line, so a sponsor-covered quote still adds up", () => {
    const q = parseQuote({ ...base, sponsor_share_kobo: 4_000_000, discount_kobo: 0, discount_code_ok: null, amount_due_kobo: 6_000_000, lines: [line("list", 10_000_000, 10_000_000), line("sponsor", -4_000_000, 6_000_000)] });
    expect(q?.sponsorShareKobo).toBe(4_000_000);
    expect(q?.amountDueKobo).toBe(6_000_000);
  });

  it("refuses a quote whose explanation does not explain the number", () => {
    expect(parseQuote({ ...base, amount_due_kobo: 8_000_000 })).toBeNull();
  });

  it("refuses a negative amount, a missing list line, an unknown rule and a non-integer amount", () => {
    expect(parseQuote({ ...base, amount_due_kobo: -1, lines: [line("list", 1, 1), line("discount_code", -2, -1)] })).toBeNull();
    expect(parseQuote({ ...base, lines: [line("discount_code", -1_000_000, 9_000_000)], amount_due_kobo: -1_000_000 })).toBeNull();
    expect(parseQuote({ ...base, lines: [line("list", 10_000_000, 10_000_000), line("mystery", -1_000_000, 9_000_000)] })).toBeNull();
    expect(parseQuote({ ...base, amount_due_kobo: 9_000_000.5 })).toBeNull();
  });

  it("refuses anything that is not an object with lines", () => {
    for (const v of [null, undefined, 5, "x", [], {}, { ...base, lines: [] }, { ...base, lines: "no" }]) expect(parseQuote(v)).toBeNull();
  });

  it("reports an unusable code without saying why, and a rate limit", () => {
    const q = parseQuote({ ...base, discount_kobo: 0, discount_code_ok: false, discount_error: "rate_limited", amount_due_kobo: 10_000_000,
      lines: [line("list", 10_000_000, 10_000_000), line("discount_code", 0, 10_000_000, { applied: false, reason_key: "quote.reason.code_unusable" })] });
    expect(q?.discountCodeOk).toBe(false);
    expect(q?.rateLimited).toBe(true);
    expect(q?.lines[1]?.reasonKey).toBe("quote.reason.code_unusable");
  });
});
