import type { WorklistCountKey } from "./worklist-counts";

/**
 * A founder-commissioned launch-scope audit's core clinician-side ask: reduce
 * the default view from ~50 separate `/clinician/*` destinations to 3
 * priority buckets (Urgent now / Paid-funded work due / Follow-up & quality).
 * Deliberately additive, not a nav rewrite — every page in navigation.ts
 * stays reachable exactly as it is today ("All other specialist queues
 * remain accessible to authorised staff but should not be default navigation
 * or launch KPIs" is the audit's own wording); this file only adds a
 * classification of the existing worklist-counts.ts keys so a summary view
 * can group them, and a page-link for each so that summary is clickable.
 *
 * `Record<WorklistCountKey, ...>` rather than three plain arrays: TypeScript
 * itself refuses to compile if a key is missing from this map, which is the
 * actual guarantee that matters here — a worklist silently left out of every
 * bucket would be invisible from the launch summary with no error anywhere.
 */
export type LaunchWorklistBucket = "urgent" | "paidWorkDue" | "followUp";

export const LAUNCH_WORKLIST_BUCKET: Record<WorklistCountKey, LaunchWorklistBucket> = {
  // Urgent now — time-critical clinical risk: emergencies, safety, abnormal
  // results, the tightest SLAs on the platform.
  escalations: "urgent",
  pendingEcRequests: "urgent",
  openSafetyIncidents: "urgent",
  openSafeguardingConcerns: "urgent",
  resultsInboxAwaitingAction: "urgent",

  // Paid/funded work due — a patient (or a sponsor/voucher) has paid for a
  // specific piece of clinician time and is waiting on it. Each key here has
  // a real service_products row with a price_kobo behind it (async consult,
  // second opinion, prescription renewal, verified document, senior case
  // review, a lab result consult, a Preventive Health Check Review,
  // a therapy approval) — this is a deliberately narrower test than "a
  // doctor owes someone a reply," which is why curbside consults (free
  // doctor-to-doctor messaging, no
  // service_products row at all, see curbside-consults' own page header) is
  // classified under Follow-up & quality below instead, not here.
  asyncConsults: "paidWorkDue",
  secondOpinionRequests: "paidWorkDue",
  prescriptionRenewalRequests: "paidWorkDue",
  verifiedDocumentRequests: "paidWorkDue",
  seniorCaseReviews: "paidWorkDue",
  labResultConsultsWaiting: "paidWorkDue",
  preventiveHealthCheckReviewsWaiting: "paidWorkDue",
  therapyApprovalsWaiting: "paidWorkDue",

  // Follow-up & quality — everything else: condition-programme reviews,
  // outreach/adherence, referrals, operational/support queues, governance
  // feeds, and free collegial channels. Real work, but neither an acute
  // risk nor a specific unmet payment — the audit's own "quality and
  // growth" framing.
  curbsideConsultsAwaitingReply: "followUp",
  referralsNeedingUrgency: "followUp",
  waitlistedReferrals: "followUp",
  referralsAwaitingClosure: "followUp",
  outreach: "followUp",
  adherenceAlerts: "followUp",
  medicationReviews: "followUp",
  preventiveReviews: "followUp",
  annualReviews: "followUp",
  lifestyleReviews: "followUp",
  lifestyleFlags: "followUp",
  carePlanReviewPrompts: "followUp",
  recommendations: "followUp",
  vaccinationVerifications: "followUp",
  activeCases: "followUp",
  operationsQueueAlerts: "followUp",
  openMedicationDispenseFlags: "followUp",
  openSupportTickets: "followUp",
  openComplaints: "followUp",
  unreadSupportMessages: "followUp",
  careThreadsAwaitingReply: "followUp",
  labOrdersAwaitingHomeVisitAssignment: "followUp",
  fhirProposedResourcesPending: "followUp",
};

export const LAUNCH_WORKLIST_BUCKET_LABEL: Record<LaunchWorklistBucket, string> = {
  urgent: "Urgent now",
  paidWorkDue: "Paid/funded work due",
  followUp: "Follow-up & quality",
};

/** Every item's own worklist page — same hrefs as navigation.ts, kept as a
 * flat lookup here rather than importing navigation.ts's full nav-section
 * tree into a client component for one field. */
export const WORKLIST_HREF: Record<WorklistCountKey, string> = {
  escalations: "/clinician/escalations",
  pendingEcRequests: "/clinician/sexual-health",
  openSafetyIncidents: "/clinician/safety-incidents",
  openSafeguardingConcerns: "/clinician/safeguarding",
  resultsInboxAwaitingAction: "/clinician/results-inbox",
  asyncConsults: "/clinician/async-consults",
  secondOpinionRequests: "/clinician/second-opinions",
  prescriptionRenewalRequests: "/clinician/prescription-renewals",
  verifiedDocumentRequests: "/clinician/verified-documents",
  seniorCaseReviews: "/clinician/senior-case-reviews",
  curbsideConsultsAwaitingReply: "/clinician/curbside-consults",
  labResultConsultsWaiting: "/clinician/lab-result-consults",
  preventiveHealthCheckReviewsWaiting: "/clinician/preventive-health-check-reviews",
  therapyApprovalsWaiting: "/clinician/therapy-approvals",
  referralsNeedingUrgency: "/clinician/referrals",
  waitlistedReferrals: "/clinician/referrals/waitlisted",
  // Not its own nav destination — a filtered state of the referrals page.
  referralsAwaitingClosure: "/clinician/referrals",
  outreach: "/clinician/outreach",
  adherenceAlerts: "/clinician/adherence",
  medicationReviews: "/clinician/medication-reviews",
  preventiveReviews: "/clinician/preventive-reviews",
  annualReviews: "/clinician/annual-reviews",
  lifestyleReviews: "/clinician/lifestyle-reviews",
  lifestyleFlags: "/clinician/lifestyle-flags",
  carePlanReviewPrompts: "/clinician/care-plan-review",
  recommendations: "/clinician/recommendations",
  vaccinationVerifications: "/clinician/vaccinations",
  activeCases: "/clinician/case-management",
  operationsQueueAlerts: "/clinician/operations-queue",
  openMedicationDispenseFlags: "/clinician/medication-issues",
  openSupportTickets: "/clinician/support-tickets",
  openComplaints: "/clinician/complaints",
  unreadSupportMessages: "/clinician/support-inbox",
  careThreadsAwaitingReply: "/clinician/messages",
  labOrdersAwaitingHomeVisitAssignment: "/clinician/orders",
  fhirProposedResourcesPending: "/clinician/fhir-review",
};

/** Human label for each worklist item, for the summary's breakdown list —
 * same wording as navigation.ts's own nav-item labels. */
export const WORKLIST_LABEL: Record<WorklistCountKey, string> = {
  escalations: "Escalations",
  pendingEcRequests: "Emergency contraception requests",
  openSafetyIncidents: "Safety incidents",
  openSafeguardingConcerns: "Safeguarding concerns",
  resultsInboxAwaitingAction: "Results inbox",
  asyncConsults: "Async consults",
  secondOpinionRequests: "Second opinions",
  prescriptionRenewalRequests: "Prescription renewals",
  verifiedDocumentRequests: "Verified documents",
  seniorCaseReviews: "Senior case reviews",
  curbsideConsultsAwaitingReply: "Curbside consults",
  labResultConsultsWaiting: "Lab result consults",
  preventiveHealthCheckReviewsWaiting: "Preventive Health Check reviews",
  therapyApprovalsWaiting: "Therapy approvals",
  referralsNeedingUrgency: "Referrals",
  waitlistedReferrals: "Waitlisted referrals",
  referralsAwaitingClosure: "Referrals awaiting closure",
  outreach: "Outreach tasks",
  adherenceAlerts: "Adherence alerts",
  medicationReviews: "Medication reviews",
  preventiveReviews: "Preventive reviews",
  annualReviews: "Annual reviews",
  lifestyleReviews: "Lifestyle reviews",
  lifestyleFlags: "Lifestyle flags",
  carePlanReviewPrompts: "Care plan reviews",
  recommendations: "Recommendations",
  vaccinationVerifications: "Vaccination verifications",
  activeCases: "Active cases",
  operationsQueueAlerts: "Operations queue",
  openMedicationDispenseFlags: "Medication issues",
  openSupportTickets: "Support tickets",
  openComplaints: "Complaints",
  unreadSupportMessages: "Support inbox",
  careThreadsAwaitingReply: "Patient messages",
  labOrdersAwaitingHomeVisitAssignment: "Home visit orders",
  fhirProposedResourcesPending: "FHIR imports",
};

const ALL_KEYS = Object.keys(LAUNCH_WORKLIST_BUCKET) as WorklistCountKey[];

export function worklistKeysInBucket(bucket: LaunchWorklistBucket): WorklistCountKey[] {
  return ALL_KEYS.filter((key) => LAUNCH_WORKLIST_BUCKET[key] === bucket);
}
