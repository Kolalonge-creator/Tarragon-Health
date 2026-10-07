"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { loose } from "@/lib/clinician/loose-client";
import { reviewFormSchema, type Notice } from "./model";

const back = (n: Notice): never => redirect(`/admin/settings/translations?n=${n}`);

/** Moves a translation one step. The database allows only legal steps and reserves clinical review for the Chief Medical Officer. */
export async function reviewTranslationAction(formData: FormData): Promise<void> {
  const parsed = reviewFormSchema.safeParse({ id: formData.get("id"), state: formData.get("state") });
  if (!parsed.success) return back("failed");
  const { error } = await loose(await createClient()).rpc("review_translation", { p_id: parsed.data.id, p_state: parsed.data.state });
  if (error) return back(/not authorised/i.test(error.message) || error.code === "42501" ? "denied" : "failed");
  return back("reviewed");
}
