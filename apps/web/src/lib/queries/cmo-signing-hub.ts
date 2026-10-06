import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { getSignoffQueue, SEVERITY_RANK, type SignoffQueueItem } from "@/lib/queries/signoff-queue";
import { readPendingAiGovernanceSignoff } from "@/lib/queries/pending-ai-governance-signoff";

export type CmoSigningHub = {
  /** One line per thing that needs the Chief Medical Officer's signature, most urgent first. */
  items: SignoffQueueItem[];
  /** At least one read failed, so `items` may be short. Never render this state as an all-clear. */
  failed: boolean;
};

/** The key the merged clinical-rules line carries, so the page can attach the guided signing forms to it. */
export const CLINICAL_RULES_ITEM_KEY = "clinical_rules";

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
  const [queueResult, ai] = await Promise.all([
    getSignoffQueue(supabase, "/clinician").then(
      (items) => ({ items, failed: false }),
      () => ({ items: [] as SignoffQueueItem[], failed: true })
    ),
    readPendingAiGovernanceSignoff(supabase),
  ]);

  const items: SignoffQueueItem[] = [];
  let ruleCount = 0;
  let ruleSeverity: SignoffQueueItem["severity"] | null = null;
  for (const item of queueResult.items) {
    if (item.key === "clinical_rules_needs_setup" || item.key === "clinical_rules_ready") {
      ruleCount += item.count ?? 1;
      ruleSeverity = "draft_pending";
      continue;
    }
    items.push(item);
  }

  if (ruleSeverity) {
    items.push({
      key: CLINICAL_RULES_ITEM_KEY,
      title: "Clinical rules",
      detail: `${ruleCount} rule${ruleCount === 1 ? "" : "s"} waiting. For each, pick the doctor accountable and the signed protocol it comes from, then sign.`,
      href: "/clinician/clinical-rules",
      severity: ruleSeverity,
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

  items.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
  return { items, failed: queueResult.failed || ai.failed };
}
