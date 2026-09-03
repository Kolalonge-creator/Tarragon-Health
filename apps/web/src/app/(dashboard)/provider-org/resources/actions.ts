"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type ActionState = { error?: string; message?: string } | undefined;

const createSchema = z.object({
  organisationId: z.string().uuid(),
  resourceType: z.enum(["room", "equipment"]),
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(500).optional(),
});

export async function createResourceAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = createSchema.safeParse({
    organisationId: formData.get("organisationId"),
    resourceType: formData.get("resourceType"),
    name: formData.get("name"),
    description: formData.get("description") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const supabase = await createClient();
  const { error } = await supabase.from("provider_org_resources").insert({
    organisation_id: parsed.data.organisationId,
    resource_type: parsed.data.resourceType,
    name: parsed.data.name,
    description: parsed.data.description ?? null,
  });
  if (error) return { error: error.message };

  revalidatePath("/provider-org/resources");
  return { message: "Resource added." };
}

export async function deactivateResourceAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const id = formData.get("id");
  if (typeof id !== "string" || !id) return { error: "Missing id" };

  const supabase = await createClient();
  const { error } = await supabase.from("provider_org_resources").update({ is_active: false }).eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/provider-org/resources");
  return { message: "Resource removed." };
}
