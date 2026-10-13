"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export type HandoverState = { error?: string; done?: "accepted" | "declined" } | undefined;

const handoverSchema = z.object({ handoverId: z.uuid() });

/**
 * The young person agrees to take over the record that was kept for them (S04b-1, R3). Everything that matters is
 * decided in the database from the signed-in identity: public.accept_dependant_handover only proceeds for the person
 * the record is about, signed in on the verified number the guardian entered, and once they are 18 or over.
 * Nothing from this form is trusted beyond the hand-over id.
 */
export async function acceptHandoverAction(_prev: HandoverState, formData: FormData): Promise<HandoverState> {
  const parsed = handoverSchema.safeParse({ handoverId: formData.get("handoverId") });
  if (!parsed.success) return { error: "Something went wrong. Please try again." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("accept_dependant_handover", { p_handover: parsed.data.handoverId });
  if (error) return { error: "We could not complete the hand-over. Please try again." };
  revalidatePath("/patient");
  return { done: "accepted" };
}

export async function declineHandoverAction(_prev: HandoverState, formData: FormData): Promise<HandoverState> {
  const parsed = handoverSchema.safeParse({ handoverId: formData.get("handoverId") });
  if (!parsed.success) return { error: "Something went wrong. Please try again." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("decline_dependant_handover", { p_handover: parsed.data.handoverId });
  if (error) return { error: "We could not record your answer. Please try again." };
  revalidatePath("/patient");
  return { done: "declined" };
}
