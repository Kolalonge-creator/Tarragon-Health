"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type ActionState = { error?: string; message?: string } | undefined;

const addSchema = z.object({
  insurerId: z.string().uuid(),
  providerType: z.enum(["facility", "lab_provider", "pharmacy_partner", "specialist_provider"]),
  providerId: z.string().uuid(),
  status: z.enum(["in_network", "out_of_network", "restricted"]),
  serviceCategory: z.enum(["consultation", "laboratory", "pharmacy", "referral"]).optional(),
});

export async function addPayerNetworkProviderAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = addSchema.safeParse({
    insurerId: formData.get("insurerId"),
    providerType: formData.get("providerType"),
    providerId: formData.get("providerId"),
    status: formData.get("status"),
    serviceCategory: formData.get("serviceCategory") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const supabase = await createClient();
  const { error } = await supabase.from("payer_network_providers").insert({
    insurer_id: parsed.data.insurerId,
    provider_type: parsed.data.providerType,
    provider_id: parsed.data.providerId,
    status: parsed.data.status,
    service_category: parsed.data.serviceCategory ?? null,
  });
  if (error) return { error: error.message };

  revalidatePath("/payer/network");
  return { message: "Network entry added." };
}

export async function removePayerNetworkProviderAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const id = formData.get("id");
  if (typeof id !== "string" || !id) return { error: "Missing id" };

  const supabase = await createClient();
  const { error } = await supabase.from("payer_network_providers").delete().eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/payer/network");
  return { message: "Removed." };
}
