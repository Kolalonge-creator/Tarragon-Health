import { renderToBuffer } from "@react-pdf/renderer";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import {
  PreventiveCarePlanDocument,
  type PreventiveCarePlanData,
} from "@/lib/preventive-care/preventive-care-plan-document";

export type GeneratePreventiveCarePlanPdfResult =
  | { ok: true; buffer: Buffer; filename: string }
  | { ok: false; error: "not_found" };

/**
 * Builds the take-anywhere preventive & chronic-care plan for one patient.
 *
 * There is no existing DB view or RPC that aggregates "what is this patient
 * due for" across screenings, vaccinations and the Annual Health Check —
 * each lives in its own table with its own reminder cron. This function is
 * the first place those three are read together, purely for this document;
 * it does not create a new aggregation table or change how any of the three
 * reminder pipelines work.
 *
 * Takes a SupabaseClient rather than constructing one, same rule as
 * generateLabRequestPdf: this function never decides its own authority, the
 * caller does by which client it hands in. The one caller today
 * (/api/patient/preventive-care-plan) passes the caller's own cookie-session
 * client, so every read is scoped by that session's RLS — a patientId the
 * caller cannot see simply returns no profile and this 404s.
 */
export async function generatePreventiveCarePlanPdf(
  supabase: SupabaseClient<Database>,
  patientId: string,
): Promise<GeneratePreventiveCarePlanPdfResult> {
  const { data: patient } = await supabase
    .from("profiles")
    .select("full_name, patient_number, date_of_birth, sex")
    .eq("id", patientId)
    .maybeSingle();
  if (!patient) return { ok: false, error: "not_found" };

  const { data: screeningRows } = await supabase
    .from("screening_schedules")
    .select(
      "due_date, status, screen_type:screen_types(name, patient_explainer, clinical_basis, frequency_months)",
    )
    .eq("patient_id", patientId)
    .in("status", ["pending", "overdue"])
    .order("due_date", { ascending: true });

  const screenings: PreventiveCarePlanData["screenings"] = (screeningRows ?? [])
    .filter((row) => row.screen_type)
    .map((row) => ({
      name: row.screen_type!.name,
      reason:
        row.screen_type!.patient_explainer ?? row.screen_type!.clinical_basis,
      dueDate: row.due_date,
      overdue: row.status === "overdue",
      frequencyMonths: row.screen_type!.frequency_months,
    }));

  const { data: vaccineRows } = await supabase
    .from("vaccination_schedules")
    .select(
      "due_date, status, vaccination_catalog:vaccination_catalog(name, description)",
    )
    .eq("patient_id", patientId)
    .in("status", ["pending", "overdue"])
    .order("due_date", { ascending: true });

  const vaccines: PreventiveCarePlanData["vaccines"] = (vaccineRows ?? [])
    .filter((row) => row.vaccination_catalog)
    .map((row) => ({
      name: row.vaccination_catalog!.name,
      reason: row.vaccination_catalog!.description,
      dueDate: row.due_date,
      overdue: row.status === "overdue",
    }));

  const currentYear = new Date().getFullYear();
  const { data: ahc } = await supabase
    .from("annual_health_checks")
    .select("year, status, completion_pct, reviewed_at")
    .eq("patient_id", patientId)
    .eq("year", currentYear)
    .maybeSingle();

  const data: PreventiveCarePlanData = {
    patientName: patient.full_name ?? "Patient",
    patientNumber: patient.patient_number,
    dateOfBirth: patient.date_of_birth,
    sex: patient.sex,
    generatedAt: new Date().toISOString(),
    screenings,
    vaccines,
    annualHealthCheck: ahc
      ? {
          year: ahc.year,
          status: ahc.status,
          completionPct: ahc.completion_pct,
          reviewedAt: ahc.reviewed_at,
        }
      : null,
  };

  const buffer = await renderToBuffer(PreventiveCarePlanDocument({ data }));
  const filename = `tarragon-preventive-care-plan-${patient.patient_number ?? patientId.slice(0, 8)}.pdf`;

  return { ok: true, buffer, filename };
}
