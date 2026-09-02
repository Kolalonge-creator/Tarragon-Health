/**
 * Weight-based paediatric dosing safety check (Child Health Platform §48.10:
 * "Child prescriptions require appropriate age/weight/dosing/allergy checks
 * ... should not allow unsafe assumptions about adult dosing").
 *
 * ADVISORY, NEVER A BLOCK — same posture as assessMedicationSafety in
 * drug-safety.ts, which this is a sibling to (not a replacement for; call
 * both when logging a medication for a dependent under 12). Returns the same
 * SafetyFinding shape so a caller can merge both lists into one display.
 * PURE, no I/O.
 *
 * SCOPE, STATED HONESTLY: a small formulary of three common, extremely
 * well-established WHO Model Formulary for Children / BNF for Children
 * dosing RANGES (deliberately ranges, not decimal-precise figures — these are
 * the kind of widely-reproduced clinical constant safe to encode directly,
 * unlike the LMS growth-reference parameters in
 * 20260829121652_pediatric_growth_monitoring.sql, which are precision-
 * sensitive population statistics and are NOT approximated here or anywhere
 * in this codebase). This is NOT a complete paediatric formulary and must
 * never be represented as one — verify any real prescribing decision against
 * the platform's actual clinical formulary / a current BNF for Children.
 *
 * Deliberately takes STRUCTURED numeric dosing inputs (mg per dose, doses per
 * day), not medications.dose free text ("500mg twice daily") — reliably
 * parsing arbitrary prescription free text is a separate, much larger
 * problem this change does not attempt; see docs/PEDIATRIC_CHILD_HEALTH_SPEC.md.
 */

import type { SafetyFinding } from "./drug-safety";

export interface PediatricFormularyEntry {
  drugName: string;
  /** Matches against a free-text drug name the same loose way drug-safety.ts's CLASS_PATTERNS do. */
  matchPattern: RegExp;
  minMgPerKgPerDose: number;
  maxMgPerKgPerDose: number;
  maxMgPerKgPerDay: number;
  minAgeMonths: number | null;
  minWeightKg: number | null;
  note: string;
}

/** Deliberately small — see this file's SCOPE header. */
export const PEDIATRIC_FORMULARY: PediatricFormularyEntry[] = [
  {
    drugName: "Paracetamol (acetaminophen)",
    matchPattern: /paracetamol|acetaminophen/i,
    minMgPerKgPerDose: 10,
    maxMgPerKgPerDose: 15,
    maxMgPerKgPerDay: 60,
    minAgeMonths: 1,
    minWeightKg: null,
    note: "WHO Model Formulary for Children: 10-15 mg/kg per dose, up to 4 times daily (max 60 mg/kg/day). Under 1 month: dose only under direct clinical supervision.",
  },
  {
    drugName: "Ibuprofen",
    matchPattern: /ibuprofen/i,
    minMgPerKgPerDose: 5,
    maxMgPerKgPerDose: 10,
    maxMgPerKgPerDay: 30,
    minAgeMonths: 3,
    minWeightKg: 5,
    note: "WHO Model Formulary for Children: 5-10 mg/kg per dose, up to 3 times daily (max ~30 mg/kg/day). Not recommended under 3 months or under 5 kg.",
  },
  {
    drugName: "Amoxicillin",
    matchPattern: /amoxicillin/i,
    minMgPerKgPerDose: 12.5,
    maxMgPerKgPerDose: 25,
    maxMgPerKgPerDay: 90,
    minAgeMonths: null,
    minWeightKg: null,
    note: "WHO Model Formulary for Children: 25-50 mg/kg/day in 2-3 divided doses (up to 90 mg/kg/day for severe infection, per local protocol).",
  },
];

export function findPediatricFormularyEntry(drugName: string): PediatricFormularyEntry | null {
  return PEDIATRIC_FORMULARY.find((entry) => entry.matchPattern.test(drugName)) ?? null;
}

export interface PediatricDosingInput {
  medicationId?: string;
  drugName: string;
  doseMgPerAdministration: number | null;
  dosesPerDay: number | null;
  weightKg: number | null;
  ageMonths: number | null;
}

function finding(
  severity: SafetyFinding["severity"],
  title: string,
  message: string,
  entry: PediatricFormularyEntry,
  medicationId?: string
): SafetyFinding {
  return {
    kind: "drug_specific",
    severity,
    title,
    message,
    medicationIds: medicationId ? [medicationId] : [],
    drugNames: [entry.drugName],
  };
}

/**
 * Findings for a single medication being logged for a child. Missing weight
 * is itself flagged — §48.10's "should not allow unsafe assumptions" means a
 * dose can never be silently assessed as though it were an adult's, and it
 * cannot be assessed as safe at all without a current weight on file.
 */
export function assessPediatricDosing(input: PediatricDosingInput): SafetyFinding[] {
  const entry = findPediatricFormularyEntry(input.drugName);
  if (!entry) return [];

  if (input.weightKg === null) {
    return [
      finding(
        "caution",
        "Weight required for a safe children's dose",
        `${entry.drugName} is dosed by weight in children (${entry.minMgPerKgPerDose}-${entry.maxMgPerKgPerDose} mg/kg per dose). Record a current weight before relying on this dose.`,
        entry,
        input.medicationId
      ),
    ];
  }

  const findings: SafetyFinding[] = [];

  if (entry.minAgeMonths !== null && (input.ageMonths === null || input.ageMonths < entry.minAgeMonths)) {
    findings.push(
      finding("contraindicated", `${entry.drugName} may not be appropriate at this age`, entry.note, entry, input.medicationId)
    );
  }

  if (entry.minWeightKg !== null && input.weightKg < entry.minWeightKg) {
    findings.push(
      finding("contraindicated", `${entry.drugName} may not be appropriate at this weight`, entry.note, entry, input.medicationId)
    );
  }

  if (input.doseMgPerAdministration !== null) {
    const mgPerKgPerDose = input.doseMgPerAdministration / input.weightKg;

    if (mgPerKgPerDose > entry.maxMgPerKgPerDose) {
      findings.push(
        finding(
          "contraindicated",
          `Dose exceeds the usual paediatric range for ${entry.drugName}`,
          `${mgPerKgPerDose.toFixed(1)} mg/kg is above the usual ${entry.minMgPerKgPerDose}-${entry.maxMgPerKgPerDose} mg/kg per dose. ${entry.note}`,
          entry,
          input.medicationId
        )
      );
    } else if (mgPerKgPerDose < entry.minMgPerKgPerDose) {
      findings.push(
        finding(
          "info",
          `Dose is below the usual paediatric range for ${entry.drugName}`,
          `${mgPerKgPerDose.toFixed(1)} mg/kg is below the usual ${entry.minMgPerKgPerDose}-${entry.maxMgPerKgPerDose} mg/kg per dose. May be intentional (e.g. a first dose) — for context only.`,
          entry,
          input.medicationId
        )
      );
    }

    if (input.dosesPerDay !== null) {
      const mgPerKgPerDay = mgPerKgPerDose * input.dosesPerDay;
      if (mgPerKgPerDay > entry.maxMgPerKgPerDay) {
        findings.push(
          finding(
            "contraindicated",
            `Daily total exceeds the usual paediatric maximum for ${entry.drugName}`,
            `${mgPerKgPerDay.toFixed(1)} mg/kg/day is above the usual maximum of ${entry.maxMgPerKgPerDay} mg/kg/day.`,
            entry,
            input.medicationId
          )
        );
      }
    }
  }

  return findings;
}
