"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";

const schema = z.object({ on: z.enum(["0", "1"]), note: z.string().trim().max(500).optional(), confirm: z.string().optional() });
/** Switching ON needs a written record of who approved it and when (at least 10 characters); it is kept with the switch and in the audit log. */
const MIN_APPROVAL_NOTE = 10;
const BACK = "/admin/triage-accuracy";

/** Switch the clinicians' grade review on or off. Admin only. Turning it ON needs the tick-box and a note saying who approved it: the Chief Medical Officer must have approved it first. */
export async function setReviewSwitchAction(formData: FormData): Promise<void> {
  if ((await getCurrentProfile())?.role !== "admin") redirect("/admin");
  const p = schema.safeParse({ on: formData.get("on"), note: (formData.get("note") as string | null) || undefined, confirm: (formData.get("confirm") as string | null) || undefined });
  if (!p.success || (p.data.on === "1" && (p.data.confirm !== "on" || (p.data.note ?? "").length < MIN_APPROVAL_NOTE))) redirect(`${BACK}?m=invalid`);
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_platform_switch", { p_key: "triage_agreement_capture", p_on: p.data.on === "1", p_note: p.data.note });
  if (error) redirect(`${BACK}?m=refused`);
  revalidatePath(BACK);
  redirect(`${BACK}?m=${p.data.on === "1" ? "on" : "off"}`);
}
