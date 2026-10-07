"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

/**
 * S59 (spec 12.7): a clinician completes a photo review. The rules (the tie to the patient, the tier, a message and a next step) are
 * in the database function; this only shapes the request and returns with a one-word outcome (never a patient detail). There is no
 * score or classification anywhere in this form.
 */
const schema = z.object({
  photo: z.string().uuid(),
  next: z.enum(["emergency", "urgent", "routine", "self_management"]),
  message: z.string().trim().min(10).max(600),
  note: z.string().trim().max(2000).optional(),
});
const BASE = "/clinician/skin-photo-reviews";

export async function completeSkinPhotoReviewAction(formData: FormData): Promise<void> {
  const parsed = schema.safeParse({
    photo: formData.get("photo"),
    next: formData.get("next"),
    message: formData.get("message"),
    note: (formData.get("note") as string | null) || undefined,
  });
  if (!parsed.success) redirect(`${BASE}?photo=${encodeURIComponent(String(formData.get("photo") ?? ""))}&r=input`);
  const v = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("complete_skin_photo_review", { p_photo: v.photo, p_next_step: v.next, p_message: v.message, p_internal_note: v.note });
  if (!error && (data as { status?: string } | null)?.status === "denied") redirect(`${BASE}?photo=${v.photo}&r=denied`);
  if (error) redirect(`${BASE}?photo=${v.photo}&r=${error.code === "42501" ? "denied" : error.code === "22023" || error.code === "23514" ? "invalid" : "error"}`);
  revalidatePath(BASE);
  redirect(`${BASE}?r=done`);
}
