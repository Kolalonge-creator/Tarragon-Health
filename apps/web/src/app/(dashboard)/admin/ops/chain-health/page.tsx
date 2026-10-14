import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { ChainHealthPanel } from "@/components/chain-health/chain-health-panel";
import { parseChainHealth, parseReliability } from "@/lib/chain-health/model";

export const metadata = { title: "Chain health" };
export const dynamic = "force-dynamic";

/** P1: is the clinical chain (grading, tasks, paging, notices) working right now, and how fast. Admin; the CMO has /clinician/chain-health. */
export default async function AdminChainHealthPage({ searchParams }: { searchParams: Promise<{ r?: string }> }) {
  const profile = await getCurrentProfile();
  if (profile?.role !== "admin") redirect("/admin");
  const sp = await searchParams;
  const supabase = await createClient();
  const [h, rel] = await Promise.all([supabase.rpc("chain_health"), supabase.rpc("chain_reliability_report", { p_days: 30 })]);
  const result = sp.r === "started" || sp.r === "wait" || sp.r === "failed" ? sp.r : null;
  return (
    <div className="space-y-6">
      <PageHeader
        title="Chain health"
        backTo={{ href: "/admin/ops", label: "Operations" }}
        description="Whether a reading becomes a grade, a task or a page, a neutral notice and an acknowledgement, and how long each step takes. Counts, seconds and stage names only: no patient appears here."
      />
      <ChainHealthPanel health={h.error ? null : parseChainHealth(h.data)} reliability={rel.error ? null : parseReliability(rel.data)} from="admin" result={result} />
    </div>
  );
}
