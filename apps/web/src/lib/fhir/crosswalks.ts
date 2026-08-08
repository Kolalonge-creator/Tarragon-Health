import type { CodeableConcept, Coding } from "./types";

/**
 * Code-system crosswalks between Tarragon's internal enums/catalogues and
 * standard FHIR terminologies (LOINC, CVX). None of this platform's own
 * tables carry a standard code today (confirmed: no LOINC/SNOMED/ICD-10/
 * RxNorm/CVX column anywhere in the schema) — every mapping here is a
 * best-effort default for a *class* of internal value, not something
 * clinically verified for an individual patient. Every lookup function
 * degrades to `{ text }`-only (no `coding`) rather than emit a guessed
 * code, which is the FHIR-valid way to say "we know what this is, we don't
 * have its standard code."
 *
 * Local, Tarragon-namespaced CodeSystems cover concepts with no standard
 * code at all (the Nigeria-specific hospital genotype screen; the internal
 * `care_plan_condition` value 'other').
 */

const TARRAGON_CODESYSTEM_BASE = "https://tarragonhealth.ng/fhir/CodeSystem";

export const LOCAL_CODESYSTEMS = {
  haemoglobinGenotype: `${TARRAGON_CODESYSTEM_BASE}/haemoglobin-genotype`,
  carePlanCondition: `${TARRAGON_CODESYSTEM_BASE}/care-plan-condition`,
} as const;

// ---------------------------------------------------------------------------
// Vitals -> LOINC
// ---------------------------------------------------------------------------

const LOINC = "http://loinc.org";

/**
 * One representative LOINC code per vital_type. Blood pressure is a panel
 * with two components (systolic/diastolic) handled separately by the
 * Observation builder, not a single code — see loincVitalsPanel below.
 * Confidence is high for the first six (in wide clinical use); ketones has
 * no single universally-used LOINC for a capillary/blood strip reading, so
 * it's marked lower-confidence in the comment rather than silently treated
 * the same as the rest.
 */
export const LOINC_BY_VITAL_TYPE: Record<string, Coding> = {
  pulse: { system: LOINC, code: "8867-4", display: "Heart rate" },
  weight: { system: LOINC, code: "29463-7", display: "Body weight" },
  temperature: { system: LOINC, code: "8310-5", display: "Body temperature" },
  spo2: {
    system: LOINC,
    code: "59408-5",
    display: "Oxygen saturation in Arterial blood by Pulse oximetry",
  },
  glucose: { system: LOINC, code: "2339-0", display: "Glucose [Mass/volume] in Blood" },
  waist_circumference: {
    system: LOINC,
    code: "56086-2",
    display: "Waist Circumference at umbilicus by Tape measure",
  },
  // Lower confidence: no single dominant LOINC for a home blood-ketone
  // strip reading. 12836-9 is the closest general "Ketones, blood" code.
  ketones: { system: LOINC, code: "12836-9", display: "Ketones [Moles/volume] in Blood" },
};

export const LOINC_BLOOD_PRESSURE_PANEL: Coding = {
  system: LOINC,
  code: "85354-9",
  display: "Blood pressure panel with all children optional",
};
export const LOINC_SYSTOLIC: Coding = { system: LOINC, code: "8480-6", display: "Systolic blood pressure" };
export const LOINC_DIASTOLIC: Coding = { system: LOINC, code: "8462-4", display: "Diastolic blood pressure" };

export function loincCodeableConceptForVitalType(vitalType: string, fallbackText: string): CodeableConcept {
  const coding = LOINC_BY_VITAL_TYPE[vitalType];
  return coding ? { coding: [coding], text: fallbackText } : { text: fallbackText };
}

// ---------------------------------------------------------------------------
// Blood group / genotype -> LOINC / local CodeSystem
// ---------------------------------------------------------------------------

export const LOINC_ABO_GROUP: Coding = { system: LOINC, code: "883-9", display: "ABO group [Type] in Blood" };
export const LOINC_RH_GROUP: Coding = { system: LOINC, code: "10331-7", display: "Rh [Type] in Blood" };

/** blood_group enum values are combined ABO+Rh shorthand, e.g. "O+" / "AB-" — split for FHIR's separate ABO/Rh Observations. */
export function splitCombinedBloodGroup(bloodGroup: string): { abo: string; rh: "Positive" | "Negative" } | null {
  const match = /^(AB|A|B|O)([+-])$/.exec(bloodGroup);
  if (!match) return null;
  return { abo: match[1], rh: match[2] === "+" ? "Positive" : "Negative" };
}

export function genotypeCodeableConcept(genotype: string): CodeableConcept {
  return {
    coding: [{ system: LOCAL_CODESYSTEMS.haemoglobinGenotype, code: genotype, display: `Haemoglobin genotype ${genotype}` }],
    text: `Haemoglobin genotype ${genotype}`,
  };
}

// ---------------------------------------------------------------------------
// care_plan_condition -> ICD-10 (best-effort defaults, not patient-specific)
// ---------------------------------------------------------------------------

const ICD10 = "http://hl7.org/fhir/sid/icd-10";

/**
 * One default ICD-10 code per condition category. These are the most
 * generic/unspecified code in the relevant ICD-10 block (e.g. "type 2
 * diabetes mellitus without complications" for the bare 'diabetes'
 * category) — never a substitute for a clinician's own diagnosis coding.
 * 'other' has no ICD-10 mapping at all by construction; text-only.
 */
export const ICD10_BY_CARE_PLAN_CONDITION: Record<string, Coding> = {
  hypertension: { system: ICD10, code: "I10", display: "Essential (primary) hypertension" },
  diabetes: { system: ICD10, code: "E11.9", display: "Type 2 diabetes mellitus without complications" },
  obesity: { system: ICD10, code: "E66.9", display: "Obesity, unspecified" },
  ckd: { system: ICD10, code: "N18.9", display: "Chronic kidney disease, unspecified" },
  cardiovascular: { system: ICD10, code: "I25.9", display: "Chronic ischaemic heart disease, unspecified" },
  asthma: { system: ICD10, code: "J45.9", display: "Asthma, unspecified" },
  copd: { system: ICD10, code: "J44.9", display: "Chronic obstructive pulmonary disease, unspecified" },
  heart_failure: { system: ICD10, code: "I50.9", display: "Heart failure, unspecified" },
};

export function conditionCodeableConcept(condition: string): CodeableConcept {
  const coding = ICD10_BY_CARE_PLAN_CONDITION[condition];
  if (coding) return { coding: [coding], text: coding.display };
  return {
    coding: [{ system: LOCAL_CODESYSTEMS.carePlanCondition, code: condition, display: condition }],
    text: condition,
  };
}

// ---------------------------------------------------------------------------
// Vaccines -> CVX
// ---------------------------------------------------------------------------

const CVX = "http://hl7.org/fhir/sid/cvx";

/**
 * vaccination_catalog is a live, org-editable table with no fixed rows and
 * no code column beyond its own internal `code` — there is no reliable key
 * to hardcode a code->CVX map against. Matching is done by name pattern
 * instead, checked in order, first match wins. A catalogue entry that
 * matches nothing gets no `coding` on export (text-only) and, on import,
 * a parse_warning asking a clinician to pick the right catalogue entry by
 * hand rather than guessing.
 */
const CVX_NAME_PATTERNS: { pattern: RegExp; coding: Coding }[] = [
  { pattern: /\bbcg\b/i, coding: { system: CVX, code: "19", display: "BCG" } },
  // Combination-vaccine patterns must be checked before their individual
  // component patterns below (e.g. "Pentavalent (DTaP-Hib-IPV-HepB)" would
  // otherwise match the plain IPV pattern first, since IPV is a substring
  // of its own name).
  { pattern: /penta|dtap.?hep.?hib/i, coding: { system: CVX, code: "120", display: "DTaP-Hib-IPV-HepB (pentavalent-equivalent)" } },
  { pattern: /\b(opv|polio)\b/i, coding: { system: CVX, code: "02", display: "OPV" } },
  { pattern: /\bipv\b/i, coding: { system: CVX, code: "10", display: "IPV" } },
  { pattern: /rota/i, coding: { system: CVX, code: "116", display: "Rotavirus, pentavalent" } },
  { pattern: /measles/i, coding: { system: CVX, code: "05", display: "Measles" } },
  { pattern: /\bmmr\b/i, coding: { system: CVX, code: "03", display: "MMR" } },
  { pattern: /yellow.?fever/i, coding: { system: CVX, code: "37", display: "Yellow fever" } },
  { pattern: /hep.?b|hepatitis.?b/i, coding: { system: CVX, code: "08", display: "Hepatitis B" } },
  { pattern: /\btd\b|tetanus.?(diphtheria)?/i, coding: { system: CVX, code: "09", display: "Td" } },
  { pattern: /covid|sars.?cov.?2/i, coding: { system: CVX, code: "213", display: "COVID-19 vaccine" } },
  { pattern: /hpv/i, coding: { system: CVX, code: "137", display: "HPV, unspecified formulation" } },
  { pattern: /meningo/i, coding: { system: CVX, code: "108", display: "Meningococcal, unspecified formulation" } },
];

export function cvxCodingForVaccineName(name: string): Coding | null {
  for (const { pattern, coding } of CVX_NAME_PATTERNS) {
    if (pattern.test(name)) return coding;
  }
  return null;
}

export function vaccineCodeableConcept(catalogName: string): CodeableConcept {
  const coding = cvxCodingForVaccineName(catalogName);
  return coding ? { coding: [coding], text: catalogName } : { text: catalogName };
}

/**
 * Import direction: given the FHIR Immunization's vaccineCode, find the
 * best-matching row in this org's live vaccination_catalog by name. Prefers
 * an exact CVX code match (if the catalogue name itself resolves to the
 * same CVX code) over a raw text match. Returns null — never a guess — when
 * nothing is confident enough; the caller must then surface this as a
 * parse_warning and let a clinician pick manually before confirming.
 */
export function matchVaccineToCatalog<T extends { id: string; name: string }>(
  vaccineCode: CodeableConcept | undefined,
  catalog: T[]
): T | null {
  if (!vaccineCode) return null;

  const incomingCvxCode = vaccineCode.coding?.find((c) => c.system === CVX)?.code;
  if (incomingCvxCode) {
    const byCode = catalog.find((row) => cvxCodingForVaccineName(row.name)?.code === incomingCvxCode);
    if (byCode) return byCode;
  }

  const text = vaccineCode.text?.trim().toLowerCase();
  if (text) {
    const byExactText = catalog.find((row) => row.name.trim().toLowerCase() === text);
    if (byExactText) return byExactText;
  }

  return null;
}
