"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { PIDGIN_SWITCH_KEY } from "@/lib/language/pidgin-switch";

export type SetPidginState = { error?: string; message?: string } | undefined;

const schema = z.object({
  on: z.enum(["true", "false"]),
  note: z.string().trim().max(2000).optional(),
});

/**
 * Thin wrapper over public.set_platform_switch(). The RPC is the authority
 * (admin only, audit-logged); the note is optional in both directions so
 * turning Pidgin off in a hurry is never blocked by a form field.
 */
export async function setPidginSwitchAction(
  _prev: SetPidginState,
  formData: FormData
): Promise<SetPidginState> {
  const parsed = schema.safeParse({
    on: formData.get("on"),
    note: formData.get("note") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const on = parsed.data.on === "true";

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_platform_switch", {
    p_key: PIDGIN_SWITCH_KEY,
    p_on: on,
    p_note: parsed.data.note ?? undefined,
  });
  if (error) return { error: error.message };

  // Every patient shell and signed-out page reads the switch per request.
  revalidatePath("/", "layout");
  return {
    message: on
      ? "Pidgin is on. People who chose it will see it again."
      : "Pidgin is off. Everyone now sees English.",
  };
}
