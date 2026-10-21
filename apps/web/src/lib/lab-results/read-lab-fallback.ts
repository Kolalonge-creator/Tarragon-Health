import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { z } from "zod";
import { loose } from "@/lib/clinician/loose-client";

const rowSchema = z.object({
  id: z.string().uuid(),
  version: z.number(),
  wording_key: z.enum(["v1"]),
  approved_at: z.string().nullable(),
  created_at: z.string(),
  notes: z.string().nullable(),
});
export type LabFallbackSignoff = z.infer<typeof rowSchema>;

/** The active fallback wording sign-off row. `loadFailed` is a failure to read, never "nothing to sign". */
export async function readLabFallback(supabase: SupabaseClient<Database>): Promise<{ signoff: LabFallbackSignoff | null; loadFailed: boolean }> {
  const res = (await loose(supabase)
    .from("lab_fallback_wording_signoffs")
    .select("id, version, wording_key, approved_at, created_at, notes")
    .eq("is_active", "true")
    .maybeSingle()) as { data: unknown; error: { message: string } | null };
  if (res.error) return { signoff: null, loadFailed: true };
  if (res.data === null) return { signoff: null, loadFailed: false };
  const parsed = rowSchema.safeParse(res.data);
  return parsed.success ? { signoff: parsed.data, loadFailed: false } : { signoff: null, loadFailed: true };
}
