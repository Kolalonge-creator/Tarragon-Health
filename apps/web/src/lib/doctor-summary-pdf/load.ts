import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { addDays, lagosLocalDate, parseScheduleSpec, specFromLegacyTimes, type AdherenceReportWeek } from "@tarragon/medicines";
import { loadAdherenceReport } from "@/lib/medicines/adherence-report-data";
import { loadEmergencyDatasetForPatient } from "@/lib/emergency/dataset";
import {
  buildBpChart,
  buildBpSection,
  buildSkipped,
  buildSymptoms,
  describeSchedule,
  summaryConfig,
  type BpChart,
  type BpSection,
  type MedicineLine,
  type SectionKey,
  type SkippedLine,
  type SummaryConfig,
  type SymptomLine,
} from "./model";

/**
 * Gathers what the patient ticked, through the patient's OWN session (row level security keeps every read to her own rows), and
 * builds the printable data. Failure is loud on purpose: a section that cannot be read fails the whole summary instead of being
 * left out, because a page handed to a clinic that quietly lacks the medicines or the readings reads as "none".
 *
 * Wearable-sourced readings are listed and labelled but never enter the average or the chart (model.ts). Nothing here reads a
 * reproductive-health or mental-health table: there is no section for either, so they cannot be ticked by accident.
 */

export interface DoctorSummaryData {
  generatedAtMs: number;
  days: number;
  sinceDate: string;
  sections: SectionKey[];
  patient: { name: string; dateOfBirth: string | null; sex: string | null; patientNumber: string | null };
  bp: BpSection | null;
  chart: BpChart | null;
  medicines: MedicineLine[] | null;
  adherence: { weeks: AdherenceReportWeek[]; minDoses: number; hasScheduledMedicines: boolean } | null;
  skipped: { lines: SkippedLine[]; total: number } | null;
  symptoms: { lines: SymptomLine[]; total: number; leftOut: number } | null;
  allergiesConditions: { allergies: { allergen: string; reaction: string | null; severity: string | null }[]; conditions: string[] } | null;
}

export type DoctorSummaryResult = { ok: true; data: DoctorSummaryData } | { ok: false; error: string };

const READING_FETCH_CAP = 2000;

export async function loadDoctorSummary(
  supabase: SupabaseClient<Database>,
  patientId: string,
  request: { days: number; sections: readonly SectionKey[] },
  nowMs: number = Date.now(),
  cfg: SummaryConfig = summaryConfig(),
): Promise<DoctorSummaryResult> {
  const want = new Set<SectionKey>(request.sections);
  const sinceMs = nowMs - request.days * 24 * 60 * 60 * 1000;
  const sinceIso = new Date(sinceMs).toISOString();
  const sinceDate = addDays(lagosLocalDate(nowMs), -request.days);
  const fail = (what: string): DoctorSummaryResult => ({ ok: false, error: `Could not read ${what}.` });

  const profileRes = await supabase.from("profiles").select("full_name, date_of_birth, sex, patient_number").eq("id", patientId).maybeSingle();
  if (profileRes.error || !profileRes.data) return fail("your details");
  const patient = {
    name: profileRes.data.full_name ?? "Patient",
    dateOfBirth: profileRes.data.date_of_birth ?? null,
    sex: profileRes.data.sex ?? null,
    patientNumber: profileRes.data.patient_number ?? null,
  };

  let bp: BpSection | null = null;
  let chart: BpChart | null = null;
  if (want.has("bp") || want.has("bp_chart")) {
    const { data, error } = await supabase
      .from("vitals_readings")
      .select("taken_at, systolic, diastolic, pulse_bpm, source, validation_status")
      .eq("patient_id", patientId)
      .eq("vital_type", "blood_pressure")
      .is("correction_status", null)
      .gte("taken_at", sinceIso)
      .order("taken_at", { ascending: false })
      .limit(READING_FETCH_CAP);
    if (error) return fail("your blood pressure readings");
    bp = buildBpSection(
      (data ?? []).map((r) => ({
        takenAt: r.taken_at,
        systolic: r.systolic,
        diastolic: r.diastolic,
        pulse: r.pulse_bpm,
        source: String(r.source),
        validationStatus: String(r.validation_status),
      })),
      cfg,
    );
    if (want.has("bp_chart")) chart = buildBpChart(bp.chartReadings);
  }

  let medicines: MedicineLine[] | null = null;
  if (want.has("medicines")) {
    const { data, error } = await supabase
      .from("medications")
      .select("drug_name, dose, frequency, schedule_spec, schedule_times, prescription_id")
      .eq("patient_id", patientId)
      .eq("is_active", true)
      .is("superseded_at", null)
      .order("drug_name");
    if (error) return fail("your medicines");
    medicines = (data ?? []).map((m) => {
      const parsed = m.schedule_spec != null ? parseScheduleSpec(m.schedule_spec) : null;
      const spec = parsed?.ok ? parsed.spec : m.schedule_times ? specFromLegacyTimes(m.schedule_times) : null;
      return { name: m.drug_name, dose: m.dose, schedule: describeSchedule(spec, m.frequency), prescribed: m.prescription_id !== null };
    });
  }

  let adherence: DoctorSummaryData["adherence"] = null;
  if (want.has("adherence")) {
    // The same function the app and the care team's chart use. Whole completed Lagos weeks, so the period is rounded up to weeks.
    const report = await loadAdherenceReport(supabase, patientId, nowMs, Math.min(26, Math.ceil(request.days / 7)));
    if (!report.ok) return fail("your medicine adherence");
    adherence = { weeks: report.data.weeks, minDoses: report.data.minDoses, hasScheduledMedicines: report.data.hasScheduledMedicines };
  }

  let skipped: DoctorSummaryData["skipped"] = null;
  if (want.has("skipped")) {
    const { data, error } = await supabase
      .from("medication_logs_latest_per_slot")
      .select("medication_id, scheduled_for_date, scheduled_time, missed_reason, reason")
      .eq("patient_id", patientId)
      .eq("status", "skipped")
      .gte("scheduled_for_date", sinceDate)
      .order("scheduled_for_date", { ascending: false })
      .limit(500);
    if (error) return fail("your skipped doses");
    const rows = data ?? [];
    const ids = [...new Set(rows.map((r) => r.medication_id).filter((id): id is string => !!id))];
    const names = new Map<string, string>();
    if (ids.length > 0) {
      const med = await supabase.from("medications").select("id, drug_name").eq("patient_id", patientId).in("id", ids);
      if (med.error) return fail("your skipped doses");
      for (const m of med.data ?? []) names.set(m.id, m.drug_name);
    }
    skipped = buildSkipped(
      rows
        .filter((r) => r.scheduled_for_date && r.scheduled_time)
        .map((r) => ({
          date: r.scheduled_for_date as string,
          time: (r.scheduled_time as string).slice(0, 5),
          medicine: (r.medication_id && names.get(r.medication_id)) || "A medicine",
          missedReason: r.missed_reason ? String(r.missed_reason) : null,
          reason: r.reason,
        })),
      cfg,
    );
  }

  let symptoms: DoctorSummaryData["symptoms"] = null;
  if (want.has("symptoms")) {
    const { data, error } = await supabase.rpc("patient_symptom_journal", { p_limit: 500 });
    if (error) return fail("your symptom journal");
    const rows = (Array.isArray(data) ? data : []) as unknown as { reported_at: string; symptom_type: string; free_text: string | null; severity: number | null }[];
    symptoms = buildSymptoms(rows.map((r) => ({ reportedAt: r.reported_at, symptomType: r.symptom_type, freeText: r.free_text, severity: r.severity })), sinceMs, cfg);
  }

  let allergiesConditions: DoctorSummaryData["allergiesConditions"] = null;
  if (want.has("allergies_conditions")) {
    try {
      const facts = await loadEmergencyDatasetForPatient(supabase, patientId);
      allergiesConditions = { allergies: facts.allergies, conditions: facts.conditions };
    } catch {
      return fail("your allergies and conditions");
    }
  }

  return {
    ok: true,
    data: { generatedAtMs: nowMs, days: request.days, sinceDate, sections: [...want], patient, bp, chart, medicines, adherence, skipped, symptoms, allergiesConditions },
  };
}

/**
 * One audit row per generation, written BEFORE the document is built and returned: a summary whose audit row could not be
 * written must not be produced. The event carries ids and choices only (the sections ticked, the period), never a value from
 * the record. The row is the patient's own action on her own record (actor and subject are the same person).
 */
export async function recordSummaryGeneration(
  supabase: SupabaseClient<Database>,
  actor: { id: string; organisationId: string },
  request: { days: number; sections: readonly SectionKey[] },
): Promise<{ ok: true } | { ok: false }> {
  const { error } = await supabase.from("audit_log").insert({
    organisation_id: actor.organisationId,
    actor_id: actor.id,
    action: "patient.doctor_summary_generated",
    entity_type: "profiles",
    entity_id: actor.id,
    subject_patient_id: actor.id,
    event: { sections: [...request.sections], period_days: request.days, config_key: "record.doctor_summary_pdf" },
  });
  return error ? { ok: false } : { ok: true };
}
