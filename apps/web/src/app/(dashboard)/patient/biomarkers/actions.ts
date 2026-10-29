"use server";

import { revalidatePath } from "next/cache";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { patientReportedLabSchema } from "@/lib/validation/patient-reported-lab";

export type ConfirmReportedValuesResult = { ok: true; saved: number } | { ok: false; error: string };

/**
 * A patient confirms, or corrects, the numbers read from a report they uploaded themselves. The numbers go to
 * patient_reported_lab_values (never the clinical record) and show on their own chart marked as theirs. Always the signed-in
 * person's own report: the database function uses the session, not an id from the form.
 */
export async function confirmMyLabReport(input: unknown): Promise<ConfirmReportedValuesResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sign in again to continue." };

  const parsed = patientReportedLabSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the numbers and try again." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("confirm_my_lab_report", {
    p_extraction_id: parsed.data.extractionId,
    p_readings: parsed.data.readings.map((r) => ({ code: r.code, value: r.value, unit: r.unit ?? null })),
    p_report_date: parsed.data.reportDate,
  });
  if (error) {
    // 22023 messages are written for people ("give the date printed on the report"). Anything else, including a permission error, is
    // never shown raw: it can carry internal wording.
    return { ok: false, error: error.code === "22023" ? error.message : "We could not save these numbers. Try again." };
  }
  revalidatePath("/patient/biomarkers");
  return { ok: true, saved: typeof data === "number" ? data : 0 };
}
