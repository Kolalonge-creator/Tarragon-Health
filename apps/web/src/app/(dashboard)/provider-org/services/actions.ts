"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type ActionState = { error?: string; message?: string } | undefined;

const createSchema = z.object({
  organisationId: z.string().uuid(),
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(500).optional(),
  durationMinutes: z.coerce.number().int().positive().optional(),
  priceKobo: z.coerce.number().int().min(0).optional(),
});

export async function createServiceAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = createSchema.safeParse({
    organisationId: formData.get("organisationId"),
    name: formData.get("name"),
    description: formData.get("description") || undefined,
    durationMinutes: formData.get("durationMinutes") || undefined,
    priceKobo: formData.get("priceKobo") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const supabase = await createClient();
  const { error } = await supabase.from("provider_org_services").insert({
    organisation_id: parsed.data.organisationId,
    name: parsed.data.name,
    description: parsed.data.description ?? null,
    duration_minutes: parsed.data.durationMinutes ?? null,
    price_kobo: parsed.data.priceKobo ?? null,
  });
  if (error) return { error: error.message };

  revalidatePath("/provider-org/services");
  return { message: "Service added." };
}

export async function deactivateServiceAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const id = formData.get("id");
  if (typeof id !== "string" || !id) return { error: "Missing id" };

  const supabase = await createClient();
  const { error } = await supabase.from("provider_org_services").update({ is_active: false }).eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/provider-org/services");
  return { message: "Service removed." };
}
