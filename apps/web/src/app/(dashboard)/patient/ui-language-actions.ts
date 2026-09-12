"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { UI_LANGUAGES, type UiLanguage } from "@tarragon/shared";

export type UpdateUiLanguageState = { success?: boolean; error?: string } | undefined;

function isUiLanguage(value: unknown): value is UiLanguage {
  return typeof value === "string" && (UI_LANGUAGES as readonly string[]).includes(value);
}

/**
 * Saves profiles.language — the patient's interface language.
 *
 * Wayfinding only: navigation, buttons and the setup steps. Clinical guidance,
 * emergency copy, dosing and consent text are deliberately not translated (see
 * the boundary note in packages/shared/src/ui-language.ts), so switching this
 * never changes a single word of clinical content.
 *
 * Written as the patient's own session against RLS. `language` is not on
 * private.guard_profiles_self_update()'s denylist of privileged columns —
 * checked against the live function definition, not assumed.
 */
export async function updateUiLanguage(
  _prev: UpdateUiLanguageState,
  formData: FormData
): Promise<UpdateUiLanguageState> {
  const language = formData.get("language");
  if (!isUiLanguage(language)) {
    return { error: "Pick either English or Pidgin." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "You need to be signed in to change this." };

  const { error } = await supabase.from("profiles").update({ language }).eq("id", user.id);
  if (error) return { error: "Couldn't save that. Please try again." };

  // The shell's nav labels are server-rendered against this, so the whole
  // patient area is stale the moment it changes.
  revalidatePath("/patient", "layout");
  return { success: true };
}
