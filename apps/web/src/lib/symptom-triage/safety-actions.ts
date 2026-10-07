"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getCurrentClinicalStaff, getCurrentProfile } from "@/lib/auth/current-profile";
import { canAssignCases } from "@/lib/clinical/doctor-tier";

/**
 * S60: the two writes on the symptom checker safety page, for an admin or the Chief Medical Officer. The database functions
 * (record_regulatory_position, run_symptom_accuracy_audit_now) re-check the role and refuse everyone else with 42501; the check here
 * only picks the right page to come back to and gives a clear outcome. The outcome travels as one word in the address.
 */
const PATHS = { admin: "/admin/symptom-safety", cmo: "/clinician/symptom-safety" } as const;

async function viewerOf(raw: FormDataEntryValue | null): Promise<keyof typeof PATHS | null> {
  if (raw === "admin") return (await getCurrentProfile())?.role === "admin" ? "admin" : null;
  if (raw === "cmo") return canAssignCases(await getCurrentClinicalStaff()) ? "cmo" : null;
  return null;
}

const positionSchema = z.object({
  text: z.string().trim().min(40).max(4000),
  classification: z.enum(["decision_support_not_a_device", "regulated_medical_device_registered", "regulated_medical_device_not_registered", "not_yet_determined"]),
  counsel: z.string().trim().min(3).max(200),
  firm: z.string().trim().max(200).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  document: z.string().trim().max(300).optional(),
});

export async function recordPositionAction(formData: FormData): Promise<void> {
  const viewer = await viewerOf(formData.get("viewer"));
  if (!viewer) redirect("/");
  const parsed = positionSchema.safeParse({
    text: formData.get("text"),
    classification: formData.get("classification"),
    counsel: formData.get("counsel"),
    firm: (formData.get("firm") as string | null) || undefined,
    date: formData.get("date"),
    document: (formData.get("document") as string | null) || undefined,
  });
  if (!parsed.success) redirect(`${PATHS[viewer]}?r=position_input`);
  const v = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc("record_regulatory_position", {
    p_topic: "symptom_checker",
    p_position_text: v.text,
    p_classification: v.classification,
    p_counsel_name: v.counsel,
    p_counsel_firm: v.firm ?? "",
    p_position_date: v.date,
    p_document_ref: v.document ?? "",
  });
  if (error) redirect(`${PATHS[viewer]}?r=position_error`);
  revalidatePath(PATHS[viewer]);
  redirect(`${PATHS[viewer]}?r=position_done`);
}

const auditSchema = z.object({ month: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });

export async function runAuditAction(formData: FormData): Promise<void> {
  const viewer = await viewerOf(formData.get("viewer"));
  if (!viewer) redirect("/");
  const parsed = auditSchema.safeParse({ month: formData.get("month") });
  if (!parsed.success) redirect(`${PATHS[viewer]}?r=audit_error`);
  const supabase = await createClient();
  const { error } = await supabase.rpc("run_symptom_accuracy_audit_now", {
    p_month: parsed.data.month,
    p_include_test: formData.get("include_test") === "on",
  });
  if (error) redirect(`${PATHS[viewer]}?r=audit_error`);
  revalidatePath(PATHS[viewer]);
  redirect(`${PATHS[viewer]}?r=audit_done`);
}
