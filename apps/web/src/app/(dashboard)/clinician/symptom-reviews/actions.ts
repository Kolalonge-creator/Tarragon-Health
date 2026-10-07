"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

/**
 * S60 (spec 12.10): a clinician completes a symptom check review. Every rule is in the database function
 * (complete_symptom_review): the tie to the patient (INV-12), the tier, the code format, and "agrees" meaning something. This
 * action only shapes the request and sends the person back with a one-word outcome in the address (never a patient detail).
 */
const schema = z.object({
  review: z.string().uuid(),
  code: z.string().trim().min(3).max(10),
  label: z.string().trim().max(200).optional(),
  category: z.enum(["emergency", "urgent", "routine", "self_management"]),
  agrees: z.enum(["yes", "no"]),
  message: z.string().trim().min(10).max(600),
  note: z.string().trim().max(2000).optional(),
});

const BASE = "/clinician/symptom-reviews";

export async function completeSymptomReviewAction(formData: FormData): Promise<void> {
  const parsed = schema.safeParse({
    review: formData.get("review"),
    code: formData.get("code"),
    label: (formData.get("label") as string | null) || undefined,
    category: formData.get("category"),
    agrees: formData.get("agrees") === "on" ? "yes" : "no",
    message: formData.get("message"),
    note: (formData.get("note") as string | null) || undefined,
  });
  if (!parsed.success) redirect(`${BASE}?review=${encodeURIComponent(String(formData.get("review") ?? ""))}&r=input`);
  const v = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc("complete_symptom_review", {
    p_review: v.review,
    p_final_code: v.code,
    p_final_label: v.label ?? "",
    p_clinician_category: v.category,
    p_agrees: v.agrees === "yes",
    p_patient_message: v.message,
    p_internal_note: v.note,
  });
  if (error) redirect(`${BASE}?review=${v.review}&r=${error.code === "42501" ? "denied" : error.code === "22023" || error.code === "23514" ? "invalid" : "error"}`);
  revalidatePath(BASE);
  redirect(`${BASE}?r=done`);
}
