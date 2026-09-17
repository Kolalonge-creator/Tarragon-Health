"use server";

import { z } from "zod";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { initiateBookingCheckout } from "@/lib/billing/booking-checkout";
import { createMeeting } from "@/lib/zoom/meetings";
import { isZoomConfigured } from "@/lib/zoom/client";
import { sendVideoConsultBookedConfirmation } from "@/lib/notifications/video-consult-confirmation";
import type { Currency } from "@tarragon/shared";

const requestSchema = z.object({
  slotId: z.string().uuid(),
  note: z.string().trim().max(500).optional(),
});

export type RequestVideoVisitState = { error: string } | undefined;

/**
 * Shared preamble for both payment paths below: parse the form, resolve the
 * signed-in patient + org, re-check (RLS-visibly) that the slot is still
 * open, then insert the video_visit_requests row. private.pin_video_visit_
 * amount() (a BEFORE INSERT trigger) pins amount_minor/currency from the
 * price book server-side — nothing the client sends ever sets the price —
 * and resets status/origin/payment_provider* to their pre-payment defaults
 * regardless of what's in the insert payload.
 *
 * Returns either the inserted row (id/amount_minor/currency) or a
 * RequestVideoVisitState error to return straight from the caller.
 */
async function insertVideoVisitRequestRow(formData: FormData): Promise<
  | {
      ok: true;
      requestId: string;
      amountMinor: number;
      currency: string;
      organisationId: string;
      patientId: string;
      email: string;
    }
  | { ok: false; error: RequestVideoVisitState }
> {
  const parsed = requestSchema.safeParse({
    slotId: String(formData.get("slot_id") ?? ""),
    note: String(formData.get("note") ?? "") || undefined,
  });
  if (!parsed.success) {
    return { ok: false, error: { error: "Pick a time first" } };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!user.email) {
    return { ok: false, error: { error: "Your account needs an email on file to check out." } };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("organisation_id")
    .eq("id", user.id)
    .single();
  if (!profile?.organisation_id) {
    return { ok: false, error: { error: "Your account has no organisation on file." } };
  }

  // RLS-visible check that the slot is still open before taking payment.
  const { data: slot } = await supabase
    .from("consult_availability_slots")
    .select("id, slot_start")
    .eq("id", parsed.data.slotId)
    .maybeSingle();
  if (!slot) {
    return { ok: false, error: { error: "That time is no longer available, pick another slot." } };
  }

  const { data: request, error: insertError } = await supabase
    .from("video_visit_requests")
    .insert({
      organisation_id: profile.organisation_id,
      patient_id: user.id,
      slot_id: parsed.data.slotId,
      note: parsed.data.note ?? null,
    })
    .select("id, amount_minor, currency")
    .single();
  if (insertError || !request) {
    return { ok: false, error: { error: insertError?.message ?? "Could not create the request." } };
  }

  return {
    ok: true,
    requestId: request.id,
    amountMinor: request.amount_minor,
    currency: request.currency,
    organisationId: profile.organisation_id,
    patientId: user.id,
    email: user.email,
  };
}

/**
 * Patient requests a paid video visit for a published slot: a
 * video_visit_requests row is created (amount pinned server-side by the DB
 * trigger from the price book — nothing the client sends sets the price) and
 * the browser is redirected to hosted checkout. The captured payment is HELD:
 * 'payment_confirmed' only puts the request in front of a doctor — the visit
 * is booked exclusively by a doctor accepting it, and a declined/unaccepted
 * request is refunded in full. Capitated org members skip payment but still
 * wait for doctor acceptance like everyone else.
 */
export async function requestVideoVisit(
  _prev: RequestVideoVisitState,
  formData: FormData
): Promise<RequestVideoVisitState> {
  const inserted = await insertVideoVisitRequestRow(formData);
  if (!inserted.ok) return inserted.error;

  const origin = (await headers()).get("origin") ?? process.env.NEXT_PUBLIC_SITE_URL ?? "";
  const result = await initiateBookingCheckout({
    orderType: "video_visit",
    orderId: inserted.requestId,
    organisationId: inserted.organisationId,
    patientId: inserted.patientId,
    amountKobo: inserted.amountMinor,
    currency: inserted.currency as Currency,
    email: inserted.email,
    description: "Tarragon Health: video visit with a doctor",
    callbackUrl: `${origin}/patient`,
  });

  if (!result.ok) {
    return { error: result.error };
  }
  redirect(result.checkoutUrl);
}

/**
 * Platform-credit twin of requestVideoVisit above. Same insert, same price
 * pinning — but instead of an external Paystack redirect, this calls
 * confirm_video_visit_request_on_platform_credit, which only CHECKS the
 * caller's platform credit balance covers the pinned price and, if so,
 * flips status straight to 'payment_confirmed' (payment_provider=
 * 'platform_credit', payment_provider_ref left null). Nothing is actually
 * spent yet — see that migration's header for why: the real spend is
 * deferred to the moment a doctor accepts (private.pay_video_visit_
 * request_on_platform_credit, called from accept_video_visit_request /
 * select_video_visit_alternate_slot). If the balance check fails, the
 * half-created request row is deleted rather than left dangling — the
 * patient sees the error and can pick a slot again, by card or by credit.
 */
export async function requestVideoVisitWithPlatformCredit(
  _prev: RequestVideoVisitState,
  formData: FormData
): Promise<RequestVideoVisitState> {
  const inserted = await insertVideoVisitRequestRow(formData);
  if (!inserted.ok) return inserted.error;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("confirm_video_visit_request_on_platform_credit", {
    p_request_id: inserted.requestId,
  });

  const result = data as
    | { ok: true; request_id: string; amount_kobo: number }
    | { ok: false; reason: "not_payable"; status: string }
    | { ok: false; reason: "unsupported_currency"; currency: string }
    | { ok: false; reason: "insufficient_balance"; balance_kobo: number; required_kobo: number; shortfall_kobo: number }
    | null;

  if (error || !result || !result.ok) {
    // Never leave a half-created, unpaid request lingering — the patient
    // can simply try again (by card, or after topping up).
    await supabase
      .from("video_visit_requests")
      .delete()
      .eq("id", inserted.requestId)
      .in("status", ["requested", "pending_payment"]);

    if (result && !result.ok && result.reason === "insufficient_balance") {
      const shortfallNaira = Math.ceil(result.shortfall_kobo / 100).toLocaleString();
      return { error: `You need ₦${shortfallNaira} more in platform credit to reserve this visit.` };
    }
    return { error: error?.message ?? "Could not reserve this visit with platform credit." };
  }

  redirect("/patient#book-video-visit");
}

/** Patient withdraws a request that hasn't been paid yet (RLS-enforced). */
export async function cancelVideoVisitRequest(requestId: string): Promise<void> {
  const parsed = z.string().uuid().safeParse(requestId);
  if (!parsed.success) return;
  const supabase = await createClient();
  await supabase
    .from("video_visit_requests")
    .delete()
    .eq("id", parsed.data)
    .in("status", ["requested", "pending_payment"]);
}

export type SelectAlternateSlotState = { error: string } | undefined;

/**
 * Patient picks one of the doctor's proposed alternate times
 * (select_video_visit_alternate_slot RPC) — the atomic booking + ownership
 * check both live in the RPC itself, this is a thin wrapper that also fires
 * the Zoom meeting + patient/doctor confirmation, mirroring acceptVideoVisit.
 */
export async function selectVideoVisitAlternateSlot(
  _prev: SelectAlternateSlotState,
  formData: FormData
): Promise<SelectAlternateSlotState> {
  const requestId = z.string().uuid().safeParse(String(formData.get("request_id") ?? ""));
  const slotId = z.string().uuid().safeParse(String(formData.get("slot_id") ?? ""));
  if (!requestId.success || !slotId.success) return { error: "Pick a time first" };

  const supabase = await createClient();
  const { data: consultId, error } = await supabase.rpc("select_video_visit_alternate_slot", {
    p_request_id: requestId.data,
    p_slot_id: slotId.data,
  });
  if (error || !consultId) {
    return { error: error?.message ?? "Could not book that time." };
  }

  const { data: consult } = await supabase
    .from("video_consultations")
    .select("id, organisation_id, patient_id, scheduled_at")
    .eq("id", consultId)
    .maybeSingle();

  if (consult) {
    const service = createServiceRoleClient();
    let joinUrl: string | null = null;
    if (consult.scheduled_at && isZoomConfigured()) {
      const meeting = await createMeeting({
        topic: "Tarragon Health: Video visit",
        startTime: consult.scheduled_at,
      });
      if (meeting.ok) {
        joinUrl = meeting.data.joinUrl;
        await service
          .from("video_consultations")
          .update({
            zoom_meeting_id: meeting.data.meetingId,
            join_url: meeting.data.joinUrl,
            host_start_url: meeting.data.hostStartUrl,
          })
          .eq("id", consult.id);
      }
    }
    await sendVideoConsultBookedConfirmation({ service, consultId: consult.id, joinUrl });
  }

  return undefined;
}

export type SubmitPrepState = { error?: string; message?: string } | undefined;

const prepNotesSchema = z.string().trim().max(1000);

/** Consultation System §9.4 — patient's own pre-visit reason/symptoms, editable any time before the call. */
export async function submitConsultationPrep(
  _prev: SubmitPrepState,
  formData: FormData
): Promise<SubmitPrepState> {
  const consultationId = z.string().uuid().safeParse(String(formData.get("consultation_id") ?? ""));
  const notes = prepNotesSchema.safeParse(String(formData.get("notes") ?? ""));
  if (!consultationId.success) return { error: "Invalid consultation" };
  if (!notes.success) return { error: "Keep it under 1000 characters" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("submit_consultation_prep", {
    p_consultation_id: consultationId.data,
    p_notes: notes.data,
  });
  if (error) return { error: error.message };
  return { message: "Saved. Your care team will see this before the visit." };
}

export type SubmitFeedbackState = { error?: string; message?: string } | undefined;

const feedbackSchema = z.object({
  consultationId: z.string().uuid(),
  overallRating: z.coerce.number().int().min(1).max(5),
  technicalExperienceRating: z.coerce.number().int().min(1).max(5).optional(),
  punctualityRating: z.coerce.number().int().min(1).max(5).optional(),
  communicationRating: z.coerce.number().int().min(1).max(5).optional(),
  // §29.4's fourth structured dimension (punctuality/communication/
  // professionalism/overall), added alongside clinician_id attribution in
  // 20260829093626 — optional like the other sub-ratings.
  professionalismRating: z.coerce.number().int().min(1).max(5).optional(),
  comment: z.string().trim().max(1000).optional(),
});

/**
 * Consultation System §9.20 — patient experience rating for a completed
 * video visit. organisation_id/patient_id are server-derived by
 * private.enforce_consultation_feedback_scope from video_consultation_id
 * (which also requires the caller be that consult's own patient on a
 * completed visit); the current user/org are still fetched here only
 * because the generated insert type requires non-null values for both — the
 * DB trigger overwrites whatever is sent before any constraint is checked.
 */
export async function submitConsultationFeedback(
  _prev: SubmitFeedbackState,
  formData: FormData
): Promise<SubmitFeedbackState> {
  const parsed = feedbackSchema.safeParse({
    consultationId: String(formData.get("consultation_id") ?? ""),
    overallRating: String(formData.get("overall_rating") ?? ""),
    technicalExperienceRating: formData.get("technical_experience_rating")
      ? String(formData.get("technical_experience_rating"))
      : undefined,
    punctualityRating: formData.get("punctuality_rating")
      ? String(formData.get("punctuality_rating"))
      : undefined,
    communicationRating: formData.get("communication_rating")
      ? String(formData.get("communication_rating"))
      : undefined,
    professionalismRating: formData.get("professionalism_rating")
      ? String(formData.get("professionalism_rating"))
      : undefined,
    comment: String(formData.get("comment") ?? "") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check your ratings" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("organisation_id")
    .eq("id", user.id)
    .single();
  if (!profile?.organisation_id) {
    return { error: "Your account has no organisation on file." };
  }

  const { error } = await supabase.from("consultation_feedback").insert({
    organisation_id: profile.organisation_id,
    patient_id: user.id,
    video_consultation_id: parsed.data.consultationId,
    overall_rating: parsed.data.overallRating,
    technical_experience_rating: parsed.data.technicalExperienceRating ?? null,
    punctuality_rating: parsed.data.punctualityRating ?? null,
    communication_rating: parsed.data.communicationRating ?? null,
    professionalism_rating: parsed.data.professionalismRating ?? null,
    comment: parsed.data.comment ?? null,
  });
  if (error) {
    return {
      error:
        error.code === "23505"
          ? "You've already left feedback for this visit."
          : error.message,
    };
  }
  return { message: "Thanks for the feedback." };
}
