import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";

export type VersionedGovernedTable =
  | "alert_rules"
  | "escalation_slas"
  | "triage_protocols"
  | "mental_health_screening_cadences"
  | "provider_quality_policy"
  | "cv_risk_config"
  | "risk_questionnaire_configs"
  | "vaccination_schedule_signoffs"
  | "result_release_policies";

/**
 * Tables whose versions are numbered per partition, not globally: one live row per
 * organisation (and per code for the questionnaire). The database guard partitions
 * the same way (see its migration); comparing across partitions here would refuse a
 * legitimate version in one organisation because another organisation is further on.
 */
const PARTITION_COLUMNS: Partial<Record<VersionedGovernedTable, readonly string[]>> = {
  cv_risk_config: ["organisation_id"],
  risk_questionnaire_configs: ["organisation_id", "code"],
};

/**
 * True for an unsigned-or-not draft that is OLDER than the live version: the one
 * kind of version that must never be offered for signing. The managers use it to
 * hide Sign; refuseSupersededDraft uses it to refuse server-side. One definition,
 * so what the page offers and what the action accepts cannot disagree.
 */
export function isSupersededVersion(row: { version: number; is_active: boolean }, liveVersion: number | null | undefined): boolean {
  return !row.is_active && liveVersion != null && row.version < liveVersion;
}

const COULD_NOT_CHECK =
  "This version could not be checked against the live one, so it was not signed. Reload and try again.";

/**
 * Why a sign button must refuse an unsigned version that is older than the one
 * in force, or null when signing it is fine.
 *
 * Every sign_* RPC activates whatever it signs and deactivates the rest. Several
 * of these tables hold old unsigned drafts that a later version superseded
 * (escalation_slas v1-v6 beside a live v8, for instance), and their managers
 * offer Sign on them. Signing one would silently put the platform back on an
 * older configuration: a clinical-safety regression behind a button that looks
 * like routine sign-off. A change is made by drafting a new version, never by
 * reviving an old one.
 *
 * Fails closed: if either read fails it refuses rather than letting an
 * unverified signature through.
 */
export async function refuseSupersededDraft(
  supabase: SupabaseClient<Database>,
  table: VersionedGovernedTable,
  id: string
): Promise<string | null> {
  const partition = PARTITION_COLUMNS[table] ?? [];
  const { data: target, error: targetError } = await supabase
    .from(table)
    .select(["version", "is_active", ...partition].join(", "))
    .eq("id", id)
    .maybeSingle();
  if (targetError || !target) return COULD_NOT_CHECK;
  const row = target as unknown as { version: number; is_active: boolean } & Record<string, string | null>;
  if (row.is_active) return null;

  let liveQuery = supabase.from(table).select("version").eq("is_active", true);
  // A null partition value must match with `is null`, as the database trigger's
  // `is not distinct from` does; `.eq(column, null)` would filter on the string "null".
  for (const column of partition) {
    const value = row[column];
    liveQuery = value === null || value === undefined ? liveQuery.is(column, null) : liveQuery.eq(column, value);
  }
  const { data: active, error: activeError } = await liveQuery.maybeSingle();
  if (activeError) return COULD_NOT_CHECK;
  const live = active as { version: number } | null;

  if (live && isSupersededVersion(row, live.version)) {
    return `Version ${row.version} is older than the live version ${live.version}. Signing it would put the platform back on an older configuration, so it was not signed. Draft a new version instead.`;
  }
  return null;
}
