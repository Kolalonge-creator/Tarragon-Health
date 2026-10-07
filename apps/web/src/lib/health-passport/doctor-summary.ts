import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import type { EmergencyClinicalFacts } from "@/lib/emergency/card";
import { loadEmergencyDatasetForPatient } from "@/lib/emergency/dataset";

/**
 * The summary a person hands a facility that does not know them (S43, spec 2.9).
 * One short page, black on white, no logo and no fills so it prints cheaply and
 * photocopies cleanly. Every line says who stands behind it in plain words (entered
 * by the patient, confirmed by a clinician, from a laboratory, from a device), so a
 * reader does not have to guess how far to trust a line. Mental health and
 * reproductive health are never included, exactly like a share link.
 *
 * `buildDoctorSummary` is pure: it turns gathered rows into the printed lines.
 */

export type Provenance = "patient" | "clinician_confirmed" | "care_plan" | "laboratory" | "device" | "imported";

export const PROVENANCE_LABEL: Record<Provenance, string> = {
  patient: "entered by the patient",
  clinician_confirmed: "confirmed by a clinician",
  care_plan: "from the patient's care plan",
  laboratory: "from a laboratory",
  device: "from a device (estimate)",
  imported: "imported from another record",
};

export interface SummaryLine {
  text: string;
  detail: string | null;
  provenance: Provenance;
}

export interface DoctorSummary {
  generatedOn: string;
  patient: { name: string; dateOfBirth: string | null; sex: string | null; patientNumber: string | null };
  emergencyContact: { text: string } | null;
  blood: { text: string; provenance: Provenance } | null;
  sections: { key: string; title: string; lines: SummaryLine[]; emptyText: string }[];
}

export interface DoctorSummaryInput {
  facts: EmergencyClinicalFacts;
  /** Medicines with who stands behind each: a signed prescription is a clinician's; a medicine the patient added is the patient's. Falls back to the card's list, all patient-entered. */
  medications?: { name: string; dose: string | null; frequency: string | null; prescribed: boolean }[];
  vitals: { vitalType: string; text: string; takenAt: string; source: string }[];
  labs: { code: string; text: string; takenAt: string; range: string | null; flag: string | null }[];
  vaccinations: { name: string; doseNumber: number | null; givenAt: string | null; verified: boolean }[];
  procedures: { name: string; when: string | null; verified: boolean }[];
  family: { condition: string; relative: string; verified: boolean }[];
  now?: Date;
}

const VITAL_LABEL: Record<string, string> = {
  blood_pressure: "Blood pressure",
  glucose: "Glucose",
  weight: "Weight",
  pulse: "Heart rate",
  temperature: "Temperature",
  spo2: "Oxygen saturation",
};

function date(value: string | null | undefined): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Lagos" });
}

function humanise(value: string): string {
  const s = value.replace(/_/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function buildDoctorSummary(input: DoctorSummaryInput): DoctorSummary {
  const { facts } = input;
  const now = input.now ?? new Date();
  const contact = facts.emergency_contact?.name
    ? { text: [facts.emergency_contact.name, facts.emergency_contact.relationship ? `(${facts.emergency_contact.relationship})` : null, facts.emergency_contact.phone].filter(Boolean).join(" ") }
    : null;
  const blood =
    facts.blood && (facts.blood.blood_group || facts.blood.genotype)
      ? {
          text: `Blood group ${facts.blood.blood_group ?? "not recorded"}, genotype ${facts.blood.genotype ?? "not recorded"}`,
          // a laboratory document stands behind it; a patient attestation does not
          provenance: (facts.blood.provenance === "lab_document" ? "laboratory" : "patient") as Provenance,
        }
      : null;

  const sections: DoctorSummary["sections"] = [
    {
      key: "allergies",
      title: "Allergies",
      emptyText: "None recorded",
      lines: facts.allergies.map((a) => ({
        text: a.allergen,
        detail: [a.reaction, a.severity].filter(Boolean).join(", ") || null,
        provenance: "patient" as Provenance,
      })),
    },
    {
      key: "medications",
      title: "Current medicines",
      emptyText: "None recorded",
      lines: (input.medications ?? facts.medications.map((m) => ({ name: m.drug_name, dose: m.dose, frequency: m.frequency, prescribed: false }))).map((m) => ({
        text: m.name,
        detail: [m.dose, m.frequency].filter(Boolean).join(", ") || null,
        provenance: (m.prescribed ? "clinician_confirmed" : "patient") as Provenance,
      })),
    },
    {
      key: "conditions",
      title: "Ongoing conditions",
      emptyText: "None recorded",
      // a condition here is one the patient's care plan is organised around; that is not the same as a clinician having confirmed a diagnosis, so it says so
      lines: facts.conditions.map((c) => ({ text: humanise(c), detail: null, provenance: "care_plan" as Provenance })),
    },
    {
      key: "vitals",
      title: "Latest readings",
      emptyText: "None recorded",
      lines: input.vitals.map((v) => ({
        text: VITAL_LABEL[v.vitalType] ?? humanise(v.vitalType),
        detail: [v.text, date(v.takenAt)].filter(Boolean).join(", "),
        provenance: (v.source === "device" || v.source === "cgm" || v.source === "wearable" ? "device" : v.source === "fhir_import" ? "imported" : "patient") as Provenance,
      })),
    },
    {
      key: "labs",
      title: "Laboratory results",
      emptyText: "None released",
      lines: input.labs.map((l) => ({
        text: humanise(l.code),
        detail: [l.text, l.range ? `lab range ${l.range}` : null, l.flag && l.flag !== "normal" ? l.flag.replace(/_/g, " ") : null, date(l.takenAt)].filter(Boolean).join(", "),
        provenance: "laboratory" as Provenance,
      })),
    },
    {
      key: "vaccinations",
      title: "Vaccinations",
      emptyText: "None recorded",
      lines: input.vaccinations.map((v) => ({
        text: v.name,
        detail: [v.doseNumber ? `dose ${v.doseNumber}` : null, date(v.givenAt)].filter(Boolean).join(", ") || null,
        provenance: (v.verified ? "clinician_confirmed" : "patient") as Provenance,
      })),
    },
    {
      key: "procedures",
      title: "Procedures",
      emptyText: "None recorded",
      lines: input.procedures.map((p) => ({ text: p.name, detail: p.when, provenance: (p.verified ? "clinician_confirmed" : "patient") as Provenance })),
    },
    {
      key: "family",
      title: "Family history",
      emptyText: "None recorded",
      lines: input.family.map((f) => ({ text: f.condition, detail: humanise(f.relative).toLowerCase(), provenance: (f.verified ? "clinician_confirmed" : "patient") as Provenance })),
    },
  ];

  return {
    generatedOn: now.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Lagos" }),
    patient: { name: facts.full_name ?? "Patient", dateOfBirth: date(facts.date_of_birth), sex: facts.sex, patientNumber: facts.patient_number },
    emergencyContact: contact,
    blood,
    sections,
  };
}

const MAX_PER_SECTION = { labs: 12, vaccinations: 15, procedures: 10, family: 10 } as const;

/** Gathers everything through the person's own session (RLS), then builds the summary. */
export async function getDoctorSummary(supabase: SupabaseClient<Database>, patientId: string): Promise<DoctorSummary> {
  const VITAL_TYPES = ["blood_pressure", "glucose", "weight", "pulse", "temperature", "spo2"] as const;
  const [facts, medsRes, labsRes, vaccRes, procRes, famRes, ...vitalRows] = await Promise.all([
    loadEmergencyDatasetForPatient(supabase, patientId),
    supabase.from("medications").select("drug_name, dose, frequency, prescription_id").eq("patient_id", patientId).eq("is_active", true).order("drug_name"),
    // The same released-only, non-sensitive results the trends screen reads (INV-03, INV-04), with the laboratory's own range.
    supabase.rpc("patient_biomarker_list", { p_patient: patientId }),
    supabase.from("immunisations").select("vaccine_code, dose_number, given_at, verified").eq("patient_id", patientId).order("given_at", { ascending: false }).limit(MAX_PER_SECTION.vaccinations),
    supabase.from("procedures").select("name, performed_on, approximate_year, verified_by_clinician").eq("patient_id", patientId).is("removed_at", null).order("created_at", { ascending: false }).limit(MAX_PER_SECTION.procedures),
    supabase.from("family_history").select("condition_name, relationship, verified_by_clinician").eq("patient_id", patientId).is("removed_at", null).limit(MAX_PER_SECTION.family),
    // The latest reading of EACH type, one small query per type: a patient who logs blood pressure daily must still see their weight and glucose.
    ...VITAL_TYPES.map((vt) =>
      supabase
        .from("vitals_readings")
        .select("vital_type, systolic, diastolic, glucose_mmol_l, weight_kg, pulse_bpm, temperature_c, spo2_pct, source, taken_at")
        .eq("patient_id", patientId)
        .eq("vital_type", vt)
        .order("taken_at", { ascending: false })
        .limit(1)
    ),
  ]);

  const vitals: DoctorSummaryInput["vitals"] = [];
  for (const res of vitalRows) {
    const v = res.data?.[0];
    if (!v) continue;
    const text =
      v.vital_type === "blood_pressure" ? `${v.systolic}/${v.diastolic} mmHg`
      : v.vital_type === "glucose" ? `${v.glucose_mmol_l} mmol/L`
      : v.vital_type === "weight" ? `${v.weight_kg} kg`
      : v.vital_type === "pulse" ? `${v.pulse_bpm} bpm`
      : v.vital_type === "temperature" ? `${v.temperature_c} C`
      : v.vital_type === "spo2" ? `${v.spo2_pct}%`
      : "";
    if (text) vitals.push({ vitalType: v.vital_type, text, takenAt: v.taken_at, source: String(v.source) });
  }

  type LabListItem = {
    code: string;
    last_at: string;
    latest_value: number | null;
    latest_unit: string | null;
    latest_flag: string | null;
    latest_ref_low: number | null;
    latest_ref_high: number | null;
    latest_ref_text: string | null;
  };
  const labList = (Array.isArray(labsRes.data) ? labsRes.data : []) as unknown as LabListItem[];
  const labs: DoctorSummaryInput["labs"] = labList
    .filter((l) => l.latest_value !== null)
    .slice(0, MAX_PER_SECTION.labs)
    .map((l) => ({
      code: l.code,
      text: `${l.latest_value}${l.latest_unit ? ` ${l.latest_unit}` : ""}`,
      takenAt: l.last_at,
      range: l.latest_ref_text ?? (l.latest_ref_low !== null || l.latest_ref_high !== null ? [l.latest_ref_low, l.latest_ref_high].filter((x) => x !== null).join(" to ") : null),
      flag: l.latest_flag,
    }));

  return buildDoctorSummary({
    facts,
    medications: (medsRes.data ?? []).map((m) => ({ name: m.drug_name, dose: m.dose, frequency: m.frequency, prescribed: m.prescription_id !== null })),
    vitals,
    labs,
    vaccinations: (vaccRes.data ?? []).map((v) => ({ name: v.vaccine_code ? humaniseCode(v.vaccine_code) : "Vaccine", doseNumber: v.dose_number, givenAt: v.given_at, verified: v.verified === true })),
    procedures: (procRes.data ?? []).map((p) => ({ name: p.name, when: p.performed_on ? String(new Date(p.performed_on).getFullYear()) : p.approximate_year ? String(p.approximate_year) : null, verified: p.verified_by_clinician })),
    family: (famRes.data ?? []).map((f) => ({ condition: f.condition_name, relative: String(f.relationship), verified: f.verified_by_clinician })),
  });
}

function humaniseCode(code: string): string {
  const s = code.replace(/^child_/, "").replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}
