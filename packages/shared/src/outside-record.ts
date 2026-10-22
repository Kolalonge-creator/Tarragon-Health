/**
 * What a record a patient supplied from another hospital may say about itself (S09y). Shared by the web page and the phone so both obey one rule.
 * "Checked" is claimed only when a status of verified AND a reviewer AND a review time all exist. Anything short of that falls back to "supplied by you,
 * not yet checked": the safe direction, and the same null-gating the shared ReviewedByDoctor follows for cases.
 */
export type OutsideRecordVerification = "unchecked" | "verified" | "not_verified" | "not_applicable";

export interface OutsideRecordStatusInput {
  status: OutsideRecordVerification | string | null | undefined;
  /** The checking clinician's name, resolved from the staff directory. Null when unknown: the line then says "your care team", never a guessed name. */
  reviewerName: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  note: string | null;
}

export type OutsideRecordLabel =
  | { kind: "unchecked" }
  | { kind: "verified"; reviewerName: string | null; date: string }
  | { kind: "not_verified"; note: string | null; date: string | null }
  | { kind: "none" };

function formatDate(value: string): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", year: "numeric" });
}

export function outsideRecordLabel(i: OutsideRecordStatusInput): OutsideRecordLabel {
  if (i.status === "not_applicable") return { kind: "none" };
  if (i.status === "verified" && i.reviewedBy && i.reviewedAt) return { kind: "verified", reviewerName: i.reviewerName, date: formatDate(i.reviewedAt) };
  if (i.status === "not_verified" && i.reviewedBy && i.reviewedAt) return { kind: "not_verified", note: i.note, date: formatDate(i.reviewedAt) };
  return { kind: "unchecked" };
}
