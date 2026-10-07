"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { canAssignCases } from "@/lib/clinical/doctor-tier";
import { createClient } from "@/lib/supabase/server";
import { loose } from "@/lib/clinician/loose-client";
import { HANDBACK_OUTCOMES, parseAuditForm, type Notice } from "./model";

/**
 * S36c server actions, run only when the lead presses a button. The database is the protection (credential_is_cmo, no self audit,
 * assigned reviewer only, the rules in submit_clinical_audit); these checks give a clear message first and never trust the page.
 */
const idSchema = z.string().uuid();
const back = (n: Notice): never => redirect(`/clinician/quality?n=${n}`);

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

export async function submitAuditAction(formData: FormData): Promise<void> {
  if (!(await mayLead())) return redirect("/clinician");
  const id = idSchema.safeParse(formData.get("audit"));
  if (!id.success) return back("audit_failed");

  // The item list travels with the form. A tampered list gains nothing: submit_clinical_audit demands exactly the stored form's items
  // and refuses anything else, and it computes the score and outcome itself. Not re-reading the case file also avoids a second logged read.
  const form = z
    .object({ safety_items: z.array(z.string()).min(1), quality_items: z.array(z.string()).min(1), quality_max: z.number().int().positive() })
    .safeParse(safeJson(formData.get("form")));
  if (!form.success) return back("audit_failed");
  const payload = parseAuditForm(formData, form.data);
  if (!payload.ok) return redirect(`/clinician/quality/audits/${id.data}?n=audit_incomplete`);

  const { error } = await loose(await createClient()).rpc("submit_clinical_audit", {
    p_audit: id.data,
    p_safety: payload.safety,
    p_quality: payload.quality,
    p_rationale: payload.rationale,
  });
  if (error) return redirect(`/clinician/quality/audits/${id.data}?n=audit_failed`);
  return back("audit_submitted");
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
