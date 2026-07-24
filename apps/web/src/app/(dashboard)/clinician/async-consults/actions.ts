"use server";

import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { asyncConsultAnswerSchema } from "@/lib/validation/async-consults";

export type AnswerConsultState = { error?: string; message?: string } | undefined;

/**
 * A doctor answers an async consult. The UPDATE runs under the caller's own
 * RLS session so private.stamp_async_consult_answer can derive answered_by
 * from their real clinical_staff row — a non-doctor caller gets a structural
 * 42501, not an app-layer message. The patient notification is enqueued via
 * service role afterwards (notification layer only; the answer itself lives
 * in-app).
 */
export async function answerAsyncConsult(
  _prev: AnswerConsultState,
  formData: FormData
): Promise<AnswerConsultState> {
  const parsed = asyncConsultAnswerSchema.safeParse({
    consultId: String(formData.get("consult_id") ?? ""),
    answer: String(formData.get("answer") ?? ""),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the answer and try again" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("async_consults")
    .update({ status: "answered", answer: parsed.data.answer })
    .eq("id", parsed.data.consultId);
  if (error) {
    return {
      error:
        error.code === "42501"
          ? "Only an active doctor on the care team can answer consults."
          : error.message,
    };
  }

  const { data: consult } = await supabase
    .from("async_consults")
    .select("organisation_id, patient_id")
    .eq("id", parsed.data.consultId)
    .maybeSingle();
  if (consult) {
    const service = createServiceRoleClient();
    await service.from("notifications").insert({
      organisation_id: consult.organisation_id,
      recipient_id: consult.patient_id,
      channel: "whatsapp",
      status: "pending",
      template: "async_consult_answered",
      payload: {},
    });
  }

  return { message: "Answer sent to the patient." };
}
