"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type SetModuleState = { error?: string; message?: string } | undefined;

const schema = z.object({
  // Any well-formed module key. This used to be an enum of the first two modules (payer_platform, provider_org_platform), so every
  // module added later (Care Circle digest, tasks, nudge, and the rest) was listed on the page but refused here, with the error shown at the
  // top of a long page. public.set_platform_module is the authority: it refuses a key that is not in platform_modules, refuses anyone who
  // is not a superadmin, demands a note to switch on, and audit-logs the change.
  key: z.string().regex(/^[a-z][a-z0-9_]{1,62}$/, "Unknown module"),
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
