import { createClient } from "@/lib/supabase/server";
import type { AgentCommissionRow, AgentPayoutBatchRow, CommunityAgentRow } from "@tarragon/shared";

export interface AgentWithTotals extends CommunityAgentRow {
  pending_kobo: number;
  approved_kobo: number;
  paid_kobo: number;
}

/** All agents in the caller's organisation, with commission totals per
 * status — the admin agents list. RLS-scoped to the caller (admin/
 * agents.manage), same as every other query in this file. */
export async function listAgentsWithTotals(): Promise<AgentWithTotals[]> {
  const supabase = await createClient();
  const { data: agents } = await supabase
    .from("community_agents")
    .select("*")
    .order("created_at", { ascending: false });
  if (!agents) return [];

  const { data: commissions } = await supabase
    .from("agent_commissions")
    .select("agent_id, amount_kobo, status");

  const totals = new Map<string, { pending: number; approved: number; paid: number }>();
  for (const c of commissions ?? []) {
    const row = totals.get(c.agent_id) ?? { pending: 0, approved: 0, paid: 0 };
    if (c.status === "pending") row.pending += c.amount_kobo;
    else if (c.status === "approved") row.approved += c.amount_kobo;
    else if (c.status === "paid") row.paid += c.amount_kobo;
    totals.set(c.agent_id, row);
  }

  return agents.map((a) => {
    const t = totals.get(a.id) ?? { pending: 0, approved: 0, paid: 0 };
    return { ...a, pending_kobo: t.pending, approved_kobo: t.approved, paid_kobo: t.paid };
  });
}

export async function listPayoutBatches(): Promise<AgentPayoutBatchRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("agent_payout_batches")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(20);
  return data ?? [];
}

/** The signed-in agent's own commission rows — the agent portal. RLS
 * restricts this to the caller's own agent_id, no organisation filter
 * needed here. */
export async function listMyCommissions(): Promise<{
  agent: CommunityAgentRow | null;
  commissions: AgentCommissionRow[];
}> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { agent: null, commissions: [] };

  const { data: agent } = await supabase
    .from("community_agents")
    .select("*")
    .eq("profile_id", user.id)
    .single();
  if (!agent) return { agent: null, commissions: [] };

  const { data: commissions } = await supabase
    .from("agent_commissions")
    .select("*")
    .eq("agent_id", agent.id)
    .order("earned_at", { ascending: false })
    .limit(100);

  return { agent, commissions: commissions ?? [] };
}
