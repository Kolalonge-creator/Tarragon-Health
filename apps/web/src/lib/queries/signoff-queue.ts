import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { KNOWN_UNPROMOTED_PROTOCOL_DRAFTS } from "@/lib/protocol-draft-manifest";

export type SignoffQueueItem = {
  key: string;
  title: string;
  detail: string;
  href: string;
  /** live_unsigned: actively driving patient/clinician behaviour with no Director
   * signature on file. setup_needed: blocked on a prerequisite (owner/protocol)
   * before it can even be signed. draft_pending: a reviewed draft waiting to be
   * promoted and signed. */
  severity: "live_unsigned" | "setup_needed" | "draft_pending";
  /** How many underlying things this one line stands for (rules, content blocks), when more than one. */
  count?: number;
};

export const SEVERITY_RANK: Record<SignoffQueueItem["severity"], number> = {
  live_unsigned: 0,
  draft_pending: 1,
  setup_needed: 2,
};

/**
 * Versioned single-active-row governance tables — every one of them follows
 * the same shape (id, version, approved_by, approved_at, is_active) and the
 * same "one active row, sign via a Director-only RPC" lifecycle. Walking
 * this list generically, rather than hand-writing one query per table, is
 * what keeps this queue honest as new tables join the pattern (it would
 * have silently missed alert_rules/mental_health_screening_cadences/
 * provider_quality_policy if written before they existed, and will miss
 * whatever comes next unless it's added here).
 */
type VersionedTableName =
  | "alert_rules"
  | "escalation_slas"
  | "triage_protocols"
  | "mental_health_screening_cadences"
  | "provider_quality_policy"
  | "cv_risk_config"
  | "risk_questionnaire_configs"
  | "vaccination_schedule_signoffs"
  | "lab_panel_signoffs";

const VERSIONED_TABLES: { table: VersionedTableName; title: string; slug: string }[] = [
  { table: "alert_rules", title: "Alert rules", slug: "alert-rules" },
  { table: "escalation_slas", title: "Escalation SLAs", slug: "escalation-slas" },
  { table: "triage_protocols", title: "Symptom triage protocols", slug: "triage-protocols" },
  {
    table: "mental_health_screening_cadences",
    title: "Mental health screening cadences",
    slug: "mental-health-screening",
  },
  { table: "provider_quality_policy", title: "Provider quality policy", slug: "provider-quality-policy" },
  { table: "cv_risk_config", title: "CV-risk (cholesterol) config", slug: "cv-risk-config" },
  {
    table: "risk_questionnaire_configs",
    title: "Risk questionnaire configuration",
    slug: "risk-questionnaire-config",
  },
  { table: "vaccination_schedule_signoffs", title: "Vaccination schedule", slug: "vaccination-schedule" },
  { table: "lab_panel_signoffs", title: "Lab ranges and release policy", slug: "lab-panels" },
];

/**
 * `basePath` picks which console the item links point into: `/admin/settings`
 * (the default, the admin hub) or `/clinician` (the Chief Medical Officer's own
 * signing hub). A real CMO account is always `profiles.role = 'clinician'`, so
 * proxy.ts refuses every `/admin/*` link before the page loads; a queue that
 * names what to sign and then hands over a link that cannot be opened is the
 * exact failure the hub exists to remove. Every slug used below has a matching
 * page under both bases.
 */
export async function getSignoffQueue(
  supabase: SupabaseClient<Database>,
  basePath: string = "/admin/settings"
): Promise<SignoffQueueItem[]> {
  const items: SignoffQueueItem[] = [];

  const versionedResults = await Promise.all(
    VERSIONED_TABLES.map((t) =>
      supabase
        .from(t.table)
        .select("id, version, approved_by, approved_at, created_at")
        .eq("is_active", true)
        .maybeSingle()
    )
  );
  versionedResults.forEach((res, i) => {
    const def = VERSIONED_TABLES[i];
    if (res.error) {
      throw new Error(`signoff-queue: failed reading ${def.table}: ${res.error.message}`);
    }
    const row = res.data as { version: number; approved_by: string | null; created_at: string } | null;
    if (row && !row.approved_by) {
      items.push({
        key: `versioned:${def.table}`,
        title: def.title,
        detail: `Version ${row.version} is live and driving real behaviour with no Clinical Director signature on file since ${new Date(row.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}.`,
        href: `${basePath}/${def.slug}`,
        severity: "live_unsigned",
      });
    }
  });

  const { data: drafts, error: draftsError } = await supabase
    .from("protocol_drafts")
    .select("id, protocol_id, title, status")
    .in("status", ["draft", "in_review"]);
  if (draftsError) throw new Error(`signoff-queue: failed reading protocol_drafts: ${draftsError.message}`);
  for (const d of drafts ?? []) {
    items.push({
      key: `protocol_draft:${d.id}`,
      title: d.title,
      detail: `Protocol draft (${d.protocol_id}) — ${d.status === "in_review" ? "in review" : "drafted"}, ready to promote and sign.`,
      href: `${basePath}/protocols`,
      severity: "draft_pending",
    });
  }

  const { data: signedProtocolIds, error: protocolVersionsError } = await supabase
    .from("protocol_versions")
    .select("protocol_id")
    .not("approved_by", "is", null);
  if (protocolVersionsError) {
    throw new Error(`signoff-queue: failed reading protocol_versions: ${protocolVersionsError.message}`);
  }
  const signedSet = new Set((signedProtocolIds ?? []).map((r) => r.protocol_id as string));
  for (const known of KNOWN_UNPROMOTED_PROTOCOL_DRAFTS) {
    if (!signedSet.has(known.protocolId)) {
      items.push({
        key: `unpromoted_protocol:${known.protocolId}`,
        title: known.title,
        detail: known.sourceHint,
        href: `${basePath}/protocols`,
        severity: "draft_pending",
      });
    }
  }

  const { count: unreviewedLpeCount, error: lpeError } = await supabase
    .from("lpe_content_blocks")
    .select("id", { count: "exact", head: true })
    .eq("clinician_reviewed", false);
  if (lpeError) throw new Error(`signoff-queue: failed reading lpe_content_blocks: ${lpeError.message}`);
  if (unreviewedLpeCount && unreviewedLpeCount > 0) {
    items.push({
      key: "lpe_content_blocks",
      title: "Lifestyle coaching content",
      detail: `${unreviewedLpeCount} content block${unreviewedLpeCount === 1 ? "" : "s"} the AI Coach can reference, never reviewed by a clinician.`,
      href: `${basePath}/lpe-content-library`,
      severity: "live_unsigned",
      count: unreviewedLpeCount,
    });
  }

  // Result release policies: the governed switch deciding whether an abnormal
  // result waits for a doctor or reaches the patient the instant it is
  // recorded. v1 went live unsigned by design (a transcription of an older
  // rule is not a fresh attestation), so "active but never signed" is the
  // normal outstanding state here, and a drafted re-attestation is the other.
  const { data: releasePolicies, error: releaseError } = await supabase
    .from("result_release_policies")
    .select("id, version, is_active, approved_at");
  if (releaseError) {
    throw new Error(`signoff-queue: failed reading result_release_policies: ${releaseError.message}`);
  }
  const activeRelease = (releasePolicies ?? []).find((r) => r.is_active);
  const pendingReleaseDraft = (releasePolicies ?? []).find((r) => !r.is_active && !r.approved_at);
  if (activeRelease && !activeRelease.approved_at) {
    items.push({
      key: "result_release_policies",
      title: "Result release policies",
      detail: `Version ${activeRelease.version} decides which abnormal results wait for a doctor before the patient sees them. It is live with no Clinical Director signature on file.`,
      href: `${basePath}/result-release-policies`,
      severity: "live_unsigned",
    });
  } else if (pendingReleaseDraft) {
    items.push({
      key: "result_release_policies",
      title: "Result release policies",
      detail: `Version ${pendingReleaseDraft.version} is drafted and waiting for your signature to come into force.`,
      href: `${basePath}/result-release-policies`,
      severity: "draft_pending",
    });
  }

  // One row per rule_key, newest version: the same definition of "a rule's
  // current state" the guided sign forms on the CMO hub use
  // (readClinicalSignoffChecklist), so the count here can never disagree with
  // the forms. An old unsigned draft that a later signed version superseded is
  // not outstanding, and an unsigned rule whose newest version is already
  // active still is.
  const { data: rules, error: rulesError } = await supabase
    .from("clinical_rules")
    .select("id, rule_key, version, status, owner_clinical_staff_id, protocol_version_id, approved_by")
    .in("status", ["draft", "shadow", "active"])
    .order("rule_key", { ascending: true })
    .order("version", { ascending: false });
  if (rulesError) throw new Error(`signoff-queue: failed reading clinical_rules: ${rulesError.message}`);
  const newestRuleByKey = new Map<string, NonNullable<typeof rules>[number]>();
  for (const r of rules ?? []) {
    if (!newestRuleByKey.has(r.rule_key)) newestRuleByKey.set(r.rule_key, r);
  }
  const newestRules = [...newestRuleByKey.values()];
  const needsSetup = newestRules.filter(
    (r) => !r.approved_by && (!r.owner_clinical_staff_id || !r.protocol_version_id)
  );
  const readyToSign = newestRules.filter(
    (r) => !r.approved_by && r.owner_clinical_staff_id && r.protocol_version_id
  );
  if (needsSetup.length > 0) {
    items.push({
      key: "clinical_rules_needs_setup",
      title: "Clinical rules engine",
      detail: `${needsSetup.length} rule${needsSetup.length === 1 ? "" : "s"} need an owner and a linked signed protocol assigned (via a new draft version) before they can be signed.`,
      href: `${basePath}/clinical-rules`,
      severity: "setup_needed",
      count: needsSetup.length,
    });
  }
  if (readyToSign.length > 0) {
    items.push({
      key: "clinical_rules_ready",
      title: "Clinical rules engine",
      detail: `${readyToSign.length} rule${readyToSign.length === 1 ? "" : "s"} have an owner and protocol assigned and are ready to sign.`,
      href: `${basePath}/clinical-rules`,
      severity: "draft_pending",
      count: readyToSign.length,
    });
  }

  return items.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
}
