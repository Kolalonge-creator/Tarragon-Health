import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { createClient } from "@/lib/supabase/client";
import { koboToNaira } from "@tarragon/shared";
import { providerLabel, streamLabel, PAYER_TYPE_LABEL } from "./definitions";
import { parseMoneyInput } from "./money-input";

/**
 * Finance v2 Phase B: the transaction directory and transaction detail
 * (public.finance_transactions_list / public.finance_transaction_detail,
 * migration 20261107023339). Both are finance-only RPCs; the detail read and
 * every export are written to the audit log by the database.
 */

const minor = z.number().int();

export const EVENT_KINDS = ["payment", "failed_payment", "refund"] as const;
export const SETTLEMENT_STATUSES = ["settled", "awaiting_settlement", "exception", "not_applicable"] as const;
export const PAYER_TYPES = ["individual", "family_sponsor", "employer"] as const;
export const RECORD_TYPES = [
  "order",
  "payment_transaction",
  "employer_invoice",
  "refund",
  "lab_order_refund",
  "pharmacy_order_refund",
  "service_purchase_refund",
  "voucher_refund",
] as const;
export type RecordType = (typeof RECORD_TYPES)[number];

export const EVENT_KIND_LABEL: Record<(typeof EVENT_KINDS)[number], string> = {
  payment: "Payment",
  failed_payment: "Failed",
  refund: "Refund",
};

export const SETTLEMENT_LABEL: Record<(typeof SETTLEMENT_STATUSES)[number], string> = {
  settled: "Settled",
  awaiting_settlement: "Awaiting settlement",
  exception: "Reconciliation exception",
  not_applicable: "Not applicable",
};

export const transactionRowSchema = z.object({
  event_id: z.string(),
  occurred_at: z.string().nullable(),
  event_kind: z.enum(EVENT_KINDS),
  stream: z.string(),
  payer_type: z.string(),
  provider: z.string(),
  amount_minor: minor,
  fee_minor: minor.nullable(),
  currency: z.string(),
  reference: z.string().nullable(),
  record_type: z.enum(RECORD_TYPES),
  record_id: z.string(),
  is_renewal: z.boolean(),
  processing_error: z.boolean(),
  settlement_status: z.enum(SETTLEMENT_STATUSES),
  refunded_minor: minor,
  payer_label: z.string(),
  beneficiary_label: z.string().nullable(),
});
export type TransactionRow = z.infer<typeof transactionRowSchema>;

export const transactionsPageSchema = z.object({
  total: z.number().int(),
  total_payments_minor: minor,
  total_refunds_minor: minor,
  limit: z.number().int(),
  offset: z.number().int(),
  rows: z.array(transactionRowSchema),
});
export type TransactionsPage = z.infer<typeof transactionsPageSchema>;

// ---------------------------------------------------------------------------
// Filters <-> URL
// ---------------------------------------------------------------------------

export interface TransactionFilters {
  kinds: string[];
  payerTypes: string[];
  settlement: string[];
  providers: string[];
  streams: string[];
  /** Naira as typed; converted to kobo only when sent. Empty means no bound. */
  minNaira: string;
  maxNaira: string;
  search: string;
  sort: "occurred_at" | "amount";
  dir: "asc" | "desc";
  page: number;
}

export const PAGE_SIZE = 50;

export const EMPTY_FILTERS: TransactionFilters = {
  kinds: [],
  payerTypes: [],
  settlement: [],
  providers: [],
  streams: [],
  minNaira: "",
  maxNaira: "",
  search: "",
  sort: "occurred_at",
  dir: "desc",
  page: 0,
};

const list = (v: string | null, allowed?: readonly string[]) =>
  (v ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s && /^[a-z_]{2,40}$/.test(s) && (!allowed || allowed.includes(s)));

// What the amount filters accept in the URL: plain naira with up to two decimals (the inputs strip commas first).
const NAIRA = /^\d{1,12}(\.\d{1,2})?$/;

/** Read filters from URL parameters, dropping anything unrecognised rather than passing it to the database. */
export function filtersFromParams(p: URLSearchParams): TransactionFilters {
  const min = (p.get("min") ?? "").trim();
  const max = (p.get("max") ?? "").trim();
  const page = Number.parseInt(p.get("page") ?? "0", 10);
  return {
    kinds: list(p.get("kind"), EVENT_KINDS),
    payerTypes: list(p.get("payer"), PAYER_TYPES),
    settlement: list(p.get("settlement"), SETTLEMENT_STATUSES),
    providers: list(p.get("provider")),
    streams: list(p.get("stream")),
    minNaira: NAIRA.test(min) ? min : "",
    maxNaira: NAIRA.test(max) ? max : "",
    search: (p.get("q") ?? "").slice(0, 100),
    sort: p.get("sort") === "amount" ? "amount" : "occurred_at",
    dir: p.get("dir") === "asc" ? "asc" : "desc",
    page: Number.isFinite(page) && page > 0 ? Math.min(page, 10_000) : 0,
  };
}

/** Write filters onto existing URL parameters (keeping the period keys), omitting defaults. */
export function filtersToParams(f: TransactionFilters, base: URLSearchParams): URLSearchParams {
  const p = new URLSearchParams(base);
  const set = (k: string, v: string) => (v ? p.set(k, v) : p.delete(k));
  set("kind", f.kinds.join(","));
  set("payer", f.payerTypes.join(","));
  set("settlement", f.settlement.join(","));
  set("provider", f.providers.join(","));
  set("stream", f.streams.join(","));
  set("min", f.minNaira);
  set("max", f.maxNaira);
  set("q", f.search.trim());
  set("sort", f.sort === "amount" ? "amount" : "");
  set("dir", f.dir === "asc" ? "asc" : "");
  set("page", f.page > 0 ? String(f.page) : "");
  return p;
}

/** Naira text to integer kobo through the one sanctioned parser (no floats). Null when empty or unreadable. */
export function nairaTextToKobo(text: string): number | null {
  if (!text.trim()) return null;
  const parsed = parseMoneyInput(text);
  return parsed.ok ? parsed.minor : null;
}

export function activeFilterCount(f: TransactionFilters): number {
  return [f.kinds, f.payerTypes, f.settlement, f.providers, f.streams].filter((a) => a.length > 0).length +
    (f.minNaira ? 1 : 0) + (f.maxNaira ? 1 : 0) + (f.search.trim() ? 1 : 0);
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

function rpcArgs(from: string, to: string, f: TransactionFilters) {
  const nonEmpty = (a: string[]) => (a.length ? a : undefined);
  return {
    p_from: from,
    p_to: to,
    p_event_kinds: nonEmpty(f.kinds),
    p_payer_types: nonEmpty(f.payerTypes),
    p_settlement: nonEmpty(f.settlement),
    p_providers: nonEmpty(f.providers),
    p_streams: nonEmpty(f.streams),
    p_min_minor: nairaTextToKobo(f.minNaira) ?? undefined,
    p_max_minor: nairaTextToKobo(f.maxNaira) ?? undefined,
    p_search: f.search.trim() || undefined,
    p_sort: f.sort,
    p_sort_dir: f.dir,
  };
}

export function useTransactions(from: string, to: string, f: TransactionFilters) {
  return useQuery({
    queryKey: ["finance", "transactions", from, to, f],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const { data, error } = await createClient().rpc("finance_transactions_list", {
        ...rpcArgs(from, to, f),
        p_limit: PAGE_SIZE,
        p_offset: f.page * PAGE_SIZE,
      });
      if (error) throw error;
      return transactionsPageSchema.parse(data);
    },
  });
}

/** The most rows one export will fetch. A larger export is refused with a message rather than cut short silently. */
export const EXPORT_ROW_CEILING = 20_000;
const EXPORT_PAGE = 5_000;

export class ExportTooLargeError extends Error {
  constructor(public readonly total: number) {
    super(`This export would be ${total.toLocaleString("en-NG")} rows; narrow the filters to ${EXPORT_ROW_CEILING.toLocaleString("en-NG")} or fewer.`);
  }
}

/**
 * Every row matching the filters, fetched in export mode (needs finance.export; each page is
 * audited by the database). Throws rather than returning a partial file.
 */
export async function fetchAllTransactionsForExport(from: string, to: string, f: TransactionFilters): Promise<TransactionRow[]> {
  const supabase = createClient();
  const rows: TransactionRow[] = [];
  let total = Infinity;
  for (let offset = 0; offset < total; offset += EXPORT_PAGE) {
    const { data, error } = await supabase.rpc("finance_transactions_list", {
      ...rpcArgs(from, to, f),
      p_limit: EXPORT_PAGE,
      p_offset: offset,
      p_for_export: true,
    });
    if (error) throw error;
    const page = transactionsPageSchema.parse(data);
    total = page.total;
    if (total > EXPORT_ROW_CEILING) throw new ExportTooLargeError(total);
    rows.push(...page.rows);
    if (page.rows.length === 0) break;
  }
  if (rows.length !== total) throw new Error(`Export read ${rows.length} of ${total} rows; nothing was saved. Try again.`);
  return rows;
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

function csvCell(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return "";
  let s = String(v);
  // Spreadsheet formula injection: a cell starting with = + - @ is text, not a formula.
  if (/^[=+\-@\t\r]/.test(s) && typeof v === "string") s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function transactionsCsv(rows: TransactionRow[], meta: { from: string; to: string; generatedAt: string }): string {
  const header = [
    "Date (Lagos)", "Type", "Reference", "Payer", "Beneficiary", "Payer type", "Category", "Renewal",
    "Amount (kobo)", "Amount (naira)", "Card fee (kobo)", "Refunded (kobo)", "Currency", "Provider",
    "Settlement status", "Processing error", "Record type", "Record id",
  ];
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.occurred_at ? new Date(r.occurred_at).toLocaleString("en-GB", { timeZone: "Africa/Lagos" }) : "",
        EVENT_KIND_LABEL[r.event_kind],
        r.reference,
        r.payer_label,
        r.beneficiary_label,
        PAYER_TYPE_LABEL[r.payer_type] ?? r.payer_type,
        streamLabel(r.stream),
        r.is_renewal ? "Yes" : "No",
        r.amount_minor,
        koboToNaira(r.amount_minor),
        r.fee_minor,
        r.refunded_minor,
        r.currency,
        providerLabel(r.provider),
        SETTLEMENT_LABEL[r.settlement_status],
        r.processing_error ? "Yes" : "No",
        r.record_type,
        r.record_id,
      ].map(csvCell).join(",")
    );
  }
  lines.push("", `Period,${meta.from} to ${meta.to}`, `Generated,${meta.generatedAt}`, `Rows,${rows.length}`,
    "Source,public.finance_transactions_list; definitions at /finance/glossary");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------

export const transactionDetailSchema = z.object({
  event: z.object({
    event_id: z.string(),
    occurred_at: z.string().nullable(),
    event_kind: z.enum(EVENT_KINDS),
    stream: z.string(),
    payer_type: z.string(),
    provider: z.string(),
    amount_minor: minor,
    fee_minor: minor.nullable(),
    currency: z.string(),
    reference: z.string().nullable(),
    record_type: z.enum(RECORD_TYPES),
    record_id: z.string(),
    is_renewal: z.boolean(),
    processing_error: z.boolean(),
    settlement_status: z.enum(SETTLEMENT_STATUSES),
  }),
  payer: z.object({ label: z.string(), kind: z.string() }),
  beneficiary: z.object({ label: z.string() }).nullable(),
  order: z
    .object({
      state: z.string(),
      list_amount_minor: minor.nullable(),
      amount_minor: minor,
      fee_minor: minor.nullable(),
      total_minor: minor.nullable(),
      discount_minor: minor.nullable(),
      sponsor_share_minor: minor.nullable(),
      paid_at: z.string().nullable(),
      created_at: z.string(),
      item: z.string().nullable(),
      failure_reason: z.string().nullable(),
    })
    .nullable(),
  membership: z
    .array(
      z.object({
        id: z.string(),
        tier: z.string(),
        state: z.string(),
        source: z.string(),
        starts_at: z.string(),
        ends_at: z.string().nullable(),
        auto_renew: z.boolean(),
        renewal_cancelled_at: z.string().nullable(),
      })
    )
    .nullable(),
  refunds: z.array(
    z.object({
      id: z.string(),
      amount_minor: minor,
      state: z.string(),
      reason: z.string(),
      provider_reference: z.string().nullable(),
      requested_at: z.string(),
      decided_at: z.string().nullable(),
      decided_by: z.string().nullable(),
      completed_at: z.string().nullable(),
      last_error_code: z.string().nullable(),
    })
  ),
  refundable_minor: minor.nullable(),
  webhooks: z.array(
    z.object({
      event_type: z.string(),
      status: z.string(),
      received_at: z.string().nullable(),
      processed_at: z.string().nullable(),
      attempt_count: z.number().int().nullable(),
      last_error: z.string().nullable(),
      signature_verified: z.boolean().nullable(),
    })
  ),
  settlement: z.array(
    z.object({
      provider_reference: z.string().nullable(),
      amount_kobo: minor.nullable(),
      fees_kobo: minor.nullable(),
      line_status: z.string().nullable(),
      paid_at: z.string().nullable(),
      provider_settlement_id: z.string().nullable(),
      report_status: z.string().nullable(),
      settled_at: z.string().nullable(),
    })
  ),
  reconciliation: z.array(
    z.object({
      kind: z.string(),
      type: z.string(),
      status: z.string(),
      provider_minor: minor.nullable(),
      local_minor: minor.nullable(),
      difference_minor: minor.nullable(),
      seen_at: z.string().nullable(),
      closed_at: z.string().nullable(),
      note: z.string().nullable(),
    })
  ),
  ledger: z.array(
    z.object({
      id: z.string(),
      entry_date: z.string(),
      source: z.string(),
      memo: z.string().nullable(),
      created_at: z.string(),
      lines: z.array(z.object({ account_code: z.string(), account_name: z.string(), debit_minor: minor, credit_minor: minor })),
    })
  ),
  timeline: z.array(z.object({ at: z.string(), label: z.string(), kind: z.string() })),
});
export type TransactionDetail = z.infer<typeof transactionDetailSchema>;

export function useTransactionDetail(recordType: RecordType, recordId: string) {
  return useQuery({
    queryKey: ["finance", "transaction", recordType, recordId],
    // Every read is audited; do not refetch on focus and write a fresh audit row each time.
    refetchOnWindowFocus: false,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await createClient().rpc("finance_transaction_detail", {
        p_record_type: recordType,
        p_record_id: recordId,
      });
      if (error) throw error;
      return data === null ? null : transactionDetailSchema.parse(data);
    },
  });
}

export function transactionHref(recordType: string, recordId: string): string | null {
  return (RECORD_TYPES as readonly string[]).includes(recordType) ? `/finance/transactions/${recordType}/${recordId}` : null;
}
