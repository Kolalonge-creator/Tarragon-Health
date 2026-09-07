import { supabase } from "./supabase";
import type { QueryResult } from "./medications";
import type { Tables, Enums } from "@tarragon/shared";

// ---------------------------------------------------------------------------
// Ask a doctor — async written Q&A. Mirrors apps/web/src/app/(dashboard)/
// patient/ask-a-doctor.tsx. A plain insert, not a two-step RPC: the credit/
// plan-access gate lives in a BEFORE INSERT trigger on async_consults
// (20260831164640_async_consult_credit_gate.sql), which raises a specific,
// catchable error when neither is available — this file never duplicates
// that check, it only recognises the error text to offer buying a credit in
// the system browser instead (no Paystack secret key exists on this app).
// ---------------------------------------------------------------------------

export type AsyncConsult = Tables<"async_consults">;
export type AsyncConsultWithAnswerer = AsyncConsult & {
  answerer: { full_name: string; credential_type: string | null; credential_number: string | null } | null;
};

export const ASYNC_CONSULT_CATEGORIES: { value: string; label: string }[] = [
  { value: "medication", label: "A question about my medicines" },
  { value: "symptom", label: "A symptom I'm unsure about" },
  { value: "results", label: "Understanding a result" },
  { value: "lifestyle", label: "Diet, exercise or lifestyle" },
  { value: "general", label: "Something else" },
];

export const ASK_A_DOCTOR_CREDIT_REQUIRED_MARKER = "Ask a doctor";

export async function loadMyAsyncConsults(patientId: string): Promise<QueryResult<AsyncConsultWithAnswerer[]>> {
  const { data, error } = await supabase
    .from("async_consults")
    .select(
      "*, answerer:clinical_staff!async_consults_answered_by_fkey(full_name, credential_type, credential_number)"
    )
    .eq("patient_id", patientId)
    .order("created_at", { ascending: false })
    .limit(10);
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: data as AsyncConsultWithAnswerer[] };
}

export async function submitAsyncConsult(input: {
  patientId: string;
  organisationId: string;
  category: string;
  question: string;
  durationNote?: string;
}): Promise<QueryResult<null>> {
  const { error } = await supabase.from("async_consults").insert({
    patient_id: input.patientId,
    organisation_id: input.organisationId,
    category: input.category,
    question: input.question,
    duration_note: input.durationNote || null,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: null };
}

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
