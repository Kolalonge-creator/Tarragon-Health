"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const schema = z.object({
  featureId: z.string().trim().min(1).max(100),
  action: z.enum(["opened", "dismissed"]),
});

/**
 * Record that a patient has opened or dismissed a suggested feature, so the
 * discovery card stops offering it.
 *
 * Writes only ever land on the CALLER's own row: `patient_id` is taken from
 * the session, never from the request, and the table's RLS re-checks that
 * independently. Nothing here is clinical.
 */
export async function recordFeatureView(input: { featureId: string; action: "opened" | "dismissed" }) {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Invalid request" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: "Not signed in" };

  const { data: profile } = await supabase
    .from("profiles")
    .select("organisation_id")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile?.organisation_id) return { ok: false as const, error: "No organisation" };

  const stamp = new Date().toISOString();
  const { error } = await supabase.from("patient_feature_views").upsert(
    {
      organisation_id: profile.organisation_id,
      patient_id: user.id,
      feature_id: parsed.data.featureId,
      ...(parsed.data.action === "opened" ? { opened_at: stamp } : { dismissed_at: stamp }),
    },
    { onConflict: "patient_id,feature_id" },
  );
  if (error) return { ok: false as const, error: error.message };

  revalidatePath("/patient");
  return { ok: true as const };
}
