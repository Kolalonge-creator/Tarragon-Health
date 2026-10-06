import { supabase } from "./supabase";
import type { QueryResult } from "./medications";
import type { Tables, Enums } from "@tarragon/shared";

// ---------------------------------------------------------------------------
// The written-question ("Ask your care team") flow moved to
// ./written-questions/ and ./patient-notes.ts in S22. Patients can no longer
// read async_consults directly; every read and write there goes through the
// database functions. Only the marker below stays, because other credit-gated
// services (second opinion, senior case review) cite it in their comments.
// ---------------------------------------------------------------------------

export const ASK_A_DOCTOR_CREDIT_REQUIRED_MARKER = "Ask a doctor";

// ---------------------------------------------------------------------------
// Navigation requests — "I need help with something" (non-clinical: booking,
// pharmacy, labs, insurance, referral, payment, technical). Mirrors
// apps/web/src/app/(dashboard)/patient/navigation-requests.tsx.
// ---------------------------------------------------------------------------

export type NavigationRequest = Tables<"navigation_requests">;
export type NavigationRequestCategory = Enums<"navigation_request_category">;
export type NavigationRequestStatus = Enums<"navigation_request_status">;

export const NAVIGATION_REQUEST_CATEGORIES: NavigationRequestCategory[] = [
  "appointment",
  "pharmacy",
  "laboratory",
  "insurance",
  "referral",
  "payment",
  "technical",
  "other",
];

export const NAVIGATION_REQUEST_CATEGORY_LABEL: Record<NavigationRequestCategory, string> = {
  appointment: "Appointment",
  pharmacy: "Pharmacy",
  laboratory: "Laboratory",
  insurance: "Insurance",
  referral: "Referral",
  payment: "Payment",
  technical: "Technical",
  other: "Something else",
};

export const NAVIGATION_REQUEST_STATUS_LABEL: Record<NavigationRequestStatus, string> = {
  open: "Open",
  waiting_on_provider: "Waiting on provider",
  waiting_on_patient: "Waiting on patient",
  resolved: "Resolved",
};

export async function loadMyNavigationRequests(patientId: string): Promise<QueryResult<NavigationRequest[]>> {
  const { data, error } = await supabase
    .from("navigation_requests")
    .select("*")
    .eq("patient_id", patientId)
    .order("created_at", { ascending: false });
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: data as NavigationRequest[] };
}

/** create_navigation_request RPC — organisation_id/classification are
 * server-derived, same reasoning as the web hook's own comment. */
export async function createNavigationRequest(input: {
  patientId: string;
  category: NavigationRequestCategory;
  description: string;
  isComplaint: boolean;
}): Promise<QueryResult<null>> {
  if (input.description.trim().length < 10) {
    return { ok: false, error: "Tell us a bit more about what you need" };
  }
  const { error } = await supabase.rpc("create_navigation_request", {
    p_category: input.category,
    p_description: input.description,
    p_is_complaint: input.isComplaint,
    p_patient_id: input.patientId,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: null };
}

export async function submitNavigationRequestFeedback(
  requestId: string,
  rating: number
): Promise<QueryResult<null>> {
  const { error } = await supabase.rpc("submit_navigation_request_feedback", {
    p_request_id: requestId,
    p_rating: rating,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: null };
}
