"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const schema = z.object({
  sponsor: z.string().uuid(),
  name: z.string().trim().min(3).max(80),
  validFrom: day,
  validTo: day,
  maxUses: z.coerce.number().int().min(1).max(100000),
});

/** Make a programme code for a sponsor. Admin only (the database checks too). The code appears in the list afterwards. */
export async function createCohortAction(formData: FormData): Promise<void> {
  if ((await getCurrentProfile())?.role !== "admin") redirect("/admin");
  const p = schema.safeParse({ sponsor: formData.get("sponsor"), name: formData.get("name"), validFrom: formData.get("validFrom"), validTo: formData.get("validTo"), maxUses: formData.get("maxUses") });
  if (!p.success) redirect("/admin/sponsors?m=invalid");
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_create_sponsor_cohort", { p_sponsor_org: p.data.sponsor, p_name: p.data.name, p_valid_from: p.data.validFrom, p_valid_to: p.data.validTo, p_max_uses: p.data.maxUses });
  if (error) redirect("/admin/sponsors?m=refused");
  revalidatePath("/admin/sponsors");
  redirect("/admin/sponsors?m=created");
}

export async function closeCohortAction(formData: FormData): Promise<void> {
  if ((await getCurrentProfile())?.role !== "admin") redirect("/admin");
  const id = z.string().uuid().safeParse(formData.get("cohortId"));
  if (!id.success) redirect("/admin/sponsors?m=invalid");
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_close_sponsor_cohort", { p_cohort: id.data });
  if (error) redirect("/admin/sponsors?m=refused");
  revalidatePath("/admin/sponsors");
  redirect("/admin/sponsors?m=closed");
}
