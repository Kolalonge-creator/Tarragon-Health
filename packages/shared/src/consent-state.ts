/**
 * What a patient's consent rows mean, in one place (v5 4.2, S04).
 *
 * `patient_consents` is append-only: an acceptance and a later withdrawal are two rows, never an update. A consent is
 * IN FORCE when there is an accepted row for the current version and no withdrawn row of the same type created after
 * it. This mirrors `private.has_required_consents` exactly (same ordering, on `created_at`), so what a screen shows
 * can never disagree with what the database enforces. Before this existed, web and mobile treated any matching row as
 * accepted, so a withdrawn consent still showed as granted.
 */
export interface ConsentEventRow {
  consent_type: string;
  version: string;
  action: string;
  created_at: string;
}

export interface ConsentVersionRef {
  consent_type: string;
  version: string;
  /** True only for a purpose declared optional. Absent or false means required, the safer reading. */
  is_optional?: boolean;
}

export type ConsentState =
  /** An acceptance of this exact version is in force. */
  | "granted"
  /** The latest word on this purpose is a withdrawal. */
  | "withdrawn"
  /** An older version is in force; a newer one needs review. */
  | "older_version"
  /** Never answered. */
  | "never";

const at = (row: ConsentEventRow) => Date.parse(row.created_at);

function inForce(rows: readonly ConsentEventRow[], row: ConsentEventRow): boolean {
  return (
    row.action === "accepted" &&
    !rows.some((r) => r.consent_type === row.consent_type && r.action === "withdrawn" && at(r) > at(row))
  );
}

export function consentStateFor(rows: readonly ConsentEventRow[], version: ConsentVersionRef): ConsentState {
  const ofType = rows.filter((r) => r.consent_type === version.consent_type);
  if (ofType.some((r) => r.version === version.version && inForce(rows, r))) return "granted";
  if (ofType.some((r) => inForce(rows, r))) return "older_version";
  // Nothing in force. If the person ever answered, the latest answer was a withdrawal (or an acceptance that a later
  // withdrawal ended).
  return ofType.length > 0 ? "withdrawn" : "never";
}

/** The current REQUIRED purposes that are not in force. Optional purposes are never outstanding: they are a choice. */
export function outstandingRequired<V extends ConsentVersionRef>(
  versions: readonly V[],
  rows: readonly ConsentEventRow[]
): V[] {
  return versions.filter((v) => !v.is_optional && consentStateFor(rows, v) !== "granted");
}
