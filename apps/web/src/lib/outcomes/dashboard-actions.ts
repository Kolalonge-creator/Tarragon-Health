"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getCurrentClinicalStaff, getCurrentProfile } from "@/lib/auth/current-profile";
import { canAssignCases } from "@/lib/clinical/doctor-tier";
import { DASHBOARD_PATHS, type DashboardViewer } from "./dashboard-paths";
import { parseFounderView } from "./dashboard-report";
import type { FounderState } from "./founder-state";

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

const reasonSchema = z.string().trim().min(10).max(500);

/**
 * The founder's unfrozen view. The database function is the gate (super admin only, switch on, a reason, audited, nothing stored); this action only
 * turns its refusals into words and checks the shape. There is no CSV or file for this view, and it is never cached or revalidated.
 */
export async function readFounderViewAction(_prev: FounderState, formData: FormData): Promise<FounderState> {
  if ((await getCurrentProfile())?.role !== "admin") return { status: "error", message: "refused" };
  const reason = reasonSchema.safeParse(formData.get("reason"));
  if (!reason.success) return { status: "error", message: "reason" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("read_outcomes_founder_unfrozen", { p_reason: reason.data });
  if (error) {
    if (error.code === "55000") return { status: "error", message: "off" };
    if (error.code === "42501") return { status: "error", message: "refused" };
    if (error.code === "22023") return { status: "error", message: "reason" };
    return { status: "error", message: "failed" };
  }
  const view = parseFounderView(data);
  return view ? { status: "ok", view } : { status: "error", message: "failed" };
}
