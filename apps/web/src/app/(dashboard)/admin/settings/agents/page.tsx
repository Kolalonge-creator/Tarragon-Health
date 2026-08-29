import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { listAgentsWithTotals, listPayoutBatches } from "@/lib/queries/agents";
import { AgentsManager } from "./agents-manager";

export default async function AgentsPage() {
  const profile = await getCurrentProfile();
  // proxy.ts already blocks non-admins from /admin/**; defence in depth.
  if (profile?.role !== "admin") redirect("/admin");

  const [agents, batches] = await Promise.all([listAgentsWithTotals(), listPayoutBatches()]);

  return <AgentsManager agents={agents} batches={batches} />;
}
