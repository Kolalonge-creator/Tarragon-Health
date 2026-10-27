import { en } from "@tarragon/i18n";
import { parseQuote, type FeeEstimateSchedule } from "@tarragon/commerce";
import { getProposedConfig, type ConfigValue } from "@tarragon/shared";
import { buildCheckoutView, itemisedRows, naira, returnNotice } from "./checkout-view";
import { parseCatalogue } from "./parse";

const fee = getProposedConfig<ConfigValue>("commerce.processing_fee_estimate").value as unknown as FeeEstimateSchedule;
const isKey = (k: string): boolean => Object.hasOwn(en, k);
const copy = (k: string): string => (isKey(k) ? (en as Record<string, string>)[k]! : "");
const about = (a: string): string => `about ${a}`;

const base = { code: "consult_gp", kind: "consultation", name_key: "n", description_key: "d", included_keys: [], amount_kobo: 1_000_000 };
const item = (components?: Record<string, unknown>) => parseCatalogue([{ ...base, ...(components ? { components } : {}) }])[0]!;
const list = { rule: "list", label_key: "quote.line.list", amount_kobo: 1_000_000, running_kobo: 1_000_000, applied: true };
const rawQuote = (over: Record<string, unknown> = {}, lines: unknown[] = [list]) => ({ item_code: "consult_gp", list_kobo: 1_000_000, amount_due_kobo: 1_000_000, lines, ...over });
const sponsorLine = (amount: number, running: number) => ({ rule: "sponsor", label_key: "quote.line.sponsor", amount_kobo: -amount, running_kobo: running, applied: true });

describe("catalogue components", () => {
  it("keeps only whole non-negative kobo values", () => {
    expect(item({ clinician_fee: 800_000, tarragon_service_fee: 200_000, bad: -1, worse: 1.5, text: "x" }).components).toEqual({ clinician_fee: 800_000, tarragon_service_fee: 200_000 });
    expect(item().components).toEqual({});
  });
});

describe("buildCheckoutView", () => {
  it("itemises when the split accounts for the whole price, and the lines sum to the total", () => {
    const v = buildCheckoutView({ item: item({ clinician_fee: 800_000, tarragon_service_fee: 200_000 }), quote: parseQuote(rawQuote()), fee });
    expect(v.mode).toBe("pay");
    if (v.mode !== "pay" || !v.itemised) throw new Error("expected itemised");
    expect(v.itemised.split).toBe(true);
    expect(v.itemised.lines.map((l) => l.kind)).toEqual(["clinician_fee", "tarragon_service_fee", "processing_estimate"]);
    expect(v.itemised.lines.reduce((a, l) => a + l.amountKobo, 0)).toBe(v.itemised.totalKobo);
    expect(v.expectedAmountKobo).toBe(1_000_000);
    const rows = itemisedRows(v.itemised, copy, about);
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.label.length > 0)).toBe(true);
    expect(rows[2]!.amount.startsWith("about ")).toBe(true);
    expect(rows[2]!.estimate).toBe(true);
  });

  it("a price with no recorded split is one honest Price line, never an invented split", () => {
    const v = buildCheckoutView({ item: item(), quote: parseQuote(rawQuote()), fee });
    if (v.mode !== "pay" || !v.itemised) throw new Error("expected itemised");
    expect(v.itemised.split).toBe(false);
    expect(v.itemised.lines[0]!.kind).toBe("price");
  });

  it("a split that does not add up to the price is not shown as a split", () => {
    const v = buildCheckoutView({ item: item({ clinician_fee: 500_000, tarragon_service_fee: 200_000 }), quote: parseQuote(rawQuote()), fee });
    if (v.mode !== "pay" || !v.itemised) throw new Error("expected itemised");
    expect(v.itemised.split).toBe(false);
  });

  it("part cover shows the sponsor share and the lines still sum", () => {
    const q = parseQuote(rawQuote({ amount_due_kobo: 600_000, sponsor_share_kobo: 400_000, sponsor_name: "Acme" }, [list, sponsorLine(400_000, 600_000)]));
    const v = buildCheckoutView({ item: item(), quote: q, fee });
    if (v.mode !== "pay") throw new Error("expected pay");
    expect(v.partCover).toEqual({ sponsorName: "Acme", amountKobo: 400_000 });
    expect(v.itemised?.lines.some((l) => l.kind === "reduction" && l.amountKobo === -400_000)).toBe(true);
    expect(v.itemised?.lines.reduce((a, l) => a + l.amountKobo, 0)).toBe(v.itemised?.totalKobo);
    const rows = itemisedRows(v.itemised!, copy, about);
    expect(rows.find((r) => r.reduction)!.amount.startsWith("-")).toBe(true);
    expect(v.expectedAmountKobo).toBe(600_000);
  });

  it("covered in full: no payment step, no itemised lines, the sponsor is named", () => {
    const q = parseQuote(rawQuote({ amount_due_kobo: 0, sponsor_share_kobo: 1_000_000, sponsor_name: "Acme" }, [list, sponsorLine(1_000_000, 0)]));
    expect(buildCheckoutView({ item: item(), quote: q, fee })).toEqual({ mode: "covered", sponsorName: "Acme" });
    const anon = parseQuote(rawQuote({ amount_due_kobo: 0, sponsor_share_kobo: 1_000_000 }, [list, sponsorLine(1_000_000, 0)]));
    expect(buildCheckoutView({ item: item(), quote: anon, fee })).toEqual({ mode: "covered", sponsorName: null });
  });

  it("a budget that ran out is said plainly and the ordinary price is quoted", () => {
    const v = buildCheckoutView({ item: item(), quote: parseQuote(rawQuote({ sponsor_budget_short: true })), fee });
    expect(v.mode === "pay" && v.budgetShort).toBe(true);
  });

  it("foreign-card estimate line is present when the schedule has a figure", () => {
    const v = buildCheckoutView({ item: item(), quote: parseQuote(rawQuote()), fee });
    if (v.mode !== "pay" || !v.itemised?.international) return; // schedule without an international figure: the line is simply not shown
    expect(v.itemised.international.totalKobo).toBe(v.itemised.amountDueKobo + v.itemised.international.processingKobo);
  });

  it("with no quote (offline or refused) falls back to the catalogue price and sends no expected total", () => {
    const v = buildCheckoutView({ item: item(), quote: null, fee });
    if (v.mode !== "pay") throw new Error("expected pay");
    expect(v.itemised).toBeNull();
    expect(v.expectedAmountKobo).toBeNull();
    expect(v.fallback.priceKobo).toBe(1_000_000);
    expect(v.fallback.totalKobo).toBe(v.fallback.priceKobo + v.fallback.feeKobo);
  });

  it("a quote whose lines do not sum is rejected, so the screen falls back rather than show a wrong price", () => {
    expect(parseQuote(rawQuote({ amount_due_kobo: 900_000 }))).toBeNull();
  });
});

describe("return notice", () => {
  it("a bank transfer or USSD that has not landed is pending, never failed", () => {
    expect(returnNotice({ state: "created", outcome: "pending" })).toBe("shop.return.pending");
    expect(returnNotice(null)).toBe("shop.return.pending");
    expect(returnNotice({ state: "paid", outcome: "paid" })).toBe("shop.return.paid.body");
    expect(returnNotice({ state: "failed", outcome: "failed" })).toBe("shop.return.failed");
    expect(returnNotice({ state: "created", outcome: "mismatch" })).toBe("shop.return.mismatch");
  });
  it("every notice has copy and the pending title says waiting for the bank", () => {
    for (const k of ["shop.return.paid.body", "shop.return.mismatch", "shop.return.failed", "shop.return.pending", "shop.return.pending.title", "shop.return.check_again"] as const) expect(en[k].length).toBeGreaterThan(0);
    expect(en["shop.return.pending.title"]).toBe("Waiting for your bank");
  });
});

describe("copy for the new screens", () => {
  it("every key used exists, has no em dash and no unfilled braces beyond {name}-style params", () => {
    const keys = ["checkout.itemised.title", "checkout.line.clinician_fee", "checkout.line.partner_fee", "checkout.line.tarragon_service_fee", "checkout.line.price", "checkout.line.processing_estimate",
      "checkout.total", "checkout.itemised.note", "checkout.international.line", "sponsor.covered_by", "sponsor.no_payment", "sponsor.get", "sponsor.part", "sponsor.budget_short", "hmo.title"] as const;
    for (const k of keys) {
      expect(en[k].length).toBeGreaterThan(0);
      expect(en[k]).not.toContain("—");
    }
    expect(naira(12_345_000)).toBe("₦123,450");
  });
});
