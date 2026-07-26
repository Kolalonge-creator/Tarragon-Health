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
  cost_center_code: z.string().nullable().optional(),
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

/**
 * Additions from the 2026-07-26 audit/tracking/functionality pass: maker-
 * checker approvals, cost centers, budgets, cash flow statement, accounts
 * payable, HMO capitation register, statutory compliance calendar, KPIs and
 * the finance-specific audit log viewer.
 */

// --- Approvals ---------------------------------------------------------
export const pendingApprovalsSchema = z.array(
  z.object({
    id: z.string(),
    request_type: z.enum(["manual_journal", "period_lock"]),
    payload: z.record(z.string(), z.unknown()),
    reason: z.string().nullable(),
    requested_by_name: z.string().nullable(),
    requested_at: z.string(),
    is_own_request: z.boolean(),
  }),
);
export type PendingApproval = z.infer<typeof pendingApprovalsSchema>[number];

export const approvalHistorySchema = z.array(
  z.object({
    id: z.string(),
    request_type: z.enum(["manual_journal", "period_lock"]),
    status: z.enum(["approved", "rejected"]),
    payload: z.record(z.string(), z.unknown()),
    reason: z.string().nullable(),
    requested_by_name: z.string().nullable(),
    requested_at: z.string(),
    reviewed_by_name: z.string().nullable(),
    reviewed_at: z.string().nullable(),
    review_note: z.string().nullable(),
    result_entry_id: z.string().nullable(),
  }),
);
export type ApprovalHistoryEntry = z.infer<typeof approvalHistorySchema>[number];

export const approvalSettingsSchema = z.array(
  z.object({ currency: z.string(), threshold_minor: num }),
);
export type ApprovalSetting = z.infer<typeof approvalSettingsSchema>[number];

export const postOrPendingSchema = z.object({
  status: z.enum(["posted", "pending_approval"]),
  entry_id: z.string().optional(),
  request_id: z.string().optional(),
});
export type PostOrPendingResult = z.infer<typeof postOrPendingSchema>;

export const periodStatusResultSchema = z.object({
  status: z.string(),
  request_id: z.string().optional(),
});
export type PeriodStatusResult = z.infer<typeof periodStatusResultSchema>;

// --- Cost centers --------------------------------------------------------
export const costCentersListSchema = z.array(
  z.object({ code: z.string(), name: z.string(), is_active: z.boolean(), sort_order: int }),
);
export type FinanceCostCenter = z.infer<typeof costCentersListSchema>[number];

export const pnlByCostCenterSchema = z.array(
  z.object({
    cost_center_code: z.string(),
    cost_center_name: z.string(),
    revenue_minor: num,
    expense_minor: num,
    net_minor: num,
  }),
);
export type PnlByCostCenter = z.infer<typeof pnlByCostCenterSchema>[number];

// --- Budgets ---------------------------------------------------------------
export const budgetsListSchema = z.array(
  z.object({
    id: z.string(),
    account_code: z.string(),
    account_name: z.string(),
    cost_center_code: z.string().nullable(),
    period_month: z.string(),
    currency: z.string(),
    amount_minor: num,
    notes: z.string().nullable(),
  }),
);
export type FinanceBudget = z.infer<typeof budgetsListSchema>[number];

export const budgetVarianceSchema = z.array(
  z.object({
    account_code: z.string(),
    account_name: z.string(),
    account_type: z.string(),
    cost_center_code: z.string().nullable(),
    budget_minor: num,
    actual_minor: num,
    variance_minor: num,
  }),
);
export type BudgetVarianceRow = z.infer<typeof budgetVarianceSchema>[number];

// --- Cash flow statement ---------------------------------------------------
const cashFlowSectionSchema = z.object({
  adjustments: z.array(z.object({ code: z.string(), name: z.string(), delta_minor: num })).default([]),
});
export const cashFlowStatementSchema = z.object({
  from: z.string(),
  to: z.string(),
  currency: z.string(),
  net_income_minor: num,
  cash_beginning_minor: num,
  cash_ending_minor: num,
  net_change_in_cash_minor: num,
  operating: cashFlowSectionSchema.extend({ net_cash_from_operating_minor: num }),
  investing: cashFlowSectionSchema.extend({ net_cash_from_investing_minor: num }),
  financing: cashFlowSectionSchema.extend({ net_cash_from_financing_minor: num }),
});
export type CashFlowStatement = z.infer<typeof cashFlowStatementSchema>;

// --- Accounts payable: vendors + bills -------------------------------------
export const vendorsListSchema = z.array(
  z.object({
    id: z.string(),
    name: z.string(),
    vendor_type: z.string().nullable(),
    contact_email: z.string().nullable(),
    contact_phone: z.string().nullable(),
    tin: z.string().nullable(),
    wht_applicable: z.boolean(),
    wht_rate_pct: num.nullable(),
    is_active: z.boolean(),
  }),
);
export type FinanceVendor = z.infer<typeof vendorsListSchema>[number];

export const billsListSchema = z.array(
  z.object({
    id: z.string(),
    bill_no: int,
    vendor_id: z.string(),
    vendor_name: z.string(),
    bill_date: z.string(),
    due_date: z.string().nullable(),
    currency: z.string(),
    amount_minor: num,
    expense_account_code: z.string(),
    cost_center_code: z.string().nullable(),
    description: z.string().nullable(),
    status: z.enum(["draft", "approved", "paid", "void"]),
    wht_minor: num,
    paid_at: z.string().nullable(),
  }),
);
export type FinanceBill = z.infer<typeof billsListSchema>[number];

export const apAgingSchema = z.array(
  z.object({
    id: z.string(),
    bill_no: int,
    vendor_name: z.string(),
    currency: z.string(),
    amount_minor: num,
    due_date: z.string().nullable(),
    days_overdue: int,
  }),
);
export type ApAgingRow = z.infer<typeof apAgingSchema>[number];

// --- HMO capitation register ------------------------------------------------
export const capitationRegisterSchema = z.array(
  z.object({
    id: z.string(),
    organisation_id: z.string(),
    organisation_name: z.string(),
    contract_name: z.string(),
    pmpm_rate_minor: num,
    currency: z.string(),
    effective_from: z.string(),
    effective_to: z.string().nullable(),
    is_active: z.boolean(),
    roster_active_members: int,
    receipts: z.array(
      z.object({
        id: z.string(),
        period_month: z.string(),
        enrolled_members: int,
        amount_minor: num,
        received_date: z.string(),
        implied_pmpm_minor: num.nullable(),
        rate_variance_minor: num.nullable(),
        estimated_cost_of_care_minor: num.nullable(),
        estimated_loss_ratio_pct: num.nullable(),
      }),
    ).default([]),
  }),
);
export type CapitationContractRow = z.infer<typeof capitationRegisterSchema>[number];

export const hmoOrganisationsListSchema = z.array(z.object({ id: z.string(), name: z.string() }));
export type HmoOrganisation = z.infer<typeof hmoOrganisationsListSchema>[number];

// --- Statutory compliance calendar -----------------------------------------
export const complianceCalendarSchema = z.array(
  z.object({
    obligation_code: z.string(),
    obligation_name: z.string(),
    agency: z.string(),
    frequency: z.enum(["monthly", "annual"]),
    period_label: z.string(),
    due_date: z.string(),
    status: z.enum(["filed", "overdue", "due_soon", "upcoming"]),
    filed_at: z.string().nullable(),
    remittance_reference: z.string().nullable(),
    amount_minor: num.nullable(),
    description: z.string().nullable(),
  }),
);
export type ComplianceObligation = z.infer<typeof complianceCalendarSchema>[number];

// --- KPIs + risk flags + audit log -----------------------------------------
export const kpiSummarySchema = z.object({
  currency: z.string(),
  revenue_mtd_minor: num,
  gross_profit_mtd_minor: num,
  gross_margin_pct: num.nullable(),
  net_income_mtd_minor: num,
  net_margin_pct: num.nullable(),
  mom_revenue_growth_pct: num.nullable(),
  yoy_revenue_growth_pct: num.nullable(),
  dso_days: num.nullable(),
  cash_runway_months: num.nullable(),
  cash_minor: num,
  receivable_minor: num,
});
export type KpiSummary = z.infer<typeof kpiSummarySchema>;

export const riskFlagsSchema = z.object({
  pending_approvals_count: int,
  aged_unreconciled_count: int,
  ap_due_soon_count: int,
  ap_overdue_count: int,
  compliance_overdue_count: int,
});
export type RiskFlags = z.infer<typeof riskFlagsSchema>;

export const financeAuditLogSchema = z.array(
  z.object({
    id: z.string(),
    created_at: z.string(),
    actor_name: z.string().nullable(),
    action: z.string(),
    entity_type: z.string().nullable(),
    entity_id: z.string().nullable(),
    event: z.record(z.string(), z.unknown()),
  }),
);
export type FinanceAuditLogEntry = z.infer<typeof financeAuditLogSchema>[number];

export const auditActionsListSchema = z.array(z.string());

export const complianceSuggestedAmountSchema = z.object({
  suggested_amount_minor: num.optional(),
  currency: z.string().optional(),
  basis: z.string().optional(),
});
export type ComplianceSuggestedAmount = z.infer<typeof complianceSuggestedAmountSchema>;
