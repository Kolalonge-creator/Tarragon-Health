import { z } from "zod";

/**
 * Money reconciliation screen: the shapes the two read-only database functions return, the plain-words label of every mismatch
 * kind, where each id can be opened, and the owner hint. No server-only imports so the page and the tests share one definition.
 * The screen never writes: nothing here builds a mutation, a retry or a fix. Money is integer kobo (INV-15).
 */

export const OWNER_LABEL: Record<string, string> = {
  finance: "Finance",
  engineering: "Engineering on call",
  support: "Support and the care team",
};

/** Every kind the database can report. A kind the page does not know is still shown (with its raw code), never dropped. */
export const KIND_LABEL: Record<string, string> = {
  paid_order_no_entitlement: "Paid order, no entitlement",
  entitlement_no_paid_order: "Entitlement on an order that is not paid",
  refunded_order_entitlement_active: "Refunded order, entitlement still active",
  paid_order_no_payment: "Paid order, no successful payment row",
  payment_amount_differs_from_order: "Payment amount differs from the order price",
  payment_total_inconsistent: "Payment total is not amount plus fee",
  payment_success_order_not_paid: "Successful payment on an order that is not paid",
  payment_mismatch_recorded: "Checkout refused a payment as a mismatch",
  paid_order_no_journal: "Paid order, no general ledger entry",
  refund_processing_stuck: "Refund stuck while sending",
  refund_paystack_mismatch: "Refund disagrees with Paystack",
  refund_completed_no_cash_posting: "Refund completed, cash entry missing",
  refund_gl_release_pending: "Refund completed, deferred revenue release pending",
  refund_cash_out_without_payment_entry: "Refund completed, order never reached the ledger as a payment",
  refund_decided_not_sent: "Order refunded, but the refund has not gone back to the card",
  refund_gl_release_irregular: "Deferred revenue release for a refund that is not completed, or larger than the refund",
  earnings_reversal_irregular: "Earnings reversal for a refund that is not completed, or larger than the share",
  consultation_share_not_reversed: "Refunded consultation, clinician share not (fully) reversed",
  payout_total_differs_from_lines: "Payout total differs from its earnings lines",
  payout_succeeded_no_successful_transfer: "Payout succeeded, no successful transfer",
  payout_succeeded_no_gl_posting: "Payout succeeded, no ledger posting",
  payout_gl_posting_failed: "Payout ledger posting failed",
  payout_gl_amount_differs: "Payout ledger entry differs from the payout",
  payout_reversed_no_gl_reversal: "Payout returned by the bank, no reversing entry",
  payout_includes_disputed_line: "Payout includes an earnings line under dispute",
  earnings_dispute_overdue: "Earnings question overdue, line held",
  payout_sent_with_withholding: "Payout sent while a withholding is undecided",
};

export const KIND_ORDER: readonly string[] = Object.keys(KIND_LABEL);

/** Where an id can be opened today. There is no per-record page for most of these, so this is the list page that holds the record. */
const SUBJECT_HREF: Record<string, string> = {
  order: "/admin/refund-requests",
  payment: "/finance/transactions",
  refund: "/admin/refund-requests",
  entitlement: "/admin/memberships",
  earnings_line: "/admin/earnings",
  payout: "/admin/payouts",
  journal_entry: "/finance/ledger",
};

const SUBJECT_NAME: Record<string, string> = {
  order: "Order",
  payment: "Payment",
  refund: "Refund",
  entitlement: "Entitlement",
  earnings_line: "Earnings line",
  payout: "Payout",
  journal_entry: "Ledger entry",
};

export function subjectName(type: string): string {
  return SUBJECT_NAME[type] ?? type;
}

export function subjectHref(type: string): string | null {
  return SUBJECT_HREF[type] ?? null;
}

export const mismatchRowSchema = z.object({
  kind: z.string(),
  severity: z.enum(["high", "medium"]),
  organisation_id: z.string().uuid().nullable(),
  subject_type: z.string(),
  subject_id: z.string().uuid(),
  related_type: z.string().nullable(),
  related_id: z.string().uuid().nullable(),
  delta_kobo: z.number().int().nullable(),
  since: z.string().nullable(),
  owner_hint: z.string(),
  detail: z.string(),
  total_count: z.number().int().nonnegative(),
});
export type MismatchRow = z.infer<typeof mismatchRowSchema>;
export const mismatchListSchema = z.array(mismatchRowSchema);

export const summaryRowSchema = z.object({
  kind: z.string(),
  severity: z.enum(["high", "medium"]),
  n: z.number().int().nonnegative(),
  delta_abs_kobo: z.number().int().nonnegative(),
  oldest: z.string().nullable(),
});
export type SummaryRow = z.infer<typeof summaryRowSchema>;
export const summaryListSchema = z.array(summaryRowSchema);

const MS_PER_HOUR = 3_600_000;
const HOURS_PER_DAY = 24;

/** "3 hours", "2 days": how long a record has been wrong. Null when the database has no timestamp for it. */
export function ageLabel(since: string | null, now: Date = new Date()): string {
  if (!since) return "unknown";
  const ms = now.getTime() - new Date(since).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "just now";
  const hours = Math.floor(ms / MS_PER_HOUR);
  if (hours < 1) return "under an hour";
  if (hours < HOURS_PER_DAY) return `${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.floor(hours / HOURS_PER_DAY);
  return `${days} day${days === 1 ? "" : "s"}`;
}

export interface ScreenParams {
  kind: string | null;
  includeTest: boolean;
  page: number;
}

/** Read the query string. An unknown kind is dropped (shows everything) rather than shown as an empty list. */
export function parseScreenParams(raw: { kind?: string; test?: string; page?: string }): ScreenParams {
  const kind = raw.kind && KIND_LABEL[raw.kind] ? raw.kind : null;
  const page = Number.parseInt(raw.page ?? "1", 10);
  return { kind, includeTest: raw.test === "1", page: Number.isInteger(page) && page >= 1 ? page : 1 };
}
