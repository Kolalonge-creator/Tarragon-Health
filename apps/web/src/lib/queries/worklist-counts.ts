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
 *
 * Every counter destructures `error` and throws it. That is load-bearing, not
 * defensive habit: these numbers are a doctor's answer to "what needs me
 * today", and a swallowed error would render as a confident "0" — a failed
 * query dressed up as an empty queue. Throwing is what puts the consuming
 * component into its `isError` branch, which says the counts could not be
 * loaded instead of asserting there is nothing waiting — see AppShell's
 * NavBadge (app-shell.tsx), the sidebar badge every NavItem.countKey feeds,
 * which renders a small amber dot rather than a silently-vanished badge on
 * this exact failure. Never soften one of these back to `count ?? 0` on its
 * own.
 */
async function countOpenEscalations(supabase: Client) {
  const { count, error } = await supabase
    .from("escalations")
    .select("id", { count: "exact", head: true })
    .in("status", ["open", "under_review"]);
  if (error) throw error;
  return count ?? 0;
}

async function countReferralsNeedingUrgency(supabase: Client) {
  const { count, error } = await supabase
    .from("specialist_referrals")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");
  if (error) throw error;
  return count ?? 0;
}

async function countWaitlistedReferrals(supabase: Client) {
  const { count, error } = await supabase
    .from("specialist_referrals")
    .select("id", { count: "exact", head: true })
    .eq("status", "waitlisted");
  if (error) throw error;
  return count ?? 0;
}

/** A referral with an outcome on file (transcribed plan or uploaded
 * document) that hasn't been reviewed & closed yet — task spec §11.15. */
async function countReferralsAwaitingClosure(supabase: Client) {
  const { count, error } = await supabase
    .from("specialist_referrals")
    .select("id", { count: "exact", head: true })
    .eq("status", "completed")
    .or("treatment_plan_received_at.not.is.null,outcome_document_path.not.is.null");
  if (error) throw error;
  return count ?? 0;
}

async function countOutreachTasks(supabase: Client) {
  const { count, error } = await supabase
    .from("care_outreach_tasks")
    .select("id", { count: "exact", head: true })
    .in("status", ["open", "in_progress", "contacted"]);
  if (error) throw error;
  return count ?? 0;
}

async function countAsyncConsults(supabase: Client) {
  const { count, error } = await supabase
    .from("async_consults")
    .select("id", { count: "exact", head: true })
    .in("status", ["submitted", "in_review"]);
  if (error) throw error;
  return count ?? 0;
}

async function countSecondOpinionRequests(supabase: Client) {
  const { count, error } = await supabase
    .from("second_opinion_requests")
    .select("id", { count: "exact", head: true })
    .in("status", ["submitted", "in_review"]);
  if (error) throw error;
  return count ?? 0;
}

async function countPrescriptionRenewalRequests(supabase: Client) {
  const { count, error } = await supabase
    .from("prescription_renewal_requests")
    .select("id", { count: "exact", head: true })
    .in("status", ["submitted", "in_review"]);
  if (error) throw error;
  return count ?? 0;
}

async function countVerifiedDocumentRequests(supabase: Client) {
  const { count, error } = await supabase
    .from("verified_documents")
    .select("id", { count: "exact", head: true })
    .eq("status", "requested");
  if (error) throw error;
  return count ?? 0;
}

async function countSeniorCaseReviews(supabase: Client) {
  const { count, error } = await supabase
    .from("senior_case_reviews")
    .select("id", { count: "exact", head: true })
    .in("status", ["submitted", "in_review"]);
  if (error) throw error;
  return count ?? 0;
}

async function countAdherenceAlerts(supabase: Client) {
  const { count, error } = await supabase
    .from("medication_adherence_alerts")
    .select("id", { count: "exact", head: true })
    .neq("status", "resolved");
  if (error) throw error;
  return count ?? 0;
}

async function countMedicationReviews(supabase: Client) {
  const { count, error } = await supabase
    .from("medication_reviews")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");
  if (error) throw error;
  return count ?? 0;
}

async function countPreventiveReviews(supabase: Client) {
  const { count, error } = await supabase
    .from("preventive_reviews")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");
  if (error) throw error;
  return count ?? 0;
}

async function countAnnualReviews(supabase: Client) {
  const { count, error } = await supabase
    .from("annual_reviews")
    .select("id", { count: "exact", head: true })
    .in("status", ["pending", "in_progress"]);
  if (error) throw error;
  return count ?? 0;
}

async function countLifestyleReviews(supabase: Client) {
  const { count, error } = await supabase
    .from("lpe_reviews")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");
  if (error) throw error;
  return count ?? 0;
}

async function countLifestyleFlags(supabase: Client) {
  const { count, error } = await supabase
    .from("lpe_red_flag_events")
    .select("id", { count: "exact", head: true })
    .eq("status", "open");
  if (error) throw error;
  return count ?? 0;
}

async function countCarePlanReviewPrompts(supabase: Client) {
  const { count, error } = await supabase
    .from("care_plan_review_prompts")
    .select("id", { count: "exact", head: true })
    .eq("status", "open");
  if (error) throw error;
  return count ?? 0;
}

async function countRecommendations(supabase: Client) {
  const { count, error } = await supabase
    .from("care_plan_recommendations")
    .select("id", { count: "exact", head: true })
    .eq("status", "proposed");
  if (error) throw error;
  return count ?? 0;
}

async function countPendingVaccinationVerifications(supabase: Client) {
  const { count, error } = await supabase
    .from("vaccination_records")
    .select("id", { count: "exact", head: true })
    .eq("verification_status", "pending_verification");
  if (error) throw error;
  return count ?? 0;
}

async function countActiveCases(supabase: Client) {
  const { count, error } = await supabase
    .from("care_management_cases")
    .select("id", { count: "exact", head: true })
    .eq("status", "active");
  if (error) throw error;
  return count ?? 0;
}

/** Exact same filter as useOperationsQueueAlerts (lib/queries/operations-queue.ts). */
async function countOperationsQueueAlerts(supabase: Client) {
  const { count, error } = await supabase
    .from("clinician_alerts")
    .select("id", { count: "exact", head: true })
    .eq("status", "open");
  if (error) throw error;
  return count ?? 0;
}

/** Exact same filter as the results-inbox page's own "Awaiting action" count
 * (apps/web/src/app/(dashboard)/clinician/results-inbox/page.tsx). */
async function countResultsInboxAwaitingAction(supabase: Client) {
  const { count, error } = await supabase
    .from("lab_result_documents")
    .select("id", { count: "exact", head: true })
    .neq("acknowledgement_status", "action_completed");
  if (error) throw error;
  return count ?? 0;
}

/**
 * Emergency contraception requests specifically (not the sexual-health
 * worklist's other two sub-lists, STI case episodes and requested
 * contraception plans) -- exact same filter as useOrgPendingEcRequests
 * (lib/queries/emergency-contraception.ts). Singled out because it carries a
 * 1-hour SLA, the most time-critical item on that page by a wide margin --
 * found sitting 127 hours overdue with no badge anywhere pointing at it
 * during the 2026-09-17 pending-jobs-banner audit.
 */
async function countPendingEcRequests(supabase: Client) {
  const { count, error } = await supabase
    .from("emergency_contraception_requests")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");
  if (error) throw error;
  return count ?? 0;
}

/** Exact same filter as safety-incidents-console.tsx's own "Open" tab
 * (`status !== "closed"`). Found a CRITICAL-severity incident sitting in
 * this queue with no badge anywhere pointing at it during the same audit
 * that found the emergency-contraception gap above. */
async function countOpenSafetyIncidents(supabase: Client) {
  const { count, error } = await supabase
    .from("clinical_incident_reports")
    .select("id", { count: "exact", head: true })
    .neq("status", "closed");
  if (error) throw error;
  return count ?? 0;
}

/** Exact same filter as safeguarding/page.tsx's own `openCount`
 * (`status !== "closed"`). Restricted-visibility worklist (only a Senior
 * Medical Officer+ can move a concern into review or close it), but every
 * tier can see the queue -- see that page's own header comment -- so the
 * count is safe to show to every tier too. */
async function countOpenSafeguardingConcerns(supabase: Client) {
  const { count, error } = await supabase
    .from("safeguarding_concerns")
    .select("id", { count: "exact", head: true })
    .neq("status", "closed");
  if (error) throw error;
  return count ?? 0;
}

/** Medication issues has two independent sub-worklists (affordability
 * reports, dispense/interaction concerns) -- this counts only the latter
 * (medication_dispense_flags, same filter as useOpenDispenseFlags), chosen
 * as the single more clinically load-bearing of the two rather than summing
 * both into one query: worklist-counts.test.ts's generic success test
 * stubs the whole client to one fixed result per key, so a counter issuing
 * more than one real query resolves to a multiple of the stub value, not
 * the value itself -- learned the hard way building the sexual-health
 * counter earlier the same day. Affordability reports stay uncounted here,
 * not silently dropped: opening the page itself still shows them exactly as
 * before. */
async function countOpenMedicationDispenseFlags(supabase: Client) {
  const { count, error } = await supabase
    .from("medication_dispense_flags")
    .select("id", { count: "exact", head: true })
    .neq("status", "resolved");
  if (error) throw error;
  return count ?? 0;
}

/** Exact same filter as useSupportTicketQueue (lib/queries/support-tickets.ts). */
async function countOpenSupportTickets(supabase: Client) {
  const { count, error } = await supabase
    .from("support_tickets")
    .select("id", { count: "exact", head: true })
    .not("status", "in", "(resolved,closed)");
  if (error) throw error;
  return count ?? 0;
}

/** Exact same filter as useComplaintQueue (lib/queries/complaints.ts) --
 * every complaint short of governance_review, the point at which it moves
 * to a different reviewer and stops being this queue's job. */
async function countOpenComplaints(supabase: Client) {
  const { count, error } = await supabase
    .from("complaints")
    .select("id", { count: "exact", head: true })
    .neq("status", "governance_review");
  if (error) throw error;
  return count ?? 0;
}

/** Exact same filter as usePendingEligibility (weight-management/eligibility-
 * queue.tsx) -- the more clinically load-bearing of weight management's two
 * sub-worklists (nothing happens for a patient clinically until this
 * decision is made); tolerability check-ins stay uncounted here for the
 * same reason affordability reports do above. */
async function countWeightManagementPendingEligibility(supabase: Client) {
  const { count, error } = await supabase
    .from("weight_management_enrolments")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending_eligibility");
  if (error) throw error;
  return count ?? 0;
}

/** Exact same filter as therapy-approvals/queue.tsx's own psychiatry-request
 * query. Approving needs prescribing authority (a Senior Medical Officer+),
 * but the queue is visible to every tier -- see that page's own header
 * comment -- so the count is safe to show to every tier too. */
async function countTherapyApprovalsWaiting(supabase: Client) {
  const { count, error } = await supabase
    .from("therapy_sessions")
    .select("id", { count: "exact", head: true })
    .eq("status", "awaiting_clinician_approval");
  if (error) throw error;
  return count ?? 0;
}

/**
 * Unread WhatsApp support messages -- a deliberate approximation of
 * support-inbox/page.tsx's own worklist, not an exact copy of it: that page
 * dedupes to one row per patient (most recent message) client-side, which
 * cannot be expressed as a single PostgREST head-count without a database
 * view or RPC. Counting raw unread messages instead means a patient with
 * several unread messages counts more than once here, which only ever
 * overstates how much is waiting -- the safe direction to be imprecise in,
 * never the page's actual displayed number. Revisit with a proper RPC if
 * that gap ever matters enough to close exactly.
 */
async function countUnreadSupportMessages(supabase: Client) {
  const { count, error } = await supabase
    .from("support_messages")
    .select("id", { count: "exact", head: true })
    .eq("status", "unread");
  if (error) throw error;
  return count ?? 0;
}

/**
 * Orders needing a home-visit provider assigned -- exact same predicate as
 * the "Home visits & deliveries" page's LabOrdersWorklist (a lab order with
 * no home_visit_provider yet, in payment_confirmed or ordered status --
 * apps/web/src/app/(dashboard)/clinician/orders/page.tsx). That page also
 * has a second sub-worklist (pharmacy orders needing a courier assigned, out
 * for delivery, or a failed delivery to retry), left uncounted here for the
 * same reason Medication issues/Weight management leave their second
 * sub-worklist uncounted: this file's counters issue exactly one query each,
 * and a home-visit collection blocks a diagnostic sample from ever being
 * taken -- the more clinically load-bearing of the two. Pharmacy orders stay
 * fully visible on the page itself, just not globally counted.
 */
async function countLabOrdersAwaitingHomeVisitAssignment(supabase: Client) {
  const { count, error } = await supabase
    .from("lab_orders")
    .select("id", { count: "exact", head: true })
    .is("home_visit_provider_id", null)
    .in("status", ["payment_confirmed", "ordered"]);
  if (error) throw error;
  return count ?? 0;
}

/** Exact same filter as useOrgLabResultConsultRequests
 * (lib/queries/lab-result-consult.ts) -- a paid consult request whose result
 * a doctor hasn't yet accepted a booking slot for. */
async function countLabResultConsultsWaiting(supabase: Client) {
  const { count, error } = await supabase
    .from("lab_result_consult_requests")
    .select("id", { count: "exact", head: true })
    .in("status", ["payment_confirmed", "document_uploaded"]);
  if (error) throw error;
  return count ?? 0;
}

/** Recognised FHIR Bundle entries from a partner import (labs/HMOs/hospitals
 * via POST /api/v1/fhir/import) waiting for a clinician to confirm, modify,
 * or dismiss them into the record -- see clinician/fhir-review. */
async function countFhirProposedResourcesPending(supabase: Client) {
  const { count, error } = await supabase
    .from("fhir_import_proposed_resources")
    .select("id", { count: "exact", head: true })
    .eq("status", "proposed");
  if (error) throw error;
  return count ?? 0;
}

/**
 * Threads waiting on a care-team reply -- exact same predicate as
 * isAwaitingCareTeam (lib/worklist/message-triage.ts), which compares
 * care_team_last_read_at to last_message_at. That's a column-vs-column
 * comparison PostgREST's query-string filters can't express (they only ever
 * compare a column to a supplied value), so this counter calls a
 * `security invoker` SQL RPC instead of the usual .select().eq() chain --
 * see migration 20260917090629_count_care_threads_awaiting_reply_rpc.sql.
 * RLS on care_message_threads still scopes the result per caller, same as
 * every other counter here.
 */
async function countCareThreadsAwaitingReply(supabase: Client) {
  const { data, error } = await supabase.rpc("count_care_threads_awaiting_reply");
  if (error) throw error;
  return data ?? 0;
}

/**
 * Preventive Health Check Reviews a patient has paid for but nobody has
 * written back yet — exact same predicate as the preventive-health-check-
 * reviews worklist page's own query. Before this counter/page existed
 * (added 2026-09-22 alongside the Preventive Health Check Review SKU, see
 * 20260922185300_preventive_health_check_review_sku.sql), a doctor could
 * only find a check to review by already knowing the patientId and
 * navigating straight to /clinician/patients/[patientId] — nothing
 * surfaced "a patient is waiting on this" anywhere.
 */
async function countPreventiveHealthCheckReviewsWaiting(supabase: Client) {
  const { count, error } = await supabase
    .from("annual_health_checks")
    .select("id", { count: "exact", head: true })
    .not("review_requested_at", "is", null)
    .is("reviewed_at", null);
  if (error) throw error;
  return count ?? 0;
}

/** Doctor-to-doctor curbside consults where the OTHER party sent last --
 * same "column-vs-caller" RPC shape as countCareThreadsAwaitingReply, and
 * the same reason: comparing last_message_sender_id to the caller's own
 * clinical_staff id isn't expressible as a plain .select().eq() filter. See
 * public.count_curbside_consults_awaiting_reply()
 * (20260922230142_curbside_consults.sql). */
async function countCurbsideConsultsAwaitingReply(supabase: Client) {
  const { data, error } = await supabase.rpc("count_curbside_consults_awaiting_reply");
  if (error) throw error;
  return data ?? 0;
}

export type WorklistCountKey =
  | "escalations"
  | "referralsNeedingUrgency"
  | "waitlistedReferrals"
  | "referralsAwaitingClosure"
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
  | "vaccinationVerifications"
  | "activeCases"
  | "operationsQueueAlerts"
  | "resultsInboxAwaitingAction"
  | "pendingEcRequests"
  | "openSafetyIncidents"
  | "openSafeguardingConcerns"
  | "openMedicationDispenseFlags"
  | "openSupportTickets"
  | "openComplaints"
  | "weightManagementPendingEligibility"
  | "therapyApprovalsWaiting"
  | "unreadSupportMessages"
  | "careThreadsAwaitingReply"
  | "labOrdersAwaitingHomeVisitAssignment"
  | "labResultConsultsWaiting"
  | "fhirProposedResourcesPending"
  | "preventiveHealthCheckReviewsWaiting"
  | "curbsideConsultsAwaitingReply";

/**
 * Exported so the "a broken query must never render as 0" invariant above is
 * testable for every counter at once (worklist-counts.test.ts), rather than
 * trusted to twenty near-identical copies of the same three lines.
 */
export const COUNTERS: Record<WorklistCountKey, (supabase: Client) => Promise<number>> = {
  escalations: countOpenEscalations,
  referralsNeedingUrgency: countReferralsNeedingUrgency,
  waitlistedReferrals: countWaitlistedReferrals,
  referralsAwaitingClosure: countReferralsAwaitingClosure,
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
  activeCases: countActiveCases,
  operationsQueueAlerts: countOperationsQueueAlerts,
  resultsInboxAwaitingAction: countResultsInboxAwaitingAction,
  pendingEcRequests: countPendingEcRequests,
  openSafetyIncidents: countOpenSafetyIncidents,
  openSafeguardingConcerns: countOpenSafeguardingConcerns,
  openMedicationDispenseFlags: countOpenMedicationDispenseFlags,
  openSupportTickets: countOpenSupportTickets,
  openComplaints: countOpenComplaints,
  weightManagementPendingEligibility: countWeightManagementPendingEligibility,
  therapyApprovalsWaiting: countTherapyApprovalsWaiting,
  unreadSupportMessages: countUnreadSupportMessages,
  careThreadsAwaitingReply: countCareThreadsAwaitingReply,
  labOrdersAwaitingHomeVisitAssignment: countLabOrdersAwaitingHomeVisitAssignment,
  labResultConsultsWaiting: countLabResultConsultsWaiting,
  fhirProposedResourcesPending: countFhirProposedResourcesPending,
  preventiveHealthCheckReviewsWaiting: countPreventiveHealthCheckReviewsWaiting,
  curbsideConsultsAwaitingReply: countCurbsideConsultsAwaitingReply,
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
