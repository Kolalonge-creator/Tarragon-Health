import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { worstStatusOf, type PatientContext } from "./reference-ranges";

/** Age in whole years, or null when the patient has no recorded date of birth. */
export function ageFrom(dateOfBirth: string | null): number | null {
  if (!dateOfBirth) return null;
  const dob = new Date(dateOfBirth);
  if (Number.isNaN(dob.getTime())) return null;
  const years = (Date.now() - dob.getTime()) / (365.2425 * 24 * 60 * 60 * 1000);
  return years >= 0 && years < 130 ? Math.floor(years) : null;
}

/**
 * The escalation bridge for a DRAFT (an AI reading, or results a Care Coordinator typed in by hand, CDE-02): when a draft looks
 * critical, the review alert already open for the document is raised to urgent so a doctor sees it first. It records no finding,
 * writes nothing to the patient's record and tells the patient nothing. raise_lab_extraction_alert enforces the rest: service-role
 * only, raise-only, never above 'urgent_escalation'.
 *
 * Never throws: a failure to escalate must never lose the draft. The alert still exists at its normal priority.
 */
export async function raiseIfCriticalDraft(
  service: SupabaseClient<Database>,
  params: {
    documentId: string;
    patientId: string;
    rows: readonly { code: string | null; value: number | null; valueText: string | null; status: string }[];
  },
): Promise<{ raised: boolean }> {
  try {
    const { data: profile } = await service.from("profiles").select("sex, date_of_birth").eq("id", params.patientId).maybeSingle();
    const ctx: PatientContext = {
      sex: profile?.sex === "male" || profile?.sex === "female" ? profile.sex : null,
      ageYears: ageFrom(profile?.date_of_birth ?? null),
    };
    const { status, reason } = worstStatusOf(params.rows, ctx);
    if (status !== "critical" || !reason) return { raised: false };
    await service.rpc("raise_lab_extraction_alert", {
      p_document_id: params.documentId,
      p_level: "urgent_escalation",
      p_reason: reason,
    });
    await service.from("lab_report_extractions").update({ critical_suspected: true }).eq("document_id", params.documentId);
    return { raised: true };
  } catch (error) {
    console.error("lab-reports: escalation bridge failed", error);
    return { raised: false };
  }
}
