"use server";

import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { secondOpinionAnswerSchema } from "@/lib/validation/second-opinion";

export type AnswerSecondOpinionState = { error?: string; message?: string } | undefined;

/**
 * A doctor answers a second opinion request — mirrors answerAsyncConsult
 * (clinician/async-consults/actions.ts) exactly: the UPDATE runs under the
 * caller's own RLS session so private.stamp_second_opinion_answer can derive
 * answered_by from their real, active, non-coordinator clinical_staff row.
 */
export async function answerSecondOpinionRequest(
  _prev: AnswerSecondOpinionState,
  formData: FormData
): Promise<AnswerSecondOpinionState> {
  const parsed = secondOpinionAnswerSchema.safeParse({
    requestId: String(formData.get("request_id") ?? ""),
    answer: String(formData.get("answer") ?? ""),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the answer and try again" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("second_opinion_requests")
    .update({ status: "answered", answer: parsed.data.answer })
    .eq("id", parsed.data.requestId);
  if (error) {
    return {
      error:
        error.code === "42501"
          ? "Only an active doctor on the care team can answer second opinion requests."
          : error.message,
    };
  }

  const { data: request } = await supabase
    .from("second_opinion_requests")
    .select("organisation_id, patient_id")
    .eq("id", parsed.data.requestId)
    .maybeSingle();
  if (request) {
    const service = createServiceRoleClient();
    await service.from("notifications").insert({
      organisation_id: request.organisation_id,
      recipient_id: request.patient_id,
      channel: "whatsapp",
      status: "pending",
      template: "second_opinion_answered",
      payload: {},
    });
  }

  return { message: "Answer sent to the patient." };
}
