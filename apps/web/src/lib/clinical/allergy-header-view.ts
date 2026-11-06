import { ALLERGY_SOURCE_LABEL, allergyProvenance, type AllergyLine } from "@/lib/doctor-summary-pdf/model";
import type { AuditedSectionResult } from "./audited-chart";

/**
 * Display model for the allergy line in the patient-record header (doctor workspace spec 11.1, 11.2, 28).
 *
 * Four states, and only one of them may say "none recorded":
 *  - `denied`: the audited chart read refused this section (not on the care team). Not "no allergies".
 *  - `error`:  the read failed. Not "no allergies".
 *  - `none`:   the read succeeded and the list is empty.
 *  - `list`:   one or more allergies, severe first, ruled-out entries last.
 *
 * Provenance uses the same helper and wording as the doctor summary PDF (allergyProvenance, ALLERGY_SOURCE_LABEL),
 * so the two never disagree; a refuted entry is shown, labelled "marked as not an allergy", not silently dropped.
 */
export type AllergyProvenance = AllergyLine["provenance"];

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

/** Sentence-case label for a chip, from the shared PDF wording. */
export function provenanceLabel(p: AllergyProvenance): string {
  const text = ALLERGY_SOURCE_LABEL[p];
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function allergyHeaderView(result: AuditedSectionResult<"allergies">): AllergyHeaderView {
  if (result.status === "denied") return { kind: "denied" };
  if (result.status === "error") return { kind: "error" };

  const items: AllergyHeaderItem[] = result.rows.flatMap((row) => {
    if (!row.id || !row.substance) return [];
    return [
      {
        id: row.id,
        substance: row.substance,
        severity: row.severity,
        provenance: allergyProvenance(row.source ?? "patient", row.verification_status ?? "unverified"),
      },
    ];
  });

  if (items.length === 0) return { kind: "none" };

  const rank = (a: AllergyHeaderItem) =>
    (a.provenance === "ruled_out" ? 10 : 0) + (a.severity ? SEVERITY_RANK[a.severity] : 3);
  items.sort((a, b) => rank(a) - rank(b) || a.substance.localeCompare(b.substance));
  return { kind: "list", items };
}

/** Whole years between a YYYY-MM-DD date of birth and `now`, by calendar date in Africa/Lagos; null if unusable. */
export function ageInYears(dateOfBirth: string | null, now: Date): number | null {
  const m = dateOfBirth ? /^(\d{4})-(\d{2})-(\d{2})/.exec(dateOfBirth) : null;
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit" })
    .format(now)
    .split("-")
    .map(Number);
  const [ty, tm, td] = [today[0] ?? 0, today[1] ?? 0, today[2] ?? 0];
  const age = ty - y - (tm < mo || (tm === mo && td < d) ? 1 : 0);
  return age >= 0 && age < 150 ? age : null;
}

/** "54 years, female" style line; each part only when known, null when neither is. */
export function ageSexLine(ageYears: number | null, sex: "male" | "female" | null): string | null {
  const parts: string[] = [];
  if (ageYears !== null && Number.isFinite(ageYears) && ageYears >= 0) parts.push(`${ageYears} ${ageYears === 1 ? "year" : "years"}`);
  if (sex) parts.push(sex);
  return parts.length > 0 ? parts.join(", ") : null;
}
