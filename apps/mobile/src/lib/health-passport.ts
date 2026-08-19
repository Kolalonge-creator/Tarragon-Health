import { supabase } from "./supabase";

export interface PassportVitalsSummary {
  vitalType: string;
  latest: Record<string, unknown>;
  takenAt: string;
  readingCount: number;
}

export interface PassportScreening {
  screenTypeName: string;
  status: string;
  dueDate: string;
  resultStatus: string | null;
}

export interface PassportLabReading {
  code: string;
  value: number;
  unit: string;
  takenAt: string;
}

export interface HealthPassportSummary {
  periodStart: string;
  vitals: PassportVitalsSummary[];
  screenings: PassportScreening[];
  labReadings: PassportLabReading[];
  protocolAuthorName: string | null;
  protocolAuthorCredential: string | null;
}

const PERIOD_MONTHS = 12;

/**
 * Read-only mirror of getHealthPassportData in
 * apps/web/src/lib/health-passport/get-health-passport-data.ts, trimmed to
 * what the native summary card shows (drops BMI/escalations — those stay a
 * WebView-only detail for now). No Ed25519 signing/verification exists in
 * this codebase yet — this is a plain RLS-scoped read, same as the web page.
 */
export async function getHealthPassportSummary(
  patientId: string,
  organisationId: string
): Promise<HealthPassportSummary> {
  const periodStart = new Date();
  periodStart.setMonth(periodStart.getMonth() - PERIOD_MONTHS);
  const periodStartIso = periodStart.toISOString();

  const [vitalsRes, screeningsRes, labRes, careTeamRes] = await Promise.all([
    supabase
      .from("vitals_readings")
      .select("*")
      .eq("patient_id", patientId)
      .gte("taken_at", periodStartIso)
      .order("taken_at", { ascending: false }),
    supabase
      .from("screening_schedules")
      .select("status, due_date, screen_types(name), screening_results(result_status)")
      .eq("patient_id", patientId)
      .gte("due_date", periodStart.toISOString().slice(0, 10)),
    supabase
      .from("lab_analyte_readings")
      .select("code, value, unit, taken_at")
      .eq("patient_id", patientId)
      .gte("taken_at", periodStartIso)
      .order("taken_at", { ascending: false }),
    supabase.from("care_team_assignment").select("clinical_director_id").eq("patient_id", patientId).maybeSingle(),
  ]);

  const byType = new Map<string, Record<string, unknown>[]>();
  for (const row of vitalsRes.data ?? []) {
    const key = row.vital_type;
    if (!byType.has(key)) byType.set(key, []);
    byType.get(key)!.push(row as unknown as Record<string, unknown>);
  }
  const vitals: PassportVitalsSummary[] = [...byType.entries()].map(([vitalType, rows]) => ({
    vitalType,
    latest: rows[0],
    takenAt: rows[0].taken_at as string,
    readingCount: rows.length,
  }));

  const screenings: PassportScreening[] = (screeningsRes.data ?? []).map((row) => {
    const screenType = row.screen_types as unknown as { name: string } | null;
    const results = row.screening_results as unknown as { result_status: string }[] | null;
    return {
      screenTypeName: screenType?.name ?? "Screening",
      status: row.status,
      dueDate: row.due_date,
      resultStatus: results && results.length > 0 ? results[0].result_status : null,
    };
  });

  const labReadings: PassportLabReading[] = (labRes.data ?? [])
    .filter((row): row is typeof row & { value: number; unit: string } => row.value !== null && row.unit !== null)
    .map((row) => ({ code: row.code, value: row.value, unit: row.unit, takenAt: row.taken_at }));

  let protocolAuthorName: string | null = null;
  let protocolAuthorCredential: string | null = null;
  const directorId = careTeamRes.data?.clinical_director_id;
  const directorQuery = directorId
    ? supabase
        .from("clinical_staff")
        .select("full_name, credential_type, credential_number")
        .eq("profile_id", directorId)
        .eq("active", true)
        .maybeSingle()
    : supabase
        .from("clinical_staff")
        .select("full_name, credential_type, credential_number")
        .eq("organisation_id", organisationId)
        .eq("is_clinical_director", true)
        .eq("active", true)
        .limit(1)
        .maybeSingle();
  const { data: author } = await directorQuery;
  if (author) {
    protocolAuthorName = author.full_name;
    protocolAuthorCredential =
      author.credential_type && author.credential_number
        ? `${author.credential_type} ${author.credential_number}`
        : null;
  }

  return { periodStart: periodStartIso, vitals, screenings, labReadings, protocolAuthorName, protocolAuthorCredential };
}
