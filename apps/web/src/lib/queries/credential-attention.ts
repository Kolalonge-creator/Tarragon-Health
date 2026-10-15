import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { workListSchema } from "@/lib/credentialing/schemas";
import type { SignoffQueueItem } from "@/lib/queries/signoff-queue";

export type CredentialAttention = {
  overdueRechecks: number;
  unverified: number;
  /** The read failed, so the counts understate reality: never render it as an all-clear. */
  failed: boolean;
};

export const CREDENTIAL_ATTENTION_ITEM_KEY = "credential_attention";

const NONE: CredentialAttention = { overdueRechecks: 0, unverified: 0, failed: true };

/**
 * What the credentialing work list needs the Chief Medical Officer to know about (P5, CMO answers Q14 and Q15). This is attention, not a
 * signature: nothing here is signed on the hub, and an overdue re-check never pauses anyone's access (suspension stays expiry-driven).
 * Never throws; a failed read says so instead of looking like nothing is outstanding.
 */
export async function readCredentialAttention(supabase: SupabaseClient<Database>): Promise<CredentialAttention> {
  try {
    const { data, error } = await (supabase as unknown as { rpc: (fn: string) => PromiseLike<{ data: unknown; error: unknown }> }).rpc("credentialing_work_list");
    const parsed = workListSchema.safeParse(data);
    if (error || !parsed.success) return NONE;
    return {
      overdueRechecks: parsed.data.rechecks.filter((r) => r.overdue).length,
      unverified: parsed.data.unverified.length,
      failed: false,
    };
  } catch {
    return NONE;
  }
}

/** The hub line, or null when there is nothing to do. */
export function credentialAttentionItem(a: CredentialAttention): SignoffQueueItem | null {
  const count = a.overdueRechecks + a.unverified;
  if (count === 0) return null;
  const parts = [
    a.overdueRechecks > 0 && `${a.overdueRechecks} MDCN spot re-check${a.overdueRechecks === 1 ? " is" : "s are"} overdue`,
    a.unverified > 0 && `${a.unverified} clinician${a.unverified === 1 ? " has" : "s have"} no MDCN or DataFlow verification on record`,
  ].filter(Boolean);
  return {
    key: CREDENTIAL_ATTENTION_ITEM_KEY,
    title: "Clinician registration checks",
    detail: `${parts.join(" and ")}. Nothing is paused for this; a reviewer records the evidence from the credentialing page.`,
    href: "/clinician/credentialing",
    severity: "draft_pending",
    count,
  };
}
