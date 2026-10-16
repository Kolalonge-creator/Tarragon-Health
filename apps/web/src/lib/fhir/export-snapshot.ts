import { z } from "zod";

/**
 * What `public.fhir_export_snapshot` returns. Every access rule (who may export, which categories, released-only results, no private notes)
 * is enforced in the database; this file only describes the shape so the FHIR mapping is typed.
 */
const num = z.number().nullable().optional();
const str = z.string().nullable().optional();

export const exportSections = ["vitals", "lab_results", "medications", "conditions", "allergies", "immunizations", "documents"] as const;
export type ExportSection = (typeof exportSections)[number];

const vitalRow = z.object({
  id: z.string(),
  vital_type: z.string(),
  taken_at: z.string(),
  source: z.string(),
  systolic: num,
  diastolic: num,
  pulse_bpm: num,
  glucose_mmol_l: num,
  glucose_context: str,
  weight_kg: num,
  temperature_c: num,
  spo2_pct: num,
  waist_cm: num,
  ketones_mmol_l: num,
  respiratory_rate_bpm: num,
  peak_flow_l_min: num,
});

const labRow = z.object({
  id: z.string(),
  code: z.string(),
  value: num,
  value_text: str,
  unit: str,
  ref_low: num,
  ref_high: num,
  flag: str,
  taken_at: z.string().nullable().optional(),
  origin: z.string(),
});

const medicationRow = z.object({
  id: z.string(),
  drug_name: z.string(),
  dose: str,
  frequency: str,
  route: str,
  is_active: z.boolean(),
  source: z.string(),
  stopped_at: str,
  created_at: z.string(),
});

const conditionRow = z.object({
  id: z.string(),
  condition_name: z.string(),
  icd10_code: str,
  status: z.string(),
  date_identified: str,
  source: z.string(),
  created_at: z.string(),
});

const allergyRow = z.object({
  id: z.string(),
  allergen: z.string(),
  reaction: str,
  severity: str,
  noted_at: z.string(),
  verification_status: z.string(),
  source: z.string(),
});

const immunizationRow = z.object({
  id: z.string(),
  vaccine_code: str,
  vaccine_name: str,
  dose_number: num,
  date_administered: z.string(),
  batch_lot_number: str,
  given_where: str,
  verification_status: z.string(),
});

const documentRow = z.object({
  id: z.string(),
  document_type: z.string(),
  document_date: str,
  mime_type: str,
  source: str,
  created_at: z.string(),
});

export const exportSnapshotSchema = z.object({
  status: z.literal("ok"),
  generated_at: z.string(),
  requester_kind: z.enum(["self", "supporter", "staff"]),
  sections_included: z.array(z.string()),
  sections_refused: z.array(z.string()),
  excluded_domains: z.array(z.string()),
  limits: z.array(z.string()),
  patient: z.object({
    id: z.string(),
    patient_number: str,
    full_name: str,
    sex: str,
    date_of_birth: str,
  }),
  vitals: z.array(vitalRow).optional(),
  lab_results: z.array(labRow).optional(),
  medications: z.array(medicationRow).optional(),
  conditions: z.array(conditionRow).optional(),
  allergies: z.array(allergyRow).optional(),
  immunizations: z.array(immunizationRow).optional(),
  documents: z.array(documentRow).optional(),
});

export type ExportSnapshot = z.infer<typeof exportSnapshotSchema>;
export type VitalRow = z.infer<typeof vitalRow>;
