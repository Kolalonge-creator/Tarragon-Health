import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { resolveProtocolsForPatient, primaryProtocol } from "./protocol";
import { matchRedFlags, type CaseFacts } from "./propose";

/**
 * Loads everything the deterministic rule engine needs for one case.
 *
 * The read/decide split is deliberate: everything that touches the database
 * lives here, and proposeActions stays a pure function of the result. That is
 * what makes the rules unit-testable without a live Supabase client, and it
 * keeps "what the engine may look at" to a single reviewable surface -- a rule
 * cannot quietly start consulting some new table without a change here.
 *
 * RLS is the tenancy gate throughout, as everywhere else in this app: this
 * runs on the CALLER'S session, not the service role, so a case outside the
 * caller's organisation simply returns nothing.
 */
export interface LoadedCase {
  facts: CaseFacts;
  patientId: string;
  organisationId: string;
}

export async function loadCaseFacts(
  supabase: SupabaseClient<Database>,
  clinicianAlertId: string
): Promise<LoadedCase | null> {
  const { data: alert } = await supabase
    .from("clinician_alerts")
    .select("title, detail, level, override_level, patient_id, organisation_id")
    .eq("id", clinicianAlertId)
    .maybeSingle();

  if (!alert) return null;

  const { patient_id: patientId, organisation_id: organisationId } = alert;
  const today = new Date().toISOString().slice(0, 10);

  const [
    { data: escalation },
    { data: medications },
    { data: schedules },
    { data: enrolments },
    { data: vitals },
    protocols,
  ] = await Promise.all([
    supabase
      .from("escalations")
      .select("id, status")
      .eq("clinician_alert_id", clinicianAlertId)
      .maybeSingle(),
    supabase
      .from("medications")
      .select("id, drug_name, dose, refill_date")
      .eq("patient_id", patientId)
      .eq("is_active", true),
    // Due or overdue only. A schedule that is not yet due is not a finding,
    // and proposing an early order would be the engine inventing work.
    supabase
      .from("screening_schedules")
      .select("id, due_date, screen_type:screen_types(code, name)")
      .eq("patient_id", patientId)
      .eq("status", "pending")
      .lte("due_date", today)
      .order("due_date", { ascending: true }),
    supabase
      .from("chronic_programme_enrolments")
      .select("programme:chronic_condition_programmes(review_cadence_months)")
      .eq("patient_id", patientId)
      .eq("status", "enrolled"),
    supabase
      .from("vitals_readings")
      .select("systolic, diastolic")
      .eq("patient_id", patientId)
      .eq("vital_type", "blood_pressure")
      .order("taken_at", { ascending: false })
      .limit(5),
    resolveProtocolsForPatient(supabase, patientId, organisationId),
  ]);

  // A due screening is only actionable if the catalogue actually has a
  // single-test bundle for it -- same findSingleTestBundle rule the patient
  // and clinician order forms already use. Fetched once for all the due
  // schedules rather than per row.
  const dueScreenings = await resolveScreeningBundles(supabase, schedules ?? []);

  // The shortest cadence wins for a multi-condition patient: a 3-month
  // diabetes review and a 6-month hypertension review means the patient is
  // seen at 3 months, not 6.
  const cadences = (enrolments ?? [])
    .map((enrolment) => enrolment.programme?.review_cadence_months)
    .filter((months): months is number => typeof months === "number" && months > 0);

  const protocol = primaryProtocol(protocols);

  const facts: CaseFacts = {
    alert: {
      title: alert.title,
      level: alert.level,
      overrideLevel: alert.override_level,
      detail: alert.detail,
    },
    escalation: escalation ? { id: escalation.id, status: escalation.status } : null,
    medications: (medications ?? []).map((medication) => ({
      id: medication.id,
      // Dose included in the label so a doctor confirming a refill sees
      // exactly what is being continued, not just a drug name.
      name: medication.dose ? `${medication.drug_name} ${medication.dose}` : medication.drug_name,
      refillDate: medication.refill_date,
    })),
    dueScreenings,
    reviewCadenceMonths: cadences.length > 0 ? Math.min(...cadences) : null,
    redFlags: matchRedFlags(protocol, vitals ?? []),
    protocol,
  };

  return { facts, patientId, organisationId };
}

type ScheduleRow = {
  id: string;
  due_date: string;
  screen_type: { code: string; name: string } | null;
};

async function resolveScreeningBundles(
  supabase: SupabaseClient<Database>,
  schedules: ScheduleRow[]
): Promise<CaseFacts["dueScreenings"]> {
  const codes = schedules
    .map((schedule) => schedule.screen_type?.code)
    .filter((code): code is string => typeof code === "string");

  if (codes.length === 0) return [];

  const { data: bundles } = await supabase
    .from("panel_bundles")
    .select("id, test_codes")
    .eq("is_active", true)
    .overlaps("test_codes", codes);

  // Single-test bundles only, matching findSingleTestBundle in
  // lib/queries/lab-orders.ts -- a multi-test panel would order tests the
  // schedule never asked for.
  const bundleByCode = new Map<string, string>();
  for (const bundle of bundles ?? []) {
    if (bundle.test_codes.length === 1) {
      bundleByCode.set(bundle.test_codes[0], bundle.id);
    }
  }

  return schedules.map((schedule) => ({
    id: schedule.id,
    screenName: schedule.screen_type?.name ?? "Screening",
    panelBundleId: schedule.screen_type?.code
      ? (bundleByCode.get(schedule.screen_type.code) ?? null)
      : null,
    dueDate: schedule.due_date,
  }));
}
