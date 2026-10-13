"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { hasPermission } from "@/lib/auth/permissions";
import { canAssignCases } from "@/lib/clinical/doctor-tier";
import { createClient } from "@/lib/supabase/server";
import { loose } from "@/lib/clinician/loose-client";
import type { Notice } from "./model";

/**
 * S36d server actions. Two doors, as in S37: operations (a clinical_staff.manage holder or an admin) at /admin/ops/clinicians, and the
 * clinical lead (the CMO) at /clinician/roster. The database is the protection (can_view_clinician_roster, credential_is_cmo, reasons,
 * no self-action); these checks give a clear message first and never trust the page. Every call uses the signed-in user's session.
 */
const idSchema = z.string().uuid();
const codeSchema = z.string().min(1).max(60);
const OPS = "/admin/ops/clinicians";
const LEAD = "/clinician/roster";
const back = (path: string, n: Notice): never => redirect(`${path}?n=${n}`);
const text = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

async function opsAllowed(): Promise<boolean> {
  return hasPermission("clinical_staff.manage");
}
async function leadAllowed(): Promise<boolean> {
  return canAssignCases(await getCurrentClinicalStaff());
}

export async function opsSuspendAction(formData: FormData): Promise<void> {
  if (!(await opsAllowed())) return redirect("/admin");
  const staff = idSchema.safeParse(formData.get("staff"));
  const reason = text(formData, "reason");
  if (!staff.success || reason.length < 10) return back(OPS, "suspend_failed");
  const { error } = await loose(await createClient()).rpc("ops_suspend_clinician", { p_staff: staff.data, p_reason: reason });
  return back(OPS, error ? "suspend_failed" : "suspended");
}

export async function opsRequestAction(formData: FormData): Promise<void> {
  if (!(await opsAllowed())) return redirect("/admin");
  const staff = idSchema.safeParse(formData.get("staff"));
  const kind = z.enum(["competency_grant", "reinstatement"]).safeParse(formData.get("kind"));
  const reason = text(formData, "reason");
  const code = kind.success && kind.data === "competency_grant" ? codeSchema.safeParse(formData.get("competency")) : null;
  if (!staff.success || !kind.success || reason.length < 10 || (code && !code.success)) return back(OPS, "request_failed");
  const { error } = await loose(await createClient()).rpc("request_clinician_change", {
    p_staff: staff.data, p_kind: kind.data, p_competency: code && code.success ? code.data : null, p_reason: reason,
  });
  return back(OPS, error ? "request_failed" : "requested");
}

export async function leadSuspendAction(formData: FormData): Promise<void> {
  if (!(await leadAllowed())) return redirect("/clinician");
  const staff = idSchema.safeParse(formData.get("staff"));
  const reason = text(formData, "reason");
  if (!staff.success || reason.length < 10) return back(LEAD, "suspend_failed");
  const { error } = await loose(await createClient()).rpc("suspend_clinician", { p_staff: staff.data, p_reason: reason });
  return back(LEAD, error ? "suspend_failed" : "suspended");
}

export async function leadReinstateAction(formData: FormData): Promise<void> {
  if (!(await leadAllowed())) return redirect("/clinician");
  const staff = idSchema.safeParse(formData.get("staff"));
  const reason = text(formData, "reason");
  if (!staff.success || reason.length < 10) return back(LEAD, "reinstate_failed");
  const { error } = await loose(await createClient()).rpc("reinstate_clinician", { p_staff: staff.data, p_reason: reason });
  return back(LEAD, error ? "reinstate_failed" : "reinstated");
}

export async function leadGrantAction(formData: FormData): Promise<void> {
  if (!(await leadAllowed())) return redirect("/clinician");
  const staff = idSchema.safeParse(formData.get("staff"));
  const code = codeSchema.safeParse(formData.get("competency"));
  if (!staff.success || !code.success) return back(LEAD, "grant_failed");
  const { error } = await loose(await createClient()).rpc("grant_clinician_competency", { p_staff: staff.data, p_code: code.data });
  return back(LEAD, error ? "grant_failed" : "granted");
}

export async function leadRevokeAction(formData: FormData): Promise<void> {
  if (!(await leadAllowed())) return redirect("/clinician");
  const staff = idSchema.safeParse(formData.get("staff"));
  const code = codeSchema.safeParse(formData.get("competency"));
  if (!staff.success || !code.success) return back(LEAD, "revoke_failed");
  const { error } = await loose(await createClient()).rpc("revoke_clinician_competency", { p_staff: staff.data, p_code: code.data });
  return back(LEAD, error ? "revoke_failed" : "revoked");
}

export async function leadDecideAction(formData: FormData): Promise<void> {
  if (!(await leadAllowed())) return redirect("/clinician");
  const request = idSchema.safeParse(formData.get("request"));
  const decision = z.enum(["approve", "decline"]).safeParse(formData.get("decision"));
  const note = text(formData, "note");
  if (!request.success || !decision.success) return back(LEAD, "decide_failed");
  if (decision.data === "decline" && note.length < 10) return back(LEAD, "decide_failed");
  const { error } = await loose(await createClient()).rpc("decide_clinician_change", {
    p_request: request.data, p_approve: decision.data === "approve", p_note: note || null,
  });
  return back(LEAD, error ? "decide_failed" : "decided");
}
