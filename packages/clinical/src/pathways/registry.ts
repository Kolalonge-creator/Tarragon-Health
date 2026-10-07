/**
 * The pathway registry (S62): which pathways exist, what each one runs on, and which go-live guard gates it. It maps ONTO the live objects
 * instead of beside them: enrolment is `chronic_programme_enrolments` (OQ-124), the programme row is `chronic_condition_programmes`, the
 * step table is a `protocols` row and the rule set is a `triage_rule_sets` row. There is deliberately no second enrolment table.
 *
 * Every pathway's guard is seeded OFF in `go_live_guards` (key `pathway_<code>`) and is checked by the enrolment trigger, so a pathway
 * cannot take a real patient until a signed protocol, a signed rule set, safety cases and trained clinicians exist (INV-14).
 * The migration seeds `pathway_definitions` from this list and a mirror test keeps the two identical.
 */
export type PathwayKind = "programme" | "composite" | "prevention" | "scaffold";

export interface PathwayDefinition {
  readonly code: string;
  readonly label: string;
  readonly kind: PathwayKind;
  /** `chronic_condition_programmes.code` values this pathway enrols through. Empty: no enrolment path yet. */
  readonly programmeCodes: readonly string[];
  readonly guardKey: string;
  /** `triage_rule_sets.code`, or null when the pathway has no triage thresholds (sickle cell, post-stroke, reporting-only pathways). */
  readonly ruleSetCode: string | null;
  /** `protocols.code` of the step table, or null (diabetes has none in v1: decision Q8). */
  readonly stepTableCode: string | null;
  /** For a composite: the pathway codes whose rule sets run, most urgent wins (Q9). */
  readonly composedOf: readonly string[];
  /** Reporting only: the pathway never grades urgency (prediabetes, weight). */
  readonly reportingOnly: boolean;
}

const def = (d: Omit<PathwayDefinition, "guardKey" | "composedOf" | "reportingOnly"> & Partial<Pick<PathwayDefinition, "composedOf" | "reportingOnly">>): PathwayDefinition => ({
  composedOf: [],
  reportingOnly: false,
  ...d,
  guardKey: `pathway_${d.code}`,
});

export const PATHWAY_DEFINITIONS: readonly PathwayDefinition[] = [
  def({ code: "bp", label: "Blood pressure care", kind: "programme", programmeCodes: ["hypertension"], ruleSetCode: "bp_care_triage", stepTableCode: "htn_rtsl_ng" }),
  def({ code: "diabetes_care", label: "Diabetes care", kind: "programme", programmeCodes: ["diabetes"], ruleSetCode: "diabetes_care_triage", stepTableCode: null }),
  def({ code: "cardiometabolic_care", label: "Cardiometabolic care", kind: "composite", programmeCodes: [], ruleSetCode: null, stepTableCode: null, composedOf: ["bp", "diabetes_care"] }),
  def({ code: "prediabetes_prevention", label: "Prediabetes prevention", kind: "prevention", programmeCodes: [], ruleSetCode: null, stepTableCode: null, reportingOnly: true }),
  def({ code: "weight_care", label: "Weight management", kind: "programme", programmeCodes: ["obesity"], ruleSetCode: null, stepTableCode: null, reportingOnly: true }),
  def({ code: "asthma_copd_care", label: "Asthma and COPD care", kind: "programme", programmeCodes: ["asthma", "copd"], ruleSetCode: "asthma_copd_care_triage", stepTableCode: null }),
  def({ code: "heart_failure_care", label: "Heart failure self-monitoring", kind: "programme", programmeCodes: ["heart_failure"], ruleSetCode: "heart_failure_triage", stepTableCode: null }),
  def({ code: "ckd_care", label: "Chronic kidney disease monitoring", kind: "programme", programmeCodes: ["ckd"], ruleSetCode: "ckd_monitoring_triage", stepTableCode: null }),
  def({ code: "sickle_cell_care", label: "Sickle cell self-management", kind: "scaffold", programmeCodes: [], ruleSetCode: null, stepTableCode: null }),
  def({ code: "post_stroke_care", label: "Post-stroke secondary prevention", kind: "scaffold", programmeCodes: [], ruleSetCode: null, stepTableCode: null }),
];

export const pathwayByCode = (code: string): PathwayDefinition | undefined => PATHWAY_DEFINITIONS.find((p) => p.code === code);
