import { supabase } from "./supabase";
import type { QueryResult } from "./medications";
import type { Tables } from "@tarragon/shared";

/**
 * Native equivalent of apps/web/.../patient/video-visit/[consultationId] --
 * scoped down from the web page: joining itself is already native and
 * working (Overview's "Join call" banner, see getUpcomingVideoVisit in
 * overview.ts), so this covers what Overview's compact card doesn't --
 * full visit details, prep notes, the published post-visit summary, and
 * reporting a technical problem. Deliberately NOT porting the web page's
 * live getUserMedia camera/mic device test: Zoom's own client does its own
 * device check on join, and a native camera/mic preview here is out of
 * proportion to the value -- same reasoning noted in
 * docs/MOBILE_REMAINING_SCREENS_PLAN.md.
 */
export type VideoConsultation = Pick<
  Tables<"video_consultations">,
  "id" | "patient_id" | "scheduled_at" | "join_url" | "status" | "patient_prep_notes"
>;

export async function loadVideoConsultation(consultationId: string): Promise<QueryResult<VideoConsultation | null>> {
  const { data, error } = await supabase
    .from("video_consultations")
    .select("id, patient_id, scheduled_at, join_url, status, patient_prep_notes")
    .eq("id", consultationId)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  return { ok: true, data };
}

export type ConsultationSummary = Tables<"consultation_patient_summaries">;

export async function loadConsultationSummary(consultationId: string): Promise<QueryResult<ConsultationSummary | null>> {
  const { data, error } = await supabase
    .from("consultation_patient_summaries")
    .select("*")
    .eq("video_consultation_id", consultationId)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  return { ok: true, data };
}

/** Mirrors apps/web/.../patient/video-visit-actions.ts's submitConsultationPrep
 * -- same RPC, so the same 1000-char server-side cap applies regardless of
 * what this client sends. */
export async function submitConsultationPrep(consultationId: string, notes: string): Promise<{ error?: string }> {
  const { error } = await supabase.rpc("submit_consultation_prep", {
    p_consultation_id: consultationId,
    p_notes: notes,
  });
  return error ? { error: error.message } : {};
}
