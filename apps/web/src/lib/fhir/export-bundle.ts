import type { FhirMapping } from "./config";
import type { ExportSnapshot, VitalRow } from "./export-snapshot";
import { CANONICAL_UNIT, labUnitToUcum } from "./units";

/**
 * Builds a FHIR R4 `collection` Bundle from an export snapshot (S44, spec 2.10): Patient, Observation, MedicationStatement, Condition,
 * Immunization and DocumentReference. Pure: no database, no network, so it is the thing the round-trip test exercises.
 *
 * Rules this file keeps:
 *   - It maps only what the snapshot holds. Access rules (who, which categories, released-only results) were applied by the database before the
 *     snapshot existed; nothing here widens them.
 *   - A code is only written when the configuration has one. A lab analyte with no LOINC entry is exported with Tarragon's own analyte code and
 *     text, never a guessed LOINC. A vital with no mapping is listed in `skipped`, not exported with an invented code.
 *   - Units are UCUM and are the stored units (see units.ts), so a value and its unit travel together and read back to the same number.
 *   - A reading from a consumer wearable carries a data-quality tag and a note saying it is an estimate. The source of every observation is a tag.
 *   - No Nigeria Core or NPHCDA profile is claimed until the configuration lists one (`profiles`).
 */

export type FhirOut = Record<string, unknown>;

export interface BundleResult {
  bundle: FhirOut;
  /** Items the snapshot held that were not exported, and why (never silently dropped). */
  skipped: { kind: string; id: string; reason: string }[];
  resourceCount: number;
}

export const WEARABLE_ESTIMATE_NOTE = "Estimate from a consumer wearable. It is not a clinical measurement.";

const VITAL_VALUE: Record<string, (v: VitalRow) => number | null | undefined> = {
  pulse: (v) => v.pulse_bpm,
  glucose: (v) => v.glucose_mmol_l,
  weight: (v) => v.weight_kg,
  temperature: (v) => v.temperature_c,
  spo2: (v) => v.spo2_pct,
  waist_circumference: (v) => v.waist_cm,
  respiratory_rate: (v) => v.respiratory_rate_bpm,
  peak_flow: (v) => v.peak_flow_l_min,
};

function quantity(value: number, unit: { code: string; display: string }, ucum: string): FhirOut {
  return { value, unit: unit.display, system: ucum, code: unit.code };
}

function loincCoding(system: string, code: string, display?: string): FhirOut {
  return display ? { system, code, display } : { system, code };
}

const INTERPRETATION: Record<string, { code: string; display: string }> = {
  normal: { code: "N", display: "Normal" },
  low: { code: "L", display: "Low" },
  high: { code: "H", display: "High" },
  critical: { code: "AA", display: "Critical abnormal" },
  positive: { code: "POS", display: "Positive" },
  negative: { code: "NEG", display: "Negative" },
};

const SNOMED_RESULT: Record<string, { code: string; display: string }> = {
  positive: { code: "10828004", display: "Positive" },
  negative: { code: "260385009", display: "Negative" },
};

export function buildFhirBundle(snapshot: ExportSnapshot, mapping: FhirMapping): BundleResult {
  const { systems } = mapping;
  const base = mapping.base_url.replace(/\/$/, "");
  const patientId = snapshot.patient.id;
  const subject = { reference: `Patient/${patientId}` };
  const skipped: BundleResult["skipped"] = [];
  const resources: FhirOut[] = [];

  const sourceTag = (source: string): FhirOut => ({ system: systems.record_source, code: source });
  const metaFor = (source: string, extraTags: FhirOut[] = []): FhirOut => ({ tag: [sourceTag(source), ...extraTags] });
  const profilesFor = (resourceType: string): string[] | undefined => {
    const list = mapping.profiles[resourceType];
    return list && list.length > 0 ? list : undefined;
  };
  const push = (resource: FhirOut): void => {
    const profile = profilesFor(String(resource.resourceType));
    if (profile) {
      const meta = (resource.meta ?? {}) as FhirOut;
      resource.meta = { ...meta, profile };
    }
    resources.push(resource);
  };

  // --- Patient ---------------------------------------------------------------------------------------------------------------
  const sex = snapshot.patient.sex?.toLowerCase();
  const patient: FhirOut = {
    resourceType: "Patient",
    id: patientId,
    identifier: snapshot.patient.patient_number ? [{ system: systems.patient_number, value: snapshot.patient.patient_number }] : undefined,
    name: snapshot.patient.full_name ? [{ text: snapshot.patient.full_name }] : undefined,
    gender: sex === "male" || sex === "female" || sex === "other" ? sex : "unknown",
    birthDate: snapshot.patient.date_of_birth ?? undefined,
  };
  push(patient);

  // --- Observation: vitals ---------------------------------------------------------------------------------------------------
  for (const v of snapshot.vitals ?? []) {
    const code = mapping.vitals[v.vital_type];
    const unit = CANONICAL_UNIT[v.vital_type as keyof typeof CANONICAL_UNIT];
    if (!code || !unit) {
      skipped.push({ kind: "vital", id: v.id, reason: `no FHIR mapping for vital type ${v.vital_type}` });
      continue;
    }
    const wearable = v.source === "wearable";
    const tags = wearable ? [{ system: systems.data_quality, code: "estimate" }] : [];
    const base_: FhirOut = {
      resourceType: "Observation",
      status: "final",
      category: [{ coding: [{ system: systems.observation_category, code: "vital-signs", display: "Vital Signs" }] }],
      subject,
      effectiveDateTime: v.taken_at,
      meta: metaFor(v.source, tags),
      note: wearable ? [{ text: WEARABLE_ESTIMATE_NOTE }] : undefined,
    };
    if (v.vital_type === "blood_pressure") {
      if (v.systolic == null || v.diastolic == null || !code.systolic || !code.diastolic) {
        skipped.push({ kind: "vital", id: v.id, reason: "blood pressure reading without both values" });
        continue;
      }
      push({
        ...base_,
        id: v.id,
        code: { coding: [loincCoding(systems.loinc, code.loinc, code.display)], text: "Blood pressure" },
        component: [
          { code: { coding: [loincCoding(systems.loinc, code.systolic, "Systolic blood pressure")] }, valueQuantity: quantity(v.systolic, unit, systems.ucum) },
          { code: { coding: [loincCoding(systems.loinc, code.diastolic, "Diastolic blood pressure")] }, valueQuantity: quantity(v.diastolic, unit, systems.ucum) },
        ],
      });
      if (v.pulse_bpm != null && mapping.vitals.pulse && CANONICAL_UNIT.pulse) {
        // the pulse the cuff reported with this reading, as its own observation
        push({
          ...base_,
          id: `${v.id}-pulse`,
          code: { coding: [loincCoding(systems.loinc, mapping.vitals.pulse.loinc, mapping.vitals.pulse.display)], text: "Heart rate" },
          valueQuantity: quantity(v.pulse_bpm, CANONICAL_UNIT.pulse, systems.ucum),
        });
      }
      continue;
    }
    const value = VITAL_VALUE[v.vital_type]?.(v);
    if (value == null) {
      skipped.push({ kind: "vital", id: v.id, reason: `${v.vital_type} reading without a value` });
      continue;
    }
    push({
      ...base_,
      id: v.id,
      code: { coding: [loincCoding(systems.loinc, code.loinc, code.display)], text: code.display },
      valueQuantity: quantity(value, unit, systems.ucum),
    });
  }

  // --- Observation: released laboratory results ------------------------------------------------------------------------------
  for (const r of snapshot.lab_results ?? []) {
    const loinc = mapping.lab_analyte_loinc[r.code];
    const ucum = r.unit ? labUnitToUcum(r.unit) : null;
    const coding: FhirOut[] = [{ system: systems.lab_analyte, code: r.code }];
    if (loinc) coding.unshift(loincCoding(systems.loinc, loinc));
    const obs: FhirOut = {
      resourceType: "Observation",
      id: r.id,
      status: "final",
      category: [{ coding: [{ system: systems.observation_category, code: "laboratory", display: "Laboratory" }] }],
      code: { coding, text: r.code },
      subject,
      effectiveDateTime: r.taken_at ?? undefined,
      meta: metaFor(r.origin === "lab_result" ? "lab" : "lab_legacy"),
    };
    if (r.value != null) {
      obs.valueQuantity = r.unit ? { value: r.value, unit: r.unit, ...(ucum ? { system: systems.ucum, code: ucum } : {}) } : { value: r.value };
    } else if (r.value_text) {
      const snomed = SNOMED_RESULT[r.value_text.toLowerCase()];
      obs.valueCodeableConcept = snomed
        ? { coding: [{ system: systems.snomed, code: snomed.code, display: snomed.display }], text: r.value_text }
        : { text: r.value_text };
    } else {
      skipped.push({ kind: "lab_result", id: r.id, reason: "result without a value" });
      continue;
    }
    const interp = r.flag ? INTERPRETATION[r.flag] : undefined;
    if (interp) obs.interpretation = [{ coding: [{ system: systems.interpretation, code: interp.code, display: interp.display }] }];
    if ((r.ref_low != null || r.ref_high != null) && r.value != null) {
      const q = (n: number): FhirOut => (r.unit ? { value: n, unit: r.unit, ...(ucum ? { system: systems.ucum, code: ucum } : {}) } : { value: n });
      obs.referenceRange = [{ low: r.ref_low != null ? q(r.ref_low) : undefined, high: r.ref_high != null ? q(r.ref_high) : undefined }];
    }
    push(obs);
  }

  // --- MedicationStatement ---------------------------------------------------------------------------------------------------
  for (const m of snapshot.medications ?? []) {
    const text = [m.dose, m.frequency].filter((x): x is string => Boolean(x && x.trim())).join(", ");
    push({
      resourceType: "MedicationStatement",
      id: m.id,
      status: m.is_active ? "active" : m.stopped_at ? "stopped" : "completed",
      medicationCodeableConcept: { text: m.drug_name },
      subject,
      dosage: text || m.route ? [{ text: text || undefined, route: m.route ? { text: m.route } : undefined }] : undefined,
      meta: metaFor(m.source),
    });
  }

  // --- Condition -------------------------------------------------------------------------------------------------------------
  for (const c of snapshot.conditions ?? []) {
    const inactive = c.status === "historical";
    const resolved = c.status === "resolved";
    const unconfirmed = c.status === "suspected" || c.status === "under_investigation";
    push({
      resourceType: "Condition",
      id: c.id,
      clinicalStatus: { coding: [{ system: systems.condition_clinical, code: resolved ? "resolved" : inactive ? "inactive" : "active" }] },
      verificationStatus: { coding: [{ system: systems.condition_verification, code: unconfirmed ? "unconfirmed" : "confirmed" }] },
      code: {
        coding: c.icd10_code ? [{ system: systems.icd10, code: c.icd10_code }] : undefined,
        text: c.condition_name,
      },
      subject,
      onsetDateTime: c.date_identified ?? undefined,
      meta: metaFor(c.source),
    });
  }

  // --- AllergyIntolerance (not in the spec's six, exported because a record without allergies is unsafe to hand on) ---------------
  for (const a of snapshot.allergies ?? []) {
    push({
      resourceType: "AllergyIntolerance",
      id: a.id,
      clinicalStatus: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical", code: "active" }] },
      verificationStatus: {
        coding: [{ system: "http://terminology.hl7.org/CodeSystem/allergyintolerance-verification", code: a.verification_status === "verified" ? "confirmed" : "unconfirmed" }],
      },
      code: { text: a.allergen },
      patient: subject,
      recordedDate: a.noted_at,
      reaction: a.reaction || a.severity ? [{ manifestation: [{ text: a.reaction ?? "Not specified" }], severity: a.severity === "mild" || a.severity === "moderate" || a.severity === "severe" ? a.severity : undefined }] : undefined,
      meta: metaFor(a.source),
    });
  }

  // --- Immunization ----------------------------------------------------------------------------------------------------------
  for (const i of snapshot.immunizations ?? []) {
    const name = i.vaccine_name ?? i.vaccine_code;
    if (!name) {
      skipped.push({ kind: "immunization", id: i.id, reason: "vaccine has no name" });
      continue;
    }
    push({
      resourceType: "Immunization",
      id: i.id,
      status: "completed",
      vaccineCode: {
        coding: i.vaccine_code ? [{ system: systems.vaccine, code: i.vaccine_code, display: name }] : undefined,
        text: name,
      },
      patient: subject,
      occurrenceDateTime: i.date_administered,
      lotNumber: i.batch_lot_number ?? undefined,
      primarySource: i.verification_status === "verified",
      performer: i.given_where ? [{ actor: { display: i.given_where } }] : undefined,
      protocolApplied: i.dose_number != null ? [{ doseNumberPositiveInt: i.dose_number }] : undefined,
      meta: metaFor(i.verification_status === "verified" ? "clinician" : "patient"),
    });
  }

  // --- DocumentReference (metadata only: no file, no text, no values read from a photo) -------------------------------------------
  for (const d of snapshot.documents ?? []) {
    push({
      resourceType: "DocumentReference",
      id: d.id,
      status: "current",
      type: { coding: [{ system: systems.document_type, code: d.document_type }], text: d.document_type.replace(/_/g, " ") },
      subject,
      date: d.created_at,
      content: [{ attachment: { contentType: d.mime_type ?? "application/octet-stream" } }],
      context: d.document_date ? { period: { start: d.document_date } } : undefined,
      meta: metaFor(d.source ?? "patient"),
    });
  }

  const scopeTags: FhirOut[] = [
    ...snapshot.excluded_domains.map((x) => ({ system: systems.data_quality, code: `excludes-${x.replace(/_/g, "-")}` })),
    ...snapshot.limits.map((x) => ({ system: systems.data_quality, code: x.replace(/_/g, "-") })),
    ...snapshot.sections_refused.map((x) => ({ system: systems.data_quality, code: `section-not-permitted-${x.replace(/_/g, "-")}` })),
  ];

  const bundle: FhirOut = {
    resourceType: "Bundle",
    type: "collection",
    timestamp: snapshot.generated_at,
    meta: { tag: scopeTags },
    entry: resources.map((r) => ({ fullUrl: `${base}/${String(r.resourceType)}/${String(r.id)}`, resource: stripUndefined(r) })),
  };
  return { bundle: stripUndefined(bundle) as FhirOut, skipped, resourceCount: resources.length };
}

/** JSON drops undefined already, but a test that compares objects should not see keys that are present and undefined. */
function stripUndefined<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
