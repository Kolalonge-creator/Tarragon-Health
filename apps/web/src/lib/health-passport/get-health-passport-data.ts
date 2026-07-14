import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";

/**
 * Health Passport — read-side query only, per FEATURE_SPEC.md §10's explicit
 * flag: "a unified 'Health Passport' view should be a read-side query, not a
 * new write table" (sign-off confirmed before building). Assembles data
 * already sitting in vitals_readings, screening_results, lab_analyte_readings
 * and escalations — no new table, no duplicated source of truth.
 *
 * Covers a trailing 12-month period, framed as a "period" per
 * docs/CLINICAL_TRUST_MODEL_SPEC.md's monthly/quarterly report language,
 * without actually scheduling a recurring job — this is patient-initiated
 * (view/download), not an automated email, matching FEATURE_SPEC.md's
 * free-tier "downloadable Health Passport PDF" framing.
 */

const PERIOD_MONTHS = 12;

export interface HealthPassportVitalsSummary {
  vitalType: Database["public"]["Enums"]["vital_type"];
  latest: Record<string, unknown>;
  takenAt: string;
  readingCount: number;
}

export interface HealthPassportScreening {
  screenTypeName: string;
  status: Database["public"]["Enums"]["screening_status"];
  dueDate: string;
  resultStatus: Database["public"]["Enums"]["result_status"] | null;
  resultSummary: string | null;
}

export interface HealthPassportEscalation {
  id: string;
  reason: string;
  reviewedAt: string;
}

export interface HealthPassportProtocolAuthor {
  fullName: string;
  credentialType: string | null;
  credentialNumber: string | null;
}

export interface HealthPassportData {
  periodStart: string;
  periodEnd: string;
  vitals: HealthPassportVitalsSummary[];
  screenings: HealthPassportScreening[];
  labReadings: { code: string; value: number; unit: string; takenAt: string }[];
  reviewedEscalations: HealthPassportEscalation[];
  protocolAuthor: HealthPassportProtocolAuthor | null;
}

export async function getHealthPassportData(
  supabase: SupabaseClient<Database>,
  patientId: string,
  organisationId: string
): Promise<HealthPassportData> {
  const periodEnd = new Date();
  const periodStart = new Date(periodEnd);
  periodStart.setMonth(periodStart.getMonth() - PERIOD_MONTHS);
  const periodStartIso = periodStart.toISOString();

  const [vitalsRes, screeningsRes, labRes, escalationsRes, careTeamRes] = await Promise.all([
    supabase
      .from("vitals_readings")
      .select("*")
      .eq("patient_id", patientId)
      .gte("taken_at", periodStartIso)
      .order("taken_at", { ascending: false }),
    supabase
      .from("screening_schedules")
      .select("status, due_date, screen_types(name), screening_results(result_status, result_summary)")
      .eq("patient_id", patientId)
      .gte("due_date", periodStart.toISOString().slice(0, 10)),
    supabase
      .from("lab_analyte_readings")
      .select("code, value, unit, taken_at")
      .eq("patient_id", patientId)
      .gte("taken_at", periodStartIso)
      .order("taken_at", { ascending: false }),
    supabase
      .from("escalations")
      .select("id, reason, reviewed_at")
      .eq("patient_id", patientId)
      .not("reviewed_by", "is", null)
      .not("reviewed_at", "is", null)
      .gte("reviewed_at", periodStartIso)
      .order("reviewed_at", { ascending: false }),
    supabase
      .from("care_team_assignment")
      .select("clinical_director_id")
      .eq("patient_id", patientId)
      .maybeSingle(),
  ]);

  // Latest reading per vital_type, plus a count within the period.
  const byType = new Map<string, { rows: Record<string, unknown>[] }>();
  for (const row of vitalsRes.data ?? []) {
    const key = row.vital_type;
    if (!byType.has(key)) byType.set(key, { rows: [] });
    byType.get(key)!.rows.push(row as unknown as Record<string, unknown>);
  }
  const vitals: HealthPassportVitalsSummary[] = [...byType.entries()].map(([vitalType, { rows }]) => ({
    vitalType: vitalType as Database["public"]["Enums"]["vital_type"],
    latest: rows[0],
    takenAt: rows[0].taken_at as string,
    readingCount: rows.length,
  }));

  const screenings: HealthPassportScreening[] = (screeningsRes.data ?? []).map((row) => {
    const screenType = row.screen_types as unknown as { name: string } | null;
    const results = row.screening_results as unknown as
      | { result_status: string; result_summary: string | null }[]
      | null;
    const latestResult = results && results.length > 0 ? results[0] : null;
    return {
      screenTypeName: screenType?.name ?? "Screening",
      status: row.status,
      dueDate: row.due_date,
      resultStatus:
        (latestResult?.result_status as Database["public"]["Enums"]["result_status"]) ?? null,
      resultSummary: latestResult?.result_summary ?? null,
    };
  });

  const reviewedEscalations: HealthPassportEscalation[] = (escalationsRes.data ?? []).map((row) => ({
    id: row.id,
    reason: row.reason,
    reviewedAt: row.reviewed_at as string,
  }));

  // Protocol author (Clinical Director) — care_team_assignment first (the
  // per-patient assignment), falling back to the org's active Clinical
  // Director directly for free-tier patients who don't have an assignment
  // yet (assignment requires a clinician-review entitlement).
  let protocolAuthor: HealthPassportProtocolAuthor | null = null;
  const directorId = careTeamRes.data?.clinical_director_id;
  if (directorId) {
    const { data } = await supabase
      .from("clinical_staff")
      .select("full_name, credential_type, credential_number")
      .eq("profile_id", directorId)
      .eq("active", true)
      .maybeSingle();
    if (data) {
      protocolAuthor = {
        fullName: data.full_name,
        credentialType: data.credential_type,
        credentialNumber: data.credential_number,
      };
    }
  }
  if (!protocolAuthor) {
    const { data } = await supabase
      .from("clinical_staff")
      .select("full_name, credential_type, credential_number")
      .eq("organisation_id", organisationId)
      .eq("role", "clinical_director")
      .eq("active", true)
      .limit(1)
      .maybeSingle();
    if (data) {
      protocolAuthor = {
        fullName: data.full_name,
        credentialType: data.credential_type,
        credentialNumber: data.credential_number,
      };
    }
  }

  return {
    periodStart: periodStartIso,
    periodEnd: periodEnd.toISOString(),
    vitals,
    screenings,
    labReadings: (labRes.data ?? []).map((row) => ({
      code: row.code,
      value: row.value,
      unit: row.unit,
      takenAt: row.taken_at,
    })),
    reviewedEscalations,
    protocolAuthor,
  };
}
