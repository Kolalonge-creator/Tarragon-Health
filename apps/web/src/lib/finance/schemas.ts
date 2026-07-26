import { z } from "zod";

/**
 * Zod schemas for the finance console RPC boundary. Every finance RPC returns
 * `Json` and is gated by private.is_finance(), so responses are parsed here
 * before use (same pattern as the analytics console). Amounts are minor units
 * (kobo/pence/cents) throughout.
 */

const num = z.number();
const int = z.number().int();

export const dashboardSummarySchema = z.object({
  cash_ngn: num,
  deferred_revenue_ngn: num,
  wallet_liability_ngn: num,
  receivables_ngn: num,
  vat_payable_ngn: num,
  wht_payable_ngn: num,
  revenue_ytd_ngn: num,
  revenue_mtd_ngn: num,
  expenses_ytd_ngn: num,
  unreconciled: z.object({
    count: int,
    by_currency: z.array(z.object({ currency: z.string().nullable(), total_minor: num })).default([]),
  }),
  revenue_by_currency: z
    .array(z.object({ currency: z.string().nullable(), recognised_minor: num }))
    .default([]),
  open_period: z.string().nullable(),
  entries_count: int,
});
export type DashboardSummary = z.infer<typeof dashboardSummarySchema>;

export const trialBalanceSchema = z.array(
  z.object({
    code: z.string(),
    name: z.string(),
    type: z.string(),
    debit_minor: num,
    credit_minor: num,
    balance_minor: num,
  }),
);
export type TrialBalanceRow = z.infer<typeof trialBalanceSchema>[number];

export const incomeStatementSchema = z.object({
  from: z.string(),
  to: z.string(),
  currency: z.string(),
  revenue_minor: num,
  contra_revenue_minor: num,
  expense_minor: num,
  net_revenue_minor: num,
  net_income_minor: num,
  lines: z
    .array(z.object({ code: z.string(), name: z.string(), type: z.string(), amount_minor: num }))
    .default([]),
});
export type IncomeStatement = z.infer<typeof incomeStatementSchema>;

export const balanceSheetSchema = z.object({
  as_of: z.string(),
  currency: z.string(),
  assets_minor: num,
  liabilities_minor: num,
  equity_minor: num,
  retained_earnings_minor: num,
  total_equity_minor: num,
  balances: z.boolean(),
  accounts: z
    .array(z.object({ code: z.string(), name: z.string(), type: z.string(), amount_minor: num }))
    .default([]),
});
export type BalanceSheet = z.infer<typeof balanceSheetSchema>;

const ledgerLineSchema = z.object({
  account_code: z.string(),
  name: z.string().nullable(),
  debit_minor: num,
  credit_minor: num,
  counterparty: z.string().nullable(),
  memo: z.string().nullable(),
});
export const ledgerEntriesSchema = z.array(
  z.object({
    id: z.string(),
    entry_no: int,
    entry_date: z.string(),
    period_month: z.string(),
    currency: z.string(),
    source: z.string(),
    memo: z.string().nullable(),
    is_reversed: z.boolean(),
    reversal_of: z.string().nullable(),
    lines: z.array(ledgerLineSchema).nullable().default([]),
  }),
);
export type LedgerEntry = z.infer<typeof ledgerEntriesSchema>[number];

export const taxSummarySchema = z.object({
  from: z.string(),
  to: z.string(),
  currency: z.string(),
  output_vat_minor: num,
  input_vat_minor: num,
  wht_payable_minor: num,
  revenue_by_vat_treatment: z
    .array(z.object({ treatment: z.string(), revenue_minor: num }))
    .default([]),
  rates: z
    .array(
      z.object({
        type: z.string(),
        name: z.string(),
        rate_pct: num,
        applies_to: z.string().nullable(),
        is_active: z.boolean(),
      }),
    )
    .default([]),
});
export type TaxSummary = z.infer<typeof taxSummarySchema>;

export const reconciliationSummarySchema = z.object({
  settlements: z
    .array(
      z.object({
        id: z.string(),
        provider: z.string(),
        external_ref: z.string().nullable(),
        settlement_date: z.string(),
        currency: z.string(),
        gross_minor: num,
        fees_minor: num,
        net_minor: num,
        status: z.string(),
        variance_minor: num,
        matched_count: int,
      }),
    )
    .default([]),
  unmatched: z
    .array(
      z.object({
        id: z.string(),
        provider: z.string(),
        event_type: z.string(),
        amount_minor: num,
        currency: z.string().nullable(),
        processed_at: z.string().nullable(),
        reference: z.string().nullable(),
      }),
    )
    .default([]),
});
export type ReconciliationSummary = z.infer<typeof reconciliationSummarySchema>;

export const revrecSummarySchema = z.object({
  total_deferred_minor: num,
  total_recognized_minor: num,
  active_schedules: int,
  schedules: z
    .array(
      z.object({
        id: z.string(),
        source_kind: z.string(),
        currency: z.string(),
        total_minor: num,
        recognized_minor: num,
        remaining_minor: num,
        period_start: z.string(),
        period_end: z.string(),
        status: z.string(),
      }),
    )
    .default([]),
});
export type RevrecSummary = z.infer<typeof revrecSummarySchema>;

export const accountsListSchema = z.array(
  z.object({
    code: z.string(),
    name: z.string(),
    type: z.string(),
    normal_balance: z.string(),
    vat_treatment: z.string(),
    is_active: z.boolean(),
    sort_order: int,
    description: z.string().nullable(),
  }),
);
export type FinanceAccount = z.infer<typeof accountsListSchema>[number];

export const periodsListSchema = z.array(
  z.object({
    period_month: z.string(),
    status: z.string(),
    closed_at: z.string().nullable(),
  }),
);
export type FinancePeriod = z.infer<typeof periodsListSchema>[number];

export const taxRatesListSchema = z.array(
  z.object({
    id: z.string(),
    jurisdiction: z.string(),
    tax_type: z.string(),
    name: z.string(),
    rate_pct: num,
    applies_to: z.string().nullable(),
    effective_from: z.string(),
    is_active: z.boolean(),
    notes: z.string().nullable(),
  }),
);
export type TaxRate = z.infer<typeof taxRatesListSchema>[number];
