import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { addDays, lagosLocalDate, parseScheduleSpec, specFromLegacyTimes, type AdherenceReportWeek } from "@tarragon/medicines";
import { loadAdherenceReport } from "@/lib/medicines/adherence-report-data";
import {
  allergyProvenance,
  buildBpChart,
  buildBpSection,
  buildSkipped,
  buildSymptoms,
  describeSchedule,
  summaryConfig,
  type AllergyLine,
  type BpChart,
  type BpReadingIn,
  type BpSection,
  type MedicineLine,
  type SectionKey,
  type SkippedLine,
  type SummaryConfig,
  type SymptomLine,
} from "./model";
import { buildGlucoseSection, buildLabSection, type GlucoseSection, type LabSection } from "./passport-model";
import { rangeMayBeShownAsClinical, rangeSourceLabel } from "@tarragon/shared";

/**
 * Gathers what the patient ticked, through the patient's OWN session (row level security keeps every read to her own rows), and
 * builds the printable data. Failure is loud on purpose: a section that cannot be read fails the whole summary instead of being
 * left out, because a page handed to a clinic that quietly lacks the medicines or the allergies reads as "none". Every query's
 * `error` is checked, and a read that hits its row limit says so on the page.
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
  /** `weeks` are whole completed Lagos weeks inside the period, so they never cover a day outside it. */
  adherence: { weeks: AdherenceReportWeek[]; minDoses: number; hasScheduledMedicines: boolean } | null;
  skipped: { lines: SkippedLine[]; total: number; capped: boolean } | null;
  symptoms: { lines: SymptomLine[]; total: number; leftOut: number; capped: boolean } | null;
  allergiesConditions: { allergies: AllergyLine[]; conditions: string[] } | null;
  /** Result passport sections (item 10). Null unless ticked. */
  glucose: GlucoseSection | null;
  labs: LabSection | null;
}

export type DoctorSummaryResult = { ok: true; data: DoctorSummaryData } | { ok: false; error: string };

/** Row limits for one read. Hitting one is shown on the page (BpSection.capped, symptoms.capped). */
export const READ_LIMITS = { bpCounted: 2000, bpOther: 500, symptoms: 500, skipped: 500, glucose: 500, labs: 400 } as const; // band-ok: row limits for one read, not a clinical threshold

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
  const nowIso = new Date(nowMs).toISOString();
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
    const bpColumns = "taken_at, systolic, diastolic, pulse_bpm, source, validation_status";
    // Two reads, so a feed of wearable rows can never crowd the home-cuff readings out of the row limit.
    const [counted, other] = await Promise.all([
      supabase
        .from("vitals_readings")
        .select(bpColumns)
        .eq("patient_id", patientId)
        .eq("vital_type", "blood_pressure")
        .is("correction_status", null)
        .in("source", cfg.averageSources as Database["public"]["Enums"]["vital_source"][])
        .gte("taken_at", sinceIso)
        .order("taken_at", { ascending: false })
        .limit(READ_LIMITS.bpCounted),
      supabase
        .from("vitals_readings")
        .select(bpColumns)
        .eq("patient_id", patientId)
        .eq("vital_type", "blood_pressure")
        .is("correction_status", null)
        .not("source", "in", `(${cfg.averageSources.join(",")})`)
        .gte("taken_at", sinceIso)
        .order("taken_at", { ascending: false })
        .limit(READ_LIMITS.bpOther),
    ]);
    if (counted.error || other.error) return fail("your blood pressure readings");
    const rows = [...(counted.data ?? []), ...(other.data ?? [])];
    const capped = (counted.data ?? []).length >= READ_LIMITS.bpCounted || (other.data ?? []).length >= READ_LIMITS.bpOther;
    const readings: BpReadingIn[] = rows.map((r) => ({
      takenAt: r.taken_at,
      systolic: r.systolic,
      diastolic: r.diastolic,
      pulse: r.pulse_bpm,
      source: String(r.source),
      validationStatus: String(r.validation_status),
    }));
    bp = buildBpSection(readings, cfg, capped);
    if (want.has("bp_chart")) chart = buildBpChart(bp.chartReadings);
  }

  let medicines: MedicineLine[] | null = null;
  if (want.has("medicines")) {
    const { data, error } = await supabase
      .from("medications")
      .select("drug_name, dose, frequency, schedule_spec, schedule_times, prescription_id, source")
      .eq("patient_id", patientId)
      .eq("is_active", true)
      .is("superseded_at", null)
      // a finished, time-limited course is not a current medicine even if nobody has switched it off
      .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
      .order("drug_name");
    if (error) return fail("your medicines");
    const prescriptionIds = [...new Set((data ?? []).map((m) => m.prescription_id).filter((id): id is string => !!id))];
    // "From a signed prescription" is only said when a signed, uncancelled prescription is actually there (INV-02).
    const signed = new Set<string>();
    if (prescriptionIds.length > 0) {
      const rx = await supabase.from("prescriptions").select("id, signed_at, cancelled_at").in("id", prescriptionIds);
      if (rx.error) return fail("your medicines");
      for (const p of rx.data ?? []) if (p.signed_at && !p.cancelled_at) signed.add(p.id);
    }
    medicines = (data ?? []).map((m) => {
      const parsed = m.schedule_spec != null ? parseScheduleSpec(m.schedule_spec) : null;
      const spec = parsed?.ok ? parsed.spec : m.schedule_times ? specFromLegacyTimes(m.schedule_times) : null;
      const provenance: MedicineLine["provenance"] =
        m.prescription_id && signed.has(m.prescription_id) ? "signed_prescription" : !m.prescription_id && String(m.source) === "patient" ? "patient" : "other";
      return { name: m.drug_name, dose: m.dose, schedule: describeSchedule(spec, m.frequency), provenance };
    });
  }

  let adherence: DoctorSummaryData["adherence"] = null;
  if (want.has("adherence")) {
    // The same function the app and the care team's chart use. Whole completed Lagos weeks that fit inside the period (rounded
    // DOWN), so the table never covers a day the page does not say it covers.
    const report = await loadAdherenceReport(supabase, patientId, nowMs, Math.max(1, Math.min(26, Math.floor(request.days / 7))));
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
      .limit(READ_LIMITS.skipped);
    if (error) return fail("your skipped doses");
    const rows = data ?? [];
    const ids = [...new Set(rows.map((r) => r.medication_id).filter((id): id is string => !!id))];
    const names = new Map<string, string>();
    if (ids.length > 0) {
      const med = await supabase.from("medications").select("id, drug_name").eq("patient_id", patientId).in("id", ids);
      if (med.error) return fail("your skipped doses");
      for (const m of med.data ?? []) names.set(m.id, m.drug_name);
    }
    const skippedCapped = rows.length >= READ_LIMITS.skipped;
    skipped = { ...buildSkipped(
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
    ), capped: skippedCapped };
  }

  let symptoms: DoctorSummaryData["symptoms"] = null;
  if (want.has("symptoms")) {
    const { data, error } = await supabase.rpc("patient_symptom_journal", { p_limit: READ_LIMITS.symptoms });
    if (error || !Array.isArray(data)) return fail("your symptom journal");
    const rows = data as unknown as { reported_at: string; symptom_type: string; free_text: string | null; severity: number | null }[];
    symptoms = buildSymptoms(
      rows.map((r) => ({ reportedAt: r.reported_at, symptomType: r.symptom_type, freeText: r.free_text, severity: r.severity })),
      sinceMs,
      cfg,
      // capped only when the oldest row read is still inside the period: otherwise every in-period entry was read
      rows.length >= READ_LIMITS.symptoms && rows.every((r) => Date.parse(r.reported_at) >= sinceMs),
    );
  }

  let allergiesConditions: DoctorSummaryData["allergiesConditions"] = null;
  if (want.has("allergies_conditions")) {
    // Read here with every error checked: the shared emergency-card helper ignores query errors and would turn a failed read
    // into "None recorded", which on a page handed to a clinic is a false statement about an allergy.
    const [allergyRes, planRes] = await Promise.all([
      supabase
        .from("patient_allergies")
        .select("allergen, reaction, severity, source, verification_status")
        .eq("patient_id", patientId)
        .is("correction_status", null)
        .order("allergen"),
      supabase.from("care_plans").select("condition").eq("patient_id", patientId).eq("status", "active"),
    ]);
    if (allergyRes.error || planRes.error) return fail("your allergies and conditions");
    allergiesConditions = {
      allergies: (allergyRes.data ?? []).map((a) => ({
        allergen: a.allergen,
        detail: [a.reaction, a.severity ? String(a.severity) : null].filter(Boolean).join(", ") || null,
        provenance: allergyProvenance(String(a.source), String(a.verification_status)),
      })),
      conditions: [...new Set((planRes.data ?? []).map((c) => String(c.condition)))],
    };
  }

  let glucose: GlucoseSection | null = null;
  if (want.has("glucose")) {
    const { data, error } = await supabase
      .from("vitals_readings")
      .select("taken_at, glucose_mmol_l, glucose_context, source, validation_status")
      .eq("patient_id", patientId)
      .eq("vital_type", "glucose")
      .is("correction_status", null)
      .gte("taken_at", sinceIso)
      .order("taken_at", { ascending: false })
      .limit(READ_LIMITS.glucose);
    if (error) return fail("your blood sugar readings");
    const rows = data ?? [];
    glucose = buildGlucoseSection(
      rows.map((r) => ({ takenAt: r.taken_at, mmolL: r.glucose_mmol_l, context: r.glucose_context ? String(r.glucose_context) : null, source: String(r.source), validationStatus: String(r.validation_status) })),
      undefined,
      rows.length >= READ_LIMITS.glucose,
    );
  }

  let labs: LabSection | null = null;
  if (want.has("lab_results")) {
    // The same filters the shared link applies (final, corrected or amended reports only; nothing superseded or withdrawn), plus
    // sensitive_positive = false stated here on purpose. Row level security already hides a sensitive row from the patient (INV-04), but
    // a filter that lives only in a policy would disappear silently if the policy were ever changed.
    const { data, error } = await supabase
      .from("lab_analyte_readings")
      .select("code, value, value_text, unit, reference_range_text, range_source, range_source_ref, abnormal_flag, taken_at, laboratory, sensitive_positive")
      .eq("patient_id", patientId)
      .in("report_status", ["final", "corrected", "amended"])
      .is("correction_status", null)
      .is("superseded_by_id", null)
      .eq("sensitive_positive", false)
      .order("taken_at", { ascending: false })
      .limit(READ_LIMITS.labs);
    if (error) return fail("your lab results");
    const rows = data ?? [];
    labs = buildLabSection(
      rows.map((r) => ({
        code: r.code,
        value: r.value,
        valueText: r.value_text,
        unit: r.unit,
        referenceRangeText: r.reference_range_text,
        rangeSource: r.range_source,
        rangeSourceRef: r.range_source_ref,
        abnormalFlag: r.abnormal_flag ? String(r.abnormal_flag) : null,
        takenAt: r.taken_at,
        laboratory: r.laboratory,
        sensitivePositive: r.sensitive_positive === true,
      })),
      { showRange: rangeMayBeShownAsClinical, describe: (s, ref) => rangeSourceLabel(s, ref) },
      undefined,
      rows.length >= READ_LIMITS.labs,
    );
  }

  return {
    ok: true,
    data: { generatedAtMs: nowMs, days: request.days, sinceDate, sections: [...want], patient, bp, chart, medicines, adherence, skipped, symptoms, allergiesConditions, glucose, labs },
  };
}

/**
 * One audit row per request, written BEFORE anything is read: a summary whose audit row could not be written must not be
 * produced. The action says "requested" because the row is written before the read and the render, so it records the intent to
 * read the record, not the outcome. The event carries ids and choices only (the sections ticked, the period), never a value from
 * the record. The patient's own action on her own record (actor and subject are the same person).
 */
export async function recordSummaryGeneration(
  supabase: SupabaseClient<Database>,
  actor: { id: string; organisationId: string },
  request: { days: number; sections: readonly SectionKey[] },
): Promise<{ ok: true } | { ok: false }> {
  const { error } = await supabase.from("audit_log").insert({
    organisation_id: actor.organisationId,
    actor_id: actor.id,
    action: "patient.doctor_summary_requested",
    entity_type: "profiles",
    entity_id: actor.id,
    subject_patient_id: actor.id,
    event: { sections: [...request.sections], period_days: request.days, config_key: "record.doctor_summary_pdf" },
  });
  return error ? { ok: false } : { ok: true };
}
