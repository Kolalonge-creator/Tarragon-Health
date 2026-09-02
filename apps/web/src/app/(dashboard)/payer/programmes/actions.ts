"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type ActionState = { error?: string; message?: string } | undefined;

const createSchema = z.object({
  insurerId: z.string().uuid(),
  programmeId: z.string().uuid(),
});

export async function createPayerDirectiveAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = createSchema.safeParse({
    insurerId: formData.get("insurerId"),
    programmeId: formData.get("programmeId"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const supabase = await createClient();
  const { error } = await supabase.from("payer_programme_directives").insert({
    insurer_id: parsed.data.insurerId,
    programme_id: parsed.data.programmeId,
  });
  if (error) return { error: error.message };

  revalidatePath("/payer/programmes");
  return { message: "Directive created." };
}

const applySchema = z.object({ directiveId: z.string().uuid() });

export async function applyPayerDirectiveAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = applySchema.safeParse({ directiveId: formData.get("directiveId") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("apply_payer_programme_directive", {
    p_directive_id: parsed.data.directiveId,
  });
  if (error) return { error: error.message };

  revalidatePath("/payer/programmes");
  const result = data as { newly_enrolled?: number; already_enrolled?: number } | null;
  return {
    message: `Enrolled ${result?.newly_enrolled ?? 0} new member(s); ${result?.already_enrolled ?? 0} already enrolled.`,
  };
}
