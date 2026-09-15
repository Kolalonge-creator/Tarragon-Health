"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type SetModuleState = { error?: string; message?: string } | undefined;

const schema = z.object({
  key: z.enum(["payer_platform", "provider_org_platform"]),
  enabled: z.enum(["true", "false"]),
  note: z.string().trim().max(2000).optional(),
});

/**
 * Thin wrapper over public.set_platform_module() — the RPC is the real
 * authority (superadmin-only, requires a note to switch on, audit-logged);
 * this action only shapes the form input and refreshes the page. See
 * 20260829092227_platform_module_activation_gate.sql.
 */
export async function setPlatformModuleAction(
  _prev: SetModuleState,
  formData: FormData
): Promise<SetModuleState> {
  const parsed = schema.safeParse({
    key: formData.get("key"),
    enabled: formData.get("enabled"),
    note: formData.get("note") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { key, enabled, note } = parsed.data;

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_platform_module", {
    p_key: key,
    p_enabled: enabled === "true",
    p_note: note ?? undefined,
  });
  if (error) {
    return { error: error.message };
  }

  revalidatePath("/admin/settings/platform-modules");
  return { message: enabled === "true" ? `${key} activated.` : `${key} deactivated.` };
}
