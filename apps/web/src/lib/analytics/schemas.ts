import { z } from "zod";

/**
 * Zod schemas that validate the jsonb payloads returned by the analytics
 * SECURITY DEFINER RPCs (supabase/migrations/20260717180931_analytics_console_rpcs.sql).
 * The RPCs type their return as `Json`, so we parse at the boundary rather than
 * trusting the shape. Every field carries a default so that a gated/empty `{}`
 * response (returned to a non-analyst caller) still parses to a zeroed shape.
 */

// ---- Business -------------------------------------------------------------
export const businessSummarySchema = z.object({
  total_orgs: z.number().default(0),
  active_orgs: z.number().default(0),
  total_profiles: z.number().default(0),
  total_patients: z.number().default(0),
  active_patients: z.number().default(0),
  onboarded_patients: z.number().default(0),
  total_subscriptions: z.number().default(0),
  active_subscriptions: z.number().default(0),
  roles: z.array(z.object({ role: z.string(), count: z.number() })).default([]),
  org_types: z.array(z.object({ type: z.string(), count: z.number() })).default([]),
  states: z.array(z.object({ state: z.string(), count: z.number() })).default([]),
});
export type BusinessSummary = z.infer<typeof businessSummarySchema>;

export const growthTimeseriesSchema = z
  .array(
    z.object({
      bucket: z.string(),
      signups: z.number(),
      new_subscriptions: z.number(),
    })
  )
  .default([]);
export type GrowthTimeseries = z.infer<typeof growthTimeseriesSchema>;

// ---- Financial (amounts in minor units — kobo for NGN) --------------------
export const financialSummarySchema = z.object({
  mrr_by_currency: z
    .array(z.object({ currency: z.string().nullable(), mrr_minor: z.number() }))
    .default([]),
  revenue_by_currency: z
    .array(z.object({ currency: z.string().nullable(), total_minor: z.number() }))
    .default([]),
  active_subscriptions: z.number().default(0),
  cancelled_subscriptions: z.number().default(0),
  churn_rate: z.number().default(0),
  commissions: z
    .object({
      total_kobo: z.number().default(0),
      pending_kobo: z.number().default(0),
      by_status: z
        .array(z.object({ status: z.string(), total_kobo: z.number(), count: z.number() }))
        .default([]),
      by_type: z.array(z.object({ type: z.string(), total_kobo: z.number() })).default([]),
    })
    .default({ total_kobo: 0, pending_kobo: 0, by_status: [], by_type: [] }),
  receivables_kobo: z.number().default(0),
});
export type FinancialSummary = z.infer<typeof financialSummarySchema>;

export const revenueTimeseriesSchema = z
  .array(
    z.object({
      bucket: z.string(),
      currency: z.string().nullable(),
      total_minor: z.number(),
    })
  )
  .default([]);
export type RevenueTimeseries = z.infer<typeof revenueTimeseriesSchema>;

export const revenueByPlanSchema = z
  .array(
    z.object({
      plan_code: z.string(),
      plan_name: z.string(),
      currency: z.string().nullable(),
      subscribers: z.number(),
      mrr_minor: z.number(),
    })
  )
  .default([]);
export type RevenueByPlan = z.infer<typeof revenueByPlanSchema>;

// ---- Population health -----------------------------------------------------
export const populationSummarySchema = z.object({
  total_patients: z.number().default(0),
  condition_prevalence: z
    .array(z.object({ condition: z.string(), patients: z.number() }))
    .default([]),
  risk_distribution: z
    .array(z.object({ risk_level: z.string().nullable(), patients: z.number() }))
    .default([]),
  screening_counts: z
    .object({ total: z.number().default(0), abnormal: z.number().default(0) })
    .default({ total: 0, abnormal: 0 }),
  abnormal_screening_rate: z.number().default(0),
  care_gaps: z.array(z.object({ gap_type: z.string(), count: z.number() })).default([]),
  age_bands: z.array(z.object({ band: z.string(), count: z.number() })).default([]),
  sex_distribution: z.array(z.object({ sex: z.string(), count: z.number() })).default([]),
});
export type PopulationSummary = z.infer<typeof populationSummarySchema>;

// ---- Audit -----------------------------------------------------------------
export const auditLogSchema = z.object({
  total: z.number().default(0),
  rows: z
    .array(
      z.object({
        id: z.string(),
        created_at: z.string(),
        action: z.string(),
        entity_type: z.string().nullable(),
        entity_id: z.string().nullable(),
        actor_name: z.string().nullable(),
        organisation_name: z.string().nullable(),
        event: z.unknown(),
      })
    )
    .default([]),
});
export type AuditLog = z.infer<typeof auditLogSchema>;
export type AuditRow = AuditLog["rows"][number];

export const auditSummarySchema = z.object({
  total: z.number().default(0),
  by_action: z.array(z.object({ action: z.string(), count: z.number() })).default([]),
  by_entity: z.array(z.object({ entity_type: z.string(), count: z.number() })).default([]),
  by_day: z.array(z.object({ bucket: z.string(), count: z.number() })).default([]),
});
export type AuditSummary = z.infer<typeof auditSummarySchema>;

// ---- Acquisition (traffic) -------------------------------------------------
export const trafficSummarySchema = z.object({
  visitors: z.number().default(0),
  logged_in_visitors: z.number().default(0),
  pageviews: z.number().default(0),
  by_country: z.array(z.object({ country: z.string(), visitors: z.number() })).default([]),
  by_region: z.array(z.object({ region: z.string(), visitors: z.number() })).default([]),
  by_referrer: z.array(z.object({ referrer_host: z.string(), visitors: z.number() })).default([]),
  by_source: z.array(z.object({ source: z.string(), visitors: z.number() })).default([]),
  by_device: z.array(z.object({ device: z.string(), visitors: z.number() })).default([]),
});
export type TrafficSummary = z.infer<typeof trafficSummarySchema>;

export const trafficTimeseriesSchema = z
  .array(z.object({ bucket: z.string(), visitors: z.number(), pageviews: z.number() }))
  .default([]);
export type TrafficTimeseries = z.infer<typeof trafficTimeseriesSchema>;

export const acquisitionFunnelSchema = z
  .array(z.object({ step: z.string(), count: z.number() }))
  .default([]);
export type AcquisitionFunnel = z.infer<typeof acquisitionFunnelSchema>;

// ---- Engagement ------------------------------------------------------------
export const engagementSummarySchema = z.object({
  dau: z.number().default(0),
  wau: z.number().default(0),
  mau: z.number().default(0),
  stickiness: z.number().default(0),
});
export type EngagementSummary = z.infer<typeof engagementSummarySchema>;

export const activeUsersTimeseriesSchema = z
  .array(z.object({ bucket: z.string(), active_users: z.number() }))
  .default([]);
export type ActiveUsersTimeseries = z.infer<typeof activeUsersTimeseriesSchema>;

export const featureAdoptionSchema = z
  .array(z.object({ feature: z.string(), patients: z.number() }))
  .default([]);
export type FeatureAdoption = z.infer<typeof featureAdoptionSchema>;

export const retentionCohortsSchema = z
  .array(
    z.object({
      cohort_week: z.string(),
      cohort_size: z.number(),
      offsets: z
        .array(z.object({ week_offset: z.number(), retained: z.number() }))
        .default([]),
    })
  )
  .default([]);
export type RetentionCohorts = z.infer<typeof retentionCohortsSchema>;

// ---- Clinical outcomes & quality ------------------------------------------
const controlRate = z.object({
  total: z.number().default(0),
  controlled: z.number().default(0),
  pct: z.number().default(0),
});
export const clinicalOutcomesSchema = z.object({
  bp_control: controlRate.default({ total: 0, controlled: 0, pct: 0 }),
  glucose_control: controlRate.default({ total: 0, controlled: 0, pct: 0 }),
  risk_migration: z.array(z.object({ direction: z.string(), patients: z.number() })).default([]),
  screening_coverage: z.array(z.object({ status: z.string(), count: z.number() })).default([]),
  vaccination_coverage: z.array(z.object({ status: z.string(), count: z.number() })).default([]),
});
export type ClinicalOutcomes = z.infer<typeof clinicalOutcomesSchema>;

export const escalationQualitySchema = z.object({
  funnel: z
    .object({
      abnormal_results: z.number().default(0),
      alerts_raised: z.number().default(0),
      escalations: z.number().default(0),
      resolved: z.number().default(0),
    })
    .default({ abnormal_results: 0, alerts_raised: 0, escalations: 0, resolved: 0 }),
  sla: z
    .object({
      total: z.number().default(0),
      met: z.number().default(0),
      breached: z.number().default(0),
      pct_met: z.number().default(0),
    })
    .default({ total: 0, met: 0, breached: 0, pct_met: 0 }),
  avg_ack_minutes: z.number().default(0),
  avg_resolution_hours: z.number().default(0),
  open_alerts: z.number().default(0),
  overdue_alerts: z.number().default(0),
});
export type EscalationQuality = z.infer<typeof escalationQualitySchema>;

// ---- Operations & deliverability ------------------------------------------
const orderStat = z.object({
  total: z.number().default(0),
  completed: z.number().optional(),
  delivered: z.number().optional(),
  confirmed: z.number().optional(),
  avg_turnaround_hours: z.number().optional(),
});
export const operationsSummarySchema = z.object({
  target_ratio: z.number().default(120),
  clinician_load: z
    .array(
      z.object({
        clinician: z.string(),
        tier: z.string().nullable(),
        patients: z.number(),
      })
    )
    .default([]),
  over_target: z.number().default(0),
  escalation_queue: z.array(z.object({ level: z.string(), open: z.number() })).default([]),
  orders: z
    .object({ lab: orderStat, pharmacy: orderStat, referral: orderStat })
    .default({ lab: { total: 0 }, pharmacy: { total: 0 }, referral: { total: 0 } }),
});
export type OperationsSummary = z.infer<typeof operationsSummarySchema>;

// ---- User segments ---------------------------------------------------------
export const userSegmentsSchema = z.object({
  activity: z
    .object({
      total: z.number().default(0),
      active_30d: z.number().default(0),
      active_90d: z.number().default(0),
      dormant_30d: z.number().default(0),
      dormant_90d: z.number().default(0),
      never_active: z.number().default(0),
    })
    .default({
      total: 0,
      active_30d: 0,
      active_90d: 0,
      dormant_30d: 0,
      dormant_90d: 0,
      never_active: 0,
    }),
  churned: z.number().default(0),
  by_plan: z.array(z.object({ plan: z.string(), users: z.number() })).default([]),
  by_care_category: z
    .array(z.object({ category: z.string(), users: z.number() }))
    .default([]),
  by_role: z.array(z.object({ role: z.string(), users: z.number() })).default([]),
  by_condition: z.array(z.object({ condition: z.string(), users: z.number() })).default([]),
  by_state: z.array(z.object({ state: z.string(), users: z.number() })).default([]),
});
export type UserSegments = z.infer<typeof userSegmentsSchema>;

// ---- Facility engagement ---------------------------------------------------
export const facilityEngagementSchema = z.object({
  total_facilities: z.number().default(0),
  active_facilities: z.number().default(0),
  total_bookings: z.number().default(0),
  facilities_with_usage: z.number().default(0),
  by_facility: z
    .array(
      z.object({
        facility: z.string(),
        type: z.string().nullable(),
        state: z.string(),
        users: z.number(),
        interactions: z.number(),
      })
    )
    .default([]),
  by_type: z.array(z.object({ type: z.string(), facilities: z.number() })).default([]),
  by_state: z.array(z.object({ state: z.string(), facilities: z.number() })).default([]),
  by_service: z.array(z.object({ service_type: z.string(), bookings: z.number() })).default([]),
});
export type FacilityEngagement = z.infer<typeof facilityEngagementSchema>;

// ---- Doctor performance (de-identified) -----------------------------------
export const doctorPerformanceSchema = z.object({
  by_doctor: z
    .array(
      z.object({
        doctor: z.string(),
        role: z.string(),
        tier: z.string().nullable(),
        patients_assigned: z.number(),
        escalations_reviewed: z.number(),
        alerts_acknowledged: z.number(),
        meds_confirmed: z.number(),
        reviews_completed: z.number(),
        avg_ack_minutes: z.number(),
        avg_resolution_hours: z.number(),
        sla_met_pct: z.number().nullable(),
        last_active_at: z.string().nullable(),
        patient_panel: z.array(z.string()).default([]),
      })
    )
    .default([]),
  recent_responses: z
    .array(
      z.object({
        doctor: z.string(),
        patient: z.string(),
        type: z.string(),
        raised_at: z.string(),
        responded_at: z.string(),
        response_min: z.number(),
      })
    )
    .default([]),
});
export type DoctorPerformance = z.infer<typeof doctorPerformanceSchema>;

// ---- Staff (Tarragon team) activity ---------------------------------------
export const staffActivitySchema = z.object({
  staff_total: z.number().default(0),
  active_today: z.number().default(0),
  active_7d: z.number().default(0),
  sessions_total: z.number().default(0),
  by_staff: z
    .array(
      z.object({
        staff: z.string(),
        role: z.string(),
        sessions: z.number(),
        active_minutes: z.number(),
        pageviews: z.number(),
        last_seen: z.string(),
      })
    )
    .default([]),
  recent_sessions: z
    .array(
      z.object({
        staff: z.string(),
        role: z.string(),
        started: z.string(),
        ended: z.string(),
        duration_min: z.number(),
        pageviews: z.number(),
      })
    )
    .default([]),
});
export type StaffActivity = z.infer<typeof staffActivitySchema>;

// ---- Patient activity (forensic / identified) -----------------------------
export const patientSearchSchema = z
  .array(
    z.object({
      patient_id: z.string(),
      patient_number: z.string().nullable(),
      name: z.string().nullable(),
      phone: z.string().nullable(),
      org: z.string().nullable(),
      created_at: z.string(),
    })
  )
  .default([]);
export type PatientSearchResult = z.infer<typeof patientSearchSchema>;

export const patientActivitySchema = z.object({
  patient: z
    .object({
      patient_number: z.string().nullable(),
      name: z.string().nullable(),
      phone: z.string().nullable(),
      created_at: z.string().nullable(),
      onboarding_completed_at: z.string().nullable(),
    })
    .nullable()
    .default(null),
  engagement: z
    .object({
      total_login_sessions: z.number().default(0),
      total_activity_events: z.number().default(0),
      first_activity: z.string().nullable().default(null),
      last_activity: z.string().nullable().default(null),
      active_days: z.number().default(0),
      days_since_last: z.number().nullable().default(null),
    })
    .partial()
    .default({}),
  login_sessions: z
    .array(
      z.object({
        started: z.string(),
        ended: z.string(),
        duration_min: z.number(),
        pageviews: z.number(),
      })
    )
    .default([]),
  activity: z
    .array(
      z.object({
        occurred_at: z.string(),
        type: z.string(),
        label: z.string(),
        source: z.string(),
      })
    )
    .default([]),
});
export type PatientActivity = z.infer<typeof patientActivitySchema>;

// ---- Governance & compliance ----------------------------------------------
export const governanceSummarySchema = z.object({
  clinical: z
    .object({
      staff_total: z.number().default(0),
      staff_verified: z.number().default(0),
      staff_unverified_active: z.number().default(0),
      verification_pct: z.number().default(0),
      tier_unassigned: z.number().default(0),
      indemnity_covered: z.number().default(0),
      indemnity_expiring_30d: z.number().default(0),
      indemnity_expired: z.number().default(0),
      indemnity_exempt: z.number().default(0),
      protocols_total: z.number().default(0),
      protocols_signed: z.number().default(0),
    })
    .partial()
    .default({}),
  privacy: z
    .object({
      patients_total: z.number().default(0),
      kyc_verified: z.number().default(0),
      kyc_pending: z.number().default(0),
      consent_coverage: z
        .array(
          z.object({
            consent_type: z.string(),
            accepted: z.number(),
            total: z.number(),
            pct: z.number(),
          })
        )
        .default([]),
    })
    .partial()
    .default({}),
  security: z
    .object({
      audit_events_30d: z.number().default(0),
      admin_accounts: z.number().default(0),
      analyst_accounts: z.number().default(0),
    })
    .partial()
    .default({}),
  risk: z
    .object({
      open: z.number().default(0),
      by_status: z.array(z.object({ status: z.string(), count: z.number() })).default([]),
      by_category: z.array(z.object({ category: z.string(), count: z.number() })).default([]),
    })
    .partial()
    .default({}),
});
export type GovernanceSummary = z.infer<typeof governanceSummarySchema>;

export const riskRegisterSchema = z
  .array(
    z.object({
      id: z.string(),
      title: z.string(),
      category: z.string(),
      likelihood: z.string(),
      impact: z.string(),
      status: z.string(),
      owner: z.string().nullable(),
      mitigation: z.string().nullable(),
      updated_at: z.string(),
    })
  )
  .default([]);
export type RiskRegister = z.infer<typeof riskRegisterSchema>;

// ---- Investor / board ------------------------------------------------------
export const investorSummarySchema = z.object({
  mrr_minor: z.number().default(0),
  arr_minor: z.number().default(0),
  active_subscriptions: z.number().default(0),
  mom_growth_pct: z.number().default(0),
  arpa_minor: z.number().default(0),
  logo_churn_pct: z.number().default(0),
  revenue_churn_pct: z.number().default(0),
  mrr_waterfall: z
    .array(
      z.object({
        month: z.string(),
        starting: z.number(),
        new_mrr: z.number(),
        churned_mrr: z.number(),
        ending: z.number(),
      })
    )
    .default([]),
  nrr_pct: z.number().nullable().default(null),
  grr_pct: z.number().nullable().default(null),
  concentration: z
    .array(z.object({ plan: z.string(), mrr_minor: z.number(), pct: z.number() }))
    .default([]),
  unit_economics: z
    .object({
      inputs_present: z.boolean().default(false),
      gross_margin_pct: z.number().default(0),
      ltv_minor: z.number().nullable().default(null),
      cac_minor: z.number().nullable().default(null),
      ltv_cac_ratio: z.number().nullable().default(null),
      cac_payback_months: z.number().nullable().default(null),
      rule_of_40: z.number().nullable().default(null),
      net_burn_minor: z.number().nullable().default(null),
      runway_months: z.number().nullable().default(null),
      new_customers: z.number().default(0),
    })
    .partial()
    .default({}),
});
export type InvestorSummary = z.infer<typeof investorSummarySchema>;

export const financeInputsSchema = z
  .array(
    z.object({
      period_month: z.string(),
      currency: z.string(),
      marketing_spend_minor: z.number(),
      operating_expense_minor: z.number(),
      cash_balance_minor: z.number(),
      gross_margin_pct: z.number(),
      new_customers: z.number().nullable(),
      notes: z.string().nullable(),
    })
  )
  .default([]);
export type FinanceInputs = z.infer<typeof financeInputsSchema>;

// ---- Accounting / revenue --------------------------------------------------
export const accountingSummarySchema = z.object({
  revenue_recognition: z
    .object({
      billed_minor: z.number().default(0),
      recognized_minor: z.number().default(0),
      deferred_minor: z.number().default(0),
      by_currency: z
        .array(
          z.object({
            currency: z.string().nullable(),
            billed: z.number(),
            recognized: z.number(),
            deferred: z.number(),
          })
        )
        .default([]),
    })
    .partial()
    .default({}),
  ar_aging: z
    .object({
      subscriptions_past_due: z.number().default(0),
      commission_receivable_kobo: z.number().default(0),
      aging: z.array(z.object({ bucket: z.string(), kobo: z.number() })).default([]),
    })
    .partial()
    .default({}),
  reconciliation: z
    .object({
      payments_collected: z
        .array(z.object({ currency: z.string().nullable(), total_minor: z.number() }))
        .default([]),
      refunds_minor: z.number().default(0),
    })
    .partial()
    .default({}),
});
export type AccountingSummary = z.infer<typeof accountingSummarySchema>;

export const deliverabilitySchema = z.object({
  by_channel: z
    .array(
      z.object({
        channel: z.string(),
        total: z.number(),
        sent: z.number(),
        failed: z.number(),
        pending: z.number(),
        success_pct: z.number(),
      })
    )
    .default([]),
  queue_depth: z.number().default(0),
  failures: z.array(z.object({ reason: z.string(), count: z.number() })).default([]),
  timeseries: z
    .array(z.object({ bucket: z.string(), sent: z.number(), failed: z.number() }))
    .default([]),
});
export type Deliverability = z.infer<typeof deliverabilitySchema>;
