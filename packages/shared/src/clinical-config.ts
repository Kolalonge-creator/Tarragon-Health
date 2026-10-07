import { z } from "zod";

/**
 * Content shapes for the six S88 governed clinical configs (`clinical_config_versions`).
 * The database holds the values (docs/plans/S88-S100-decisions-and-cmo-signoff-pack.md section 4);
 * these schemas only validate the shape so the sign-off panel never renders a malformed row as if
 * it were complete. No clinical number is defined here: a value the CMO must still supply is `null`.
 */

export const CLINICAL_CONFIG_KINDS = [
  "ai_copilot_acceptable_use",
  "hypertension_care_gap_rules",
  "glp1_readiness_protocol",
  "field_nurse_visit_scope",
  "diabetes_targets_and_triggers",
  "aggregate_reporting_small_cell",
] as const;
export type ClinicalConfigKind = (typeof CLINICAL_CONFIG_KINDS)[number];

/** High-risk kinds need an approved independent clinical review of the exact version before signing. */
export const HIGH_RISK_CLINICAL_CONFIG_KINDS: readonly ClinicalConfigKind[] = [
  "ai_copilot_acceptable_use",
  "hypertension_care_gap_rules",
  "glp1_readiness_protocol",
  "diabetes_targets_and_triggers",
];

export const CLINICAL_CONFIG_LABEL: Record<ClinicalConfigKind, string> = {
  ai_copilot_acceptable_use: "AI copilot acceptable use",
  hypertension_care_gap_rules: "Hypertension care-gap rules",
  glp1_readiness_protocol: "GLP-1 readiness and monitoring protocol",
  field_nurse_visit_scope: "Field-nurse visit scope",
  diabetes_targets_and_triggers: "Diabetes targets and review triggers",
  aggregate_reporting_small_cell: "Aggregate reporting and small-cell rule",
};

export function isHighRiskClinicalConfigKind(kind: ClinicalConfigKind): boolean {
  return HIGH_RISK_CLINICAL_CONFIG_KINDS.includes(kind);
}

const text = z.string().min(1);
const list = z.array(text).min(1);
const bp = z.object({ systolic: z.number().positive(), diastolic: z.number().positive() });
const glucose = z.object({ mmol_l: z.number().positive(), mg_dl: z.number().positive() });

export const aiCopilotAcceptableUseSchema = z.object({
  may_draft: list,
  may_not: list,
  labelling: text,
  controls: z.object({
    deterministic_red_flag_rules_before_any_model_call: z.boolean(),
    red_flag_invariant: text,
    register_each_call_site_in_ai_systems: z.boolean(),
    route_through: text,
    runtime_governed_default: z.boolean(),
    runtime_governed_until: text,
    seed_evaluation_prompt_approval_or_knowledge_source_approval: z.boolean(),
  }),
  shadow_mode: z.object({
    min_weeks: z.number().int().positive(),
    min_reviewed_drafts: z.number().int().positive(),
    rule: text,
    cmo_reviews_before_go_live: list,
    unsafe_if_signed_is_logged_as: text,
    unsafe_draft_pauses_go_live: z.boolean(),
    quote_only_own_measured_minutes_saved: z.boolean(),
  }),
});

export const hypertensionCareGapRulesSchema = z.object({
  control_target: z.object({
    adult_on_treatment: z.object({ clinic_below: bp, home_average_below: bp }),
    stricter_individual_target_allowed: z.boolean(),
    stricter_example: bp.extend({ for: list }),
    stricter_target_must_record: list,
  }),
  outreach_trigger: z.object({
    creates: list,
    consecutive_readings_above_target: z.number().int().positive(),
    on_at_least_distinct_days: z.number().int().positive(),
    or_home_average_days: z.number().int().positive(),
    or_home_average_above_target: z.boolean(),
    severe_readings: text,
    rules_change_medicines: z.boolean(),
  }),
  cadence: z.object({
    uncontrolled_or_newly_started: z.object({ reading_every_days: z.number().int().positive(), review: text }),
    controlled: z.object({ reading_every_days: z.number().int().positive(), review: text }),
  }),
  annual_labs: list,
  overdue_after_days: z.object({
    reading: z.number().int().positive(),
    review: z.number().int().positive(),
    labs: z.number().int().positive(),
  }),
  risk_score: z.object({
    prevent_calculator: z.boolean(),
    total_risk: text,
    who_2019_cvd_chart_guard: text,
    /** Null until the CMO supplies and signs the coefficients. */
    who_2019_cvd_chart_coefficients: z.null(),
    who_2019_cvd_chart_coefficients_note: text,
  }),
  notifications: z.object({
    name_the_condition: z.boolean(),
    name_any_reading: z.boolean(),
    invariant: text,
  }),
});

export const glp1ReadinessProtocolSchema = z.object({
  entry: z.object({
    bmi_min: z.number().positive(),
    bmi_min_with_weight_related_complication: z.number().positive(),
    min_months_behavioural_programme: z.number().int().positive(),
    not_pregnant: z.boolean(),
    /** Null: left to the CMO in the pack. */
    ancestry_specific_lower_bmi_cutoffs: z.null(),
    ancestry_specific_lower_bmi_cutoffs_note: text,
  }),
  hard_stops: list,
  refer_to_doctor_first: list,
  monitoring: z.object({
    weight_and_bp: text,
    gi_tolerability: z.boolean(),
    hypoglycaemia_checks_with: list,
    review_at_months: z.number().int().positive(),
    /** Null: the pack names a stop-and-review rule but gives no text. */
    stop_and_review_rule: z.null(),
    stop_and_review_rule_note: text,
    contraception_counselling: z.boolean(),
  }),
  authority: z.object({
    initiation_dose_or_stop: text,
    tarragon_sources_prices_compounds_or_delivers_the_drug: z.boolean(),
    supply: text,
    suspected_falsified_product: text,
  }),
  guard: z.object({
    name: text,
    ships: text,
    until: text,
    signing_does_not_flip_guards: z.boolean(),
  }),
});

export const fieldNurseVisitScopeSchema = z.object({
  in_scope: list,
  excluded: list,
  amendment_rule: text,
  safeguards: z.object({
    red_readings: text,
    patient_consent_recorded_before_each_visit: z.boolean(),
    nurse_verified_identity_shown_to_patient: z.boolean(),
    clinical_advice_beyond_signed_checklist: z.boolean(),
  }),
  activation: text,
});

export const diabetesTargetsAndTriggersSchema = z.object({
  hba1c_target: z.object({
    default_below_percent: z.number().positive(),
    relaxed_range_percent: z.tuple([z.number().positive(), z.number().positive()]),
    relaxed_for: list,
    set_per_patient_by: text,
  }),
  triggers: z.object({
    creates: text,
    hba1c_above_individual_target_at_months: z.number().int().positive(),
    home_fasting_glucose_above: glucose.extend({
      readings: z.number().int().positive(),
      within_days: z.number().int().positive(),
    }),
    reading_below_same_day_review: glucose,
    reading_below_urgent_triage: glucose.extend({ via: text }),
  }),
  measurement: z.object({
    fingerstick_and_laboratory_hba1c_only: z.boolean(),
    cgm: text,
  }),
});

export const aggregateReportingSmallCellSchema = z.object({
  min_cell: z.number().int().positive(),
  applies_to: list,
  employer_min_enrolled: z.number().int().positive(),
  rules: z.object({
    no_aggregate_for_group_under_min_cell: z.boolean(),
    cells_cannot_be_derived_by_subtraction: z.boolean(),
    employers_never_see: list,
    individual_drill_down: text,
    every_partner_report_is_logged: z.boolean(),
  }),
});

export const CLINICAL_CONFIG_CONTENT_SCHEMAS = {
  ai_copilot_acceptable_use: aiCopilotAcceptableUseSchema,
  hypertension_care_gap_rules: hypertensionCareGapRulesSchema,
  glp1_readiness_protocol: glp1ReadinessProtocolSchema,
  field_nurse_visit_scope: fieldNurseVisitScopeSchema,
  diabetes_targets_and_triggers: diabetesTargetsAndTriggersSchema,
  aggregate_reporting_small_cell: aggregateReportingSmallCellSchema,
} as const satisfies Record<ClinicalConfigKind, z.ZodType>;

export const clinicalConfigSourceSchema = z.object({
  name: text,
  verification: z.enum(["register_title_only", "background_cmo_to_verify"]),
});
export const clinicalConfigSourcesSchema = z.array(clinicalConfigSourceSchema).min(1);

export const clinicalConfigKindSchema = z.enum(CLINICAL_CONFIG_KINDS);

/** The parts of one `clinical_config_versions` row the sign-off panel needs. */
export const clinicalConfigVersionRowSchema = z.object({
  id: z.string().uuid(),
  config_kind: clinicalConfigKindSchema,
  version: z.number().int().positive(),
  content: z.unknown(),
  sources: z.unknown(),
  verify_against_source: z.boolean(),
  founder_position: text,
  founder_position_date: text,
  notes: z.string().nullable(),
  status: z.enum(["draft", "active", "retired"]),
  approved_at: z.string().nullable(),
});
export type ClinicalConfigVersionRow = z.infer<typeof clinicalConfigVersionRowSchema>;

export const independentClinicalReviewRowSchema = z.object({
  id: z.string().uuid(),
  config_version_id: z.string().uuid(),
  reviewer_name: text,
  mdcn_number: text,
  reviewed_at: z.string(),
  outcome: z.enum(["approved", "changes_requested"]),
  note: z.string().nullable(),
});
export type IndependentClinicalReviewRow = z.infer<typeof independentClinicalReviewRowSchema>;

/** True when the content matches its kind's shape. A false result means "show the raw JSON and do not trust it". */
export function parseClinicalConfigContent(kind: ClinicalConfigKind, content: unknown): boolean {
  return CLINICAL_CONFIG_CONTENT_SCHEMAS[kind].safeParse(content).success;
}

export type ClinicalConfigSignState =
  | { canSign: true }
  | { canSign: false; reason: string };

/**
 * Whether the Sign control may be offered, and the reason when not. A mirror of the database
 * rules (the sign RPC is the real gate): drafts only, never an older version than a signed one,
 * and a high-risk kind needs an approved independent review for this exact version.
 */
export function clinicalConfigSignState(
  row: Pick<ClinicalConfigVersionRow, "id" | "config_kind" | "version" | "status">,
  reviews: readonly IndependentClinicalReviewRow[],
  highestSignedVersion: number | null,
): ClinicalConfigSignState {
  if (row.status !== "draft") return { canSign: false, reason: `Already ${row.status}.` };
  if (highestSignedVersion !== null && row.version < highestSignedVersion) {
    return { canSign: false, reason: "An older version than one already signed cannot be signed. Draft a new version." };
  }
  if (isHighRiskClinicalConfigKind(row.config_kind)) {
    const approved = reviews.some((r) => r.config_version_id === row.id && r.outcome === "approved");
    if (!approved) {
      return {
        canSign: false,
        reason: "Needs an approved independent clinical review of this exact version before it can be signed.",
      };
    }
  }
  return { canSign: true };
}
