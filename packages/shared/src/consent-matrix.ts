/**
 * The consent matrix (v5 1.13, S42): data type x purpose. The database is the source of truth (`consent_matrix_cells`,
 * `consent_matrix_events`, rule trigger `enforce_consent_matrix_event`); this module is the typed reader and the
 * helpers both apps use, and a scan test fails if its lists drift from the migration.
 *
 * Wording for every cell is a placeholder key that counsel has not approved (OQ-49, OQ-296). Nothing here invents legal text.
 */
export const CONSENT_DATA_TYPES = ["vitals", "reproductive", "mental_health", "documents", "device_data"] as const;
export const CONSENT_PURPOSES = ["care", "care_circle_sharing", "research", "sponsor_reporting"] as const;
export type ConsentDataType = (typeof CONSENT_DATA_TYPES)[number];
export type ConsentPurpose = (typeof CONSENT_PURPOSES)[number];

export interface ConsentCell {
  data_type: ConsentDataType;
  purpose: ConsentPurpose;
  /** True only for the care purpose: it cannot be withdrawn, and turning an optional cell off never touches it. */
  required_for_care: boolean;
  sensitive: boolean;
  text_key: string;
  wording_status: "draft_pending_counsel" | "approved";
  granted: boolean;
  changed_at: string | null;
}

export interface ConsentBundle {
  code: string;
  text_key: string;
  cells: { data_type: ConsentDataType; purpose: ConsentPurpose }[];
}

export interface ConsentMatrix {
  cells: ConsentCell[];
  bundles: ConsentBundle[];
}

const isType = (v: unknown): v is ConsentDataType => (CONSENT_DATA_TYPES as readonly unknown[]).includes(v);
const isPurpose = (v: unknown): v is ConsentPurpose => (CONSENT_PURPOSES as readonly unknown[]).includes(v);

/** Reads the `my_consent_matrix()` payload. Anything unexpected returns null: a screen shows an error, never a guess. */
export function parseConsentMatrix(payload: unknown): ConsentMatrix | null {
  if (typeof payload !== "object" || payload === null) return null;
  const raw = payload as { cells?: unknown; bundles?: unknown };
  if (!Array.isArray(raw.cells) || !Array.isArray(raw.bundles)) return null;
  const cells: ConsentCell[] = [];
  for (const c of raw.cells as Record<string, unknown>[]) {
    if (!isType(c.data_type) || !isPurpose(c.purpose) || typeof c.granted !== "boolean" || typeof c.required_for_care !== "boolean") return null;
    cells.push({
      data_type: c.data_type,
      purpose: c.purpose,
      required_for_care: c.required_for_care,
      sensitive: c.sensitive === true,
      text_key: String(c.text_key ?? ""),
      wording_status: c.wording_status === "approved" ? "approved" : "draft_pending_counsel",
      granted: c.granted,
      changed_at: typeof c.changed_at === "string" ? c.changed_at : null,
    });
  }
  const bundles: ConsentBundle[] = [];
  for (const b of raw.bundles as Record<string, unknown>[]) {
    if (typeof b.code !== "string") return null;
    const bc = Array.isArray(b.cells) ? (b.cells as Record<string, unknown>[]) : [];
    bundles.push({
      code: b.code,
      text_key: String(b.text_key ?? ""),
      cells: bc.filter((x) => isType(x.data_type) && isPurpose(x.purpose)).map((x) => ({ data_type: x.data_type as ConsentDataType, purpose: x.purpose as ConsentPurpose })),
    });
  }
  return { cells, bundles };
}

export function findCell(m: ConsentMatrix, type: ConsentDataType, purpose: ConsentPurpose): ConsentCell | undefined {
  return m.cells.find((c) => c.data_type === type && c.purpose === purpose);
}

/** "on" when every cell of the bundle is in force, "off" when none, "partial" otherwise. */
export function bundleState(m: ConsentMatrix, code: string): "on" | "off" | "partial" {
  const bundle = m.bundles.find((b) => b.code === code);
  if (!bundle || bundle.cells.length === 0) return "off";
  const on = bundle.cells.filter((c) => findCell(m, c.data_type, c.purpose)?.granted).length;
  return on === bundle.cells.length ? "on" : on === 0 ? "off" : "partial";
}

/** How many optional cells are on right now (drives the "switch off everything optional" button). */
export function optionalOnCount(m: ConsentMatrix): number {
  return m.cells.filter((c) => !c.required_for_care && c.granted).length;
}

/** Database error text to a plain sentence. The database refuses; the screen explains. */
export function consentErrorMessage(message: string | undefined): "required" | "unknown" | "generic" {
  if (!message) return "generic";
  if (message.includes("consent_required_for_care")) return "required";
  if (message.includes("consent_cell_unknown") || message.includes("consent_bundle_unknown")) return "unknown";
  return "generic";
}

/**
 * Category to caregiver permission (OQ-51), mirrored from `private.category_permissions`. Used only to PREVIEW what a
 * choice lets someone do; the database writes the real value. Least access: only a category that clearly equals a view
 * permission maps to one, and no acting permission (book, pharmacy, pay, alerts) is ever implied by a category.
 */
export const CATEGORY_PERMISSIONS: Readonly<Record<string, readonly string[]>> = {
  appointments_care_plan: ["view_appointments", "view_care_plan"],
  medications: ["view_medication"],
  labs_results: ["view_results"],
  messaging: ["communicate_with_care_team"],
  vitals_readings: [],
  vaccinations: [],
  reproductive_health: [],
  medical_history: [],
};
