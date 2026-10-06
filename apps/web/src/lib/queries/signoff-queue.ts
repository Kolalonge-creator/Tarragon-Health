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

export type SettledConfig = { table: string; title: string; href: string; version: number };

export type SignoffQueueResult = {
  items: SignoffQueueItem[];
  /** The governed configurations whose live version is signed, read in the same pass, so a page needn't read each table again. Incomplete if a source failed. */
  settledConfigs: SettledConfig[];
  /** Names of the sources that could not be read. While this is non-empty `items` is incomplete and must never be shown as an all-clear. */
  failedSources: string[];
};

type VersionRow = {
  id: string;
  version: number;
  is_active: boolean;
  approved_by?: string | null;
  approved_at?: string | null;
  created_at?: string;
  notes?: string | null;
};

const isSigned = (r: VersionRow) => Boolean(r.approved_by ?? r.approved_at);

/**
 * The live row, or null. More than one live row is a corrupt state (five of these tables have
 * no unique one-live-row index to prevent it), and silently taking the first could show a
 * signed row while an unsigned one is also live, so it is reported as an unreadable source.
 */
function singleLiveRow(rows: VersionRow[], source: string): VersionRow | null {
  const live = rows.filter((r) => r.is_active);
  if (live.length > 1) throw new Error(`failed reading ${source}: ${live.length} versions are live at once`);
  return live[0] ?? null;
}

/**
 * The unsigned draft worth the Chief Medical Officer's attention: the highest
 * unsigned version that is NEWER than the live one. Older unsigned drafts that a
 * later version superseded are history, not work, and signing one would put the
 * platform back on an older configuration (see refuseSupersededDraft).
 */
function pendingNewerDraft(rows: VersionRow[]): VersionRow | null {
  const liveVersion = rows.find((r) => r.is_active)?.version ?? 0;
  const drafts = rows.filter((r) => !r.is_active && !isSigned(r) && r.version > liveVersion);
  return drafts.sort((a, b) => b.version - a.version)[0] ?? null;
}

const firstSentence = (text: string | null | undefined, max = 140) => {
  const t = (text ?? "").trim();
  if (!t) return "";
  const cut = t.split(/(?<=[.!?])\s/)[0] ?? t;
  return cut.length > max ? `${cut.slice(0, max - 1)}…` : cut;
};

/**
 * Every outstanding sign-off, read source by source. A source that cannot be
 * read is reported in `failedSources` and costs only its own lines, so one
 * unreadable table no longer blanks the whole list.
 *
 * `basePath` picks which console the item links point into: `/admin/settings`
 * (the default, the admin hub) or `/clinician` (the Chief Medical Officer's own
 * signing hub). A real CMO account is always `profiles.role = 'clinician'`, so
 * proxy.ts refuses every `/admin/*` link before the page loads; a queue that
 * names what to sign and then hands over a link that cannot be opened is the
 * exact failure the hub exists to remove. Every slug used below has a matching
 * page under both bases.
 */
export async function readSignoffQueue(
  supabase: SupabaseClient<Database>,
  basePath: string = "/admin/settings"
): Promise<SignoffQueueResult> {
  type Source = { name: string; run: () => Promise<SignoffQueueItem[]> };
  const fail = (name: string, message: string): never => {
    throw new Error(`failed reading ${name}: ${message}`);
  };

  const sources: Source[] = [];
  const settledConfigs: SettledConfig[] = [];

  for (const def of VERSIONED_TABLES) {
    sources.push({
      name: def.table,
      run: async () => {
        // The live row and any unsigned drafts; signed history is never outstanding.
        const { data, error } = await supabase
          .from(def.table)
          .select("id, version, is_active, approved_by, approved_at, created_at, notes")
          .or("is_active.eq.true,approved_by.is.null");
        if (error) fail(def.table, error.message);
        const rows = (data ?? []) as unknown as VersionRow[];
        const live = singleLiveRow(rows, def.table);
        const href = `${basePath}/${def.slug}`;
        if (live && isSigned(live)) settledConfigs.push({ table: def.table, title: def.title, href, version: live.version });
        if (live && !isSigned(live)) {
          return [
            {
              key: `versioned:${def.table}`,
              title: def.title,
              detail: `Version ${live.version} is live and driving real behaviour with no Clinical Director signature on file since ${new Date(live.created_at ?? Date.now()).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}.`,
              href,
              severity: "live_unsigned",
            },
          ];
        }
        const draft = pendingNewerDraft(rows);
        if (draft) {
          const what = firstSentence(draft.notes);
          return [
            {
              key: `versioned_draft:${def.table}`,
              title: def.title,
              detail: `Version ${draft.version} is drafted${live ? `, newer than the live version ${live.version},` : " with nothing live yet,"} and waiting for a Clinical Director's signature to come into force.${what ? ` ${what}` : ""}`,
              href,
              severity: "draft_pending",
            },
          ];
        }
        return [];
      },
    });
  }

  sources.push({
    name: "protocol_drafts",
    run: async () => {
      const { data, error } = await supabase
        .from("protocol_drafts")
        .select("id, protocol_id, title, status")
        .in("status", ["draft", "in_review"]);
      if (error) fail("protocol_drafts", error.message);
      return (data ?? []).map((d) => ({
        key: `protocol_draft:${d.id}`,
        title: d.title,
        detail: `Protocol draft (${d.protocol_id}) — ${d.status === "in_review" ? "in review" : "drafted"}, ready to promote and sign.`,
        href: `${basePath}/protocols`,
        severity: "draft_pending" as const,
      }));
    },
  });

  sources.push({
    name: "protocol_versions",
    run: async () => {
      const { data, error } = await supabase.from("protocol_versions").select("protocol_id").not("approved_by", "is", null);
      if (error) fail("protocol_versions", error.message);
      const signedSet = new Set((data ?? []).map((r) => r.protocol_id as string));
      return KNOWN_UNPROMOTED_PROTOCOL_DRAFTS.filter((known) => !signedSet.has(known.protocolId)).map((known) => ({
        key: `unpromoted_protocol:${known.protocolId}`,
        title: known.title,
        detail: known.sourceHint,
        href: `${basePath}/protocols`,
        severity: "draft_pending" as const,
      }));
    },
  });

  sources.push({
    name: "lpe_content_blocks",
    run: async () => {
      const { count, error } = await supabase
        .from("lpe_content_blocks")
        .select("id", { count: "exact", head: true })
        .eq("clinician_reviewed", false);
      if (error) fail("lpe_content_blocks", error.message);
      if (!count || count <= 0) return [];
      return [
        {
          key: "lpe_content_blocks",
          title: "Lifestyle coaching content",
          detail: `${count} content block${count === 1 ? "" : "s"} the AI Coach can reference, never reviewed by a clinician.`,
          href: `${basePath}/lpe-content-library`,
          severity: "live_unsigned" as const,
          count,
        },
      ];
    },
  });

  sources.push({
    name: "result_release_policies",
    run: async () => {
      // v1 went live unsigned by design (a transcription of an older rule is not a
      // fresh attestation), so "active but never signed" is the normal outstanding
      // state here, and a drafted re-attestation is the other.
      const { data, error } = await supabase
        .from("result_release_policies")
        .select("id, version, is_active, approved_at");
      if (error) fail("result_release_policies", error.message);
      const rows = (data ?? []) as unknown as VersionRow[];
      const live = singleLiveRow(rows, "result_release_policies");
      const href = `${basePath}/result-release-policies`;
      if (live && !isSigned(live)) {
        return [
          {
            key: "result_release_policies",
            title: "Result release policies",
            detail: `Version ${live.version} decides which abnormal results wait for a doctor before the patient sees them. It is live with no Clinical Director signature on file.`,
            href,
            severity: "live_unsigned" as const,
          },
        ];
      }
      const draft = pendingNewerDraft(rows);
      return draft
        ? [
            {
              key: "result_release_policies",
              title: "Result release policies",
              detail: `Version ${draft.version} is drafted and waiting for a Clinical Director's signature to come into force.`,
              href,
              severity: "draft_pending" as const,
            },
          ]
        : [];
    },
  });

  sources.push({
    name: "clinical_rules",
    run: async () => {
      // One row per rule_key, newest version: the same definition of "a rule's
      // current state" the guided sign forms on the CMO hub use
      // (readClinicalSignoffChecklist), so the count here can never disagree with
      // the forms. An old unsigned draft that a later signed version superseded is
      // not outstanding, and an unsigned rule whose newest version is already
      // active still is.
      const { data: rules, error } = await supabase
        .from("clinical_rules")
        .select("id, rule_key, version, status, owner_clinical_staff_id, protocol_version_id, approved_by")
        .in("status", ["draft", "shadow", "active"])
        .order("rule_key", { ascending: true })
        .order("version", { ascending: false });
      if (error) fail("clinical_rules", error.message);
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
      const out: SignoffQueueItem[] = [];
      if (needsSetup.length > 0) {
        out.push({
          key: "clinical_rules_needs_setup",
          title: "Clinical rules engine",
          detail: `${needsSetup.length} rule${needsSetup.length === 1 ? "" : "s"} need an owner and a linked signed protocol assigned (via a new draft version) before they can be signed.`,
          href: `${basePath}/clinical-rules`,
          severity: "setup_needed",
          count: needsSetup.length,
        });
      }
      if (readyToSign.length > 0) {
        out.push({
          key: "clinical_rules_ready",
          title: "Clinical rules engine",
          detail: `${readyToSign.length} rule${readyToSign.length === 1 ? "" : "s"} have an owner and protocol assigned and are ready to sign.`,
          href: `${basePath}/clinical-rules`,
          severity: "draft_pending",
          count: readyToSign.length,
        });
      }
      return out;
    },
  });

  const settled = await Promise.allSettled(sources.map((src) => src.run()));
  const items: SignoffQueueItem[] = [];
  const failedSources: string[] = [];
  settled.forEach((res, i) => {
    if (res.status === "fulfilled") items.push(...res.value);
    else failedSources.push(sources[i].name);
  });

  return {
    items: items.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]),
    settledConfigs: settledConfigs.sort((a, b) => a.title.localeCompare(b.title)),
    failedSources,
  };
}

/**
 * The all-or-nothing form the admin hub uses: throws if any source could not be
 * read, so a caller that cannot show a partial list never shows a short one.
 */
export async function getSignoffQueue(
  supabase: SupabaseClient<Database>,
  basePath: string = "/admin/settings"
): Promise<SignoffQueueItem[]> {
  const { items, failedSources } = await readSignoffQueue(supabase, basePath);
  if (failedSources.length > 0) {
    throw new Error(`signoff-queue: failed reading ${failedSources.join(", ")}`);
  }
  return items;
}
