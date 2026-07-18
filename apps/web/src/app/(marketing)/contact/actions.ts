"use server";

import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { leadSchema } from "@/lib/validation/lead";

export type ContactActionState =
  | { error?: string; success?: boolean }
  | undefined;

export async function submitLead(
  _prevState: ContactActionState,
  formData: FormData
): Promise<ContactActionState> {
  const parsed = leadSchema.safeParse({
    name: formData.get("name"),
    contact: formData.get("contact"),
    role: formData.get("role"),
    message: formData.get("message") || undefined,
    source: formData.get("source") || "homepage",
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { error: "Lead capture is not configured yet. Please email us directly." };
  }

  const supabase = createServiceRoleClient();
  const { error } = await supabase.from("leads").insert({
    name: parsed.data.name,
    contact: parsed.data.contact,
    role: parsed.data.role,
    message: parsed.data.message ?? null,
    source: parsed.data.source,
  });

  if (error) {
    return { error: "We could not save your message. Please try again shortly." };
  }

  return { success: true };
}
