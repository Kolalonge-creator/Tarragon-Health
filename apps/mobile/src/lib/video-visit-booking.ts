import { supabase } from "./supabase";
import { postSelectVideoVisitAlternateSlot } from "./api";
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
 * consult_availability_slots time, pay (hand off to the web checkout for a
 * card payment), and only once
 * a doctor accepts (or offers, then the patient picks, an alternate time) is
 * a real video_consultations row created. See
 * 20260723120000_video_visit_requests.sql for the full model.
 *
 * All reads here are plain RLS-scoped client reads, same convention as every
 * other native screen's data layer (lib/appointments.ts, lib/video-visit.ts).
 * Picking an alternate slot needs a real Zoom meeting created via service
 * role, so it goes through the bearer-authenticated passthrough route in
 * api.ts, never a raw client RPC call — see its own comment below.
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

/** Narrows my_video_visit_price's jsonb answer; anything else is treated as "no price", never a guessed number. */
export function parseVideoVisitPrice(value: unknown): VideoVisitPrice | null {
  if (typeof value !== "object" || value === null) return null;
  const { amount_minor, currency } = value as Record<string, unknown>;
  if (typeof amount_minor !== "number" || !Number.isInteger(amount_minor) || amount_minor <= 0) return null;
  if (typeof currency !== "string" || currency.length === 0) return null;
  return { amount_minor, currency };
}

/** The price a video visit costs the caller: exactly what the charge trigger pins (organisation override, else the extra-meeting
 * product, else the platform row), read from the one database function both use, so the screen cannot show a different number from
 * the one charged. null when no price is set or it is switched off. Mirrors web's useVideoVisitPrice. */
export async function loadVideoVisitPrice(): Promise<QueryResult<VideoVisitPrice | null>> {
  const { data, error } = await supabase.rpc("my_video_visit_price");
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: parseVideoVisitPrice(data) };
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
