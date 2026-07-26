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
  revrecSummarySchema,
  taxRatesListSchema,
  taxSummarySchema,
  trialBalanceSchema,
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
