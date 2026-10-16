import { createClient } from "@/lib/supabase/server";
import { loose } from "@/lib/clinician/loose-client";
import { translationRowsSchema, type TranslationRow } from "./model";

export type Loaded<T> = { ok: true; data: T } | { ok: false; denied: boolean };

export async function loadTranslations(): Promise<Loaded<TranslationRow[]>> {
  const { data, error } = await loose(await createClient())
    .from("translations")
    .select("id, key, language, is_clinical, state, reviewed_at")
    .order("key", { ascending: true });
  if (error) return { ok: false, denied: error.code === "42501" };
  const parsed = translationRowsSchema.safeParse(data);
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false, denied: false };
}
