"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isClinicalTier } from "@/lib/clinical/doctor-tier";
import {
  addIncidentDetailSchema,
  fileIncidentReportSchema,
  reviewIncidentReportSchema,
} from "@/lib/validation/clinical-incidents";

export type IncidentActionResult = { error?: string; success?: boolean };

/**
 * Clinical incident / near-miss reporting (spec §31.7–§31.10).
 *
 * Every write here goes through the caller's own RLS-scoped session, never the
 * service-role client: `auth.uid()` has to genuinely be the person filing or
 * reviewing, because `private.enforce_clinical_incident_report_attribution`
 * derives reported_by / reviewed_by_staff / closed_by_staff from it. Reaching
 * for the service role would not just bypass RLS — it would break the
 * attribution the log exists to produce.
 */

function firstIssue(error: { issues: { message: string }[] }): string {
  return error.issues[0]?.message ?? "Check the form and try again.";
}

/**
 * File a report. Open to anyone on the org staff, by design — a Care
 * Coordinator noticing a near miss and reporting it is the safety culture
 * this log exists to enable, and filing is not among the three acts CLAUDE.md
 * restricts a Care Coordinator from (medications, escalation resolution,
 * protocol signing).
 *
 * organisation_id is read from the caller's own profile rather than accepted
 * from the form: it is the tenant key every RLS policy on this table keys off,
 * and a client-supplied one is exactly the value an attacker would change.
 */
export async function fileIncidentReport(
  input: unknown,
): Promise<IncidentActionResult & { id?: string }> {
  const parsed = fileIncidentReportSchema.safeParse(input);
  if (!parsed.success) return { error: firstIssue(parsed.error) };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const { data: profile } = await supabase
    .from("profiles")
    .select("organisation_id")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile?.organisation_id) {
    return { error: "Your account is not attached to an organisation" };
  }

  const { data, error } = await supabase
    .from("clinical_incident_reports")
    .insert({
      organisation_id: profile.organisation_id,
      category: parsed.data.category,
      severity: parsed.data.severity,
      description: parsed.data.description,
      patient_id: parsed.data.patient_id ?? null,
      occurred_at: parsed.data.occurred_at ?? null,
      immediate_action_taken: parsed.data.immediate_action_taken ?? null,
      contributing_factors: parsed.data.contributing_factors ?? null,
    })
    .select("id")
    .single();
  if (error) return { error: error.message };

  revalidatePath("/clinician/incidents");
  revalidatePath("/clinician/safety");
  return { success: true, id: data.id };
}

/**
 * Add narrative to a report without changing its state. Needs no clinical
 * authority: the trigger's early return on `new.status = old.status` is what
 * lets the person who filed a report in a hurry finish it later.
 */
export async function addIncidentDetail(input: unknown): Promise<IncidentActionResult> {
  const parsed = addIncidentDetailSchema.safeParse(input);
  if (!parsed.success) return { error: firstIssue(parsed.error) };

  const { incident_id: incidentId, ...fields } = parsed.data;
  if (fields.immediate_action_taken === undefined && fields.contributing_factors === undefined) {
    return { error: "Nothing to add." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const { error } = await supabase
    .from("clinical_incident_reports")
    .update(fields)
    .eq("id", incidentId);
  if (error) return { error: error.message };

  revalidatePath("/clinician/incidents");
  return { success: true };
}

/**
 * Move a report through review, or close it (§31.8).
 *
 * Gated on isClinicalTier so a Care Coordinator gets a sentence rather than a
 * raw 42501 from the trigger — the same friendly-early-refusal pattern as
 * decideVaccinationVerification. The trigger itself remains the enforcement
 * boundary, and it is stricter than this check in one way worth keeping in
 * mind: it also refuses any edit at all to an already-closed report, which is
 * why a stale tab showing a Close button on a closed report fails safely.
 */
export async function reviewIncidentReport(input: unknown): Promise<IncidentActionResult> {
  const parsed = reviewIncidentReportSchema.safeParse(input);
  if (!parsed.success) return { error: firstIssue(parsed.error) };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const { data: staff } = await supabase
    .from("clinical_staff")
    .select("doctor_tier, is_clinical_director")
    .eq("profile_id", user.id)
    .eq("active", true)
    .maybeSingle();
  if (!isClinicalTier(staff ?? null)) {
    return {
      error:
        "Only a clinical-tier member of the care team can review or close an incident report. You can still file one and add detail to it.",
    };
  }

  const { incident_id: incidentId, status, review_outcome, corrective_action } = parsed.data;

  // reviewed_by_staff / reviewed_at / closed_by_staff / closed_at are all
  // stamped by the trigger from auth.uid(). Sending them from here would be
  // both ignored and misleading to read.
  //
  // Only the fields actually supplied are sent. Writing `?? null` instead
  // would blank an outcome a reviewer had already recorded whenever they
  // moved the report on a step without retyping it.
  const patch: {
    status: typeof status;
    review_outcome?: string;
    corrective_action?: string;
  } = { status };
  if (review_outcome !== undefined) patch.review_outcome = review_outcome;
  if (corrective_action !== undefined) patch.corrective_action = corrective_action;

  const { error } = await supabase
    .from("clinical_incident_reports")
    .update(patch)
    .eq("id", incidentId);
  if (error) return { error: error.message };

  revalidatePath("/clinician/incidents");
  revalidatePath("/clinician/safety");
  return { success: true };
}
