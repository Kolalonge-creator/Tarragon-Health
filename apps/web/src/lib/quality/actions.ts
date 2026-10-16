"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { canAssignCases } from "@/lib/clinical/doctor-tier";
import { createClient } from "@/lib/supabase/server";
import { loose } from "@/lib/clinician/loose-client";
import { extraRpcArgs, formSchema, HANDBACK_OUTCOMES, parseAuditForm, type Notice } from "./model";

/**
 * S36c and S20 v2 server actions, run only when a person presses a button. The database is the protection (credential_is_cmo, no self
 * audit, assigned reviewer only, the open-before-submit gate, the second-review rule, the rules in submit_clinical_audit); these checks give
 * a clear message first and never trust the page. A database error text is never shown: the address carries a fixed notice token.
 */
const idSchema = z.string().uuid();
const back = (n: Notice): never => redirect(`/clinician/quality?n=${n}`);
const backToAudit = (id: string, n: Notice): never => redirect(`/clinician/quality/audits/${id}?n=${n}`);

function safeJson(v: FormDataEntryValue | null): unknown {
  try {
    return typeof v === "string" ? JSON.parse(v) : null;
  } catch {
    return null;
  }
}

async function mayLead(): Promise<boolean> {
  return canAssignCases(await getCurrentClinicalStaff());
}

/** First score or second review: `mode` is a hidden field, the database decides whether this person may do either. */
export async function submitAuditAction(formData: FormData): Promise<void> {
  if (!(await mayLead())) return redirect("/clinician");
  const id = idSchema.safeParse(formData.get("audit"));
  if (!id.success) return back("audit_failed");

  // The item list travels with the form. A tampered list gains nothing: the database demands exactly the stored form's items
  // and refuses anything else, and it computes the score and outcome itself. Not re-reading the case file also avoids a second logged read.
  const form = formSchema.safeParse(safeJson(formData.get("form")));
  if (!form.success) return back("audit_failed");
  const second = formData.get("mode") === "second";
  const scribeAssisted = formData.get("scribe_assisted") === "yes";
  const payload = parseAuditForm(formData, form.data, scribeAssisted);
  if (!payload.ok) return backToAudit(id.data, "audit_incomplete");

  const { error } = await loose(await createClient()).rpc(second ? "submit_second_audit_review" : "submit_clinical_audit", {
    p_audit: id.data,
    p_safety: payload.safety,
    p_quality: payload.quality,
    p_rationale: payload.rationale,
    ...extraRpcArgs(payload, second),
  });
  if (error) return backToAudit(id.data, "audit_failed");
  return back(second ? "second_review_submitted" : "audit_submitted");
}

export async function closeHandbackReviewAction(formData: FormData): Promise<void> {
  if (!(await mayLead())) return redirect("/clinician");
  const id = idSchema.safeParse(formData.get("review"));
  const outcome = z.enum(HANDBACK_OUTCOMES).safeParse(formData.get("outcome"));
  const note = String(formData.get("note") ?? "").trim();
  if (!id.success || !outcome.success || note.length < 10) return back("review_failed");
  const { error } = await loose(await createClient()).rpc("close_handback_review", { p_review: id.data, p_outcome: outcome.data, p_note: note });
  return back(error ? "review_failed" : "review_closed");
}

/** Q7: the lead asks for an audit of one completed task. The task id is pasted from the task page; the database checks it is a finished task. */
export async function requestAuditAction(formData: FormData): Promise<void> {
  if (!(await mayLead())) return redirect("/clinician");
  const task = idSchema.safeParse(String(formData.get("task") ?? "").trim());
  if (!task.success) return back("request_failed");
  const { error } = await loose(await createClient()).rpc("request_clinical_audit", { p_task: task.data });
  return back(error ? "request_failed" : "audit_requested");
}

export async function reassignAuditAction(formData: FormData): Promise<void> {
  if (!(await mayLead())) return redirect("/clinician");
  const audit = idSchema.safeParse(formData.get("audit"));
  const reviewer = idSchema.safeParse(formData.get("reviewer"));
  if (!audit.success || !reviewer.success) return back("reassign_failed");
  const { error } = await loose(await createClient()).rpc("reassign_clinical_audit", { p_audit: audit.data, p_reviewer: reviewer.data });
  return back(error ? "reassign_failed" : "audit_reassigned");
}

/** The follow-up is history: a note appends, the close happens once and is never overwritten (the database refuses a second close). */
export async function followupAction(formData: FormData): Promise<void> {
  if (!(await mayLead())) return redirect("/clinician");
  const audit = idSchema.safeParse(formData.get("audit"));
  const kind = z.enum(["note", "close"]).safeParse(formData.get("kind"));
  const note = String(formData.get("note") ?? "").trim();
  if (!audit.success || !kind.success || note.length < 20) return back("followup_failed");
  const { error } = await loose(await createClient()).rpc(kind.data === "close" ? "close_audit_followup" : "add_audit_followup_note", { p_audit: audit.data, p_note: note });
  if (error) return back("followup_failed");
  return back(kind.data === "close" ? "followup_closed" : "followup_noted");
}

export async function extendTier1Action(formData: FormData): Promise<void> {
  if (!(await mayLead())) return redirect("/clinician");
  const staff = idSchema.safeParse(formData.get("staff"));
  const extra = z.coerce.number().int().min(1).max(20).safeParse(formData.get("extra"));
  const reason = String(formData.get("reason") ?? "").trim();
  if (!staff.success || !extra.success || reason.length < 10) return back("tier1_failed");
  const { error } = await loose(await createClient()).rpc("extend_tier1_audits", { p_staff: staff.data, p_extra: extra.data, p_reason: reason });
  return back(error ? "tier1_failed" : "tier1_extended");
}

/** The audited clinician replies to a finished audit of their own work. Any clinician may call it; the database checks it is theirs. */
export async function replyToAuditAction(formData: FormData): Promise<void> {
  if ((await getCurrentClinicalStaff()) === null) return redirect("/clinician");
  const audit = idSchema.safeParse(formData.get("audit"));
  const body = z.string().trim().min(20).max(4000).safeParse(formData.get("body"));
  if (!audit.success || !body.success) return redirect("/clinician/my-quality?n=reply_failed");
  const { error } = await loose(await createClient()).rpc("reply_to_clinical_audit", { p_audit: audit.data, p_body: body.data });
  return redirect(`/clinician/my-quality?n=${error ? "reply_failed" : "reply_sent"}`);
}
