import { supabase } from "./supabase";
import type { QueryResult } from "./medications";
import { ageFromDateOfBirth, type Enums } from "@tarragon/shared";

export type AgeingAssessmentDomain = Enums<"ageing_assessment_domain">;
export type AgeingAssessmentOutcome = Enums<"ageing_assessment_outcome">;
export type AgeingAssessmentStatus = Enums<"ageing_assessment_status">;
export type FallsRiskPathwayStage = Enums<"falls_risk_pathway_stage">;
export type FallsRiskLevel = Enums<"falls_risk_level">;
export type SocialNavigationFollowUpStatus = Enums<"social_navigation_follow_up_status">;
export type HomeCareRequestStatus = Enums<"home_care_request_status">;

/**
 * The 9 domains this table owns (spec §50.3) — deliberately excludes
 * cardiovascular, diabetes, and medication, which already have a live
 * source of truth elsewhere (care_plans/patient_conditions, medications)
 * and are composed alongside these in the UI rather than re-collected here.
 * Mirrors apps/web/src/lib/healthy-ageing/types.ts verbatim.
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

/** Safe, non-diagnostic copy for each outcome (spec §50.6) — never write new
 * copy for these, reuse this map verbatim everywhere an outcome is shown. */
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

/** A patient is treated as being on 5 or more active medicines at once — the
 * conventional polypharmacy threshold used in geriatric care. */
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

/** Age most platforms and Nigeria's own senior-citizens framing treat as
 * "older adult" — a soft threshold for framing copy only, never a hard gate.
 * Mirrors the web page's own HEALTHY_AGEING_AGE_THRESHOLD. */
export const HEALTHY_AGEING_AGE_THRESHOLD = 60;

/** Whether the subject's copy should read as older-adult framing — null
 * date of birth defaults to true, same as web (isOlderAdult = ageYears ==
 * null || ageYears >= threshold). */
export async function loadIsOlderAdultFraming(patientId: string): Promise<boolean> {
  const { data } = await supabase.from("profiles").select("date_of_birth").eq("id", patientId).maybeSingle();
  const ageYears = ageFromDateOfBirth(data?.date_of_birth ?? null);
  return ageYears == null || ageYears >= HEALTHY_AGEING_AGE_THRESHOLD;
}

export interface AgeingAssessmentDomainResultView {
  id: string;
  domain: AgeingAssessmentDomain;
  outcome: AgeingAssessmentOutcome;
  notes: string | null;
  clinicianReviewedAt: string | null;
}

export interface AgeingAssessmentView {
  id: string;
  status: AgeingAssessmentStatus;
  startedAt: string;
  completedAt: string | null;
  nextReviewDueAt: string | null;
  loggedByProfileId: string | null;
  domainResults: AgeingAssessmentDomainResultView[];
}

/** Mirrors apps/web/src/lib/healthy-ageing/loaders.ts's loadLatestAgeingAssessment. */
export async function loadLatestAgeingAssessment(patientId: string): Promise<AgeingAssessmentView | null> {
  const { data: assessment } = await supabase
    .from("ageing_assessments")
    .select("id, status, started_at, completed_at, next_review_due_at, logged_by_profile_id")
    .eq("patient_id", patientId)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!assessment) return null;

  const { data: domainRows } = await supabase
    .from("ageing_assessment_domain_results")
    .select("id, domain, outcome, notes, clinician_reviewed_at")
    .eq("assessment_id", assessment.id);

  return {
    id: assessment.id,
    status: assessment.status,
    startedAt: assessment.started_at,
    completedAt: assessment.completed_at,
    nextReviewDueAt: assessment.next_review_due_at,
    loggedByProfileId: assessment.logged_by_profile_id,
    domainResults: (domainRows ?? []).map((d) => ({
      id: d.id,
      domain: d.domain,
      outcome: d.outcome,
      notes: d.notes,
      clinicianReviewedAt: d.clinician_reviewed_at,
    })),
  };
}

/** Which of the 9 owned domains still have no answer on the given
 * assessment (or all 9, when there is none yet). */
export function missingDomains(assessment: AgeingAssessmentView | null): AgeingAssessmentDomain[] {
  const answered = new Set(assessment?.domainResults.map((d) => d.domain) ?? []);
  return AGEING_ASSESSMENT_DOMAINS.filter((d) => !answered.has(d));
}

export interface FallsRiskView {
  id: string;
  riskLevel: FallsRiskLevel | null;
  pathwayStage: FallsRiskPathwayStage;
  identifiedAt: string;
  followUpDueAt: string | null;
}

/** The patient's most recent, not-yet-resolved falls-risk pathway entry. */
export async function loadOpenFallsRisk(patientId: string): Promise<FallsRiskView | null> {
  const { data } = await supabase
    .from("falls_risk_assessments")
    .select("id, risk_level, pathway_stage, identified_at, follow_up_due_at")
    .eq("patient_id", patientId)
    .neq("pathway_stage", "resolved")
    .order("identified_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return null;
  return {
    id: data.id,
    riskLevel: data.risk_level,
    pathwayStage: data.pathway_stage,
    identifiedAt: data.identified_at,
    followUpDueAt: data.follow_up_due_at,
  };
}

/**
 * How an open falls-risk pathway entry reads on the snapshot tile. Mirrors
 * apps/web/src/lib/healthy-ageing/falls-risk-display.ts verbatim —
 * `risk_level` is nullable (a pathway entry can open before anyone has
 * graded it), which is NOT "low" and must not read as reassuring.
 */
export type FallsRiskDisplay = {
  value: string;
  badge: { text: string; tone: "danger" | "warn" | "brand" | "neutral" } | undefined;
};

const FALLS_BADGE_TONE: Record<FallsRiskLevel, "brand" | "warn" | "danger"> = {
  low: "brand",
  moderate: "warn",
  high: "danger",
};

export function fallsRiskDisplay(fallsRisk: { riskLevel: FallsRiskLevel | null } | null): FallsRiskDisplay {
  if (!fallsRisk) return { value: "Not checked", badge: undefined };
  if (fallsRisk.riskLevel === null) {
    return { value: "Awaiting review", badge: { text: "Awaiting review", tone: "neutral" } };
  }
  const label = FALLS_RISK_LEVEL_LABEL[fallsRisk.riskLevel];
  return { value: label, badge: { text: label, tone: FALLS_BADGE_TONE[fallsRisk.riskLevel] } };
}

export interface SocialDeterminantView {
  id: string;
  needsNavigationSupport: boolean;
  followUpStatus: SocialNavigationFollowUpStatus;
  screenedAt: string;
}

export async function loadLatestSocialDeterminantScreening(patientId: string): Promise<SocialDeterminantView | null> {
  const { data } = await supabase
    .from("social_determinant_screenings")
    .select("id, needs_navigation_support, follow_up_status, screened_at")
    .eq("patient_id", patientId)
    .order("screened_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return null;
  return {
    id: data.id,
    needsNavigationSupport: data.needs_navigation_support ?? false,
    followUpStatus: data.follow_up_status,
    screenedAt: data.screened_at,
  };
}

export interface HomeCareRequestView {
  id: string;
  status: HomeCareRequestStatus;
  scheduledAt: string | null;
  createdAt: string;
}

/** The patient's most recent home-care request that isn't finished
 * (completed or declined) — null once nothing is in flight. */
export async function loadOpenHomeCareRequest(patientId: string): Promise<HomeCareRequestView | null> {
  const { data } = await supabase
    .from("home_care_requests")
    .select("id, status, scheduled_at, created_at")
    .eq("patient_id", patientId)
    .not("status", "in", "(visit_completed,declined)")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return null;
  return { id: data.id, status: data.status, scheduledAt: data.scheduled_at, createdAt: data.created_at };
}

export interface CoordinatedCareAction {
  key: string;
  label: string;
  detail: string;
  dueAt: string | null;
  priority: number;
}

export interface CoordinatedCareSummary {
  activeConditionCount: number;
  activeMedicationCount: number;
  isPolypharmacy: boolean;
  actions: CoordinatedCareAction[];
}

/**
 * Spec §50.9: an orchestration layer, not a new fused care-plan table — same
 * pattern as the Annual Health Review. Reads the patient's existing
 * per-condition patient_conditions problem list, active medications, and the
 * falls-risk/social-determinant tables, and turns them into one prioritised
 * action list. Mirrors apps/web/src/lib/healthy-ageing/loaders.ts's
 * loadCoordinatedCareSummary. Note (inherited platform gap, not introduced
 * here): patient_conditions' SELECT policy has no can_act_for clause, so a
 * caregiver acting for a supported person will see activeConditionCount: 0
 * even with real active conditions — web has this exact bug today too.
 */
export async function loadCoordinatedCareSummary(patientId: string): Promise<CoordinatedCareSummary> {
  const [{ data: conditions }, { data: medications }, fallsRisk, socialScreening] = await Promise.all([
    supabase
      .from("patient_conditions")
      .select("id, condition_name, status, next_review_due_at")
      .eq("patient_id", patientId)
      .in("status", ["active", "uncontrolled", "under_investigation"]),
    supabase.from("medications").select("id").eq("patient_id", patientId).eq("is_active", true),
    loadOpenFallsRisk(patientId),
    loadLatestSocialDeterminantScreening(patientId),
  ]);

  const activeMedicationCount = medications?.length ?? 0;
  const actions: CoordinatedCareAction[] = [];

  for (const c of conditions ?? []) {
    if (c.next_review_due_at && new Date(c.next_review_due_at) <= new Date()) {
      actions.push({
        key: `condition-review-${c.id}`,
        label: `${c.condition_name} review due`,
        detail: "A scheduled review of this condition is due.",
        dueAt: c.next_review_due_at,
        priority: 2,
      });
    }
  }

  if (fallsRisk && fallsRisk.pathwayStage === "risk_identified") {
    actions.push({
      key: `falls-${fallsRisk.id}`,
      label: "Falls risk flagged, awaiting clinical assessment",
      detail: "A clinician needs to review this before the next step in the pathway.",
      dueAt: null,
      priority: 3,
    });
  } else if (fallsRisk && fallsRisk.followUpDueAt && new Date(fallsRisk.followUpDueAt) <= new Date()) {
    actions.push({
      key: `falls-followup-${fallsRisk.id}`,
      label: "Falls-risk follow-up due",
      detail: "The intervention follow-up for this falls-risk pathway is due.",
      dueAt: fallsRisk.followUpDueAt,
      priority: 2,
    });
  }

  if (socialScreening && socialScreening.followUpStatus === "pending") {
    actions.push({
      key: `social-${socialScreening.id}`,
      label: "Support and navigation follow-up pending",
      detail: "A recent check-in flagged something the care coordinator should follow up on.",
      dueAt: null,
      priority: 1,
    });
  }

  actions.sort((a, b) => b.priority - a.priority);

  return {
    activeConditionCount: conditions?.length ?? 0,
    activeMedicationCount,
    isPolypharmacy: isPolypharmacy(activeMedicationCount),
    actions,
  };
}

function trimmedNote(note?: string): string | null {
  const trimmed = note?.trim();
  if (!trimmed) return null;
  if (trimmed.length > 500) return trimmed.slice(0, 500);
  return trimmed;
}

export interface AgeingAssessmentDomainAnswer {
  domain: AgeingAssessmentDomain;
  outcome: AgeingAssessmentOutcome;
  note?: string;
}

/**
 * Mirrors healthy-ageing-actions.ts's submitAgeingAssessmentDomains: finds
 * (or starts) the patient's most recent in-progress assessment and upserts
 * the submitted domain answers onto it (onConflict "assessment_id,domain"),
 * so re-answering a domain in the same check-in overwrites rather than
 * duplicates. A plain RLS-scoped insert/upsert — no RPC, per the doc's own
 * "Recommended new API routes: None."
 */
export async function submitAgeingAssessmentDomains(
  patientId: string,
  organisationId: string,
  answers: AgeingAssessmentDomainAnswer[]
): Promise<QueryResult<null>> {
  if (answers.length === 0) return { ok: false, error: "Answer at least one section before saving" };

  const { data: openAssessment } = await supabase
    .from("ageing_assessments")
    .select("id")
    .eq("patient_id", patientId)
    .eq("status", "in_progress")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let assessmentId = openAssessment?.id;
  if (!assessmentId) {
    const { data: created, error: createError } = await supabase
      .from("ageing_assessments")
      .insert({ organisation_id: organisationId, patient_id: patientId })
      .select("id")
      .single();
    if (createError || !created) {
      return { ok: false, error: createError?.message ?? "Could not start a new check-in" };
    }
    assessmentId = created.id;
  }

  const { error: upsertError } = await supabase.from("ageing_assessment_domain_results").upsert(
    answers.map((a) => ({
      assessment_id: assessmentId,
      domain: a.domain,
      outcome: a.outcome,
      notes: trimmedNote(a.note),
    })),
    { onConflict: "assessment_id,domain" }
  );
  if (upsertError) return { ok: false, error: upsertError.message };
  return { ok: true, data: null };
}

export interface FallsRiskCheckInput {
  previous_falls_12mo: boolean;
  mobility_impairment: boolean;
  high_risk_medications: boolean;
  environmental_hazards: boolean;
  balance_concern: boolean;
}

/** Mirrors healthy-ageing-actions.ts's submitFallsRiskCheck — a plain
 * insert; risk_level defaults server-side from a before-insert trigger. */
export async function submitFallsRiskCheck(
  patientId: string,
  organisationId: string,
  input: FallsRiskCheckInput
): Promise<QueryResult<null>> {
  const { error } = await supabase.from("falls_risk_assessments").insert({
    organisation_id: organisationId,
    patient_id: patientId,
    ...input,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: null };
}

export interface SocialDeterminantsCheckInput {
  living_alone: boolean;
  transport_difficulty: boolean;
  financial_barrier: boolean;
  caregiver_limitation: boolean;
  healthcare_access_difficulty: boolean;
}

/** Mirrors healthy-ageing-actions.ts's submitSocialDeterminantsCheck —
 * needs_navigation_support/follow_up_status are computed server-side, never
 * client-set. */
export async function submitSocialDeterminantsCheck(
  patientId: string,
  organisationId: string,
  input: SocialDeterminantsCheckInput
): Promise<QueryResult<null>> {
  const { error } = await supabase.from("social_determinant_screenings").insert({
    organisation_id: organisationId,
    patient_id: patientId,
    ...input,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: null };
}

/** Mirrors healthy-ageing-actions.ts's submitHomeCareRequest. Deliberately
 * NOT live dispatch — see the table's own comment quoted in the scope doc;
 * copy must stay "we'll be in touch," never a booking confirmation. */
export async function submitHomeCareRequest(
  patientId: string,
  organisationId: string,
  reason: string
): Promise<QueryResult<null>> {
  const trimmed = reason.trim();
  if (!trimmed) return { ok: false, error: "Tell us a little about why" };
  const { error } = await supabase.from("home_care_requests").insert({
    organisation_id: organisationId,
    patient_id: patientId,
    reason: trimmed.slice(0, 500),
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: null };
}
