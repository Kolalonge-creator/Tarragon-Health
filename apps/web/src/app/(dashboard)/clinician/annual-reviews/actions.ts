"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const proposeSchema = z.object({
  reviewId: z.string().uuid(),
  // 1–3 ISO datetimes the clinician offers the patient.
  slots: z.array(z.string().datetime()).min(1).max(3),
});

export type ProposeConsultState = { error: string } | { success: true } | undefined;

/**
 * Clinician proposes candidate video-consult slots for an annual review. The
 * patient confirms one in-app (confirmAnnualReviewSlot) — that's the
 * day/time handshake, no live calendar needed. We create the
 * video_consultations row now with proposed_slots + no scheduled_at (= awaiting
 * the patient's pick) and link it to the review; the Zoom meeting itself is
 * created only once the slot is agreed. RLS (private.is_org_staff) is the gate.
 */
export async function proposeAnnualReviewConsult(
  reviewId: string,
  slots: string[],
): Promise<ProposeConsultState> {
  const parsed = proposeSchema.safeParse({ reviewId, slots });
  if (!parsed.success) {
    return { error: "Pick 1–3 valid times." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Not signed in" };
  }

  const { data: review } = await supabase
    .from("annual_reviews")
    .select("id, organisation_id, patient_id, video_consultation_id")
    .eq("id", parsed.data.reviewId)
    .maybeSingle();
  if (!review) {
    return { error: "Annual review not found or not in your organisation" };
  }

  const { data: consult, error: insertError } = await supabase
    .from("video_consultations")
    .insert({
      organisation_id: review.organisation_id,
      patient_id: review.patient_id,
      context: "annual_review",
      annual_review_id: review.id,
      initiated_by: user.id,
      proposed_slots: parsed.data.slots,
    })
    .select("id")
    .single();
  if (insertError || !consult) {
    return { error: insertError?.message ?? "Could not create the consultation" };
  }

  const { error: linkError } = await supabase
    .from("annual_reviews")
    .update({ video_consultation_id: consult.id, current_stage: "video_consult", status: "in_progress" })
    .eq("id", review.id);
  if (linkError) {
    return { error: linkError.message };
  }

  return { success: true };
}

const addWorkupSchema = z.object({
  reviewId: z.string().uuid(),
  code: z.string().min(1),
});

export type AddWorkupState = { error: string } | { success: true } | undefined;

/**
 * Clinician adds a catalogue workup item the age/sex auto-seed skipped (or that
 * was removed). Insert is RLS-gated to org staff; the label is copied from the
 * catalogue so it can never drift from a client-supplied string.
 */
export async function addWorkupItem(reviewId: string, code: string): Promise<AddWorkupState> {
  const parsed = addWorkupSchema.safeParse({ reviewId, code });
  if (!parsed.success) {
    return { error: "Invalid item" };
  }

  const supabase = await createClient();

  const { data: review } = await supabase
    .from("annual_reviews")
    .select("id, organisation_id")
    .eq("id", parsed.data.reviewId)
    .maybeSingle();
  if (!review) {
    return { error: "Annual review not found or not in your organisation" };
  }

  const { data: catalogue } = await supabase
    .from("annual_review_workup_catalogue")
    .select("code, label")
    .eq("code", parsed.data.code)
    .maybeSingle();
  if (!catalogue) {
    return { error: "Unknown workup item" };
  }

  const { error } = await supabase.from("annual_review_workup_items").insert({
    annual_review_id: review.id,
    organisation_id: review.organisation_id,
    code: catalogue.code,
    label: catalogue.label,
  });
  if (error) {
    // 23505 = the item is already on this review.
    return { error: error.code === "23505" ? "That item is already on the review." : error.message };
  }

  return { success: true };
}
