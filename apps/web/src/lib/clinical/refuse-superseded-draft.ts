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
  const { data: target, error: targetError } = await supabase
    .from(table)
    .select("version, is_active")
    .eq("id", id)
    .maybeSingle();
  if (targetError || !target) return COULD_NOT_CHECK;
  const row = target as { version: number; is_active: boolean };
  if (row.is_active) return null;

  const { data: active, error: activeError } = await supabase
    .from(table)
    .select("version")
    .eq("is_active", true)
    .maybeSingle();
  if (activeError) return COULD_NOT_CHECK;
  const live = active as { version: number } | null;

  if (live && row.version < live.version) {
    return `Version ${row.version} is older than the live version ${live.version}. Signing it would put the platform back on an older configuration, so it was not signed. Draft a new version instead.`;
  }
  return null;
}
