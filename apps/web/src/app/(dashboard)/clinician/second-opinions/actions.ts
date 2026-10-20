"use server";

import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { secondOpinionAnswerSchema, secondOpinionReadSchema, type SecondOpinionRead } from "@/lib/validation/second-opinion";

export type AnswerSecondOpinionState = { error?: string; message?: string } | undefined;

/**
 * A doctor answers a second opinion request, optionally recommending a specialist referral. The whole step is one database
 * function (public.answer_second_opinion_request): it runs as the caller, private.stamp_second_opinion_answer derives
 * answered_by from their real, active, non-coordinator clinical_staff row, and a recommended referral is created as a DRAFT
 * that the patient must accept (specialist_referrals stays staff-created only).
 */
export async function answerSecondOpinionRequest(
  _prev: AnswerSecondOpinionState,
  formData: FormData
): Promise<AnswerSecondOpinionState> {
  const referring = formData.get("refer") === "on";
  const parsed = secondOpinionAnswerSchema.safeParse({
    requestId: String(formData.get("request_id") ?? ""),
    answer: String(formData.get("answer") ?? ""),
    referral: referring
      ? {
          specialistType: String(formData.get("specialist_type") ?? ""),
          urgency: String(formData.get("urgency") ?? "routine"),
          reason: String(formData.get("referral_reason") ?? ""),
          requestedService: String(formData.get("requested_service") ?? "") || undefined,
        }
      : undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the answer and try again" };
  }

  const supabase = await createClient();
  const { data: referralId, error } = await supabase.rpc("answer_second_opinion_request", {
    p_request: parsed.data.requestId,
    p_answer: parsed.data.answer,
    ...(parsed.data.referral
      ? {
          p_specialist_type: parsed.data.referral.specialistType,
          p_urgency: parsed.data.referral.urgency,
          p_reason: parsed.data.referral.reason,
          p_requested_service: parsed.data.referral.requestedService,
        }
      : {}),
  });
  if (error) {
    return {
      error:
        error.code === "42501"
          ? "Only an active doctor on the care team can answer second opinion requests."
          : error.message,
    };
  }

  // Read with the service role: the answer has already been accepted under the caller's own session, and a doctor with no
  // care-team tie to the patient (S39b) cannot read this row directly, which would silently skip the patient's notification.
  const service = createServiceRoleClient();
  const { data: request } = await service
    .from("second_opinion_requests")
    .select("organisation_id, patient_id")
    .eq("id", parsed.data.requestId)
    .maybeSingle();
  if (request) {
    await service.from("notifications").insert({
      organisation_id: request.organisation_id,
      recipient_id: request.patient_id,
      channel: "in_app",
      status: "pending",
      template: "second_opinion_answered",
      payload: {},
    });
  }

  return {
    message: referralId
      ? "Answer sent. The patient can accept the referral and download the letter."
      : "Answer sent to the patient.",
  };
}

export type ReadSecondOpinionResult = { error: string; data?: undefined } | { data: SecondOpinionRead; error?: undefined };

/** Opens one request with the lab results the patient chose to share. The read is audited in the database. */
export async function readSharedResults(requestId: string): Promise<ReadSecondOpinionResult> {
  const id = secondOpinionAnswerSchema.shape.requestId.safeParse(requestId);
  if (!id.success) return { error: "Request not found." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("read_second_opinion_audited", { p_request: id.data });
  if (error) return { error: "Request not found." };
  const parsed = secondOpinionReadSchema.safeParse(data);
  if (!parsed.success) return { error: "Could not read the shared results." };
  return { data: parsed.data };
}
