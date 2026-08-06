"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { hasPermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";

export type LeadActionState = { error?: string } | undefined;

const toggleSchema = z.object({
  leadId: z.string().uuid(),
  contacted: z.enum(["true", "false"]),
});

/**
 * Toggles a lead between "new" and "contacted" — a timestamp + who, not a
 * status enum, so "contacted 3 days ago by Kola" is answerable directly from
 * the row. Un-toggling (a misclick, or a lead that needs following up again)
 * just clears both back to null rather than needing a history table.
 */
export async function toggleLeadContactedAction(
  _prev: LeadActionState,
  formData: FormData
): Promise<LeadActionState> {
  const actor = await getCurrentProfile();
  if (!actor) return { error: "Not signed in" };
  if (!(await hasPermission("leads.manage"))) {
    return { error: "You don't have access to do that" };
  }

  const parsed = toggleSchema.safeParse({
    leadId: formData.get("leadId"),
    contacted: formData.get("contacted"),
  });
  if (!parsed.success) return { error: "Invalid request" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("leads")
    .update(
      parsed.data.contacted === "true"
        ? { contacted_at: new Date().toISOString(), contacted_by: actor.id }
        : { contacted_at: null, contacted_by: null }
    )
    .eq("id", parsed.data.leadId);

  if (error) return { error: error.message };

  revalidatePath("/admin/leads");
  return undefined;
}
