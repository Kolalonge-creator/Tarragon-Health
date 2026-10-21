import { buildFhirBundle, type BundleResult, type FhirOut } from "@/lib/fhir/export-bundle";
import { loadFhirMapping } from "@/lib/fhir/config";
import type { ExportSnapshot } from "@/lib/fhir/export-snapshot";
import type { SharedData } from "@/app/share/[token]/shared-record-view";

/**
 * A shared record as a FHIR R4 bundle (share extras, standard format).
 *
 * The share door (`record_share_by_token`) has already decided what may leave: the sections the patient ticked, the date window, the
 * released-only results. This file only RE-SHAPES that answer and never widens it: it reads nothing from the database and adds nothing
 * the payload did not carry. It reuses the S44 mapper (`buildFhirBundle`) so a vital, a lab result or a medicine is coded the same way
 * everywhere, and no second mapping can drift.
 *
 * What is deliberately different from the full S44 export:
 *   - No real identifiers. The payload has the patient's name and nothing else, so the bundle has a name and no patient number, date of
 *     birth or sex. Resource ids are plain counters ("vital-1"), never database ids and never derived from the link's token.
 *   - Conditions travel as "unconfirmed": the share lists condition names only, with no verification status, so the bundle does not
 *     claim a clinician confirmed them.
 *   - The reference range text a lab printed is kept as text (the share holds the text, not two numbers).
 *   - Emergency blood group and contact are not exported: FHIR has no neutral place for a contact that is not also a Patient.contact, and
 *     a wrong place is worse than leaving it on the printed page.
 */

const NUMBERED = (prefix: string, index: number): string => `${prefix}-${index + 1}`;

/** The synthetic patient id inside a shared bundle. Not a real id. */
export const SHARED_PATIENT_ID = "patient-1";

export function sharedRecordToSnapshot(record: SharedData): ExportSnapshot {
  const snapshot: ExportSnapshot = {
    status: "ok",
    generated_at: record.shared_at,
    requester_kind: "self",
    sections_included: record.sections,
    sections_refused: [],
    // The share is a patient's own pick of sections; items inside a general section are not classified by purpose (same limit as S44).
    excluded_domains: [],
    limits: ["shared_by_patient_link", "items_inside_general_sections_are_not_classified_by_purpose"],
    patient: { id: SHARED_PATIENT_ID, full_name: record.full_name },
  };

  if (record.vitals) {
    snapshot.vitals = record.vitals.map((v, i) => ({
      id: NUMBERED("vital", i),
      vital_type: v.vital_type,
      taken_at: v.taken_at,
      source: v.source,
      systolic: v.systolic,
      diastolic: v.diastolic,
      pulse_bpm: v.pulse_bpm,
      glucose_mmol_l: v.glucose_mmol,
      weight_kg: v.weight_kg,
      temperature_c: v.temperature_c,
      spo2_pct: v.spo2_pct,
    }));
  }

  if (record.lab_results) {
    snapshot.lab_results = record.lab_results.map((r, i) => ({
      id: NUMBERED("lab", i),
      code: r.code,
      value: r.value,
      value_text: r.value_text,
      unit: r.unit,
      flag: r.abnormal_flag,
      taken_at: r.taken_at,
      origin: "lab_result",
    }));
  }

  if (record.medications) {
    snapshot.medications = record.medications.map((m, i) => ({
      id: NUMBERED("medication", i),
      drug_name: m.drug_name,
      dose: m.dose,
      frequency: m.frequency,
      is_active: m.is_active,
      source: "patient_share",
      created_at: record.shared_at,
    }));
  }

  if (record.conditions) {
    snapshot.conditions = record.conditions.map((name, i) => ({
      id: NUMBERED("condition", i),
      condition_name: name,
      // "suspected" is the snapshot's word for "not confirmed by a clinician in this payload"; see the file header.
      status: "suspected",
      source: "patient_share",
      created_at: record.shared_at,
    }));
  }

  if (record.allergies) {
    snapshot.allergies = record.allergies.map((a, i) => ({
      id: NUMBERED("allergy", i),
      allergen: a.allergen,
      reaction: a.reaction,
      severity: a.severity,
      noted_at: record.shared_at,
      verification_status: "unverified",
      source: "patient_share",
    }));
  }

  if (record.vaccinations) {
    snapshot.immunizations = record.vaccinations
      .filter((v) => v.date_administered)
      .map((v, i) => ({
        id: NUMBERED("immunization", i),
        vaccine_name: v.vaccine_name,
        dose_number: v.dose_number,
        date_administered: v.date_administered as string,
        batch_lot_number: v.batch_number,
        verification_status: "unverified",
      }));
  }

  return snapshot;
}

export interface SharedFhirResult extends BundleResult {
  /** The mapping version used, so a file can be traced to the configuration that produced it. */
  mappingVersion: number;
}

export function buildSharedRecordBundle(record: SharedData): SharedFhirResult {
  const { mapping, version } = loadFhirMapping();
  const snapshot = sharedRecordToSnapshot(record);
  const result = buildFhirBundle(snapshot, mapping);

  // Keep the printed reference range as text. The share carries text only, so this is a straight copy keyed by the counter id.
  const rangeText = new Map<string, string>();
  (record.lab_results ?? []).forEach((r, i) => {
    if (r.reference_range_text) rangeText.set(NUMBERED("lab", i), r.reference_range_text);
  });
  const entries = (result.bundle.entry ?? []) as Array<{ resource: FhirOut }>;
  for (const entry of entries) {
    const id = String(entry.resource.id);
    const text = rangeText.get(id);
    if (text && entry.resource.resourceType === "Observation") {
      entry.resource.referenceRange = [{ text }];
    }
  }

  // Say in the bundle itself where it came from, and how many shared items could not be coded. A file must never look complete when the page it
  // came from showed more: the receiving clinic can see the count and ask for the page.
  const meta = (result.bundle.meta ?? {}) as FhirOut;
  const tags = Array.isArray(meta.tag) ? (meta.tag as FhirOut[]) : [];
  const skippedTag: FhirOut[] = result.skipped.length > 0 ? [{ system: mapping.systems.data_quality, code: `items-not-exported-${result.skipped.length}` }] : [];
  result.bundle.meta = { ...meta, tag: [...tags, ...skippedTag], source: "Tarragon Health patient share link" };
  return { ...result, mappingVersion: version };
}

/** The file name a download should get. No name, no date of birth: just what it is and when it was made. */
export function sharedBundleFileName(record: Pick<SharedData, "shared_at">): string {
  const day = /^\d{4}-\d{2}-\d{2}/.exec(record.shared_at)?.[0] ?? "record";
  return `tarragon-health-record-${day}.fhir.json`;
}
