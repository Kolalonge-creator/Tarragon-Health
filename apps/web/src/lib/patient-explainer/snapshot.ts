import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";

/**
 * The anchors a patient can ask "help me understand this" about. The first
 * three always explain the patient's LATEST value for that kind+key --
 * matching how RiskSignalsCard/LipidProfileCard already present "latest"
 * data -- so no specific row id needs threading through the UI, and a past
 * reading never changing means the cache in patient_result_explanations
 * never goes stale. "medication" and "care_plan_item" aren't a time series --
 * subjectKey is the row's own id (medications.id / care_plans.id), and their
 * snapshot leans on `details` below instead of a latest/previous pair.
 */
export type ExplainerKind = "risk_score" | "lab_analyte" | "vitals" | "medication" | "care_plan_item";

export interface ResultSnapshot {
  kind: ExplainerKind;
  subjectKey: string;
  /** Human label for the thing being explained, e.g. "Heart & circulation risk". */
  label: string;
  latest: { value: string; unit: string | null; recordedAt: string };
  /** Prior value for trend framing, when one exists. */
  previous: { value: string; unit: string | null; recordedAt: string } | null;
  /**
   * Extra structured facts for a kind that isn't a single scalar reading
   * (medication instructions, care-plan target ranges). Rendered as
   * additional plain-text lines by formatResultSnapshotForPrompt -- same
   * "only what's here reaches the model" discipline as latest/previous.
   */
  details?: Record<string, string>;
}

/**
 * Best-effort -- never throws. Returns null when the patient has nothing
 * recorded yet for this kind+key, same "degrade to no explanation" shape as
 * case-briefs/snapshot.ts. Deliberately reads only the single latest+previous
 * value for the requested key, never the patient's whole chart -- the same
 * minimized-snapshot discipline as case briefs, just narrower since this is
 * patient-facing and about ONE number, not a whole case.
 */
export async function buildResultSnapshot(
  supabase: SupabaseClient<Database>,
  patientId: string,
  kind: ExplainerKind,
  subjectKey: string,
  label: string
): Promise<ResultSnapshot | null> {
  if (kind === "risk_score") {
    const { data } = await supabase
      .from("patient_risk_scores")
      .select("risk_level, score, computed_at")
      .eq("patient_id", patientId)
      .eq("score_type", subjectKey)
      .order("computed_at", { ascending: false })
      .limit(2);
    if (!data || data.length === 0) return null;
    const [latest, previous] = data;
    return {
      kind,
      subjectKey,
      label,
      latest: {
        value: latest.risk_level ?? (latest.score !== null ? String(latest.score) : "unknown"),
        unit: null,
        recordedAt: latest.computed_at,
      },
      previous: previous
        ? {
            value: previous.risk_level ?? (previous.score !== null ? String(previous.score) : "unknown"),
            unit: null,
            recordedAt: previous.computed_at,
          }
        : null,
    };
  }

  if (kind === "medication") {
    const { data } = await supabase
      .from("medications")
      .select("drug_name, dose, frequency, route, instructions, indication, created_at")
      .eq("patient_id", patientId)
      .eq("id", subjectKey)
      .maybeSingle();
    if (!data) return null;
    const details: Record<string, string> = {};
    if (data.route) details.route = data.route;
    if (data.instructions) details.instructions = data.instructions;
    if (data.indication) details.indication = data.indication;
    return {
      kind,
      subjectKey,
      label,
      latest: {
        value: [data.dose, data.frequency].filter(Boolean).join(", ") || "no dose/frequency on file",
        unit: null,
        recordedAt: data.created_at,
      },
      previous: null,
      details,
    };
  }

  if (kind === "care_plan_item") {
    const { data } = await supabase
      .from("care_plans")
      .select("condition, status, target_ranges, notes, updated_at")
      .eq("patient_id", patientId)
      .eq("id", subjectKey)
      .maybeSingle();
    if (!data) return null;
    const targetRanges = (data.target_ranges ?? {}) as Record<string, unknown>;
    const details: Record<string, string> = {};
    const targetEntries = Object.entries(targetRanges);
    if (targetEntries.length > 0) {
      details.target = targetEntries.map(([k, v]) => `${k}: ${v}`).join("; ");
    }
    if (data.notes) details.notes = data.notes;
    return {
      kind,
      subjectKey,
      label,
      latest: { value: data.status, unit: null, recordedAt: data.updated_at },
      previous: null,
      details,
    };
  }

  if (kind === "lab_analyte") {
    const { data } = await supabase
      .from("lab_analyte_readings")
      .select("value, unit, taken_at")
      .eq("patient_id", patientId)
      .eq("code", subjectKey)
      .order("taken_at", { ascending: false })
      .limit(2);
    if (!data || data.length === 0) return null;
    const [latest, previous] = data;
    return {
      kind,
      subjectKey,
      label,
      latest: { value: String(latest.value), unit: latest.unit, recordedAt: latest.taken_at },
      previous: previous
        ? { value: String(previous.value), unit: previous.unit, recordedAt: previous.taken_at }
        : null,
    };
  }

  // vitals -- the numeric field actually populated depends on vital_type;
  // read every candidate column and report whichever is non-null. subjectKey
  // is a plain caller-supplied string (patient-facing, not narrowed to the
  // vital_type enum at the type level) -- cast at the query boundary, same
  // as every other "search by a caller-supplied key" read in this file.
  const { data } = await supabase
    .from("vitals_readings")
    .select("systolic, diastolic, pulse_bpm, glucose_mmol_l, weight_kg, spo2_pct, temperature_c, taken_at")
    .eq("patient_id", patientId)
    .eq("vital_type", subjectKey as Database["public"]["Enums"]["vital_type"])
    .order("taken_at", { ascending: false })
    .limit(2);
  if (!data || data.length === 0) return null;

  const format = (row: (typeof data)[number]): string => {
    if (row.systolic !== null && row.diastolic !== null) return `${row.systolic}/${row.diastolic}`;
    if (row.glucose_mmol_l !== null) return String(row.glucose_mmol_l);
    if (row.weight_kg !== null) return String(row.weight_kg);
    if (row.spo2_pct !== null) return String(row.spo2_pct);
    if (row.temperature_c !== null) return String(row.temperature_c);
    if (row.pulse_bpm !== null) return String(row.pulse_bpm);
    return "unknown";
  };
  const unitFor = (): string | null => {
    switch (subjectKey) {
      case "blood_pressure":
        return "mmHg";
      case "glucose":
        return "mmol/L";
      case "weight":
        return "kg";
      case "spo2":
        return "% SpO2";
      case "temperature":
        return "°C";
      case "pulse":
        return "bpm";
      case "waist_circumference":
        return "cm";
      default:
        return null;
    }
  };
  const [latest, previous] = data;
  return {
    kind,
    subjectKey,
    label,
    latest: { value: format(latest), unit: unitFor(), recordedAt: latest.taken_at },
    previous: previous ? { value: format(previous), unit: unitFor(), recordedAt: previous.taken_at } : null,
  };
}

/**
 * Renders a snapshot into the plain-text block the model sees. Pure and
 * deterministic, same discipline as case-briefs' formatSnapshotForPrompt --
 * unit-testable without a live Supabase client or a Claude call.
 */
export function formatResultSnapshotForPrompt(snapshot: ResultSnapshot): string {
  const unitSuffix = (v: { value: string; unit: string | null }) => (v.unit ? ` ${v.unit}` : "");
  const lines: string[] = [
    `Measurement: ${snapshot.label}`,
    `Latest value: ${snapshot.latest.value}${unitSuffix(snapshot.latest)} on ${snapshot.latest.recordedAt.slice(0, 10)}`,
  ];
  if (snapshot.previous) {
    lines.push(
      `Previous value: ${snapshot.previous.value}${unitSuffix(snapshot.previous)} on ${snapshot.previous.recordedAt.slice(0, 10)}`
    );
  } else {
    lines.push("Previous value: none on file yet (this is the first recorded reading).");
  }
  if (snapshot.details) {
    for (const [key, value] of Object.entries(snapshot.details)) {
      lines.push(`${key.charAt(0).toUpperCase()}${key.slice(1)}: ${value}`);
    }
  }
  return lines.join("\n");
}
