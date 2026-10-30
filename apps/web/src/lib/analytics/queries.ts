import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { parseAnalyticsAnswer } from "./answer";
import {
  accountingSummarySchema,
  acquisitionFunnelSchema,
  activeUsersTimeseriesSchema,
  alertBurdenSchema,
  alertQualitySchema,
  appointmentCapacitySchema,
  auditLogSchema,
  auditSummarySchema,
  businessSummarySchema,
  careEngagementSummarySchema,
  clinicalOutcomesSchema,
  complaintsSummarySchema,
  deliverabilitySchema,
  diagnosticGovernanceAnalyticsSchema,
  diagnosticPathwayAnalyticsSchema,
  diagnosticSafetyDashboardSchema,
  diseaseSurveillanceSchema,
  doctorIncomeSchema,
  doctorPaidJobsSchema,
  doctorPerformanceSchema,
  engagementOutcomeCorrelationSchema,
  engagementSummarySchema,
  escalationQualitySchema,
  executiveSummarySchema,
  facilityEngagementSchema,
  featureAdoptionSchema,
  financeInputsSchema,
  financialSummarySchema,
  geoHealthAggregatesSchema,
  governanceSummarySchema,
  growthTimeseriesSchema,
  investorSummarySchema,
  operationsSummarySchema,
  patientActivitySchema,
  patientSearchSchema,
  populationSummarySchema,
  programmeFunnelSchema,
  providerCapacitySchema,
  referralTurnaroundSchema,
  reputationReviewConversionSchema,
  retentionCohortsSchema,
  riskRegisterSchema,
  safetyDashboardSummarySchema,
  screeningReferralFunnelSchema,
  serviceCoverageSchema,
  staffActivitySchema,
  supportResponseTimeSchema,
  supportTicketSummarySchema,
  userSegmentsSchema,
  revenueByProductSchema,
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
 *
 * Parse through `parseAnalyticsAnswer(schema, data)` (./answer), never a bare
 * `schema.parse(data)`. A caller who is not an analyst is answered with an
 * empty `{}` rather than an error, and every schema here turns `{}` into a
 * full set of zeros, so a bare parse shows a refusal as a quiet month. A scan
 * test (queries-guard.test.ts) fails if a hook skips the guard.
 */

export type GrowthPeriod = "day" | "week" | "month";

export function useBusinessSummary() {
  return useQuery({
    queryKey: ["analytics", "business-summary"],
    queryFn: async () => {
      const { data, error } = await createClient().rpc("analytics_business_summary");
      if (error) throw error;
      return parseAnalyticsAnswer(businessSummarySchema, data);
    },
  });
}

/** Forces the nightly-refreshed analytics_business_summary snapshot
 * (docs/DATA_ARCHITECTURE_GAPS_BUILD_PLAN.md §3) to recompute on demand,
 * same shape as useRecomputeImpactMetrics. */
export function useRecomputeBusinessSummary() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { error } = await createClient().rpc("admin_refresh_analytics_business_summary");
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["analytics", "business-summary"] });
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
      return parseAnalyticsAnswer(growthTimeseriesSchema, data);
    },
  });
}

export function useFinancialSummary() {
  return useQuery({
    queryKey: ["analytics", "financial-summary"],
    queryFn: async () => {
      const { data, error } = await createClient().rpc("analytics_financial_summary");
      if (error) throw error;
      return parseAnalyticsAnswer(financialSummarySchema, data);
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
      return parseAnalyticsAnswer(revenueTimeseriesSchema, data);
    },
  });
}

export function useRevenueByProduct() {
  return useQuery({
    queryKey: ["analytics", "revenue-by-product"],
    queryFn: async () => {
      const { data, error } = await createClient().rpc("analytics_revenue_by_product");
      if (error) throw error;
      return parseAnalyticsAnswer(revenueByProductSchema, data);
    },
  });
}

export function usePopulationSummary() {
  return useQuery({
    queryKey: ["analytics", "population-summary"],
    queryFn: async () => {
      const { data, error } = await createClient().rpc("analytics_population_summary");
      if (error) throw error;
      return parseAnalyticsAnswer(populationSummarySchema, data);
    },
  });
}

/** State-level risk/screening-gap concentration (spec §2.17) — see get_geo_health_aggregates(). */
export function useGeoHealthAggregates() {
  return useQuery({
    queryKey: ["analytics", "geo-health-aggregates"],
    queryFn: async () => {
      const { data, error } = await createClient().rpc("get_geo_health_aggregates");
      if (error) throw error;
      return parseAnalyticsAnswer(geoHealthAggregatesSchema, data);
    },
  });
}

/** Trend-over-time surveillance (spec §12.4) — new enrollments, risk scoring, screening results. */
export function useDiseaseSurveillance(period: GrowthPeriod = "month") {
  return useQuery({
    queryKey: ["analytics", "disease-surveillance", period],
    queryFn: async () => {
      const { data, error } = await createClient().rpc("analytics_disease_surveillance", {
        p_period: period,
      });
      if (error) throw error;
      return parseAnalyticsAnswer(diseaseSurveillanceSchema, data);
    },
  });
}

/** Per-condition Enrolled -> Monitoring -> Controlled/Uncontrolled -> Lost-to-follow-up (spec §12.8/§12.10). */
export function useProgrammeFunnel() {
  return useQuery({
    queryKey: ["analytics", "programme-funnel"],
    queryFn: async () => {
      const { data, error } = await createClient().rpc("analytics_programme_funnel");
      if (error) throw error;
      return parseAnalyticsAnswer(programmeFunnelSchema, data);
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
      return parseAnalyticsAnswer(auditLogSchema, data);
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
      return parseAnalyticsAnswer(auditSummarySchema, data);
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
      return parseAnalyticsAnswer(trafficSummarySchema, data);
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
      return parseAnalyticsAnswer(trafficTimeseriesSchema, data);
    },
  });
}

export function useAcquisitionFunnel() {
  return useQuery({
    queryKey: ["analytics", "acquisition-funnel"],
    queryFn: async () => {
      const { data, error } = await createClient().rpc("analytics_acquisition_funnel", {});
      if (error) throw error;
      return parseAnalyticsAnswer(acquisitionFunnelSchema, data);
    },
  });
}

// ---- Reputation review prompts ---------------------------------------------
export function useReputationReviewConversion() {
  return useQuery({
    queryKey: ["analytics", "reputation-review-conversion"],
    queryFn: async () => {
      const { data, error } = await createClient().rpc("analytics_reputation_review_conversion");
      if (error) throw error;
      return parseAnalyticsAnswer(reputationReviewConversionSchema, data);
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
      return parseAnalyticsAnswer(engagementSummarySchema, data);
    },
  });
}

export function useCareEngagementSummary() {
  return useQuery({
    queryKey: ["analytics", "care-engagement-summary"],
    queryFn: async () => {
      const { data, error } = await createClient().rpc("analytics_care_engagement_summary");
      if (error) throw error;
      return parseAnalyticsAnswer(careEngagementSummarySchema, data);
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
      return parseAnalyticsAnswer(activeUsersTimeseriesSchema, data);
    },
  });
}

export function useFeatureAdoption() {
  return useQuery({
    queryKey: ["analytics", "feature-adoption"],
    queryFn: async () => {
      const { data, error } = await createClient().rpc("analytics_feature_adoption");
      if (error) throw error;
      return parseAnalyticsAnswer(featureAdoptionSchema, data);
    },
  });
}

export function useRetentionCohorts() {
  return useQuery({
    queryKey: ["analytics", "retention-cohorts"],
    queryFn: async () => {
      const { data, error } = await createClient().rpc("analytics_retention_cohorts");
      if (error) throw error;
      return parseAnalyticsAnswer(retentionCohortsSchema, data);
    },
  });
}

export function useEngagementOutcomeCorrelation() {
  return useQuery({
    queryKey: ["analytics", "engagement-outcome-correlation"],
    queryFn: async () => {
      const { data, error } = await createClient().rpc("analytics_engagement_outcome_correlation");
      if (error) throw error;
      return parseAnalyticsAnswer(engagementOutcomeCorrelationSchema, data);
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
      return parseAnalyticsAnswer(clinicalOutcomesSchema, data);
    },
  });
}

export function useEscalationQuality() {
  return useQuery({
    queryKey: ["analytics", "escalation-quality"],
    queryFn: async () => {
      const { data, error } = await createClient().rpc("analytics_escalation_quality", {});
      if (error) throw error;
      return parseAnalyticsAnswer(escalationQualitySchema, data);
    },
  });
}

// ---- Diagnostic Safety Pathway (spec modules 56-60) ------------------------
export function useDiagnosticSafetyDashboard() {
  return useQuery({
    queryKey: ["analytics", "diagnostic-safety-dashboard"],
    queryFn: async () => {
      const { data, error } = await createClient().rpc("diagnostic_safety_dashboard");
      if (error) throw error;
      return parseAnalyticsAnswer(diagnosticSafetyDashboardSchema, data);
    },
  });
}

export function useDiagnosticPathwayAnalytics(from?: string | null, to?: string | null) {
  return useQuery({
    queryKey: ["analytics", "diagnostic-pathway-analytics", from, to],
    queryFn: async () => {
      const { data, error } = await createClient().rpc("diagnostic_pathway_analytics", {
        p_from: from ?? undefined,
        p_to: to ?? undefined,
      });
      if (error) throw error;
      return parseAnalyticsAnswer(diagnosticPathwayAnalyticsSchema, data);
    },
  });
}

export function useDiagnosticGovernanceAnalytics(from?: string | null, to?: string | null) {
  return useQuery({
    queryKey: ["analytics", "diagnostic-governance-analytics", from, to],
    queryFn: async () => {
      const { data, error } = await createClient().rpc("diagnostic_governance_analytics", {
        p_from: from ?? undefined,
        p_to: to ?? undefined,
      });
      if (error) throw error;
      return parseAnalyticsAnswer(diagnosticGovernanceAnalyticsSchema, data);
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
      return parseAnalyticsAnswer(operationsSummarySchema, data);
    },
  });
}

export function useDeliverability() {
  return useQuery({
    queryKey: ["analytics", "deliverability"],
    queryFn: async () => {
      const { data, error } = await createClient().rpc("analytics_deliverability", {});
      if (error) throw error;
      return parseAnalyticsAnswer(deliverabilitySchema, data);
    },
  });
}

// ---- Patient Support & Service Centre (spec §24, technical support only) --
export function useSupportTicketSummary() {
  return useQuery({
    queryKey: ["analytics", "support-ticket-summary"],
    queryFn: async () => {
      const { data, error } = await createClient().rpc("analytics_support_ticket_summary", {});
      if (error) throw error;
      return parseAnalyticsAnswer(supportTicketSummarySchema, data);
    },
  });
}

export function useComplaintsSummary() {
  return useQuery({
    queryKey: ["analytics", "complaints-summary"],
    queryFn: async () => {
      const { data, error } = await createClient().rpc("analytics_complaints_summary", {});
      if (error) throw error;
      return parseAnalyticsAnswer(complaintsSummarySchema, data);
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
      return parseAnalyticsAnswer(userSegmentsSchema, data);
    },
  });
}

export function useFacilityEngagement() {
  return useQuery({
    queryKey: ["analytics", "facility-engagement"],
    queryFn: async () => {
      const { data, error } = await createClient().rpc("analytics_facility_engagement");
      if (error) throw error;
      return parseAnalyticsAnswer(facilityEngagementSchema, data);
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
      return parseAnalyticsAnswer(patientSearchSchema, data);
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
      return parseAnalyticsAnswer(patientActivitySchema, data);
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
        p_reason: (reason || null) as unknown as string,
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
      return parseAnalyticsAnswer(doctorPerformanceSchema, data);
    },
  });
}

// ---- Doctor income — paid jobs per doctor, for commission calculation -----
export function useDoctorIncome(range?: { from?: string; to?: string }) {
  return useQuery({
    queryKey: ["analytics", "doctor-income", range?.from ?? null, range?.to ?? null],
    queryFn: async () => {
      const { data, error } = await createClient().rpc("analytics_doctor_income", {
        p_from: range?.from,
        p_to: range?.to,
      });
      if (error) throw error;
      return parseAnalyticsAnswer(doctorIncomeSchema, data);
    },
  });
}

export function useDoctorPaidJobs(params?: {
  doctorProfileId?: string;
  from?: string;
  to?: string;
  limit?: number;
}) {
  return useQuery({
    queryKey: [
      "analytics",
      "doctor-paid-jobs",
      params?.doctorProfileId ?? null,
      params?.from ?? null,
      params?.to ?? null,
      params?.limit ?? null,
    ],
    queryFn: async () => {
      const { data, error } = await createClient().rpc("analytics_doctor_paid_jobs", {
        p_doctor_profile_id: params?.doctorProfileId,
        p_from: params?.from,
        p_to: params?.to,
        p_limit: params?.limit,
      });
      if (error) throw error;
      return parseAnalyticsAnswer(doctorPaidJobsSchema, data);
    },
    // Only fetch line items once a doctor is actually selected — the whole-
    // period list can be large and the UI only shows it inside a drill-down.
    enabled: Boolean(params?.doctorProfileId),
  });
}

// ---- Provider capacity (docs/CLINICAL_NETWORK_SPEC.md §4.17) --------------
export function useProviderCapacity() {
  return useQuery({
    queryKey: ["analytics", "provider-capacity"],
    queryFn: async () => {
      const { data, error } = await createClient().rpc("analytics_provider_capacity");
      if (error) throw error;
      return parseAnalyticsAnswer(providerCapacitySchema, data);
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
      return parseAnalyticsAnswer(staffActivitySchema, data);
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
      return parseAnalyticsAnswer(governanceSummarySchema, data);
    },
  });
}

// ---- Patient safety (docs spec §89.14) -------------------------------------
export function useSafetyDashboardSummary() {
  return useQuery({
    queryKey: ["analytics", "safety-dashboard-summary"],
    queryFn: async () => {
      const { data, error } = await createClient().rpc("analytics_safety_dashboard_summary");
      if (error) throw error;
      return parseAnalyticsAnswer(safetyDashboardSummarySchema, data);
    },
  });
}

export function useAlertBurden() {
  return useQuery({
    queryKey: ["analytics", "alert-burden"],
    queryFn: async () => {
      const { data, error } = await createClient().rpc("analytics_alert_burden");
      if (error) throw error;
      return parseAnalyticsAnswer(alertBurdenSchema, data);
    },
  });
}

export function useRiskRegister() {
  return useQuery({
    queryKey: ["analytics", "risk-register"],
    queryFn: async () => {
      const { data, error } = await createClient().rpc("analytics_risk_register");
      if (error) throw error;
      return parseAnalyticsAnswer(riskRegisterSchema, data);
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
        p_id: (r.id ?? null) as unknown as string,
        p_title: r.title,
        p_category: r.category,
        p_likelihood: r.likelihood,
        p_impact: r.impact,
        p_status: r.status,
        p_owner: (r.owner ?? null) as unknown as string,
        p_mitigation: (r.mitigation ?? null) as unknown as string,
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
      return parseAnalyticsAnswer(investorSummarySchema, data);
    },
  });
}

export function useFinanceInputs() {
  return useQuery({
    queryKey: ["analytics", "finance-inputs"],
    queryFn: async () => {
      const { data, error } = await createClient().rpc("analytics_finance_inputs");
      if (error) throw error;
      return parseAnalyticsAnswer(financeInputsSchema, data);
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
        p_new_customers: (f.new_customers ?? null) as unknown as number,
        p_notes: (f.notes ?? null) as unknown as string,
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
      return parseAnalyticsAnswer(accountingSummarySchema, data);
    },
  });
}

// ---- Executive dashboard (Operations & Command Centre §96.3) --------------
export function useExecutiveSummary() {
  return useQuery({
    queryKey: ["analytics", "executive-summary"],
    queryFn: async () => {
      const { data, error } = await createClient().rpc("analytics_executive_summary");
      if (error) throw error;
      return parseAnalyticsAnswer(executiveSummarySchema, data);
    },
  });
}

// ---- Screening -> referral -> treatment funnel (§96.4) ---------------------
export function useScreeningReferralFunnel(from?: string | null, to?: string | null) {
  return useQuery({
    queryKey: ["analytics", "screening-referral-funnel", from, to],
    queryFn: async () => {
      const { data, error } = await createClient().rpc("analytics_screening_referral_funnel", {
        p_from: from ?? undefined,
        p_to: to ?? undefined,
      });
      if (error) throw error;
      return parseAnalyticsAnswer(screeningReferralFunnelSchema, data);
    },
  });
}

// ---- Service levels (§96.8) -------------------------------------------------
export function useAppointmentCapacity() {
  return useQuery({
    queryKey: ["analytics", "appointment-capacity"],
    queryFn: async () => {
      const { data, error } = await createClient().rpc("analytics_appointment_capacity");
      if (error) throw error;
      return parseAnalyticsAnswer(appointmentCapacitySchema, data);
    },
  });
}

export function useAlertQuality(from?: string | null, to?: string | null) {
  return useQuery({
    queryKey: ["analytics", "alert-quality", from, to],
    queryFn: async () => {
      const { data, error } = await createClient().rpc("analytics_alert_quality", {
        p_from: from ?? undefined,
        p_to: to ?? undefined,
      });
      if (error) throw error;
      return parseAnalyticsAnswer(alertQualitySchema, data);
    },
  });
}

export function useReferralTurnaround() {
  return useQuery({
    queryKey: ["analytics", "referral-turnaround"],
    queryFn: async () => {
      const { data, error } = await createClient().rpc("analytics_referral_turnaround");
      if (error) throw error;
      return parseAnalyticsAnswer(referralTurnaroundSchema, data);
    },
  });
}

export function useSupportResponseTime() {
  return useQuery({
    queryKey: ["analytics", "support-response-time"],
    queryFn: async () => {
      const { data, error } = await createClient().rpc("analytics_support_response_time");
      if (error) throw error;
      return parseAnalyticsAnswer(supportResponseTimeSchema, data);
    },
  });
}

// ---- Geographic capacity (§96.9) -------------------------------------------
/** Reads the same anon-callable public.public_service_coverage() the marketing
 * /coverage page uses (apps/web/src/lib/marketing/coverage-data.ts), but through
 * the platform's authenticated client like every other analytics hook here —
 * the marketing tree's bare-anon-client rule exists to keep that tree free of
 * platform/auth imports, which doesn't apply inside the analytics console. */
export function useServiceCoverage() {
  return useQuery({
    queryKey: ["analytics", "service-coverage"],
    queryFn: async () => {
      const { data, error } = await createClient().rpc("public_service_coverage");
      if (error) throw error;
      return parseAnalyticsAnswer(serviceCoverageSchema, data);
    },
  });
}
