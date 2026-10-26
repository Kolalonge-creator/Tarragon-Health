import { estimatedBreakdown, formatNaira, itemiseCheckout, type FeeEstimateSchedule, type Itemised, type Quote } from "@tarragon/commerce";
import type { CatalogueItem } from "./parse";

/**
 * What the checkout card shows for one item (S71, 19.5 and 19.7), worked out in one place so it is testable without rendering. Mirrors the web
 * membership shop. The database's quote decides every number; this only arranges them, and shows nothing it cannot add up:
 *   - a sponsor covers all of it: no payment step, "Covered by ...", a button that gets the cover;
 *   - otherwise the itemised lines (clinician or partner fee, Tarragon fee, reductions, processing ESTIMATE, total) when they sum;
 *   - otherwise the single honest catalogue-price fallback, labelled as an estimate. No split is ever invented.
 * No stored balance is read or shown anywhere (INV-09).
 */
export type CheckoutView =
  | { readonly mode: "covered"; readonly sponsorName: string | null }
  | {
      readonly mode: "pay";
      readonly partCover: { readonly sponsorName: string | null; readonly amountKobo: number } | null;
      readonly budgetShort: boolean;
      readonly itemised: Itemised | null;
      readonly fallback: { readonly priceKobo: number; readonly feeKobo: number; readonly totalKobo: number };
      /** The amount the person is shown. Sent with the order so the database refuses it if it now works out differently. null when no quote was available. */
      readonly expectedAmountKobo: number | null;
    };

export function buildCheckoutView(args: { readonly item: CatalogueItem; readonly quote: Quote | null; readonly fee: FeeEstimateSchedule }): CheckoutView {
  const { item, quote, fee } = args;
  if (quote?.coveredInFull === true) return { mode: "covered", sponsorName: quote.sponsorName };
  const shown = quote?.amountDueKobo ?? item.amountKobo;
  return {
    mode: "pay",
    partCover: quote !== null && quote.sponsorShareKobo > 0 ? { sponsorName: quote.sponsorName, amountKobo: quote.sponsorShareKobo } : null,
    budgetShort: quote?.sponsorBudgetShort === true,
    itemised: quote !== null ? itemiseCheckout({ quote, components: item.components, fee }) : null,
    fallback: (({ priceKobo, feeKobo, totalKobo }) => ({ priceKobo, feeKobo, totalKobo }))(estimatedBreakdown(shown, fee)),
    expectedAmountKobo: quote?.amountDueKobo ?? null,
  };
}

export const naira = (kobo: number): string => `₦${formatNaira(kobo)}`;

export interface ItemisedRow { readonly key: string; readonly label: string; readonly amount: string; readonly reduction: boolean; readonly estimate: boolean }

/** The rows as plain strings. `copy` turns a database copy key into words (unknown key: ""), `about` wraps an amount as "about X". */
export function itemisedRows(it: Itemised, copy: (key: string) => string, about: (amount: string) => string): ItemisedRow[] {
  return it.lines.map((l, i) => {
    const amount = naira(Math.abs(l.amountKobo));
    const reason = l.reasonKey ? copy(l.reasonKey) : "";
    return {
      key: `${l.kind}-${i}`,
      label: reason ? `${copy(l.labelKey)} (${reason})` : copy(l.labelKey),
      amount: `${l.amountKobo < 0 ? "-" : ""}${l.estimate ? about(amount) : amount}`,
      reduction: l.amountKobo < 0,
      estimate: l.estimate,
    };
  });
}

/** After the browser closes: what the app says about the order. A bank transfer or USSD that has not landed is "waiting", never a failure. */
export type ReturnNotice = "shop.return.paid.body" | "shop.return.mismatch" | "shop.return.failed" | "shop.return.pending";
export function returnNotice(v: { state: string; outcome: string } | null): ReturnNotice {
  if (v?.state === "paid") return "shop.return.paid.body";
  if (v?.outcome === "mismatch") return "shop.return.mismatch";
  if (v?.state === "failed") return "shop.return.failed";
  return "shop.return.pending";
}
