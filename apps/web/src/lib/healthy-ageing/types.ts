import type { Database } from "@tarragon/shared";

export type AgeingAssessmentDomain = Database["public"]["Enums"]["ageing_assessment_domain"];
export type AgeingAssessmentOutcome = Database["public"]["Enums"]["ageing_assessment_outcome"];
export type AgeingAssessmentStatus = Database["public"]["Enums"]["ageing_assessment_status"];
export type FallsRiskPathwayStage = Database["public"]["Enums"]["falls_risk_pathway_stage"];
export type FallsRiskLevel = Database["public"]["Enums"]["falls_risk_level"];
export type SocialNavigationFollowUpStatus =
  Database["public"]["Enums"]["social_navigation_follow_up_status"];
export type HomeCareRequestStatus = Database["public"]["Enums"]["home_care_request_status"];

/**
 * The 9 domains this table owns (spec §50.3) — deliberately excludes
 * cardiovascular, diabetes, and medication, which already have a live source
 * of truth elsewhere (care_plans/patient_conditions, medications) and are
 * composed alongside these in the UI rather than re-collected here.
 */
export const AGEING_ASSESSMENT_DOMAINS: AgeingAssessmentDomain[] = [
  "mobility",
  "falls",
  "cognition",
  "nutrition",
  "vision",
  "hearing",
  "social_support",
  "functional_independence",
  "frailty",
];

export const DOMAIN_LABEL: Record<AgeingAssessmentDomain, string> = {
  mobility: "Mobility",
  falls: "Falls risk",
  cognition: "Cognition",
  nutrition: "Nutrition",
  vision: "Vision",
  hearing: "Hearing",
  social_support: "Social support",
  functional_independence: "Independence with daily activities",
  frailty: "Frailty",
};

/**
 * Safe, non-diagnostic copy for each outcome — never a label, never a
 * diagnosis (spec §50.6: never "you have dementia", always "your responses
 * suggest that further assessment may be appropriate"). Reuse this map
 * everywhere an outcome is rendered rather than writing outcome copy inline.
 */
export const OUTCOME_COPY: Record<AgeingAssessmentOutcome, string> = {
  no_concern: "No concerns from this check-in",
  monitor: "Worth keeping an eye on",
  further_assessment_suggested: "Your responses suggest that further assessment may be appropriate",
};

export const FALLS_RISK_LEVEL_LABEL: Record<FallsRiskLevel, string> = {
  low: "Low",
  moderate: "Moderate",
  high: "High",
};

export const FALLS_PATHWAY_STAGE_LABEL: Record<FallsRiskPathwayStage, string> = {
  risk_identified: "Risk identified",
  clinical_assessment: "Clinical assessment",
  intervention: "Intervention",
  follow_up: "Follow-up",
  resolved: "Resolved",
};

/** A patient is treated as being on 5 or more active medicines at once —
 * the conventional polypharmacy threshold used in geriatric care. Pure logic
 * (no server dependency) so it's safe to import from client components like
 * the medications list/medication safety panel. */
export const POLYPHARMACY_THRESHOLD = 5;

export function isPolypharmacy(activeMedicationCount: number): boolean {
  return activeMedicationCount >= POLYPHARMACY_THRESHOLD;
}

export const HOME_CARE_STATUS_LABEL: Record<HomeCareRequestStatus, string> = {
  eligibility_pending: "Checking eligibility",
  eligible: "Eligible — arranging a visit",
  ineligible: "Not eligible for a home visit",
  scheduled: "Visit scheduled",
  visit_completed: "Visit completed",
  declined: "Declined",
};
