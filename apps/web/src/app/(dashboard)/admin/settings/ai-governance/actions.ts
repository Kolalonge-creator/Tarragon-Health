"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { AI_INCIDENT_CATEGORIES } from "@/lib/ai-governance";

const PATH = "/admin/settings/ai-governance";

export type AiGovernanceActionState = { error?: string; success?: string } | undefined;

const killSwitchSchema = z.object({
  systemId: z.string().uuid(),
  enabled: z.enum(["on", "off"]),
  reason: z.string().trim().min(10, "Say why in a sentence. This goes on the record."),
});

/**
 * The kill switch (Module 40.17). The database RPC is the real gate: it
 * requires an admin or an active Clinical Director, re-checks the 40.20
 * acceptance criteria before it will switch anything ON, records who and
 * why, and pages clinical operations on the way OFF. This action exists to
 * validate the form and surface the RPC's own message, not to make the
 * decision — a second, softer copy of the rule here is how the two drift.
 */
export async function setAiSystemEnabledAction(
  _prev: AiGovernanceActionState,
  formData: FormData
): Promise<AiGovernanceActionState> {
  const parsed = killSwitchSchema.safeParse({
    systemId: formData.get("systemId"),
    enabled: formData.get("enabled"),
    reason: formData.get("reason"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_ai_system_enabled", {
    p_id: parsed.data.systemId,
    p_enabled: parsed.data.enabled === "on",
    p_reason: parsed.data.reason,
  });
  if (error) return { error: error.message };

  revalidatePath(PATH);
  return {
    success:
      parsed.data.enabled === "on"
        ? "Switched on. The fallback path is no longer in use for this system."
        : "Switched off. Callers now run the fallback path, and clinical operations have been notified.",
  };
}

const triageSchema = z.object({
  incidentId: z.string().uuid(),
  severity: z.enum(["low", "moderate", "high", "critical"]),
  note: z.string().trim().optional(),
});

/** Clinician-only triage (40.12). The RPC enforces that, not this action. */
export async function triageAiIncidentAction(
  _prev: AiGovernanceActionState,
  formData: FormData
): Promise<AiGovernanceActionState> {
  const parsed = triageSchema.safeParse({
    incidentId: formData.get("incidentId"),
    severity: formData.get("severity"),
    note: formData.get("note") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("triage_ai_safety_incident", {
    p_id: parsed.data.incidentId,
    p_severity: parsed.data.severity,
    p_note: parsed.data.note,
  });
  if (error) return { error: error.message };

  revalidatePath(PATH);
  return { success: "Triaged." };
}

const resolveSchema = z.object({
  incidentId: z.string().uuid(),
  status: z.enum(["resolved", "dismissed"]),
  clinicalReviewSummary: z
    .string()
    .trim()
    .min(10, "Closing an incident needs a clinical review summary."),
  correctiveAction: z.string().trim().optional(),
  patientHarmOccurred: z.enum(["yes", "no"]).optional(),
  harmDescription: z.string().trim().optional(),
});

/**
 * Close an incident (40.12). "Dismissed" is a clinical decision on the
 * record, not a way to make a report go away: the RPC demands a review
 * summary and audit-logs the closure either way.
 */
export async function resolveAiIncidentAction(
  _prev: AiGovernanceActionState,
  formData: FormData
): Promise<AiGovernanceActionState> {
  const parsed = resolveSchema.safeParse({
    incidentId: formData.get("incidentId"),
    status: formData.get("status"),
    clinicalReviewSummary: formData.get("clinicalReviewSummary"),
    correctiveAction: formData.get("correctiveAction") || undefined,
    patientHarmOccurred: formData.get("patientHarmOccurred") || undefined,
    harmDescription: formData.get("harmDescription") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  }

  const harm =
    parsed.data.patientHarmOccurred === undefined
      ? undefined
      : parsed.data.patientHarmOccurred === "yes";

  if (harm && !parsed.data.harmDescription) {
    return { error: "Describe the harm before recording that harm occurred." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("resolve_ai_safety_incident", {
    p_id: parsed.data.incidentId,
    p_status: parsed.data.status,
    p_clinical_review_summary: parsed.data.clinicalReviewSummary,
    p_corrective_action: parsed.data.correctiveAction,
    p_patient_harm_occurred: harm,
    p_harm_description: parsed.data.harmDescription,
  });
  if (error) return { error: error.message };

  revalidatePath(PATH);
  return { success: parsed.data.status === "resolved" ? "Resolved." : "Dismissed, with the review on file." };
}

/**
 * Activate a governed prompt version (40.6). Clinical-Director-gated in the
 * database for any clinically meaningful or high-risk system.
 */
export async function activateAiPromptVersionAction(
  _prev: AiGovernanceActionState,
  formData: FormData
): Promise<AiGovernanceActionState> {
  const id = z.string().uuid().safeParse(formData.get("promptVersionId"));
  if (!id.success) return { error: "Pick a prompt version." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("activate_ai_prompt_version", {
    p_id: id.data,
    p_note: String(formData.get("note") ?? "").trim() || undefined,
  });
  if (error) return { error: error.message };

  revalidatePath(PATH);
  return { success: "Activated. The runtime picks it up within a minute." };
}

const versionApprovalSchema = z.object({
  versionId: z.string().uuid(),
  note: z.string().trim().optional(),
});

/**
 * Approve an `ai_system_versions` row (40.9's release gate, 40.2's per-
 * version record). `public.approve_ai_system_version` is the real gate: it
 * requires an admin or an active Clinical Director (a Clinical Director
 * specifically for anything clinically meaningful or high-risk), and refuses
 * outright unless every required evaluation suite already has a completed
 * passing run against this exact version — this action surfaces that refusal
 * rather than working around it. Approving is what satisfies the 40.20
 * "validation" acceptance criterion for the system.
 */
export async function approveAiSystemVersionAction(
  _prev: AiGovernanceActionState,
  formData: FormData
): Promise<AiGovernanceActionState> {
  const parsed = versionApprovalSchema.safeParse({
    versionId: formData.get("versionId"),
    note: formData.get("note") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("approve_ai_system_version", {
    p_version_id: parsed.data.versionId,
    p_note: parsed.data.note,
  });
  if (error) return { error: error.message };

  revalidatePath(PATH);
  return { success: "Approved. This version now satisfies the platform's validation acceptance criterion." };
}

const labelCaseTierSchema = z.object({
  caseId: z.string().uuid(),
  tier: z.enum(["routine", "clinician_review", "emergency"]),
  rationale: z.string().trim().optional(),
});

/**
 * Records a Chief Medical Officer's own independent tier judgement for one
 * clinical-accuracy scenario (40.20/40.9). `public.label_ai_evaluation_case_tier`
 * is the real gate: only an active Chief Medical Officer's call is accepted,
 * and this action never sees or infers a tier itself — it only forwards
 * whatever the form submitted.
 */
export async function labelAiEvaluationCaseTierAction(
  _prev: AiGovernanceActionState,
  formData: FormData
): Promise<AiGovernanceActionState> {
  const parsed = labelCaseTierSchema.safeParse({
    caseId: formData.get("caseId"),
    tier: formData.get("tier"),
    rationale: formData.get("rationale") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Choose a tier and try again." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("label_ai_evaluation_case_tier", {
    p_case_id: parsed.data.caseId,
    p_tier: parsed.data.tier,
    p_rationale: parsed.data.rationale,
  });
  if (error) return { error: error.message };

  revalidatePath(PATH);
  return { success: "Recorded. Once every case in this suite is labelled, it can be run against the coach." };
}

const staffReportSchema = z.object({
  systemCode: z.string().trim().min(1),
  category: z.enum(AI_INCIDENT_CATEGORIES),
  description: z.string().trim().min(10, "A sentence or two on what went wrong."),
  interactionId: z.string().uuid().optional(),
});

/** Staff-side incident report, for something noticed outside a specific turn. */
export async function reportAiIncidentFromConsoleAction(
  _prev: AiGovernanceActionState,
  formData: FormData
): Promise<AiGovernanceActionState> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not authorised" };

  const parsed = staffReportSchema.safeParse({
    systemCode: formData.get("systemCode"),
    category: formData.get("category"),
    description: formData.get("description"),
    interactionId: formData.get("interactionId") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("report_ai_safety_incident", {
    p_system_code: parsed.data.systemCode,
    p_category: parsed.data.category,
    p_description: parsed.data.description,
    p_interaction_id: parsed.data.interactionId,
  });
  if (error) return { error: error.message };

  revalidatePath(PATH);
  return { success: "Reported. It is now on the incident queue for triage." };
}
