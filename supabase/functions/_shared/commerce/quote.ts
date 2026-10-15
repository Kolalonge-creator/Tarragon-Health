/**
 * The price quote (S73, module 20). The database function public.price_quote decides every number; this file only checks the SHAPE of what
 * came back, so a screen can never show a figure the database did not compute. Money is integer kobo (INV-15). Line labels are i18n KEYS
 * (never English text), and a line the person must be able to explain is always present, applied or not.
 */
export type QuoteRule = "list" | "price_book" | "hardship" | "sponsor" | "discount_code" | "points";
const RULES: readonly QuoteRule[] = ["list", "price_book", "hardship", "sponsor", "discount_code", "points"];

export interface QuoteLine {
  readonly rule: QuoteRule;
  readonly labelKey: string;
  /** Signed kobo: the list price is positive, every reduction negative, an unapplied line 0. */
  readonly amountKobo: number;
  /** What the buyer would pay after this line. */
  readonly runningKobo: number;
  readonly applied: boolean;
  readonly reasonKey: string | null;
}

export interface Quote {
  readonly itemCode: string;
  readonly listKobo: number;
  readonly amountDueKobo: number;
  readonly sponsorShareKobo: number;
  readonly discountKobo: number;
  readonly pointsApplied: number;
  readonly pointsReductionKobo: number;
  readonly lines: readonly QuoteLine[];
  /** null when no code was sent, false when the code cannot be used (the reason is never said). */
  readonly discountCodeOk: boolean | null;
  readonly rateLimited: boolean;
  /** S71: the sponsor who covers part or all of it, by name ("Covered by ..."). null when no sponsor is involved. */
  readonly sponsorName: string | null;
  /** S71: true when a sponsor covers the whole price: there is then no payment step at all. */
  readonly coveredInFull: boolean;
  /** S71: a programme's budget could not cover the share, so the person is quoted the ordinary price. */
  readonly sponsorBudgetShort: boolean;
}

const isInt = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v);

/** Returns null for anything that is not a well-formed quote whose lines add up to the amount due. A screen then shows nothing rather than a wrong price. */
export function parseQuote(raw: unknown): Quote | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const lines = r["lines"];
  if (typeof r["item_code"] !== "string" || !isInt(r["list_kobo"]) || !isInt(r["amount_due_kobo"]) || !Array.isArray(lines) || lines.length === 0) return null;
  const out: QuoteLine[] = [];
  for (const l of lines) {
    if (typeof l !== "object" || l === null) return null;
    const x = l as Record<string, unknown>;
    if (!RULES.includes(x["rule"] as QuoteRule) || typeof x["label_key"] !== "string" || !isInt(x["amount_kobo"]) || !isInt(x["running_kobo"]) || typeof x["applied"] !== "boolean") return null;
    out.push({
      rule: x["rule"] as QuoteRule, labelKey: x["label_key"], amountKobo: x["amount_kobo"], runningKobo: x["running_kobo"], applied: x["applied"],
      reasonKey: typeof x["reason_key"] === "string" ? x["reason_key"] : null,
    });
  }
  const amountDue = r["amount_due_kobo"];
  if (amountDue < 0 || out[0]?.rule !== "list") return null;
  const sponsor = isInt(r["sponsor_share_kobo"]) ? r["sponsor_share_kobo"] : 0;
  // the explanation must explain the number: the list price plus every signed line (the sponsor's share is a negative line too) is what the buyer pays
  const sum = out.reduce((a, l) => a + l.amountKobo, 0);
  if (sum !== amountDue) return null;
  return {
    itemCode: r["item_code"], listKobo: r["list_kobo"], amountDueKobo: amountDue, sponsorShareKobo: sponsor,
    discountKobo: isInt(r["discount_kobo"]) ? r["discount_kobo"] : 0,
    pointsApplied: isInt(r["points_applied"]) ? r["points_applied"] : 0,
    pointsReductionKobo: isInt(r["points_reduction_kobo"]) ? r["points_reduction_kobo"] : 0,
    lines: out,
    discountCodeOk: typeof r["discount_code_ok"] === "boolean" ? r["discount_code_ok"] : null,
    rateLimited: r["discount_error"] === "rate_limited",
    sponsorName: typeof r["sponsor_name"] === "string" ? r["sponsor_name"] : null,
    // derived from the numbers as well as the flag: covered in full means a sponsor share exists and nothing is left to pay
    coveredInFull: sponsor > 0 && amountDue === 0,
    sponsorBudgetShort: r["sponsor_budget_short"] === true,
  };
}
