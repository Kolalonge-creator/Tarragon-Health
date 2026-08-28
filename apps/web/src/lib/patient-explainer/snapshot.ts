import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";

/**
 * The anchors a patient can ask "help me understand this" about. The first
 * three always explain the patient's LATEST value for that kind+key --
 * matching how RiskSignalsCard/LipidProfileCard already present "latest"
 * data -- so no specific row id needs threading through the UI, and a past
 * reading never changing means the cache in patient_result_explanations
 * never goes stale.
 *
 * "medication" is different in shape (see MedicationSnapshot below) --
 * subjectKey is a specific medications.id, not a repeatable measurement key,
 * since two rows can share a drug_name (e.g. dose changed) and a stale
 * cached explanation for the wrong row would be worse than none.
 */
export type ExplainerKind = "risk_score" | "lab_analyte" | "vitals" | "medication";

export interface ResultSnapshot {
  kind: ExplainerKind;
  subjectKey: string;
  /** Human label for the thing being explained, e.g. "Heart & circulation risk". */
  label: string;
  latest: { value: string; unit: string | null; recordedAt: string };
  /** Prior value for trend framing, when one exists. */
  previous: { value: string; unit: string | null; recordedAt: string } | null;
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
  kind: Exclude<ExplainerKind, "medication">,
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
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// "Explain my medication" (docs Module 20 §20.7) -- same cache/generation table
// as the result explainer, different snapshot shape: a medication has no
// latest/previous trend, it has a name, dose, frequency, indication and
// instructions. subjectKey is the specific medications.id (see ExplainerKind).
// ---------------------------------------------------------------------------

export interface MedicationSnapshot {
  kind: "medication";
  subjectKey: string;
  /** Human label for the thing being explained -- the drug name. */
  label: string;
  drugName: string;
  dose: string | null;
  frequency: string | null;
  route: string | null;
  indication: string | null;
  instructions: string | null;
  /** 'clinician' | 'specialist' | 'patient' -- who this was prescribed/added by. */
  source: string;
  startedAt: string;
}

/**
 * Best-effort -- never throws. Scoped to the CALLER's own medication row
 * (patientId, enforced both here and by RLS) so this can never be pointed at
 * another patient's medicine.
 */
export async function buildMedicationSnapshot(
  supabase: SupabaseClient<Database>,
  patientId: string,
  medicationId: string,
  label: string
): Promise<MedicationSnapshot | null> {
  const { data } = await supabase
    .from("medications")
    .select("drug_name, dose, frequency, route, indication, instructions, source, created_at")
    .eq("id", medicationId)
    .eq("patient_id", patientId)
    .maybeSingle();
  if (!data) return null;

  return {
    kind: "medication",
    subjectKey: medicationId,
    label,
    drugName: data.drug_name,
    dose: data.dose,
    frequency: data.frequency,
    route: data.route,
    indication: data.indication,
    instructions: data.instructions,
    source: data.source,
    startedAt: data.created_at,
  };
}

/** Renders a medication snapshot into the plain-text block the model sees. */
export function formatMedicationSnapshotForPrompt(snapshot: MedicationSnapshot): string {
  const prescribedBy =
    snapshot.source === "clinician"
      ? "the Tarragon care team"
      : snapshot.source === "specialist"
        ? "a specialist doctor"
        : "self-reported by the patient (not prescribed on this platform)";
  const lines: string[] = [
    `Medication name: ${snapshot.drugName}`,
    `Dose: ${snapshot.dose ?? "not recorded"}`,
    `Frequency: ${snapshot.frequency ?? "not recorded"}`,
  ];
  if (snapshot.route) lines.push(`Route: ${snapshot.route}`);
  if (snapshot.indication) lines.push(`Recorded reason for taking it: ${snapshot.indication}`);
  if (snapshot.instructions) lines.push(`Recorded instructions: ${snapshot.instructions}`);
  lines.push(`Added to the record by: ${prescribedBy}`);
  lines.push(`On file since: ${snapshot.startedAt.slice(0, 10)}`);
  return lines.join("\n");
}
