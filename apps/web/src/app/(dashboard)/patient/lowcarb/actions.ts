"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

/**
 * S50b: the patient answers an offer or stops the programme. Only the patient can answer: the database refuses anyone else, and a patient cannot
 * start a programme nobody offered. The answers carry no reading or condition (INV-07).
 */
export type LowCarbPatientState = { outcome?: "active" | "declined" | "unavailable" | "stopped"; error?: string } | undefined;

const idSchema = z.object({ enrolmentId: z.string().uuid() });
const GENERIC = "Something went wrong and nothing was changed. Please try again, or ask your care team in the app.";

export async function respondToLowCarbOffer(_prev: LowCarbPatientState, formData: FormData): Promise<LowCarbPatientState> {
  const parsed = idSchema.safeParse({ enrolmentId: String(formData.get("enrolmentId") ?? "") });
  if (!parsed.success) return { error: GENERIC };
  const accept = formData.get("answer") === "yes";
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("respond_lowcarb_offer", { p_enrolment: parsed.data.enrolmentId, p_accept: accept });
  if (error) return { error: GENERIC };
  revalidatePath("/patient/lowcarb");
  if (data === "active" || data === "declined" || data === "unavailable") return { outcome: data };
  return { error: GENERIC };
}

export async function stopLowCarbAsPatient(_prev: LowCarbPatientState, formData: FormData): Promise<LowCarbPatientState> {
  const parsed = idSchema.safeParse({ enrolmentId: String(formData.get("enrolmentId") ?? "") });
  if (!parsed.success) return { error: GENERIC };
  const supabase = await createClient();
  const { error } = await supabase.rpc("stop_lowcarb_programme", { p_enrolment: parsed.data.enrolmentId });
  if (error) return { error: GENERIC };
  revalidatePath("/patient/lowcarb");
  return { outcome: "stopped" };
}
