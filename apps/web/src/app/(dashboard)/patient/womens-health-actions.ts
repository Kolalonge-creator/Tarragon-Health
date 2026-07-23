"use server";

import { createClient } from "@/lib/supabase/server";

export type WomensHealthStageState = { message?: string; error?: string } | undefined;

const STAGES = new Set([
  "general",
  "trying_to_conceive",
  "pregnant",
  "postpartum",
  "perimenopause",
]);

/** Stores the life stage in profiles.metadata (jsonb) — engagement routing
 * signal only, never a clinical record; nothing downstream keys off it. */
export async function saveWomensHealthStage(
  _prev: WomensHealthStageState,
  formData: FormData
): Promise<WomensHealthStageState> {
  const stage = formData.get("stage");
  if (typeof stage !== "string" || !STAGES.has(stage)) {
    return { error: "Pick a stage first." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const { data: profile } = await supabase
    .from("profiles")
    .select("metadata")
    .eq("id", user.id)
    .single();

  const metadata = {
    ...((profile?.metadata as Record<string, unknown> | null) ?? {}),
    womens_health_stage: stage,
  };

  const { error } = await supabase.from("profiles").update({ metadata }).eq("id", user.id);
  if (error) return { error: "Could not save — try again." };
  return { message: "Saved." };
}
