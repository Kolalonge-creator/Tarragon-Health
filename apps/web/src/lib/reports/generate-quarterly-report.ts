import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { getHealthPassportData, type HealthPassportData } from "@/lib/health-passport/get-health-passport-data";

const QUARTER_MONTHS = 3;

export type QuarterlyReportSnapshot = {
  data: HealthPassportData;
};

/**
 * Data assembly for the ParentCare/Family Premium quarterly PDF report —
 * reuses getHealthPassportData's vitals/screenings/labs/escalations query
 * (parametrized to a 3-month window instead of Health Passport's 12) rather
 * than a bespoke assembler, since the underlying sources and shape are
 * identical, only the lookback window differs.
 */
export async function generateQuarterlyReportData(
  supabase: SupabaseClient<Database>,
  patientId: string,
  organisationId: string
): Promise<QuarterlyReportSnapshot> {
  const data = await getHealthPassportData(supabase, patientId, organisationId, QUARTER_MONTHS);
  return { data };
}

/**
 * Generates and archives one quarterly report row for a patient — the
 * insert relies on patient_quarterly_reports' service-role-only INSERT
 * policy, so `supabase` here must be a service-role client (the scheduled
 * cron route), never a user-session client.
 */
export async function generateAndStoreQuarterlyReport(
  supabase: SupabaseClient<Database>,
  patientId: string,
  organisationId: string
): Promise<void> {
  const { data } = await generateQuarterlyReportData(supabase, patientId, organisationId);
  const { error } = await supabase.from("patient_quarterly_reports").insert({
    patient_id: patientId,
    organisation_id: organisationId,
    period_start: data.periodStart.slice(0, 10),
    period_end: data.periodEnd.slice(0, 10),
    snapshot: data as unknown as Database["public"]["Tables"]["patient_quarterly_reports"]["Insert"]["snapshot"],
  });
  if (error) throw error;
}
