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
  answerer: { full_name: string } | null;
};

type ConsultAnswerer = NonNullable<AsyncConsultWithAnswerer["answerer"]>;

/**
 * `answered_by` used to be embedded directly via
 * `clinical_staff!async_consults_answered_by_fkey(...)` — a PostgREST
 * embedded join, which resolves against `clinical_staff`'s OWN RLS, not this
 * query's own. Since 2026-09-25 (see
 * 20260925015430_restrict_clinical_staff_patient_read_to_safe_columns.sql)
 * that policy no longer admits a patient session, so the embed would
 * silently come back null for every patient viewing their own answered
 * consult. Fetching the answerer separately from
 * public.clinical_staff_directory (the safe-column view every
 * patient-facing clinical_staff read now uses) restores the same
 * attribution without reopening the column-exposure gap that migration
 * fixed. Mirrors apps/web/src/lib/queries/async-consults.ts's
 * fetchAnswerers.
 */
async function fetchAnswerers(answererIds: string[]): Promise<Map<string, ConsultAnswerer>> {
  const answererById = new Map<string, ConsultAnswerer>();
  if (answererIds.length === 0) return answererById;
  const { data, error } = await supabase.from("clinical_staff_directory").select("id, full_name").in("id", answererIds);
  if (error) throw error;
  for (const row of data ?? []) {
    if (!row.id) continue;
    answererById.set(row.id, { full_name: row.full_name ?? "" });
  }
  return answererById;
}

export const ASYNC_CONSULT_CATEGORIES: { value: string; label: string }[] = [
  { value: "medication", label: "A question about my medicines" },
  { value: "symptom", label: "A symptom I'm unsure about" },
  { value: "results", label: "Understanding a result" },
  { value: "lifestyle", label: "Diet, exercise or lifestyle" },
  { value: "general", label: "Something else" },
];

export const ASK_A_DOCTOR_CREDIT_REQUIRED_MARKER = "Ask a doctor";

/** The service_products code a question spends when the patient has no
 * plan-based 'async_doctor_visit' feature access — see
 * private.enforce_async_consult_entitlement_or_credit and
 * platform-credit.ts's trySpendPlatformCreditForService. */
export const ASYNC_CONSULT_CREDIT_CODE = "async_consult_credit";

export async function loadMyAsyncConsults(patientId: string): Promise<QueryResult<AsyncConsultWithAnswerer[]>> {
  try {
    const { data, error } = await supabase
      .from("async_consults")
      .select("*")
      .eq("patient_id", patientId)
      .order("created_at", { ascending: false })
      .limit(10);
    if (error) return { ok: false, error: error.message };

    const rows = data ?? [];
    const answererIds = Array.from(new Set(rows.map((row) => row.answered_by).filter((id): id is string => !!id)));
    const answererById = await fetchAnswerers(answererIds);

    return {
      ok: true,
      data: rows.map((row) => ({
        ...row,
        answerer: row.answered_by ? (answererById.get(row.answered_by) ?? null) : null,
      })) as AsyncConsultWithAnswerer[],
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
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
