import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { readSignoffQueue, SEVERITY_RANK, type SettledConfig, type SignoffQueueItem } from "@/lib/queries/signoff-queue";
import { readPendingAiGovernanceSignoff } from "@/lib/queries/pending-ai-governance-signoff";
import { readPendingCommunitySignoff } from "@/lib/queries/pending-community-signoff";
import { readCredentialAttention, credentialAttentionItem } from "@/lib/queries/credential-attention";
import { GLUCOSE_TRIAGE_ITEM_KEY, readPendingGlucoseTriageSignoff } from "@/lib/queries/pending-glucose-triage-signoff";
import { readS06S10Signoffs, EMPTY_S06S10, type S06S10Snapshot } from "@/lib/queries/s06-s10-signoffs";
import { readPendingQualityConfigSignoff } from "@/lib/queries/pending-quality-config-signoff";
import { readPendingGlucoseTaskTypeSignoff } from "@/lib/queries/pending-glucose-task-type-signoff";
import { readPendingRedOutreachSignoff } from "@/lib/queries/pending-red-outreach-signoff";
import { readPendingSoleCmoException } from "@/lib/queries/pending-sole-cmo-exception";

export type CmoSigningHub = {
  /** One line per thing that needs the Chief Medical Officer's signature, most urgent first. */
  items: SignoffQueueItem[];
  /** At least one read failed, so `items` may be short. Never render this state as an all-clear. */
  failed: boolean;
  /** Which sources could not be read, by name, so the warning can say what is missing. */
  failedSources: string[];
  /** Governed configurations whose live version is signed (for the "already signed" list). */
  settledConfigs: SettledConfig[];
  /** The S06 to S10 clinical items (C1 to C8) with their live state; its lines are already merged into `items`. */
  s06s10: S06S10Snapshot;
  /**
   * Things that need the CMO's attention but are not a signature (P5: overdue MDCN spot re-checks, clinicians with no verification
   * on record). Kept apart from `items` on purpose: the banner counts `items` as "areas that need your signature".
   */
  attention: SignoffQueueItem[];
};

/** The key the merged clinical-rules line carries, so the page can attach the guided signing forms to it. */
export const CLINICAL_RULES_ITEM_KEY = "clinical_rules";
/** The key the merged protocol-drafts line carries; the one manager lists every draft, so there is one line, not one per draft. */
export const PROTOCOL_DRAFTS_ITEM_KEY = "protocol_drafts";
/** The key the Community line carries (safety rules, group rules and the three statements), so the page can attach the signing checklist. */
export const COMMUNITY_ITEM_KEY = "community";
/** The key the red-alert outreach line carries (the call-the-patient task type, CMO Q11), so the page can attach the confirm panel. */
export const RED_OUTREACH_ITEM_KEY = "red_outreach";
/** The key the urgent glucose review task type line carries (R2, CMO Q7 and Q8), so the page can attach the confirm panel. */
export const GLUCOSE_TASK_TYPE_ITEM_KEY = "glucose_task_type";
/** The line for the S20 v2 quality and credentialing configuration drafts (audit sampling, second review, speak-up check-ins, licence notices). */
export const QUALITY_CONFIG_ITEM_KEY = "quality_configs";
/** The key the sole-CMO on-call exception line carries, so the page can attach the signing panel. */
export const SOLE_CMO_EXCEPTION_ITEM_KEY = "sole_cmo_on_call_exception";
export { GLUCOSE_TRIAGE_ITEM_KEY };

/**
 * Everything that needs the Chief Medical Officer's signature, in one list.
 *
 * Before this the work was spread over three separate mechanisms — the
 * clinical sign-off checklist (rules + 8 governed configs), a banner for AI
 * governance, and a hub of per-page links on /admin that a CMO's `clinician`
 * login cannot open — so nobody could answer "what needs me?" without
 * visiting each. This is the one answer, built from the same readers the
 * admin hub and the banner already use so the counts cannot disagree.
 *
 * Links all point into /clinician/*: a CMO account is never `admin`.
 *
 * "Needs setup" and "ready to sign" clinical rules are merged into one line:
 * the guided form on the hub is where the owner and protocol are chosen, so
 * for the person signing there is no separate setup step to do first.
 *
 * Never throws. A read that fails sets `failed` rather than shortening the
 * list silently — the one wrong thing this page can say is "all clear".
 */
export async function readCmoSigningHub(supabase: SupabaseClient<Database>): Promise<CmoSigningHub> {
  const [queue, ai, community, s06s10, credentials, redOutreach, glucose, glucoseTaskType, qualityConfigs, soleCmo] = await Promise.all([
    readSignoffQueue(supabase, "/clinician").catch(() => ({
      items: [] as SignoffQueueItem[],
      settledConfigs: [] as SettledConfig[],
      failedSources: ["the sign-off queue"],
    })),
    readPendingAiGovernanceSignoff(supabase),
    readPendingCommunitySignoff(supabase),
    readS06S10Signoffs(supabase).catch(() => ({ ...EMPTY_S06S10, failed: true, failedSources: ["the S06 to S10 items"] })),
    readCredentialAttention(supabase),
    readPendingRedOutreachSignoff(supabase),
    readPendingGlucoseTriageSignoff(supabase),
    readPendingGlucoseTaskTypeSignoff(supabase),
    readPendingQualityConfigSignoff(supabase),
    readPendingSoleCmoException(supabase),
  ]);

  const items: SignoffQueueItem[] = [];
  let ruleCount = 0;
  const protocolDrafts: SignoffQueueItem[] = [];
  for (const item of queue.items) {
    if (item.key === "clinical_rules_needs_setup" || item.key === "clinical_rules_ready") {
      ruleCount += item.count ?? 0;
      continue;
    }
    if (item.key.startsWith("protocol_draft:")) {
      protocolDrafts.push(item);
      continue;
    }
    items.push(item);
  }

  if (protocolDrafts.length > 0) {
    const titles = protocolDrafts.map((d) => d.title);
    items.push({
      key: PROTOCOL_DRAFTS_ITEM_KEY,
      title: "Clinical protocol drafts",
      detail: `${protocolDrafts.length} draft${protocolDrafts.length === 1 ? "" : "s"} waiting to be promoted and signed: ${titles.slice(0, 3).join(", ")}${titles.length > 3 ? ` and ${titles.length - 3} more` : ""}.`,
      href: "/clinician/protocols",
      severity: "draft_pending",
      count: protocolDrafts.length,
    });
  }

  if (ruleCount > 0) {
    items.push({
      key: CLINICAL_RULES_ITEM_KEY,
      title: "Clinical rules",
      detail: `${ruleCount} rule${ruleCount === 1 ? "" : "s"} waiting. For each, pick the doctor accountable and the signed protocol it comes from, then sign.`,
      href: "/clinician/clinical-rules",
      severity: "draft_pending",
      count: ruleCount,
    });
  }

  if (ai.attentionCount > 0) {
    const parts = [
      ai.pendingVersionApprovalCount > 0 &&
        `${ai.pendingVersionApprovalCount} AI system version${ai.pendingVersionApprovalCount === 1 ? "" : "s"} to approve`,
      ai.pendingClinicalAccuracyLabelCount > 0 &&
        `${ai.pendingClinicalAccuracyLabelCount} clinical-accuracy scenario${ai.pendingClinicalAccuracyLabelCount === 1 ? "" : "s"} for your tier judgement`,
    ].filter(Boolean);
    items.push({
      key: "ai_governance",
      title: "AI governance",
      detail: `${parts.join(" and ")}.`,
      href: "/clinician/ai-governance",
      severity: "draft_pending",
      count: ai.attentionCount,
    });
  }

  if (community.attentionCount > 0) {
    const parts = [
      community.rulesUnsigned && "the emergency and self-harm rules to sign",
      community.groupsWaiting > 0 && `${community.groupsWaiting} group rule set${community.groupsWaiting === 1 ? "" : "s"} to approve`,
      community.statementsWaiting > 0 && `${community.statementsWaiting} statement${community.statementsWaiting === 1 ? "" : "s"} to record`,
    ].filter(Boolean);
    items.push({
      key: COMMUNITY_ITEM_KEY,
      title: "Community groups",
      detail: `${parts.join(", ")}. Nothing is live for members until you switch it on.`,
      href: "/clinician/community/signoff",
      severity: "draft_pending",
      count: community.attentionCount,
    });
  }

  const credentialItem = credentialAttentionItem(credentials);
  const attention = credentialItem ? [credentialItem] : [];
  if (redOutreach.waiting) {
    items.push({
      key: RED_OUTREACH_ITEM_KEY,
      title: "Red alert outreach (call the patient)",
      detail: "A Member's red alert that is not confirmed within the time you chose opens a call-the-patient task for the clinician on call. The task type needs your confirmation before any task is created.",
      href: "/clinician/task-types",
      severity: "draft_pending",
      count: 1,
    });
  }

  if (soleCmo.waiting) {
    items.push({
      key: SOLE_CMO_EXCEPTION_ITEM_KEY,
      title: "Sole-CMO on-call exception: sign to be allowed on the on-call rota",
      detail: "You are the only Chief Medical Officer, and the rule that nobody grants their own competencies keeps you off the on-call rota. A documented exception, signed by you, lets you grant yourself the on-call competency and nothing else.",
      href: "/clinician/clinical-signoff",
      severity: "draft_pending",
      count: 1,
    });
  }

  items.push(...s06s10.items);

  if (glucoseTaskType.waiting) {
    items.push({
      key: GLUCOSE_TASK_TYPE_ITEM_KEY,
      title: "Urgent glucose review (task type)",
      detail: "The task a doctor gets for an urgent same-day glucose reading needs your confirmation. Until you confirm it, the glucose rules cannot be signed.",
      href: "/clinician/task-types",
      severity: "draft_pending",
      count: 1,
    });
  }

  if (glucose.pending) {
    items.push({
      key: GLUCOSE_TRIAGE_ITEM_KEY,
      title: `Glucose triage rules, version ${glucose.version}`,
      detail: `Version ${glucose.version} is a draft waiting for your signature, with the guideline basis of every rule and the patient wording in full.${glucose.approvedVersion !== null ? ` Version ${glucose.approvedVersion} stays in force until you sign.` : " Until you sign, glucose readings are graded in shadow only and the older glucose alerts keep running."}`,
      href: "/clinician/glucose-triage-rules",
      severity: "draft_pending",
    });
  }

  if (qualityConfigs.qualityVersion !== null || qualityConfigs.credentialingVersion !== null) {
    const parts = [
      qualityConfigs.qualityVersion !== null && `quality configuration version ${qualityConfigs.qualityVersion} (audit sampling, second review, speak-up check-ins)`,
      qualityConfigs.credentialingVersion !== null && `credentialing configuration version ${qualityConfigs.credentialingVersion} (licence notices, shifts after expiry)`,
    ].filter(Boolean);
    items.push({
      key: QUALITY_CONFIG_ITEM_KEY,
      title: "Quality and licence rules",
      detail: `${parts.join(" and ")} waiting for your signature. They stay off until you sign.`,
      href: "/clinician/clinical-signoff",
      severity: "draft_pending",
      count: (qualityConfigs.qualityVersion !== null ? 1 : 0) + (qualityConfigs.credentialingVersion !== null ? 1 : 0),
    });
  }

  const failedSources = [
    ...queue.failedSources,
    ...s06s10.failedSources,
    ...(ai.failed ? ["AI governance"] : []),
    ...(community.failed ? ["Community"] : []),
    ...(credentials.failed ? ["Clinician registration checks"] : []),
    ...(redOutreach.failed ? ["Red alert outreach"] : []),
    ...(glucose.failed ? ["the glucose triage rules"] : []),
    ...(glucoseTaskType.failed ? ["the urgent glucose review task type"] : []),
    ...(qualityConfigs.failed ? ["the quality and credentialing configurations"] : []),
    ...(soleCmo.failed ? ["the sole-CMO on-call exception"] : []),
  ];
  items.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
  // A banner row may only link to a hub line that exists. The banner reads its own copy of the state, so if the two ever disagree (a row it
  // thinks is waiting that the queue does not list) the link falls back to the item's own page rather than pointing at a missing anchor.
  const lineKeys = new Set(items.map((i) => i.key));
  const banner: S06S10Snapshot = { ...s06s10, rows: s06s10.rows.map((r) => (r.panelKey && !lineKeys.has(r.panelKey) ? { ...r, panelKey: null } : r)) };
  return { items, failed: failedSources.length > 0, failedSources, settledConfigs: queue.settledConfigs, s06s10: banner, attention };
}
