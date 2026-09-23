import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { GOVERNED_CONFIG_TABLES, readGovernedConfigSignoff } from "@/lib/queries/governed-config-signoff";
import { WHAT_HAPPENS } from "./rule-signoff-copy";
import type {
  ProtocolOption,
  SettledItem,
  SignedRule,
  StaffOption,
  UnsignedRule,
} from "@/app/(dashboard)/admin/settings/clinical-signoff/signoff-checklist";

export type ClinicalSignoffChecklistData = {
  loadFailed: boolean;
  unsignedRules: UnsignedRule[];
  signedRules: SignedRule[];
  unsignedConfigs: SettledItem[];
  settled: SettledItem[];
  staff: StaffOption[];
  protocols: ProtocolOption[];
  totalConfigCount: number;
};

/**
 * The data behind the "what still needs my signature" checklist — shared by
 * /admin/settings/clinical-signoff and /clinician/clinical-signoff so the two
 * pages can never drift (found 2026-09-22: every one of the 8
 * GOVERNED_CONFIG_TABLES' hrefs used to be hardcoded to /admin/settings/*,
 * which a real Chief Medical Officer account — always `profiles.role =
 * 'clinician'` — cannot reach; `readGovernedConfigSignoff`'s `basePath`
 * param is what lets each caller link back into its own reachable console).
 * Extracted verbatim from admin/settings/clinical-signoff/page.tsx's
 * pre-existing logic — no behaviour change for the admin page.
 */
export async function readClinicalSignoffChecklist(
  supabase: SupabaseClient<Database>,
  basePath: string
): Promise<ClinicalSignoffChecklistData> {
  const [rulesRes, staffRes, protocolsRes, configs] = await Promise.all([
    supabase
      .from("clinical_rules")
      .select(
        "id, rule_key, version, name, description, category, status, approved_by, approved_at, owner_clinical_staff_id, protocol_version_id, clinical_staff:clinical_staff!clinical_rules_owner_clinical_staff_id_fkey(full_name), protocol_versions(title)"
      )
      .in("status", ["draft", "shadow", "active"])
      .order("rule_key", { ascending: true })
      .order("version", { ascending: false }),
    // Care Coordinators are excluded on purpose: the ladder in CLAUDE.md is
    // explicit that a Care Coordinator never owns a clinical judgement, and
    // offering one in this dropdown would be offering to record exactly that.
    supabase
      .from("clinical_staff")
      .select("id, full_name, doctor_tier")
      .eq("active", true)
      .neq("doctor_tier", "care_coordinator")
      .order("full_name", { ascending: true }),
    supabase
      .from("protocol_versions")
      .select("id, protocol_id, title, version_number")
      .not("approved_by", "is", null)
      .order("title", { ascending: true }),
    readGovernedConfigSignoff(supabase, basePath),
  ]);

  if (rulesRes.error || staffRes.error || protocolsRes.error) {
    return {
      loadFailed: true,
      unsignedRules: [],
      signedRules: [],
      unsignedConfigs: [],
      settled: [],
      staff: [],
      protocols: [],
      totalConfigCount: GOVERNED_CONFIG_TABLES.length,
    };
  }

  const rules = rulesRes.data ?? [];

  // One row per rule_key: the newest version is the one that represents the
  // rule's current state. Showing every historical version here would turn a
  // seven-item checklist into a version-history browser, which is what
  // /admin/settings/clinical-rules (and its /clinician mirror) already is.
  const newestByKey = new Map<string, (typeof rules)[number]>();
  for (const r of rules) {
    if (!newestByKey.has(r.rule_key)) newestByKey.set(r.rule_key, r);
  }
  const newest = [...newestByKey.values()];

  const unsignedRules: UnsignedRule[] = newest
    .filter((r) => !r.approved_by)
    .map((r) => ({
      id: r.id,
      rule_key: r.rule_key,
      version: r.version,
      name: r.name,
      description: r.description,
      category: r.category,
      status: r.status,
      whatHappens:
        WHAT_HAPPENS[r.rule_key] ??
        "This rule will start acting on real events instead of only being measured in shadow mode.",
    }));

  const signedRules: SignedRule[] = newest
    .filter((r) => r.approved_by)
    .map((r) => ({
      id: r.id,
      rule_key: r.rule_key,
      version: r.version,
      name: r.name,
      category: r.category,
      ownerName: (r as { clinical_staff?: { full_name: string } | null }).clinical_staff?.full_name ?? null,
      protocolTitle:
        (r as { protocol_versions?: { title: string } | null }).protocol_versions?.title ?? null,
      signedOn: r.approved_at ? new Date(r.approved_at).toISOString().slice(0, 10) : null,
      whatHappens:
        WHAT_HAPPENS[r.rule_key] ??
        "This rule acts on real events rather than only being measured in shadow mode.",
    }));

  // Read live, never hardcoded. A hardcoded "these are all signed" list is
  // exactly the kind of reassurance that goes stale silently — the page would
  // keep showing a green tick for a config somebody had since replaced with
  // an unsigned version.
  const settled: SettledItem[] = configs
    .filter((c) => c.signed)
    .map((c) => ({ key: c.table, title: c.title, detail: `version ${c.version}`, href: c.href }));

  const unsignedConfigs: SettledItem[] = configs
    .filter((c) => !c.signed)
    .map((c) => ({
      key: c.table,
      title: c.title,
      detail:
        c.version === null
          ? "no active version — nothing is configured yet"
          : `version ${c.version} is live and driving behaviour with no signature`,
      href: c.href,
    }));

  return {
    loadFailed: false,
    unsignedRules,
    signedRules,
    unsignedConfigs,
    settled,
    staff: (staffRes.data ?? []) as StaffOption[],
    protocols: (protocolsRes.data ?? []) as ProtocolOption[],
    totalConfigCount: GOVERNED_CONFIG_TABLES.length,
  };
}
