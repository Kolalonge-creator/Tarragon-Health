import { describe, expect, it } from "@jest/globals";
import { itemiseCheckout } from "../../../supabase/functions/_shared/commerce/itemised.ts";
import { parseQuote } from "../../../supabase/functions/_shared/commerce/quote.ts";
import { estimateInternationalFeeKobo, type FeeEstimateSchedule } from "../../../supabase/functions/_shared/commerce/fees.ts";

const FEE: FeeEstimateSchedule = { localBasisPoints: 150, flatKobo: 10_000, flatWaivedBelowKobo: 250_000, capKobo: 200_000, internationalBasisPoints: 390, internationalFlatKobo: 10_000 };
const line = (rule: string, amount: number, running: number, extra: Record<string, unknown> = {}) => ({
  rule, label_key: `quote.line.${rule}`, amount_kobo: amount, running_kobo: running, applied: true, reason_key: null, ...extra,
});
const quoteOf = (over: Record<string, unknown>) => {
  const q = parseQuote({ item_code: "proof_consult", list_kobo: 500_000, sponsor_share_kobo: 0, discount_kobo: 0, points_applied: 0, points_reduction_kobo: 0, discount_code_ok: null, amount_due_kobo: 500_000, lines: [line("list", 500_000, 500_000)], ...over });
  if (!q) throw new Error("fixture quote did not parse");
  return q;
};
const SPLIT = { clinician_fee: 300_000, tarragon_service_fee: 200_000 };

describe("itemiseCheckout (S71, 19.7)", () => {
  it("shows the clinician fee, Tarragon's service fee and the processing estimate separately, and they add up to the total", () => {
    const r = itemiseCheckout({ quote: quoteOf({}), components: SPLIT, fee: FEE });
    expect(r).not.toBeNull();
    expect(r!.split).toBe(true);
    expect(r!.lines.map((l) => l.kind)).toEqual(["clinician_fee", "tarragon_service_fee", "processing_estimate"]);
    expect(r!.lines.reduce((a, l) => a + l.amountKobo, 0)).toBe(r!.totalKobo);
    expect(r!.totalKobo).toBe(500_000 + r!.processingKobo);
    expect(r!.lines.at(-1)!.estimate).toBe(true);
    expect(r!.lines.slice(0, -1).every((l) => !l.estimate)).toBe(true);
  });

  it("shows a partner fee for a partner-delivered item", () => {
    const r = itemiseCheckout({ quote: quoteOf({ list_kobo: 800_000, amount_due_kobo: 800_000, lines: [line("list", 800_000, 800_000)] }), components: { partner_fee: 600_000, tarragon_service_fee: 200_000 }, fee: FEE });
    expect(r!.lines.map((l) => l.kind).slice(0, 2)).toEqual(["partner_fee", "tarragon_service_fee"]);
  });

  it("keeps the lines adding up when a code and a sponsor reduce the price", () => {
    const q = quoteOf({
      sponsor_share_kobo: 100_000, discount_kobo: 50_000, amount_due_kobo: 350_000,
      lines: [line("list", 500_000, 500_000), line("sponsor", -100_000, 400_000), line("discount_code", -50_000, 350_000)],
    });
    const r = itemiseCheckout({ quote: q, components: SPLIT, fee: FEE })!;
    expect(r.amountDueKobo).toBe(350_000);
    expect(r.lines.filter((l) => l.kind === "reduction").map((l) => l.amountKobo)).toEqual([-100_000, -50_000]);
    expect(r.lines.reduce((a, l) => a + l.amountKobo, 0)).toBe(r.totalKobo);
  });

  it("never invents a split: with no recorded components it is one honest price line", () => {
    const r = itemiseCheckout({ quote: quoteOf({}), components: {}, fee: FEE })!;
    expect(r.split).toBe(false);
    expect(r.lines[0]!.kind).toBe("price");
    expect(r.lines.reduce((a, l) => a + l.amountKobo, 0)).toBe(r.totalKobo);
  });

  it("does not show a split that does not account for the whole price", () => {
    const r = itemiseCheckout({ quote: quoteOf({}), components: { clinician_fee: 100_000, tarragon_service_fee: 100_000 }, fee: FEE })!;
    expect(r.split).toBe(false);
    expect(r.lines[0]).toMatchObject({ kind: "price", amountKobo: 500_000 });
  });

  it("refuses a malformed component rather than showing a wrong split", () => {
    expect(itemiseCheckout({ quote: quoteOf({}), components: { clinician_fee: -5, tarragon_service_fee: 500_005 }, fee: FEE })).toBeNull();
    expect(itemiseCheckout({ quote: quoteOf({}), components: { clinician_fee: 1.5, tarragon_service_fee: 499_998.5 }, fee: FEE })).toBeNull();
  });

  it("a sponsor-covered item has nothing to pay: no processing line, a zero total", () => {
    const q = quoteOf({ sponsor_share_kobo: 500_000, amount_due_kobo: 0, lines: [line("list", 500_000, 500_000), line("sponsor", -500_000, 0)], sponsor_name: "Acme Ltd" });
    const r = itemiseCheckout({ quote: q, components: SPLIT, fee: FEE })!;
    expect(q.coveredInFull).toBe(true);
    expect(q.sponsorName).toBe("Acme Ltd");
    expect(r.totalKobo).toBe(0);
    expect(r.processingKobo).toBe(0);
    expect(r.lines.some((l) => l.kind === "processing_estimate")).toBe(false);
    expect(r.international).toBeNull();
  });

  it("for every price from 100 naira to 1 million naira the lines sum to the total (property check)", () => {
    for (let due = 10_000; due <= 100_000_000; due = Math.ceil(due * 1.37) + 7) {
      const service = Math.floor(due / 3);
      const q = quoteOf({ list_kobo: due, amount_due_kobo: due, lines: [line("list", due, due)] });
      const r = itemiseCheckout({ quote: q, components: { clinician_fee: due - service, tarragon_service_fee: service }, fee: FEE });
      expect(r).not.toBeNull();
      expect(r!.lines.reduce((a, l) => a + l.amountKobo, 0)).toBe(r!.totalKobo);
      expect(Number.isSafeInteger(r!.totalKobo)).toBe(true);
    }
  });

  it("gives the card-from-outside-Nigeria estimate as a separate total, higher than the local one (19.4)", () => {
    const r = itemiseCheckout({ quote: quoteOf({}), components: SPLIT, fee: FEE })!;
    expect(r.international).not.toBeNull();
    expect(r.international!.processingKobo).toBe(estimateInternationalFeeKobo(500_000, FEE));
    expect(r.international!.processingKobo).toBeGreaterThan(r.processingKobo);
    expect(r.international!.totalKobo).toBe(500_000 + r.international!.processingKobo);
  });

  it("has no international figure when the configuration has none", () => {
    const { internationalBasisPoints: _a, internationalFlatKobo: _b, ...local } = FEE;
    const r = itemiseCheckout({ quote: quoteOf({}), components: SPLIT, fee: local as FeeEstimateSchedule })!;
    expect(r.international).toBeNull();
  });
});

describe("parseQuote (S71 additions)", () => {
  it("accepts a fully covered quote with a total of 0 and flags it", () => {
    const q = parseQuote({ item_code: "proof_consult", list_kobo: 500_000, sponsor_share_kobo: 500_000, amount_due_kobo: 0, sponsor_name: "Acme Ltd", covered_in_full: true, lines: [line("list", 500_000, 500_000), line("sponsor", -500_000, 0)] });
    expect(q?.coveredInFull).toBe(true);
    expect(q?.amountDueKobo).toBe(0);
  });
  it("is not covered in full when something is left to pay, and flags a short budget", () => {
    const q = parseQuote({ item_code: "proof_consult", list_kobo: 500_000, sponsor_share_kobo: 0, amount_due_kobo: 500_000, sponsor_budget_short: true, lines: [line("list", 500_000, 500_000)] });
    expect(q?.coveredInFull).toBe(false);
    expect(q?.sponsorBudgetShort).toBe(true);
  });
});
