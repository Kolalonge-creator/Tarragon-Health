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
  { table: "alert_rules", title: "Alert rules", href: "/admin/settings/alert-rules" },
  { table: "escalation_slas", title: "Escalation SLAs", href: "/admin/settings/escalation-slas" },
  { table: "triage_protocols", title: "Symptom triage protocols", href: "/admin/settings/triage-protocols" },
  {
    table: "mental_health_screening_cadences",
    title: "Mental health screening cadences",
    href: "/admin/settings/mental-health-screening",
  },
  {
    table: "provider_quality_policy",
    title: "Provider quality policy",
    href: "/admin/settings/provider-quality-policy",
  },
  { table: "cv_risk_config", title: "CV-risk (cholesterol) config", href: "/admin/settings/cv-risk-config" },
  {
    table: "risk_questionnaire_configs",
    title: "Risk questionnaire configuration",
    href: "/admin/settings/risk-questionnaire-config",
  },
  {
    table: "vaccination_schedule_signoffs",
    title: "Vaccination schedule",
    href: "/admin/settings/vaccination-schedule",
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
 * Never throws: a table this cannot read is reported as unsigned with a null
 * version rather than taking the page down. That is the safe direction — the
 * failure mode to avoid is a checklist that cheerfully reports "all green"
 * because a read failed.
 */
export async function readGovernedConfigSignoff(
  supabase: SupabaseClient<Database>
): Promise<GovernedConfigSignoff[]> {
  const results = await Promise.all(
    GOVERNED_CONFIG_TABLES.map(async (def) => {
      const { data, error } = await supabase
        .from(def.table)
        .select("version, approved_by")
        .eq("is_active", true)
        .maybeSingle();

      if (error) {
        return { table: def.table, title: def.title, href: def.href, version: null, signed: false };
      }
      const row = data as { version: number; approved_by: string | null } | null;
      return {
        table: def.table,
        title: def.title,
        href: def.href,
        version: row?.version ?? null,
        signed: Boolean(row?.approved_by),
      };
    })
  );

  return results;
}
