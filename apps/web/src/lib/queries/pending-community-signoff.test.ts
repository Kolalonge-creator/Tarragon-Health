jest.mock("server-only", () => ({}));
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { readPendingCommunitySignoff } from "./pending-community-signoff";

const set = (over: Record<string, unknown>) => ({ version: 1, status: "draft", params: {}, notes: null, approved_at: null, rule_count: 5, safety_rule_count: 0, ...over });
const group = (over: Record<string, unknown>) => ({
  id: "g", slug: "s", name: "G", description: "", topic_code: "t", topic_label: "T", requires_cmo_rules: false, rules_text: "r", rules_version: 1,
  rules_approved: false, rules_approved_at: null, join_mode: "open", member_cap: null, images_allowed: false, status: "draft", created_at: "2026-10-01T00:00:00Z",
  member_count: 0, held_posts: 0, open_reports: 0, open_signals: 0, ...over,
});
const cond = (code: string, met: boolean) => ({ code, label: code, met, source: "attestation" as const, detail: null });
const guard = (met: Record<string, boolean>) => ({
  key: "community", label: "Community", blocks: "b", condition_text: "c", switch_role: "cmo" as const, enforced_in: [], not_enforced_in: "", is_on: false,
  changed_at: null, changed_by_name: null, change_note: null, all_met: false, recent: [],
  conditions: ["crisis_owner_named", "consent_text_approved", "clinical_safety_case_current"].map((c) => cond(c, met[c] === true)),
});

function client(replies: Record<string, unknown>) {
  return { rpc: (fn: string) => Promise.resolve(replies[fn] ?? { data: null, error: { message: "x" } }) } as unknown as SupabaseClient<Database>;
}

describe("readPendingCommunitySignoff", () => {
  it("counts the unsigned rules, each waiting group and each unrecorded statement", async () => {
    const r = await readPendingCommunitySignoff(
      client({
        community_admin_rule_sets: { data: { rule_sets: [set({})] }, error: null },
        community_admin_groups: { data: { groups: [group({ requires_cmo_rules: true }), group({ requires_cmo_rules: true, rules_approved: true }), group({})] }, error: null },
        go_live_guard_status: { data: [guard({ crisis_owner_named: true })], error: null },
      }),
    );
    expect(r).toMatchObject({ rulesUnsigned: true, groupsWaiting: 1, statementsWaiting: 2, attentionCount: 4, failed: false });
  });

  it("is clear once signed rules are live and everything is recorded", async () => {
    const r = await readPendingCommunitySignoff(
      client({
        community_admin_rule_sets: { data: { rule_sets: [set({ status: "active", safety_rule_count: 16, approved_at: "2026-10-13T00:00:00Z" })] }, error: null },
        community_admin_groups: { data: { groups: [] }, error: null },
        go_live_guard_status: { data: [guard({ crisis_owner_named: true, consent_text_approved: true, clinical_safety_case_current: true })], error: null },
      }),
    );
    expect(r).toMatchObject({ attentionCount: 0, failed: false });
  });

  it("reports a failed read instead of an all-clear", async () => {
    const r = await readPendingCommunitySignoff(client({}));
    expect(r.failed).toBe(true);
  });
});
