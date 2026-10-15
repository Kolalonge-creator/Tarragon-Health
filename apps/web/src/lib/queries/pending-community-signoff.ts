import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { adminGroupsSchema, ruleSetsSchema } from "@/lib/community/model";
import { guardListSchema } from "@/lib/go-live/model";
import type { RpcClient } from "@/lib/go-live/load";

export const COMMUNITY_ATTEST_CODES = ["crisis_owner_named", "consent_text_approved", "clinical_safety_case_current"] as const;

export type PendingCommunitySignoff = {
  /** No live rule set carries signed emergency and self-harm rules yet. */
  rulesUnsigned: boolean;
  /** Group rules the Chief Medical Officer has to approve before the group can go live. */
  groupsWaiting: number;
  /** Of the three statements only the CMO can make, how many are not recorded. */
  statementsWaiting: number;
  /** One for the rules (if unsigned) plus each waiting group and each unrecorded statement. */
  attentionCount: number;
  /** A read failed, so the count understates reality: never render it as an all-clear. */
  failed: boolean;
};

const NONE: PendingCommunitySignoff = { rulesUnsigned: false, groupsWaiting: 0, statementsWaiting: 0, attentionCount: 0, failed: true };

/**
 * What Community needs from the Chief Medical Officer, for the sign-off hub and the banner every page shows them. Same rule as the other
 * hub sources: it never throws, and a failed read says so instead of looking like nothing is outstanding. Only call it for the CMO (the
 * Community functions refuse anyone else, which would read as a failure).
 */
export async function readPendingCommunitySignoff(supabase: SupabaseClient<Database>): Promise<PendingCommunitySignoff> {
  try {
    const client = supabase as unknown as RpcClient;
    const [setsRes, groupsRes, guardsRes] = await Promise.all([
      client.rpc("community_admin_rule_sets"),
      client.rpc("community_admin_groups"),
      client.rpc("go_live_guard_status"),
    ]);
    const sets = ruleSetsSchema.safeParse(setsRes.data);
    const groups = adminGroupsSchema.safeParse(groupsRes.data);
    const guards = guardListSchema.safeParse(guardsRes.data);
    if (setsRes.error || groupsRes.error || guardsRes.error || !sets.success || !groups.success || !guards.success) return NONE;
    const community = guards.data.find((g) => g.key === "community");
    if (!community) return NONE;

    const live = sets.data.rule_sets.find((s) => s.status === "active") ?? null;
    const rulesUnsigned = !(live !== null && live.safety_rule_count > 0 && live.approved_at !== null);
    const groupsWaiting = groups.data.groups.filter((g) => g.requires_cmo_rules && !g.rules_approved).length;
    const statementsWaiting = COMMUNITY_ATTEST_CODES.filter((code) => community.conditions.find((c) => c.code === code)?.met !== true).length;
    return {
      rulesUnsigned,
      groupsWaiting,
      statementsWaiting,
      attentionCount: (rulesUnsigned ? 1 : 0) + groupsWaiting + statementsWaiting,
      failed: false,
    };
  } catch {
    return NONE;
  }
}
