import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import {
  AGEING_ASSESSMENT_DOMAINS,
  isPolypharmacy,
  type AgeingAssessmentDomain,
  type AgeingAssessmentOutcome,
  type FallsRiskLevel,
  type FallsRiskPathwayStage,
  type HomeCareRequestStatus,
  type SocialNavigationFollowUpStatus,
} from "./types";

/**
 * Every read here goes through the CALLER'S OWN Supabase client, so RLS is
 * the authorisation gate exactly as it is everywhere else — this module adds
 * no privilege of its own. Same pattern as
 * `@/lib/clinical/patient-clinical-context`.
 */

export interface AgeingAssessmentDomainResultView {
  id: string;
  domain: AgeingAssessmentDomain;
  outcome: AgeingAssessmentOutcome;
  notes: string | null;
  clinicianReviewedAt: string | null;
}

export interface AgeingAssessmentView {
  id: string;
  status: Database["public"]["Enums"]["ageing_assessment_status"];
  startedAt: string;
  completedAt: string | null;
  nextReviewDueAt: string | null;
  loggedByProfileId: string | null;
  domainResults: AgeingAssessmentDomainResultView[];
}

/** The patient's most recent ageing assessment (in progress or completed),
 * with whatever domains have been answered so far. Null when none exists
 * yet — the UI treats that as "not started", not an error. */
export async function loadLatestAgeingAssessment(
  supabase: SupabaseClient<Database>,
  patientId: string,
): Promise<AgeingAssessmentView | null> {
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

/** Which of the 9 owned domains still have no answer on the given assessment
 * (or all 9, when there is none yet). */
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
export async function loadOpenFallsRisk(
  supabase: SupabaseClient<Database>,
  patientId: string,
): Promise<FallsRiskView | null> {
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

export interface SocialDeterminantView {
  id: string;
  needsNavigationSupport: boolean;
  followUpStatus: SocialNavigationFollowUpStatus;
  screenedAt: string;
}

export async function loadLatestSocialDeterminantScreening(
  supabase: SupabaseClient<Database>,
  patientId: string,
): Promise<SocialDeterminantView | null> {
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
export async function loadOpenHomeCareRequest(
  supabase: SupabaseClient<Database>,
  patientId: string,
): Promise<HomeCareRequestView | null> {
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
  /** Higher sorts first. Emergency/clinical work outranks routine reminders. */
  priority: number;
}

export interface CoordinatedCareSummary {
  activeConditionCount: number;
  activeMedicationCount: number;
  isPolypharmacy: boolean;
  actions: CoordinatedCareAction[];
}

/**
 * Spec §50.9: "avoid creating four completely independent care plans" for a
 * multimorbid patient. This is deliberately an ORCHESTRATION layer, not a new
 * fused care-plan table — same pattern as the Annual Health Review, which
 * "adopts + rolls" existing condition reviews rather than re-doing them (see
 * CLAUDE.md). It reads the patient's existing per-condition care_plans,
 * patient_conditions problem list, active medications, and the new
 * falls-risk/social-determinant/ageing-assessment tables, and turns them into
 * one prioritised action list — never a second copy of the underlying data.
 */
export async function loadCoordinatedCareSummary(
  supabase: SupabaseClient<Database>,
  patientId: string,
): Promise<CoordinatedCareSummary> {
  const [{ data: conditions }, { data: medications }, fallsRisk, socialScreening] = await Promise.all([
    supabase
      .from("patient_conditions")
      .select("id, condition_name, status, next_review_due_at")
      .eq("patient_id", patientId)
      .in("status", ["active", "uncontrolled", "under_investigation"]),
    supabase.from("medications").select("id").eq("patient_id", patientId).eq("is_active", true),
    loadOpenFallsRisk(supabase, patientId),
    loadLatestSocialDeterminantScreening(supabase, patientId),
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
