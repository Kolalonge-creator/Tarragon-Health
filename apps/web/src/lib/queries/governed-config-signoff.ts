import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";

/**
 * The platform's versioned, single-active-row governance configs: the ones
 * that follow the shared (id, version, approved_by, approved_at, is_active)
 * shape and are signed through a Clinical-Director-only RPC.
 *
 * Kept as one list so a new table joining the pattern is a one-line change
 * that both the sign-off queue and the sign-off checklist pick up. This
 * mirrors VERSIONED_TABLES in lib/queries/signoff-queue.ts deliberately: that
 * one answers "what is outstanding" for the hub's queue, this one answers
 * "what is the state of each, signed or not" for the checklist, and neither
 * should have to guess at the other's list.
 */
export const GOVERNED_CONFIG_TABLES = [
  { table: "alert_rules", title: "Alert rules", slug: "alert-rules" },
  { table: "escalation_slas", title: "Escalation SLAs", slug: "escalation-slas" },
  { table: "triage_protocols", title: "Symptom triage protocols", slug: "triage-protocols" },
  {
    table: "mental_health_screening_cadences",
    title: "Mental health screening cadences",
    slug: "mental-health-screening",
  },
  {
    table: "provider_quality_policy",
    title: "Provider quality policy",
    slug: "provider-quality-policy",
  },
  { table: "cv_risk_config", title: "CV-risk (cholesterol) config", slug: "cv-risk-config" },
  {
    table: "risk_questionnaire_configs",
    title: "Risk questionnaire configuration",
    slug: "risk-questionnaire-config",
  },
  {
    table: "vaccination_schedule_signoffs",
    title: "Vaccination schedule",
    slug: "vaccination-schedule",
  },
] as const;

export type GovernedConfigSignoff = {
  table: string;
  title: string;
  href: string;
  /** Null when no active version exists at all — a different state from unsigned. */
  version: number | null;
  signed: boolean;
};

/**
 * The signature state of every governed config, read live.
 *
 * `basePath` picks which reachable console the checklist links back into —
 * `/admin/settings` (the default) for the admin hub, `/clinician` for the
 * Chief Medical Officer's own mirror (found missing 2026-09-22: every href
 * here used to be hardcoded to `/admin/settings/*`, which a real CMO account
 * — always `profiles.role = 'clinician'`, per CLAUDE.md's "never re-split
 * the account role" rule — cannot reach at all once proxy.ts's /admin/**
 * gate gets there first. A checklist that tells you what to sign and then
 * hands you a link you cannot open is worse than no link, same principle as
 * navigation.ts's nav-link discipline).
 *
 * Never throws: a table this cannot read is reported as unsigned with a null
 * version rather than taking the page down. That is the safe direction — the
 * failure mode to avoid is a checklist that cheerfully reports "all green"
 * because a read failed.
 */
export async function readGovernedConfigSignoff(
  supabase: SupabaseClient<Database>,
  basePath: string = "/admin/settings"
): Promise<GovernedConfigSignoff[]> {
  const results = await Promise.all(
    GOVERNED_CONFIG_TABLES.map(async (def) => {
      const href = `${basePath}/${def.slug}`;
      const { data, error } = await supabase
        .from(def.table)
        .select("version, approved_by")
        .eq("is_active", true)
        .maybeSingle();

      if (error) {
        return { table: def.table, title: def.title, href, version: null, signed: false };
      }
      const row = data as { version: number; approved_by: string | null } | null;
      return {
        table: def.table,
        title: def.title,
        href,
        version: row?.version ?? null,
        signed: Boolean(row?.approved_by),
      };
    })
  );

  return results;
}
