import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";

type Client = SupabaseClient<Database>;

/**
 * One "how much is actually waiting for me" number per worklist, run as
 * `count: 'exact', head: true` (no rows returned, RLS still applies) so 13
 * counts cost about what one row-fetch would. Every filter here is copied
 * verbatim from that worklist's own page query — this file must never drift
 * into inventing a different definition of "open" for the same table.
 */
async function countOpenEscalations(supabase: Client) {
  const { count } = await supabase
    .from("escalations")
    .select("id", { count: "exact", head: true })
    .in("status", ["open", "under_review"]);
  return count ?? 0;
}

async function countReferralsNeedingUrgency(supabase: Client) {
  const { count } = await supabase
    .from("specialist_referrals")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");
  return count ?? 0;
}

async function countWaitlistedReferrals(supabase: Client) {
  const { count } = await supabase
    .from("specialist_referrals")
    .select("id", { count: "exact", head: true })
    .eq("status", "waitlisted");
  return count ?? 0;
}

async function countOutreachTasks(supabase: Client) {
  const { count } = await supabase
    .from("care_outreach_tasks")
    .select("id", { count: "exact", head: true })
    .in("status", ["open", "in_progress", "contacted"]);
  return count ?? 0;
}

async function countAsyncConsults(supabase: Client) {
  const { count } = await supabase
    .from("async_consults")
    .select("id", { count: "exact", head: true })
    .in("status", ["submitted", "in_review"]);
  return count ?? 0;
}

async function countSecondOpinionRequests(supabase: Client) {
  const { count } = await supabase
    .from("second_opinion_requests")
    .select("id", { count: "exact", head: true })
    .in("status", ["submitted", "in_review"]);
  return count ?? 0;
}

async function countPrescriptionRenewalRequests(supabase: Client) {
  const { count } = await supabase
    .from("prescription_renewal_requests")
    .select("id", { count: "exact", head: true })
    .in("status", ["submitted", "in_review"]);
  return count ?? 0;
}

async function countVerifiedDocumentRequests(supabase: Client) {
  const { count } = await supabase
    .from("verified_documents")
    .select("id", { count: "exact", head: true })
    .eq("status", "requested");
  return count ?? 0;
}

async function countSeniorCaseReviews(supabase: Client) {
  const { count } = await supabase
    .from("senior_case_reviews")
    .select("id", { count: "exact", head: true })
    .in("status", ["submitted", "in_review"]);
  return count ?? 0;
}

async function countAdherenceAlerts(supabase: Client) {
  const { count } = await supabase
    .from("medication_adherence_alerts")
    .select("id", { count: "exact", head: true })
    .neq("status", "resolved");
  return count ?? 0;
}

async function countMedicationReviews(supabase: Client) {
  const { count } = await supabase
    .from("medication_reviews")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");
  return count ?? 0;
}

async function countPreventiveReviews(supabase: Client) {
  const { count } = await supabase
    .from("preventive_reviews")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");
  return count ?? 0;
}

async function countAnnualReviews(supabase: Client) {
  const { count } = await supabase
    .from("annual_reviews")
    .select("id", { count: "exact", head: true })
    .in("status", ["pending", "in_progress"]);
  return count ?? 0;
}

async function countLifestyleReviews(supabase: Client) {
  const { count } = await supabase
    .from("lpe_reviews")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");
  return count ?? 0;
}

async function countLifestyleFlags(supabase: Client) {
  const { count } = await supabase
    .from("lpe_red_flag_events")
    .select("id", { count: "exact", head: true })
    .eq("status", "open");
  return count ?? 0;
}

async function countCarePlanReviewPrompts(supabase: Client) {
  const { count } = await supabase
    .from("care_plan_review_prompts")
    .select("id", { count: "exact", head: true })
    .eq("status", "open");
  return count ?? 0;
}

async function countRecommendations(supabase: Client) {
  const { count } = await supabase
    .from("care_plan_recommendations")
    .select("id", { count: "exact", head: true })
    .eq("status", "proposed");
  return count ?? 0;
}

async function countPendingVaccinationVerifications(supabase: Client) {
  const { count } = await supabase
    .from("vaccination_records")
    .select("id", { count: "exact", head: true })
    .eq("verification_status", "pending_verification");
  return count ?? 0;
}

export type WorklistCountKey =
  | "escalations"
  | "referralsNeedingUrgency"
  | "waitlistedReferrals"
  | "outreach"
  | "asyncConsults"
  | "secondOpinionRequests"
  | "prescriptionRenewalRequests"
  | "verifiedDocumentRequests"
  | "seniorCaseReviews"
  | "adherenceAlerts"
  | "medicationReviews"
  | "preventiveReviews"
  | "annualReviews"
  | "lifestyleReviews"
  | "lifestyleFlags"
  | "carePlanReviewPrompts"
  | "recommendations"
  | "vaccinationVerifications";

const COUNTERS: Record<WorklistCountKey, (supabase: Client) => Promise<number>> = {
  escalations: countOpenEscalations,
  referralsNeedingUrgency: countReferralsNeedingUrgency,
  waitlistedReferrals: countWaitlistedReferrals,
  outreach: countOutreachTasks,
  asyncConsults: countAsyncConsults,
  secondOpinionRequests: countSecondOpinionRequests,
  prescriptionRenewalRequests: countPrescriptionRenewalRequests,
  verifiedDocumentRequests: countVerifiedDocumentRequests,
  seniorCaseReviews: countSeniorCaseReviews,
  adherenceAlerts: countAdherenceAlerts,
  medicationReviews: countMedicationReviews,
  preventiveReviews: countPreventiveReviews,
  annualReviews: countAnnualReviews,
  lifestyleReviews: countLifestyleReviews,
  lifestyleFlags: countLifestyleFlags,
  carePlanReviewPrompts: countCarePlanReviewPrompts,
  recommendations: countRecommendations,
  vaccinationVerifications: countPendingVaccinationVerifications,
};

/**
 * Fetches only the requested subset of worklist counts (a doctor-role caller
 * has no route for most of these — see navigation.ts — so /doctor only asks
 * for the two that apply to it). Refetches every 60s, same cadence as the
 * doctor escalation worklist itself, so the "today" strip doesn't go stale
 * across a long session.
 */
export function useWorklistCounts(keys: WorklistCountKey[]) {
  return useQuery({
    queryKey: ["worklist-counts", ...keys.slice().sort()],
    queryFn: async () => {
      const supabase = createClient();
      const entries = await Promise.all(
        keys.map(async (key) => [key, await COUNTERS[key](supabase)] as const)
      );
      return Object.fromEntries(entries) as Record<WorklistCountKey, number>;
    },
    refetchInterval: 60_000,
  });
}
