import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { excludeTestPatients, fetchTestPatientIds } from "@/lib/queries/real-patients";

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
async function countOpenEscalations(supabase: Client, testPatientIds: readonly string[] = []) {
  const { count, error } = await excludeTestPatients(
    supabase
      .from("escalations")
      .select("id", { count: "exact", head: true })
      .in("status", ["open", "under_review"]),
    testPatientIds
  );
  if (error) throw error;
  return count ?? 0;
}

/**
 * The three referral counts come from one rule-applying function (S05e): a staff member counts only the referrals she may see (tied, the
 * creator, the assigned specialist, or the referral desk), so the badge never advertises work she cannot open. Errors throw, as above.
 */
async function referralCount(supabase: Client, kind: "needing_urgency" | "waitlisted" | "awaiting_closure") {
  const { data, error } = await supabase.rpc("referral_worklist_count", { p_kind: kind });
  if (error) throw error;
  return data ?? 0;
}

async function countReferralsNeedingUrgency(supabase: Client) {
  return referralCount(supabase, "needing_urgency");
}

async function countWaitlistedReferrals(supabase: Client) {
  return referralCount(supabase, "waitlisted");
}

/** A referral with an outcome on file (transcribed plan or uploaded
 * document) that hasn't been reviewed & closed yet — task spec §11.15. */
async function countReferralsAwaitingClosure(supabase: Client) {
  return referralCount(supabase, "awaiting_closure");
}

async function countOutreachTasks(supabase: Client, testPatientIds: readonly string[] = []) {
  const { count, error } = await excludeTestPatients(
    supabase
      .from("care_outreach_tasks")
      .select("id", { count: "exact", head: true })
      .in("status", ["open", "in_progress", "contacted"]),
    testPatientIds
  );
  if (error) throw error;
  return count ?? 0;
}

async function countAsyncConsults(supabase: Client, testPatientIds: readonly string[] = []) {
  const { count, error } = await excludeTestPatients(
    supabase
      .from("async_consults")
      .select("id", { count: "exact", head: true })
      .in("status", ["submitted", "in_review"]),
    testPatientIds
  );
  if (error) throw error;
  return count ?? 0;
}

async function countSecondOpinionRequests(supabase: Client) {
  // The same function the worklist page reads: a direct count is hidden by the S39b tie for a doctor who has not met the patient,
  // so the badge would disagree with the list.
  const { data, error } = await supabase.rpc("list_second_opinion_worklist");
  if (error) throw error;
  return Array.isArray(data) ? data.length : 0;
}

async function countPrescriptionRenewalRequests(supabase: Client, testPatientIds: readonly string[] = []) {
  const { count, error } = await excludeTestPatients(
    supabase
      .from("prescription_renewal_requests")
      .select("id", { count: "exact", head: true })
      .in("status", ["submitted", "in_review"]),
    testPatientIds
  );
  if (error) throw error;
  return count ?? 0;
}

async function countVerifiedDocumentRequests(supabase: Client, testPatientIds: readonly string[] = []) {
  const { count, error } = await excludeTestPatients(
    supabase
      .from("verified_documents")
      .select("id", { count: "exact", head: true })
      .eq("status", "requested"),
    testPatientIds
  );
  if (error) throw error;
  return count ?? 0;
}

async function countSeniorCaseReviews(supabase: Client, testPatientIds: readonly string[] = []) {
  const { count, error } = await excludeTestPatients(
    supabase
      .from("senior_case_reviews")
      .select("id", { count: "exact", head: true })
      .in("status", ["submitted", "in_review"]),
    testPatientIds
  );
  if (error) throw error;
  return count ?? 0;
}

async function countAdherenceAlerts(supabase: Client, testPatientIds: readonly string[] = []) {
  const { count, error } = await excludeTestPatients(
    supabase
      .from("medication_adherence_alerts")
      .select("id", { count: "exact", head: true })
      .neq("status", "resolved"),
    testPatientIds
  );
  if (error) throw error;
  return count ?? 0;
}

async function countMedicationReviews(supabase: Client, testPatientIds: readonly string[] = []) {
  const { count, error } = await excludeTestPatients(
    supabase
      .from("medication_reviews")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending"),
    testPatientIds
  );
  if (error) throw error;
  return count ?? 0;
}

async function countPreventiveReviews(supabase: Client, testPatientIds: readonly string[] = []) {
  const { count, error } = await excludeTestPatients(
    supabase
      .from("preventive_reviews")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending"),
    testPatientIds
  );
  if (error) throw error;
  return count ?? 0;
}

async function countAnnualReviews(supabase: Client, testPatientIds: readonly string[] = []) {
  const { count, error } = await excludeTestPatients(
    supabase
      .from("annual_reviews")
      .select("id", { count: "exact", head: true })
      .in("status", ["pending", "in_progress"]),
    testPatientIds
  );
  if (error) throw error;
  return count ?? 0;
}

async function countLifestyleReviews(supabase: Client, testPatientIds: readonly string[] = []) {
  const { count, error } = await excludeTestPatients(
    supabase
      .from("lpe_reviews")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending"),
    testPatientIds
  );
  if (error) throw error;
  return count ?? 0;
}

async function countLifestyleFlags(supabase: Client, testPatientIds: readonly string[] = []) {
  const { count, error } = await excludeTestPatients(
    supabase
      .from("lpe_red_flag_events")
      .select("id", { count: "exact", head: true })
      .eq("status", "open"),
    testPatientIds
  );
  if (error) throw error;
  return count ?? 0;
}

async function countCarePlanReviewPrompts(supabase: Client, testPatientIds: readonly string[] = []) {
  const { count, error } = await excludeTestPatients(
    supabase
      .from("care_plan_review_prompts")
      .select("id", { count: "exact", head: true })
      .eq("status", "open"),
    testPatientIds
  );
  if (error) throw error;
  return count ?? 0;
}

async function countRecommendations(supabase: Client, testPatientIds: readonly string[] = []) {
  const { count, error } = await excludeTestPatients(
    supabase
      .from("care_plan_recommendations")
      .select("id", { count: "exact", head: true })
      .eq("status", "proposed"),
    testPatientIds
  );
  if (error) throw error;
  return count ?? 0;
}

/** vaccination_records keys the patient as `profile_id`, not `patient_id`. */
async function countPendingVaccinationVerifications(supabase: Client, testPatientIds: readonly string[] = []) {
  const { count, error } = await excludeTestPatients(
    supabase
      .from("vaccination_records")
      .select("id", { count: "exact", head: true })
      .eq("verification_status", "pending_verification"),
    testPatientIds,
    { column: "profile_id" }
  );
  if (error) throw error;
  return count ?? 0;
}

async function countActiveCases(supabase: Client, testPatientIds: readonly string[] = []) {
  const { count, error } = await excludeTestPatients(
    supabase
      .from("care_management_cases")
      .select("id", { count: "exact", head: true })
      .eq("status", "active"),
    testPatientIds
  );
  if (error) throw error;
  return count ?? 0;
}

/** Exact same filter as useOperationsQueueAlerts (lib/queries/operations-queue.ts). */
async function countOperationsQueueAlerts(supabase: Client, testPatientIds: readonly string[] = []) {
  const { count, error } = await excludeTestPatients(
    supabase
      .from("clinician_alerts")
      .select("id", { count: "exact", head: true })
      .eq("status", "open"),
    testPatientIds
  );
  if (error) throw error;
  return count ?? 0;
}

/** Exact same filter as the results-inbox page's own "Awaiting action" count
 * (apps/web/src/app/(dashboard)/clinician/results-inbox/page.tsx). */
async function countResultsInboxAwaitingAction(supabase: Client, testPatientIds: readonly string[] = []) {
  const { count, error } = await excludeTestPatients(
    supabase
      .from("lab_result_documents")
      .select("id", { count: "exact", head: true })
      .neq("acknowledgement_status", "action_completed"),
    testPatientIds
  );
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
async function countPendingEcRequests(supabase: Client, testPatientIds: readonly string[] = []) {
  const { count, error } = await excludeTestPatients(
    supabase
      .from("emergency_contraception_requests")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending"),
    testPatientIds
  );
  if (error) throw error;
  return count ?? 0;
}

/** Exact same filter as safety-incidents-console.tsx's own "Open" tab
 * (`status !== "closed"`). Found a CRITICAL-severity incident sitting in
 * this queue with no badge anywhere pointing at it during the same audit
 * that found the emergency-contraception gap above. */
async function countOpenSafetyIncidents(supabase: Client, testPatientIds: readonly string[] = []) {
  const { count, error } = await excludeTestPatients(
    supabase
      .from("clinical_incident_reports")
      .select("id", { count: "exact", head: true })
      .neq("status", "closed"),
    testPatientIds, { nullable: true }
  );
  if (error) throw error;
  return count ?? 0;
}

/** Exact same filter as safeguarding/page.tsx's own `openCount`
 * (`status !== "closed"`). Restricted-visibility worklist (only a Senior
 * Medical Officer+ can move a concern into review or close it), but every
 * tier can see the queue -- see that page's own header comment -- so the
 * count is safe to show to every tier too. */
async function countOpenSafeguardingConcerns(supabase: Client, testPatientIds: readonly string[] = []) {
  const { count, error } = await excludeTestPatients(
    supabase
      .from("safeguarding_concerns")
      .select("id", { count: "exact", head: true })
      .neq("status", "closed"),
    testPatientIds
  );
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
async function countOpenMedicationDispenseFlags(supabase: Client, testPatientIds: readonly string[] = []) {
  const { count, error } = await excludeTestPatients(
    supabase
      .from("medication_dispense_flags")
      .select("id", { count: "exact", head: true })
      .neq("status", "resolved"),
    testPatientIds
  );
  if (error) throw error;
  return count ?? 0;
}

/** Exact same filter as useSupportTicketQueue (lib/queries/support-tickets.ts). */
async function countOpenSupportTickets(supabase: Client, testPatientIds: readonly string[] = []) {
  const { count, error } = await excludeTestPatients(
    supabase
      .from("support_tickets")
      .select("id", { count: "exact", head: true })
      .not("status", "in", "(resolved,closed)"),
    testPatientIds
  );
  if (error) throw error;
  return count ?? 0;
}

/** Exact same filter as useComplaintQueue (lib/queries/complaints.ts) --
 * every complaint short of governance_review, the point at which it moves
 * to a different reviewer and stops being this queue's job. */
async function countOpenComplaints(supabase: Client, testPatientIds: readonly string[] = []) {
  const { count, error } = await excludeTestPatients(
    supabase
      .from("complaints")
      .select("id", { count: "exact", head: true })
      .neq("status", "governance_review"),
    testPatientIds
  );
  if (error) throw error;
  return count ?? 0;
}

/** The same set as therapy-approvals/queue.tsx: requests for patients this
 * clinician holds a task for (S56, INV-12). A care coordinator gets 0 (the
 * function returns 0 for them). */
/**
 * Patients on the mental health follow-up worklist (S56b). A bare number from a function that counts only patients the caller is TIED to
 * (INV-12) and returns 0 for anyone else, for an unsigned configuration and while the guard is off, so the menu leaks no identity.
 */
async function countMentalHealthWorklistWaiting(supabase: Client) {
  const { data, error } = await supabase.rpc("count_mental_health_worklist");
  if (error) throw error;
  return typeof data === "number" ? data : 0;
}

async function countTherapyApprovalsWaiting(supabase: Client) {
  // S56: therapy bookings are per-patient (INV-12); the count is the requests this clinician holds a task for.
  const { data, error } = await supabase.rpc("count_therapy_approvals_waiting");
  if (error) throw error;
  return typeof data === "number" ? data : 0;
}

/**
 * Orders needing a home-visit provider assigned -- exact same predicate as
 * the "Home visits & pharmacy orders" page's LabOrdersWorklist (a lab order with
 * no home_visit_provider yet, in payment_confirmed or ordered status --
 * apps/web/src/app/(dashboard)/clinician/orders/page.tsx). That page also
 * has a second sub-worklist (pharmacy orders, read-only and collection only),
 * left uncounted here for the
 * same reason Medication issues leaves its second sub-worklist uncounted:
 * this file's counters issue exactly one query each,
 * and a home-visit collection blocks a diagnostic sample from ever being
 * taken -- the more clinically load-bearing of the two. Pharmacy orders stay
 * fully visible on the page itself, just not globally counted.
 *
 * Not yet excluding test patients (INV-13): this counter is owned by a
 * concurrent change to the home-visit worklist; apply excludeTestPatients
 * here once that lands rather than editing it twice.
 */
async function countLabOrdersAwaitingHomeVisitAssignment(supabase: Client) {
  // A self-arranged order (the patient takes the request to any laboratory and pays there, the default since 2026-08-03)
  // never needs a home-visit provider, so it must not be counted as waiting for one. On 2026-11-02 every open order on the
  // platform was self-arranged and the Chief Medical Officer's dashboard said "Home visit orders 56" for work that did not exist.
  const { count, error } = await supabase
    .from("lab_orders")
    .select("id", { count: "exact", head: true })
    .is("home_visit_provider_id", null)
    .neq("fulfilment", "self_arranged")
    .in("status", ["payment_confirmed", "ordered"]);
  if (error) throw error;
  return count ?? 0;
}

/** Exact same filter as useOrgLabResultConsultRequests
 * (lib/queries/lab-result-consult.ts) -- a paid consult request whose result
 * a doctor hasn't yet accepted a booking slot for. */
async function countLabResultConsultsWaiting(supabase: Client, testPatientIds: readonly string[] = []) {
  const { count, error } = await excludeTestPatients(
    supabase
      .from("lab_result_consult_requests")
      .select("id", { count: "exact", head: true })
      .in("status", ["payment_confirmed", "document_uploaded"]),
    testPatientIds
  );
  if (error) throw error;
  return count ?? 0;
}

/** Recognised FHIR Bundle entries from a partner import (labs/HMOs/hospitals
 * via POST /api/v1/fhir/import) waiting for a clinician to confirm, modify,
 * or dismiss them into the record -- see clinician/fhir-review. */
async function countFhirProposedResourcesPending(supabase: Client, testPatientIds: readonly string[] = []) {
  const { count, error } = await excludeTestPatients(
    supabase
      .from("fhir_import_proposed_resources")
      .select("id", { count: "exact", head: true })
      .eq("status", "proposed"),
    testPatientIds
  );
  if (error) throw error;
  return count ?? 0;
}

/** Patient requests to void or correct an allergy or a condition she entered herself, still waiting
 * for a tied doctor (S05b-d/e/f; one table, both record kinds) -- see clinician/record-changes. RLS on the request table already limits the
 * count to the requests this clinician may decide, so a Care Coordinator always sees 0. */
async function countRecordChangeRequestsWaiting(supabase: Client, testPatientIds: readonly string[] = []) {
  const { count, error } = await excludeTestPatients(
    supabase
      .from("patient_allergy_correction_requests")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending"),
    testPatientIds
  );
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
async function countPreventiveHealthCheckReviewsWaiting(supabase: Client, testPatientIds: readonly string[] = []) {
  const { count, error } = await excludeTestPatients(
    supabase
      .from("annual_health_checks")
      .select("id", { count: "exact", head: true })
      .not("review_requested_at", "is", null)
      .is("reviewed_at", null),
    testPatientIds
  );
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
  | "therapyApprovalsWaiting"
  | "careThreadsAwaitingReply"
  | "labOrdersAwaitingHomeVisitAssignment"
  | "labResultConsultsWaiting"
  | "fhirProposedResourcesPending"
  | "preventiveHealthCheckReviewsWaiting"
  | "curbsideConsultsAwaitingReply"
  | "recordChangeRequestsWaiting"
  | "mentalHealthWorklistWaiting";

/**
 * Exported so the "a broken query must never render as 0" invariant above is
 * testable for every counter at once (worklist-counts.test.ts), rather than
 * trusted to twenty near-identical copies of the same three lines.
 */
/**
 * The second argument is the INV-13 test-patient id list (lib/queries/real-patients.ts).
 * Every counter over a table with a `patient_id` column excludes those ids; a
 * counter backed by an RPC leaves the exclusion to the function. It defaults
 * to "nothing to exclude" so the generic tests above can still call a counter
 * with just a client.
 */
export const COUNTERS: Record<
  WorklistCountKey,
  (supabase: Client, testPatientIds?: readonly string[]) => Promise<number>
> = {
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
  therapyApprovalsWaiting: countTherapyApprovalsWaiting,
  mentalHealthWorklistWaiting: countMentalHealthWorklistWaiting,
  careThreadsAwaitingReply: countCareThreadsAwaitingReply,
  labOrdersAwaitingHomeVisitAssignment: countLabOrdersAwaitingHomeVisitAssignment,
  labResultConsultsWaiting: countLabResultConsultsWaiting,
  fhirProposedResourcesPending: countFhirProposedResourcesPending,
  preventiveHealthCheckReviewsWaiting: countPreventiveHealthCheckReviewsWaiting,
  curbsideConsultsAwaitingReply: countCurbsideConsultsAwaitingReply,
  recordChangeRequestsWaiting: countRecordChangeRequestsWaiting,
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
      // INV-13: one read of the test-patient list per run, shared by every counter, so a
      // staff member's badges never count a test account's work. Throws on failure like
      // every counter here, so a broken read shows as "could not be loaded", not as 0.
      const testPatientIds = await fetchTestPatientIds(supabase);
      const entries = await Promise.all(
        keys.map(async (key) => [key, await COUNTERS[key](supabase, testPatientIds)] as const)
      );
      return Object.fromEntries(entries) as Record<WorklistCountKey, number>;
    },
    refetchInterval: 60_000,
  });
}
