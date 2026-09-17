import { supabase } from "./supabase";
import { postVideoVisitRequestWithPlatformCredit, postSelectVideoVisitAlternateSlot } from "./api";
import type { QueryResult } from "./medications";
import type { Tables } from "@tarragon/shared";

/**
 * Native slot-pick-and-pay booking for a Video Visit — mirrors
 * apps/web/src/lib/queries/consult-slots.ts and
 * apps/web/src/app/(dashboard)/patient/{book-video-visit.tsx,video-visit-
 * actions.ts}. This is a DIFFERENT lifecycle from lib/appointments.ts's
 * hold_appointment_slot/confirm_appointment_booking flow (an instant
 * hold-then-confirm against the `appointments` table) — video_visit_requests
 * is a HELD-payment, doctor-acceptance model: request a published
 * consult_availability_slots time, pay (here: reserve against platform
 * credit, or hand off to the web checkout for a card payment), and only once
 * a doctor accepts (or offers, then the patient picks, an alternate time) is
 * a real video_consultations row created. See
 * 20260723120000_video_visit_requests.sql and the platform-credit migrations
 * this ships alongside (20260917230244/230328/230403) for the full model.
 *
 * All reads here are plain RLS-scoped client reads, same convention as every
 * other native screen's data layer (lib/appointments.ts, lib/video-visit.ts).
 * The two writes that need more than the mobile client's own RLS-scoped
 * session (spending platform credit is deferred to acceptance, so the
 * request-time call is safe directly — but reserving a request needs a
 * service-role-adjacent RPC in one atomic step, and picking an alternate
 * slot needs a real Zoom meeting created via service role) go through the
 * bearer-authenticated passthrough routes in api.ts, never a raw client RPC
 * call for those two — see each function's own comment below.
 */

export type ConsultSlot = Tables<"consult_availability_slots">;
export type ConsultSlotWithClinician = ConsultSlot & { clinician: { full_name: string | null } | null };
export type VideoVisitRequest = Tables<"video_visit_requests">;
export type ProposedSlot = { id: string; slot_start: string };
export type VideoVisitRequestWithSlots = VideoVisitRequest & {
  slot: { slot_start: string } | null;
  proposedSlots: ProposedSlot[];
};
export type VideoVisitPrice = { amount_minor: number; currency: string };

/** Open, future slots in the caller's org — RLS already restricts a patient
 * to exactly these rows; mirrors web's useOpenConsultSlots. */
export async function loadOpenVideoVisitSlots(): Promise<QueryResult<ConsultSlotWithClinician[]>> {
  const { data, error } = await supabase
    .from("consult_availability_slots")
    .select("*, clinician:profiles!consult_availability_slots_clinician_profile_id_fkey(full_name)")
    .is("booked_consultation_id", null)
    .gt("slot_start", new Date().toISOString())
    .order("slot_start", { ascending: true })
    .limit(30);
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: data as ConsultSlotWithClinician[] };
}

/** The price a video visit costs the caller — org override if one exists and
 * is enabled, else the platform default. Mirrors web's useVideoVisitPrice. */
export async function loadVideoVisitPrice(organisationId: string): Promise<QueryResult<VideoVisitPrice | null>> {
  const { data, error } = await supabase
    .from("video_visit_prices")
    .select("organisation_id, amount_minor, currency, is_enabled")
    .eq("is_enabled", true);
  if (error) return { ok: false, error: error.message };
  const rows = data ?? [];
  const override = rows.find((r) => r.organisation_id !== null && r.organisation_id === organisationId);
  return { ok: true, data: override ?? rows.find((r) => r.organisation_id === null) ?? null };
}

/** proposed_slot_ids is a plain uuid[], not something PostgREST can
 * embed-join — resolved with one follow-up query, mirrors web's
 * resolveProposedSlots. */
async function resolveProposedSlots(
  rows: { proposed_slot_ids: string[] | null }[]
): Promise<QueryResult<Map<string, ProposedSlot>>> {
  const ids = [...new Set(rows.flatMap((r) => r.proposed_slot_ids ?? []))];
  if (ids.length === 0) return { ok: true, data: new Map() };
  const { data, error } = await supabase.from("consult_availability_slots").select("id, slot_start").in("id", ids);
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: new Map((data ?? []).map((s) => [s.id, s])) };
}

/** The patient's own video-visit requests, newest first — mirrors web's
 * useMyVideoVisitRequests. */
export async function loadMyVideoVisitRequests(
  patientId: string
): Promise<QueryResult<VideoVisitRequestWithSlots[]>> {
  const { data, error } = await supabase
    .from("video_visit_requests")
    .select("*, slot:consult_availability_slots!video_visit_requests_slot_id_fkey(slot_start)")
    .eq("patient_id", patientId)
    .order("created_at", { ascending: false })
    .limit(10);
  if (error) return { ok: false, error: error.message };
  const rows = data as (VideoVisitRequest & { slot: { slot_start: string } | null })[];
  const resolved = await resolveProposedSlots(rows);
  if (!resolved.ok) return resolved;
  const bySlotId = resolved.data;
  return {
    ok: true,
    data: rows.map((r) => ({
      ...r,
      proposedSlots: (r.proposed_slot_ids ?? [])
        .map((id) => bySlotId.get(id))
        .filter((s): s is ProposedSlot => !!s),
    })),
  };
}

/**
 * Reserves a published slot against the patient's platform credit balance.
 * Goes through /api/mobile/platform-credit/video-visit-request rather than
 * a raw client insert + RPC call: creating the request row and calling
 * confirm_video_visit_request_on_platform_credit is the same two-step
 * sequence the web server action runs, and keeping it server-side (still
 * under the caller's own RLS, never service role — see that route's own
 * comment) means a half-created, unpaid request is always cleaned up in the
 * same place regardless of which client called it, rather than duplicating
 * that cleanup logic here. Nothing is actually spent by this call — see the
 * module header.
 */
export async function requestVideoVisitWithPlatformCredit(
  slotId: string,
  note?: string
): Promise<QueryResult<{ requestId: string; amountKobo: number }>> {
  const result = await postVideoVisitRequestWithPlatformCredit(slotId, note);
  if (result.ok) {
    return { ok: true, data: { requestId: result.request_id, amountKobo: result.amount_kobo } };
  }
  return { ok: false, error: result.error };
}

/** Patient withdraws a request that hasn't been paid yet (RLS-enforced —
 * mirrors web's cancelVideoVisitRequest, a plain delete under RLS with no
 * side effects worth a route). */
export async function cancelVideoVisitRequest(requestId: string): Promise<QueryResult<null>> {
  const { error } = await supabase
    .from("video_visit_requests")
    .delete()
    .eq("id", requestId)
    .in("status", ["requested", "pending_payment"]);
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: null };
}

/**
 * Patient picks one of the doctor's proposed alternate times. Goes through
 * /api/mobile/video-visits/select-alternate-slot rather than calling
 * select_video_visit_alternate_slot directly: the RPC itself is a safe
 * direct call, but booking happens atomically with creating a real Zoom
 * meeting and sending the patient/doctor confirmation, both of which need a
 * service-role client this app doesn't have — see that route's own comment.
 */
export async function selectVideoVisitAlternateSlot(
  requestId: string,
  slotId: string
): Promise<QueryResult<string>> {
  const result = await postSelectVideoVisitAlternateSlot(requestId, slotId);
  if (!result.success || !result.consultationId) {
    return { ok: false, error: result.error ?? "Could not book that time." };
  }
  return { ok: true, data: result.consultationId };
}
