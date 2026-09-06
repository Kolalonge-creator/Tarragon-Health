"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { generateAppointmentPrepSuggestions } from "./generate";

export interface AppointmentPrepResult {
  status: "generated" | "failed";
  questions: string[];
}

const consultationIdSchema = z.string().uuid();

/**
 * Suggests questions for the CALLER's OWN upcoming visit -- there is
 * deliberately no patientId parameter, so this action can never be pointed
 * at another patient's data (mirrors patient-explainer/actions.ts).
 *
 * Cache-first: once generated for a given consultation, the same suggestions
 * are reused -- a visit's booking context doesn't usually change between
 * booking and the visit itself, and this avoids a repeat Anthropic call
 * every time the patient reopens the waiting room.
 */
export async function prepareForAppointmentAction(
  consultationId: string
): Promise<AppointmentPrepResult> {
  const parsedId = consultationIdSchema.safeParse(consultationId);
  if (!parsedId.success) return { status: "failed", questions: [] };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { status: "failed", questions: [] };

  const { data: profile } = await supabase
    .from("profiles")
    .select("organisation_id")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile?.organisation_id) return { status: "failed", questions: [] };

  const { data: cached } = await supabase
    .from("appointment_prep_suggestions")
    .select("status, questions")
    .eq("patient_id", user.id)
    .eq("consultation_id", parsedId.data)
    .maybeSingle();

  if (cached?.status === "generated" && Array.isArray(cached.questions) && cached.questions.length > 0) {
    return { status: "generated", questions: cached.questions as string[] };
  }

  const result = await generateAppointmentPrepSuggestions(supabase, createServiceRoleClient, {
    patientId: user.id,
    organisationId: profile.organisation_id,
    consultationId: parsedId.data,
  });

  return { status: result.status, questions: result.questions ?? [] };
}
