import type { AuditedSectionResult } from "./audited-chart";

/**
 * Display model for the allergy line in the patient-record header (doctor workspace spec 11.1, 11.2, 28).
 *
 * Four states, and only one of them may say "none recorded":
 *  - `denied`: the audited chart read refused this section (not on the care team). Not "no allergies".
 *  - `error`:  the read failed. Not "no allergies".
 *  - `none`:   the read succeeded and the list is empty (after removing refuted entries).
 *  - `list`:   one or more allergies, severe first, each labelled confirmed or patient-reported.
 *
 * A refuted entry (a clinician checked it and it is not an allergy) is not shown in the header; it stays in the
 * full record. Provenance follows the record's own verification status first, then its source, so a
 * patient-entered allergy a clinician later confirmed reads "Confirmed".
 */
export type AllergyProvenance = "confirmed" | "patient_reported" | "imported_unchecked" | "recorded_by_clinician";

export type AllergyHeaderItem = {
  id: string;
  substance: string;
  severity: "mild" | "moderate" | "severe" | null;
  provenance: AllergyProvenance;
};

export type AllergyHeaderView =
  | { kind: "denied" }
  | { kind: "error" }
  | { kind: "none" }
  | { kind: "list"; items: AllergyHeaderItem[] };

const SEVERITY_RANK = { severe: 0, moderate: 1, mild: 2 } as const;

export const PROVENANCE_LABEL: Record<AllergyProvenance, string> = {
  confirmed: "Confirmed",
  recorded_by_clinician: "Recorded by a clinician, not yet confirmed",
  patient_reported: "Patient-reported, not yet confirmed",
  imported_unchecked: "Imported record, not yet confirmed",
};

export function allergyHeaderView(result: AuditedSectionResult<"allergies">): AllergyHeaderView {
  if (result.status === "denied") return { kind: "denied" };
  if (result.status === "error") return { kind: "error" };

  const items: AllergyHeaderItem[] = result.rows.flatMap((row) => {
    if (!row.id || !row.substance) return [];
    if (row.verification_status === "refuted") return [];
    const provenance: AllergyProvenance =
      row.verification_status === "confirmed"
        ? "confirmed"
        : row.source === "clinician"
          ? "recorded_by_clinician"
          : row.source === "fhir_import"
            ? "imported_unchecked"
            : "patient_reported";
    return [{ id: row.id, substance: row.substance, severity: row.severity, provenance }];
  });

  if (items.length === 0) return { kind: "none" };

  items.sort((a, b) => {
    const sa = a.severity ? SEVERITY_RANK[a.severity] : 3;
    const sb = b.severity ? SEVERITY_RANK[b.severity] : 3;
    return sa - sb || a.substance.localeCompare(b.substance);
  });
  return { kind: "list", items };
}

/** "54 years, female" style line; each part only when known, null when neither is. */
export function ageSexLine(ageYears: number | null, sex: "male" | "female" | null): string | null {
  const parts: string[] = [];
  if (ageYears !== null && Number.isFinite(ageYears) && ageYears >= 0) parts.push(`${ageYears} ${ageYears === 1 ? "year" : "years"}`);
  if (sex) parts.push(sex);
  return parts.length > 0 ? parts.join(", ") : null;
}
