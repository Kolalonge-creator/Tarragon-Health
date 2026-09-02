"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type ActionState = { error?: string; message?: string } | undefined;

const createSchema = z.object({
  organisationId: z.string().uuid(),
  name: z.string().trim().min(1).max(200),
  city: z.string().trim().max(100).optional(),
  state: z.string().trim().max(100).optional(),
  address: z.string().trim().max(500).optional(),
  isHeadquarters: z.enum(["true", "false"]).optional(),
});

export async function createLocationAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = createSchema.safeParse({
    organisationId: formData.get("organisationId"),
    name: formData.get("name"),
    city: formData.get("city") || undefined,
    state: formData.get("state") || undefined,
    address: formData.get("address") || undefined,
    isHeadquarters: formData.get("isHeadquarters") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const supabase = await createClient();
  const { error } = await supabase.from("provider_org_locations").insert({
    organisation_id: parsed.data.organisationId,
    name: parsed.data.name,
    city: parsed.data.city ?? null,
    state: parsed.data.state ?? null,
    address: parsed.data.address ?? null,
    is_headquarters: parsed.data.isHeadquarters === "true",
  });
  if (error) return { error: error.message };

  revalidatePath("/provider-org/locations");
  return { message: "Location added." };
}

export async function deactivateLocationAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const id = formData.get("id");
  if (typeof id !== "string" || !id) return { error: "Missing id" };

  const supabase = await createClient();
  const { error } = await supabase.from("provider_org_locations").update({ is_active: false }).eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/provider-org/locations");
  return { message: "Location deactivated." };
}
