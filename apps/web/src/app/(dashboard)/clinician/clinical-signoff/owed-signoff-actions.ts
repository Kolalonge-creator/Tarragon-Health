"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { canAssignCases } from "@/lib/clinical/doctor-tier";
import { setFlash } from "@/lib/go-live/flash";

/**
 * The Chief Medical Officer signs one owed line from the sign-off hub. Deliberate: the box must be ticked, the word SIGN typed and a note of
 * at least 20 characters written saying what was checked. The database (sign_owed_signoff) is the protection: it refuses anyone but the CMO,
 * a row that is not waiting, a wrong confirmation word and a short note; the checks here only give a clear message first.
 */
const subjectSchema = z.string().trim().regex(/^[a-z0-9_.:-]{3,80}$/, "That line is not recognised. Nothing was signed.");
const noteSchema = z.string().trim().min(20, "Write what you checked in at least 20 characters.").max(1000);

export async function signOwedSignoffAction(formData: FormData): Promise<void> {
  const path = "/clinician/clinical-signoff";
  const finish = async (ok: boolean, detail?: string): Promise<never> => {
    const n = await setFlash({ notice: ok ? "golive.done.signoff" : "golive.error.generic", detail: ok ? undefined : detail, ok });
    return redirect(`${path}?n=${n}`);
  };
  if (!canAssignCases(await getCurrentClinicalStaff())) return finish(false, "Only the Chief Medical Officer can do this.");
  const typed = String(formData.get("typed") ?? "").trim().toUpperCase();
  if (formData.get("understood") === null || typed !== "SIGN") {
    return finish(false, formData.get("understood") === null ? "Tick the checkbox first. Nothing was signed." : "Type the word SIGN. Nothing was signed.");
  }
  const subject = subjectSchema.safeParse(formData.get("subject") ?? "");
  if (!subject.success) return finish(false, subject.error.issues[0]?.message ?? "Nothing was signed.");
  const note = noteSchema.safeParse(formData.get("note") ?? "");
  if (!note.success) return finish(false, `${note.error.issues[0]?.message ?? "Write a note."} Nothing was signed.`);
  const supabase = await createClient();
  const { error } = await (supabase as unknown as { rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ error: { message: string; code?: string } | null }> })
    .rpc("sign_owed_signoff", { p_key: subject.data, p_note: note.data, p_confirm: "SIGN" });
  if (error) return finish(false, ["22023", "23514", "42501"].includes(error.code ?? "") ? error.message : "Something went wrong. Nothing was signed. Please try again.");
  revalidatePath(path);
  return finish(true);
}
