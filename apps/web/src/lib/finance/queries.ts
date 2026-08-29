import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import {
  accountsListSchema,
  balanceSheetSchema,
  dashboardSummarySchema,
  incomeStatementSchema,
  ledgerEntriesSchema,
  periodsListSchema,
  reconciliationSummarySchema,
  reconciliationFlagsSchema,
  fraudSignalsSchema,
  revrecSummarySchema,
  taxRatesListSchema,
  taxSummarySchema,
  trialBalanceSchema,
  pendingApprovalsSchema,
  approvalHistorySchema,
  approvalSettingsSchema,
  costCentersListSchema,
  pnlByCostCenterSchema,
  budgetsListSchema,
  budgetVarianceSchema,
  cashFlowStatementSchema,
  vendorsListSchema,
  billsListSchema,
  apAgingSchema,
  complianceCalendarSchema,
  kpiSummarySchema,
  riskFlagsSchema,
  financeAuditLogSchema,
  auditActionsListSchema,
  complianceSuggestedAmountSchema,
  companyProfileSchema,
} from "./schemas";

/**
 * Finance console data hooks. Every call goes through a SECURITY DEFINER RPC
 * that returns platform-wide finance data ONLY when the caller passes
 * private.is_finance() — see supabase/migrations/20260725230915_finance_reporting_rpcs_and_grants.sql.
 * Responses are typed as `Json`, so each is parsed with Zod at the boundary.
 */

export function useFinanceDashboard() {
  return useQuery({
    queryKey: ["finance", "dashboard"],
    queryFn: async () => {
      const { data, error } = await createClient().rpc("finance_dashboard_summary");
      if (error) throw error;
      return dashboardSummarySchema.parse(data);
    },
  });
}

export function useTrialBalance(asOf: string, currency: string) {
  return useQuery({
    queryKey: ["finance", "trial-balance", asOf, currency],
    queryFn: async () => {
      const { data, error } = await createClient().rpc("finance_trial_balance", {
        p_as_of: asOf,
        p_currency: currency,
      });
      if (error) throw error;
      return trialBalanceSchema.parse(data);
    },
  });
}

export function useIncomeStatement(from: string, to: string, currency: string) {
  return useQuery({
    queryKey: ["finance", "income-statement", from, to, currency],
    queryFn: async () => {
      const { data, error } = await createClient().rpc("finance_income_statement", {
        p_from: from,
        p_to: to,
        p_currency: currency,
      });
      if (error) throw error;
      return incomeStatementSchema.parse(data);
    },
  });
}

export function useBalanceSheet(asOf: string, currency: string) {
  return useQuery({
    queryKey: ["finance", "balance-sheet", asOf, currency],
    queryFn: async () => {
      const { data, error } = await createClient().rpc("finance_balance_sheet", {
        p_as_of: asOf,
        p_currency: currency,
      });
      if (error) throw error;
      return balanceSheetSchema.parse(data);
    },
  });
}

export function useLedgerEntries(args: {
  from: string;
  to: string;
  account?: string;
  source?: string;
}) {
  return useQuery({
    queryKey: ["finance", "ledger", args],
    queryFn: async () => {
      const { data, error } = await createClient().rpc("finance_ledger_entries", {
        p_from: args.from,
        p_to: args.to,
        p_account: args.account ?? undefined,
        p_source: args.source ?? undefined,
      });
      if (error) throw error;
      return ledgerEntriesSchema.parse(data);
    },
  });
}

export function useTaxSummary(from: string, to: string, currency: string) {
  return useQuery({
    queryKey: ["finance", "tax", from, to, currency],
    queryFn: async () => {
      const { data, error } = await createClient().rpc("finance_tax_summary", {
        p_from: from,
        p_to: to,
        p_currency: currency,
      });
      if (error) throw error;
      return taxSummarySchema.parse(data);
    },
  });
}

export function useReconciliationSummary() {
  return useQuery({
    queryKey: ["finance", "reconciliation"],
    queryFn: async () => {
      const { data, error } = await createClient().rpc("finance_reconciliation_summary");
      if (error) throw error;
      return reconciliationSummarySchema.parse(data);
    },
  });
}

export function useRevrecSummary() {
  return useQuery({
    queryKey: ["finance", "revrec"],
    queryFn: async () => {
      const { data, error } = await createClient().rpc("finance_revrec_summary");
      if (error) throw error;
      return revrecSummarySchema.parse(data);
    },
  });
}

export function useFinanceAccounts() {
  return useQuery({
    queryKey: ["finance", "accounts"],
    queryFn: async () => {
      const { data, error } = await createClient().rpc("finance_accounts_list");
      if (error) throw error;
      return accountsListSchema.parse(data);
    },
  });
}

export function useFinancePeriods() {
  return useQuery({
    queryKey: ["finance", "periods"],
    queryFn: async () => {
      const { data, error } = await createClient().rpc("finance_periods_list");
      if (error) throw error;
      return periodsListSchema.parse(data);
    },
  });
}

export function useTaxRates() {
  return useQuery({
    queryKey: ["finance", "tax-rates"],
    queryFn: async () => {
      const { data, error } = await createClient().rpc("finance_tax_rates_list");
      if (error) throw error;
      return taxRatesListSchema.parse(data);
    },
  });
}

/** React Query keys touched by finance mutations, for invalidation. */
export const financeKeys = {
  all: ["finance"] as const,
};

/**
 * Additions from the 2026-07-26 audit/tracking/functionality pass: maker-
 * checker approvals, cost centers, budgets, cash flow statement, accounts
 * payable, statutory compliance calendar, KPIs and
 * the finance-specific audit log viewer.
 */

export function usePendingApprovals() {
  return useQuery({
    queryKey: ["finance", "approvals", "pending"],
    queryFn: async () => {
      const { data, error } = await createClient().rpc("finance_pending_approvals");
      if (error) throw error;
      return pendingApprovalsSchema.parse(data);
    },
  });
}

export function useApprovalHistory() {
  return useQuery({
    queryKey: ["finance", "approvals", "history"],
    queryFn: async () => {
      const { data, error } = await createClient().rpc("finance_approval_history", { p_limit: 100 });
      if (error) throw error;
      return approvalHistorySchema.parse(data);
    },
  });
}

export function useApprovalSettings() {
  return useQuery({
    queryKey: ["finance", "approvals", "settings"],
    queryFn: async () => {
      const { data, error } = await createClient().rpc("finance_approval_settings_list");
      if (error) throw error;
      return approvalSettingsSchema.parse(data);
    },
  });
}

export function useCostCenters() {
  return useQuery({
    queryKey: ["finance", "cost-centers"],
    queryFn: async () => {
      const { data, error } = await createClient().rpc("finance_cost_centers_list");
      if (error) throw error;
      return costCentersListSchema.parse(data);
    },
  });
}

export function usePnlByCostCenter(from: string, to: string, currency: string) {
  return useQuery({
    queryKey: ["finance", "pnl-by-cost-center", from, to, currency],
    queryFn: async () => {
      const { data, error } = await createClient().rpc("finance_pnl_by_cost_center", {
        p_from: from,
        p_to: to,
        p_currency: currency,
      });
      if (error) throw error;
      return pnlByCostCenterSchema.parse(data);
    },
  });
}

export function useBudgets(periodMonth?: string) {
  return useQuery({
    queryKey: ["finance", "budgets", periodMonth ?? "all"],
    queryFn: async () => {
      const { data, error } = await createClient().rpc("finance_budgets_list", {
        p_period_month: periodMonth ?? undefined,
      });
      if (error) throw error;
      return budgetsListSchema.parse(data);
    },
  });
}

export function useBudgetVariance(from: string, to: string, currency: string) {
  return useQuery({
    queryKey: ["finance", "budget-variance", from, to, currency],
    queryFn: async () => {
      const { data, error } = await createClient().rpc("finance_budget_variance", {
        p_from: from,
        p_to: to,
        p_currency: currency,
      });
      if (error) throw error;
      return budgetVarianceSchema.parse(data);
    },
  });
}

export function useCashFlowStatement(from: string, to: string, currency: string) {
  return useQuery({
    queryKey: ["finance", "cash-flow", from, to, currency],
    queryFn: async () => {
      const { data, error } = await createClient().rpc("finance_cash_flow_statement", {
        p_from: from,
        p_to: to,
        p_currency: currency,
      });
      if (error) throw error;
      return cashFlowStatementSchema.parse(data);
    },
  });
}

export function useVendors() {
  return useQuery({
    queryKey: ["finance", "vendors"],
    queryFn: async () => {
      const { data, error } = await createClient().rpc("finance_vendors_list");
      if (error) throw error;
      return vendorsListSchema.parse(data);
    },
  });
}

export function useBills(status?: string) {
  return useQuery({
    queryKey: ["finance", "bills", status ?? "all"],
    queryFn: async () => {
      const { data, error } = await createClient().rpc("finance_bills_list", {
        p_status: status ?? undefined,
      });
      if (error) throw error;
      return billsListSchema.parse(data);
    },
  });
}

export function useApAging() {
  return useQuery({
    queryKey: ["finance", "ap-aging"],
    queryFn: async () => {
      const { data, error } = await createClient().rpc("finance_ap_aging");
      if (error) throw error;
      return apAgingSchema.parse(data);
    },
  });
}

export function useComplianceCalendar(monthsAhead = 3) {
  return useQuery({
    queryKey: ["finance", "compliance", monthsAhead],
    queryFn: async () => {
      const { data, error } = await createClient().rpc("finance_compliance_calendar", {
        p_months_ahead: monthsAhead,
      });
      if (error) throw error;
      return complianceCalendarSchema.parse(data);
    },
  });
}

/** Same shape as useComplianceCalendar, windowed by an explicit calendar
 * year instead of "relative to today" — see finance_compliance_calendar_for_year
 * (20260812041815). Powers the printable Government filings pack, which lets
 * you pick a past financial year the day-to-day tab's rolling window can't reach. */
export function useComplianceCalendarForYear(year: number) {
  return useQuery({
    queryKey: ["finance", "compliance", "year", year],
    queryFn: async () => {
      const { data, error } = await createClient().rpc("finance_compliance_calendar_for_year", {
        p_year: year,
      });
      if (error) throw error;
      return complianceCalendarSchema.parse(data);
    },
  });
}

export function useKpiSummary(currency: string) {
  return useQuery({
    queryKey: ["finance", "kpis", currency],
    queryFn: async () => {
      const { data, error } = await createClient().rpc("finance_kpi_summary", { p_currency: currency });
      if (error) throw error;
      return kpiSummarySchema.parse(data);
    },
  });
}

export function useReconciliationFlags(status: "open" | "resolved" | "ignored" | null = "open") {
  return useQuery({
    queryKey: ["finance", "reconciliation-flags", status],
    queryFn: async () => {
      const { data, error } = await createClient().rpc("finance_reconciliation_flags", {
        p_status: status ?? undefined,
      });
      if (error) throw error;
      return reconciliationFlagsSchema.parse(data);
    },
  });
}

export function useFraudSignals(status: "open" | "resolved" | "ignored" | null = "open") {
  return useQuery({
    queryKey: ["finance", "fraud-signals", status],
    queryFn: async () => {
      const { data, error } = await createClient().rpc("finance_fraud_signals", {
        p_status: status ?? undefined,
      });
      if (error) throw error;
      return fraudSignalsSchema.parse(data);
    },
  });
}

export function useRiskFlags() {
  return useQuery({
    queryKey: ["finance", "risk-flags"],
    queryFn: async () => {
      const { data, error } = await createClient().rpc("finance_risk_flags");
      if (error) throw error;
      return riskFlagsSchema.parse(data);
    },
  });
}

export function useFinanceAuditLog(args: { from: string; to: string; action?: string }) {
  return useQuery({
    queryKey: ["finance", "audit-log", args],
    queryFn: async () => {
      const { data, error } = await createClient().rpc("finance_audit_log", {
        p_from: args.from,
        p_to: args.to,
        p_action: args.action ?? undefined,
      });
      if (error) throw error;
      return financeAuditLogSchema.parse(data);
    },
  });
}

export function useFinanceAuditActions() {
  return useQuery({
    queryKey: ["finance", "audit-log", "actions"],
    queryFn: async () => {
      const { data, error } = await createClient().rpc("finance_audit_actions_list");
      if (error) throw error;
      return auditActionsListSchema.parse(data);
    },
  });
}

/** Company legal/registration profile — the letterhead facts the printable
 * Reports & Filings packs (finance/reports/print/[pack]) render at the top
 * of every document. Editable only from admin/settings/company-profile. */
export function useCompanyProfile() {
  return useQuery({
    queryKey: ["finance", "company-profile"],
    queryFn: async () => {
      const { data, error } = await createClient().rpc("finance_company_profile_get");
      if (error) throw error;
      return companyProfileSchema.parse(data);
    },
  });
}

/** On-demand only (not a background query) — fetched right before showing the mark-filed form. */
export async function fetchComplianceSuggestedAmount(obligationCode: string, periodLabel: string) {
  const { data, error } = await createClient().rpc("finance_compliance_suggested_amount", {
    p_obligation_code: obligationCode,
    p_period_label: periodLabel,
  });
  if (error) throw error;
  return complianceSuggestedAmountSchema.parse(data);
}
