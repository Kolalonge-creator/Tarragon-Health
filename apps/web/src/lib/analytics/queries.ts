import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import {
  accountingSummarySchema,
  acquisitionFunnelSchema,
  activeUsersTimeseriesSchema,
  auditLogSchema,
  auditSummarySchema,
  businessSummarySchema,
  clinicalOutcomesSchema,
  deliverabilitySchema,
  doctorPerformanceSchema,
  engagementSummarySchema,
  escalationQualitySchema,
  facilityEngagementSchema,
  featureAdoptionSchema,
  financeInputsSchema,
  financialSummarySchema,
  governanceSummarySchema,
  growthTimeseriesSchema,
  investorSummarySchema,
  operationsSummarySchema,
  patientActivitySchema,
  patientSearchSchema,
  populationSummarySchema,
  retentionCohortsSchema,
  riskRegisterSchema,
  staffActivitySchema,
  userSegmentsSchema,
  revenueByPlanSchema,
  revenueTimeseriesSchema,
  trafficSummarySchema,
  trafficTimeseriesSchema,
} from "./schemas";

/**
 * Platform Analytics & Audit Console data hooks. Every call goes through a
 * SECURITY DEFINER RPC that returns cross-org aggregates ONLY when the caller
 * is an analyst (private.is_analyst()) — see
 * supabase/migrations/20260717180931_analytics_console_rpcs.sql. Responses are
 * parsed with Zod at the boundary since the RPCs are typed as `Json`.
 */

export type GrowthPeriod = "day" | "week" | "month";

export function useBusinessSummary() {
  return useQuery({
    queryKey: ["analytics", "business-summary"],
    queryFn: async () => {
      const { data, error } = await createClient().rpc("analytics_business_summary");
      if (error) throw error;
      return businessSummarySchema.parse(data);
    },
  });
}

export function useGrowthTimeseries(period: GrowthPeriod = "month") {
  return useQuery({
    queryKey: ["analytics", "growth", period],
    queryFn: async () => {
      const { data, error } = await createClient().rpc("analytics_growth_timeseries", {
        p_period: period,
      });
      if (error) throw error;
      return growthTimeseriesSchema.parse(data);
    },
  });
}

export function useFinancialSummary() {
  return useQuery({
    queryKey: ["analytics", "financial-summary"],
    queryFn: async () => {
      const { data, error } = await createClient().rpc("analytics_financial_summary");
      if (error) throw error;
      return financialSummarySchema.parse(data);
    },
  });
}

export function useRevenueTimeseries(period: GrowthPeriod = "month") {
  return useQuery({
    queryKey: ["analytics", "revenue", period],
    queryFn: async () => {
      const { data, error } = await createClient().rpc("analytics_revenue_timeseries", {
        p_period: period,
      });
      if (error) throw error;
      return revenueTimeseriesSchema.parse(data);
    },
  });
}

export function useRevenueByPlan() {
  return useQuery({
    queryKey: ["analytics", "revenue-by-plan"],
    queryFn: async () => {
      const { data, error } = await createClient().rpc("analytics_revenue_by_plan");
      if (error) throw error;
      return revenueByPlanSchema.parse(data);
    },
  });
}

export function usePopulationSummary() {
  return useQuery({
    queryKey: ["analytics", "population-summary"],
    queryFn: async () => {
      const { data, error } = await createClient().rpc("analytics_population_summary");
      if (error) throw error;
      return populationSummarySchema.parse(data);
    },
  });
}

export interface AuditFilters {
  action?: string | null;
  entityType?: string | null;
  org?: string | null;
  from?: string | null;
  to?: string | null;
  limit?: number;
  offset?: number;
}

export function useAuditLog(filters: AuditFilters) {
  return useQuery({
    queryKey: ["analytics", "audit-log", filters],
    queryFn: async () => {
      const { data, error } = await createClient().rpc("analytics_audit_log", {
        p_action: filters.action ?? undefined,
        p_entity_type: filters.entityType ?? undefined,
        p_org: filters.org ?? undefined,
        p_from: filters.from ?? undefined,
        p_to: filters.to ?? undefined,
        p_limit: filters.limit ?? 100,
        p_offset: filters.offset ?? 0,
      });
      if (error) throw error;
      return auditLogSchema.parse(data);
    },
  });
}

export function useAuditSummary(from?: string | null, to?: string | null) {
  return useQuery({
    queryKey: ["analytics", "audit-summary", from, to],
    queryFn: async () => {
      const { data, error } = await createClient().rpc("analytics_audit_summary", {
        p_from: from ?? undefined,
        p_to: to ?? undefined,
      });
      if (error) throw error;
      return auditSummarySchema.parse(data);
    },
  });
}

// ---- Acquisition -----------------------------------------------------------
export function useTrafficSummary() {
  return useQuery({
    queryKey: ["analytics", "traffic-summary"],
    queryFn: async () => {
      const { data, error } = await createClient().rpc("analytics_traffic_summary", {});
      if (error) throw error;
      return trafficSummarySchema.parse(data);
    },
  });
}

export function useTrafficTimeseries(period: GrowthPeriod = "day") {
  return useQuery({
    queryKey: ["analytics", "traffic-timeseries", period],
    queryFn: async () => {
      const { data, error } = await createClient().rpc("analytics_traffic_timeseries", {
        p_period: period,
      });
      if (error) throw error;
      return trafficTimeseriesSchema.parse(data);
    },
  });
}

export function useAcquisitionFunnel() {
  return useQuery({
    queryKey: ["analytics", "acquisition-funnel"],
    queryFn: async () => {
      const { data, error } = await createClient().rpc("analytics_acquisition_funnel", {});
      if (error) throw error;
      return acquisitionFunnelSchema.parse(data);
    },
  });
}

// ---- Engagement ------------------------------------------------------------
export function useEngagementSummary() {
  return useQuery({
    queryKey: ["analytics", "engagement-summary"],
    queryFn: async () => {
      const { data, error } = await createClient().rpc("analytics_engagement_summary");
      if (error) throw error;
      return engagementSummarySchema.parse(data);
    },
  });
}

export function useActiveUsersTimeseries(period: GrowthPeriod = "day") {
  return useQuery({
    queryKey: ["analytics", "active-users", period],
    queryFn: async () => {
      const { data, error } = await createClient().rpc("analytics_active_users_timeseries", {
        p_period: period,
      });
      if (error) throw error;
      return activeUsersTimeseriesSchema.parse(data);
    },
  });
}

export function useFeatureAdoption() {
  return useQuery({
    queryKey: ["analytics", "feature-adoption"],
    queryFn: async () => {
      const { data, error } = await createClient().rpc("analytics_feature_adoption");
      if (error) throw error;
      return featureAdoptionSchema.parse(data);
    },
  });
}

export function useRetentionCohorts() {
  return useQuery({
    queryKey: ["analytics", "retention-cohorts"],
    queryFn: async () => {
      const { data, error } = await createClient().rpc("analytics_retention_cohorts");
      if (error) throw error;
      return retentionCohortsSchema.parse(data);
    },
  });
}

// ---- Clinical outcomes & quality ------------------------------------------
export function useClinicalOutcomes() {
  return useQuery({
    queryKey: ["analytics", "clinical-outcomes"],
    queryFn: async () => {
      const { data, error } = await createClient().rpc("analytics_clinical_outcomes");
      if (error) throw error;
      return clinicalOutcomesSchema.parse(data);
    },
  });
}

export function useEscalationQuality() {
  return useQuery({
    queryKey: ["analytics", "escalation-quality"],
    queryFn: async () => {
      const { data, error } = await createClient().rpc("analytics_escalation_quality", {});
      if (error) throw error;
      return escalationQualitySchema.parse(data);
    },
  });
}

// ---- Operations & deliverability ------------------------------------------
export function useOperationsSummary() {
  return useQuery({
    queryKey: ["analytics", "operations-summary"],
    queryFn: async () => {
      const { data, error } = await createClient().rpc("analytics_operations_summary");
      if (error) throw error;
      return operationsSummarySchema.parse(data);
    },
  });
}

export function useDeliverability() {
  return useQuery({
    queryKey: ["analytics", "deliverability"],
    queryFn: async () => {
      const { data, error } = await createClient().rpc("analytics_deliverability", {});
      if (error) throw error;
      return deliverabilitySchema.parse(data);
    },
  });
}

// ---- User segments & facilities -------------------------------------------
export function useUserSegments() {
  return useQuery({
    queryKey: ["analytics", "user-segments"],
    queryFn: async () => {
      const { data, error } = await createClient().rpc("analytics_user_segments");
      if (error) throw error;
      return userSegmentsSchema.parse(data);
    },
  });
}

export function useFacilityEngagement() {
  return useQuery({
    queryKey: ["analytics", "facility-engagement"],
    queryFn: async () => {
      const { data, error } = await createClient().rpc("analytics_facility_engagement");
      if (error) throw error;
      return facilityEngagementSchema.parse(data);
    },
  });
}

// ---- Patient activity (forensic / identified) -----------------------------
export function usePatientSearch(query: string) {
  return useQuery({
    queryKey: ["analytics", "patient-search", query],
    queryFn: async () => {
      const { data, error } = await createClient().rpc("analytics_patient_search", {
        p_query: query,
      });
      if (error) throw error;
      return patientSearchSchema.parse(data);
    },
    enabled: query.trim().length >= 2,
  });
}

export function usePatientActivity(patientId: string | null) {
  return useQuery({
    queryKey: ["analytics", "patient-activity", patientId],
    queryFn: async () => {
      const { data, error } = await createClient().rpc("analytics_patient_activity", {
        p_patient_id: patientId as string,
      });
      if (error) throw error;
      return patientActivitySchema.parse(data);
    },
    enabled: !!patientId,
  });
}

/** Audits the analyst's access to a patient dossier (forensic hygiene). */
export function useLogPatientAccess() {
  return useMutation({
    mutationFn: async ({ patientId, reason }: { patientId: string; reason: string }) => {
      const { error } = await createClient().rpc("analytics_log_patient_access", {
        p_patient_id: patientId,
        p_reason: reason || null,
      });
      if (error) throw error;
    },
  });
}

// ---- Doctor performance (de-identified) -----------------------------------
export function useDoctorPerformance() {
  return useQuery({
    queryKey: ["analytics", "doctor-performance"],
    queryFn: async () => {
      const { data, error } = await createClient().rpc("analytics_doctor_performance", {});
      if (error) throw error;
      return doctorPerformanceSchema.parse(data);
    },
  });
}

// ---- Staff (Tarragon team) activity ---------------------------------------
export function useStaffActivity() {
  return useQuery({
    queryKey: ["analytics", "staff-activity"],
    queryFn: async () => {
      const { data, error } = await createClient().rpc("analytics_staff_activity", {});
      if (error) throw error;
      return staffActivitySchema.parse(data);
    },
  });
}

// ---- Governance ------------------------------------------------------------
export function useGovernanceSummary() {
  return useQuery({
    queryKey: ["analytics", "governance-summary"],
    queryFn: async () => {
      const { data, error } = await createClient().rpc("analytics_governance_summary");
      if (error) throw error;
      return governanceSummarySchema.parse(data);
    },
  });
}

export function useRiskRegister() {
  return useQuery({
    queryKey: ["analytics", "risk-register"],
    queryFn: async () => {
      const { data, error } = await createClient().rpc("analytics_risk_register");
      if (error) throw error;
      return riskRegisterSchema.parse(data);
    },
  });
}

export interface RiskInput {
  id?: string | null;
  title: string;
  category: string;
  likelihood: string;
  impact: string;
  status: string;
  owner?: string | null;
  mitigation?: string | null;
}

export function useUpsertRisk() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (r: RiskInput) => {
      const { error } = await createClient().rpc("analytics_upsert_risk", {
        p_id: r.id ?? null,
        p_title: r.title,
        p_category: r.category,
        p_likelihood: r.likelihood,
        p_impact: r.impact,
        p_status: r.status,
        p_owner: r.owner ?? null,
        p_mitigation: r.mitigation ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["analytics", "risk-register"] });
      void qc.invalidateQueries({ queryKey: ["analytics", "governance-summary"] });
    },
  });
}

// ---- Investor / board ------------------------------------------------------
export function useInvestorSummary() {
  return useQuery({
    queryKey: ["analytics", "investor-summary"],
    queryFn: async () => {
      const { data, error } = await createClient().rpc("analytics_investor_summary");
      if (error) throw error;
      return investorSummarySchema.parse(data);
    },
  });
}

export function useFinanceInputs() {
  return useQuery({
    queryKey: ["analytics", "finance-inputs"],
    queryFn: async () => {
      const { data, error } = await createClient().rpc("analytics_finance_inputs");
      if (error) throw error;
      return financeInputsSchema.parse(data);
    },
  });
}

export interface FinanceInput {
  month: string; // YYYY-MM-DD (any day in the month)
  currency: string;
  marketing_spend_minor: number;
  operating_expense_minor: number;
  cash_balance_minor: number;
  gross_margin_pct: number;
  new_customers?: number | null;
  notes?: string | null;
}

export function useUpsertFinanceInput() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (f: FinanceInput) => {
      const { error } = await createClient().rpc("analytics_upsert_finance_input", {
        p_month: f.month,
        p_currency: f.currency,
        p_marketing: f.marketing_spend_minor,
        p_opex: f.operating_expense_minor,
        p_cash: f.cash_balance_minor,
        p_margin: f.gross_margin_pct,
        p_new_customers: f.new_customers ?? null,
        p_notes: f.notes ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["analytics", "finance-inputs"] });
      void qc.invalidateQueries({ queryKey: ["analytics", "investor-summary"] });
    },
  });
}

// ---- Accounting ------------------------------------------------------------
export function useAccountingSummary() {
  return useQuery({
    queryKey: ["analytics", "accounting-summary"],
    queryFn: async () => {
      const { data, error } = await createClient().rpc("analytics_accounting_summary");
      if (error) throw error;
      return accountingSummarySchema.parse(data);
    },
  });
}
