"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type ContentActionState = { error?: string; success?: boolean } | undefined;

const editSchema = z.object({
  blockId: z.string().uuid(),
  title: z.string().trim().min(1, "Title can't be empty").max(200),
  bodyMd: z.string().trim().min(1, "Body can't be empty").max(4000),
});

/**
 * Edits a content block's copy. Always leaves it unreviewed — the table's
 * RLS with_check (clinician_reviewed = false on any admin-driven write)
 * enforces this at the DB level too, so this isn't relying on app-layer
 * discipline alone. Editing a previously-signed block reverts it to draft;
 * it needs re-signing, same as cv_risk_config never letting an edit mutate
 * a signed version in place.
 */
export async function editContentBlockAction(
  _prev: ContentActionState,
  formData: FormData
): Promise<ContentActionState> {
  const parsed = editSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("lpe_content_blocks")
    .update({ title: parsed.data.title, body_md: parsed.data.bodyMd, clinician_reviewed: false })
    .eq("id", parsed.data.blockId);
  if (error) return { error: error.message };

  revalidatePath("/admin/settings/lpe-content-library");
  return { success: true };
}

/**
 * Signs (approves) a content block. The DB RPC (sign_lpe_content_block) is
 * the real gate — only an active Clinical Director can call it; it cannot
 * be forged from the app layer. Once signed, the AI Coach's retrieval
 * pipeline can surface this block (still additionally gated on
 * VOYAGE_API_KEY being configured and the daily embedding cron having run).
 */
export async function signContentBlockAction(blockId: string): Promise<ContentActionState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("sign_lpe_content_block", { p_block_id: blockId });
  if (error) return { error: error.message };
  revalidatePath("/admin/settings/lpe-content-library");
  return { success: true };
}
