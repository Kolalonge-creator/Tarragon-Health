import { estimateInternationalFeeKobo, estimateProcessingFeeKobo, type FeeEstimateSchedule } from "./fees.ts";
import type { Quote } from "./quote.ts";

/**
 * Itemised checkout (S71, 19.7). The checkout names who gets what, in plain words, and the lines add up to the total shown:
 *   the clinician or partner fee, Tarragon's service fee, then every reduction the quote applied (a sponsor, a code, points), then the
 *   payment provider's processing fee as an ESTIMATE, then the total.
 * The database decides every number (price components come from the price row, reductions from the quote); this file only arranges them and
 * REFUSES (returns null) if the arrangement would not add up, so a screen can never show a split that does not sum.
 * An item whose price has no recorded split (the Membership today) is shown as one honest "Price" line: a split is never invented.
 */
export type ItemisedKind = "clinician_fee" | "partner_fee" | "tarragon_service_fee" | "price" | "reduction" | "processing_estimate";

export interface ItemisedLine {
  readonly kind: ItemisedKind;
  /** An i18n key, never English text. */
  readonly labelKey: string;
  readonly reasonKey: string | null;
  /** Signed kobo: charges positive, reductions negative. */
  readonly amountKobo: number;
  /** True only for the processing fee before payment. */
  readonly estimate: boolean;
}

export interface Itemised {
  readonly lines: readonly ItemisedLine[];
  /** What the person pays the provider: the amount due plus the processing estimate. 0 when a sponsor covers everything. */
  readonly totalKobo: number;
  readonly amountDueKobo: number;
  readonly processingKobo: number;
  /** True when the clinician or partner fee and Tarragon's fee are shown separately. */
  readonly split: boolean;
  /** For a card issued outside Nigeria: the processing estimate and the total that would apply. null when the schedule has no figure or nothing is payable. */
  readonly international: { readonly processingKobo: number; readonly totalKobo: number } | null;
}

const isInt = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n);

export function itemiseCheckout(args: { readonly quote: Quote; readonly components: Readonly<Record<string, number>>; readonly fee: FeeEstimateSchedule }): Itemised | null {
  const { quote, components, fee } = args;
  const list = quote.listKobo;
  const clinician = components["clinician_fee"] ?? 0;
  const partner = components["partner_fee"] ?? 0;
  const service = components["tarragon_service_fee"] ?? 0;
  if (![clinician, partner, service].every((n) => isInt(n) && n >= 0)) return null;
  // the split is shown only when it accounts for the whole list price exactly
  const split = clinician + partner + service === list && clinician + partner + service > 0;

  const lines: ItemisedLine[] = [];
  if (split) {
    if (clinician > 0) lines.push({ kind: "clinician_fee", labelKey: "checkout.line.clinician_fee", reasonKey: null, amountKobo: clinician, estimate: false });
    if (partner > 0) lines.push({ kind: "partner_fee", labelKey: "checkout.line.partner_fee", reasonKey: null, amountKobo: partner, estimate: false });
    if (service > 0) lines.push({ kind: "tarragon_service_fee", labelKey: "checkout.line.tarragon_service_fee", reasonKey: null, amountKobo: service, estimate: false });
  } else {
    lines.push({ kind: "price", labelKey: "checkout.line.price", reasonKey: null, amountKobo: list, estimate: false });
  }
  for (const l of quote.lines) {
    if (l.rule === "list" || !l.applied || l.amountKobo === 0) continue;
    lines.push({ kind: "reduction", labelKey: l.labelKey, reasonKey: l.reasonKey, amountKobo: l.amountKobo, estimate: false });
  }
  const due = quote.amountDueKobo;
  const processing = due > 0 ? estimateProcessingFeeKobo(due, fee) : 0;
  if (processing > 0) lines.push({ kind: "processing_estimate", labelKey: "checkout.line.processing_estimate", reasonKey: null, amountKobo: processing, estimate: true });

  const total = due + processing;
  const sum = lines.reduce((a, l) => a + l.amountKobo, 0);
  if (sum !== total) return null;
  const intl = due > 0 ? estimateInternationalFeeKobo(due, fee) : null;
  return {
    lines, totalKobo: total, amountDueKobo: due, processingKobo: processing, split,
    international: intl === null ? null : { processingKobo: intl, totalKobo: due + intl },
  };
}
