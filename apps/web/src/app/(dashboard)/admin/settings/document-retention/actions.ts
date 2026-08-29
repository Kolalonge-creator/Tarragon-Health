"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { documentRetentionPolicySchema } from "@/lib/validation/document-retention-policies";

export type DocumentRetentionPolicyActionState = { error?: string; success?: boolean } | undefined;

/**
 * Create or replace the org's retention policy for one document type.
 * organisation_id is always derived from the caller's own profile — never
 * accepted from the client — and set_by is stamped by a DB trigger on
 * insert, not set here. RLS restricts the underlying write to an
 * admin-role account (private.is_admin()); the role check below exists only
 * so a non-admin gets a clean error message instead of a raw Postgres one —
 * the real enforcement is in the database.
 */
export async function upsertDocumentRetentionPolicy(
  _prev: DocumentRetentionPolicyActionState,
  formData: FormData
): Promise<DocumentRetentionPolicyActionState> {
  const profile = await getCurrentProfile();
  if (profile?.role !== "admin") {
    return { error: "Not authorised" };
  }
  if (!profile.organisation_id) {
    return { error: "Your account has no organisation to set a policy for." };
  }

  const parsed = documentRetentionPolicySchema.safeParse({
    document_type: formData.get("document_type"),
    retention_years: formData.get("retention_years"),
    basis: formData.get("basis"),
    active: formData.has("active"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("document_retention_policies").upsert(
    {
      organisation_id: profile.organisation_id,
      document_type: parsed.data.document_type,
      retention_years: parsed.data.retention_years,
      basis: parsed.data.basis,
      active: parsed.data.active,
    },
    { onConflict: "organisation_id,document_type" }
  );
  if (error) return { error: error.message };

  revalidatePath("/admin/settings/document-retention");
  return { success: true };
}

/**
 * Deactivate a policy row — never a real delete, matching the platform's
 * general "archive don't delete" ethos even for config tables. Re-adding a
 * policy for the same document type later is a fresh upsert.
 */
export async function deactivateDocumentRetentionPolicy(
  policyId: string
): Promise<DocumentRetentionPolicyActionState> {
  const profile = await getCurrentProfile();
  if (profile?.role !== "admin") {
    return { error: "Not authorised" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("document_retention_policies")
    .update({ active: false })
    .eq("id", policyId);
  if (error) return { error: error.message };

  revalidatePath("/admin/settings/document-retention");
  return { success: true };
}
