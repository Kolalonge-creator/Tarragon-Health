"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getCurrentClinicalStaff, getCurrentProfile } from "@/lib/auth/current-profile";
import { canAssignCases } from "@/lib/clinical/doctor-tier";
import { DASHBOARD_PATHS, type DashboardViewer } from "./dashboard-paths";

/**
 * The one write on the outcomes dashboard: make last month's (or any finished month's) report now, for a super admin or the Chief Medical
 * Officer. The database function re-checks the role and refuses everyone else with 42501 and refuses an unfinished month with 22023; the
 * check here only picks the right page to come back to. The outcome travels as one word in the address.
 */
async function viewerOf(raw: FormDataEntryValue | null): Promise<DashboardViewer | null> {
  if (raw === "admin") return (await getCurrentProfile())?.role === "admin" ? "admin" : null;
  if (raw === "cmo") return canAssignCases(await getCurrentClinicalStaff()) ? "cmo" : null;
  return null;
}

const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

export async function runDashboardAction(formData: FormData): Promise<void> {
  const viewer = await viewerOf(formData.get("viewer"));
  if (!viewer) redirect("/");
  const parsed = monthSchema.safeParse(formData.get("month"));
  if (!parsed.success) redirect(`${DASHBOARD_PATHS[viewer]}?r=run_error`);
  const supabase = await createClient();
  const { error } = await supabase.rpc("run_outcomes_dashboard_now", { p_month: `${parsed.data}-01` });
  if (error) redirect(`${DASHBOARD_PATHS[viewer]}?r=run_error`);
  revalidatePath(DASHBOARD_PATHS[viewer]);
  redirect(`${DASHBOARD_PATHS[viewer]}?r=run_done`);
}
