import { redirect } from "next/navigation";
import { getCurrentClinicalStaff, getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { ChainHealthPanel } from "@/components/chain-health/chain-health-panel";
import { parseChainHealth, parseReliability } from "@/lib/chain-health/model";

export const metadata = { title: "Chain health" };
export const dynamic = "force-dynamic";

/**
 * P1: the Chief Medical Officer's own path to the chain health page (a CMO account is `clinician` and proxy.ts keeps it out of /admin/*, the
 * same reason /clinician/team-caseload exists). Same panel as /admin/ops/chain-health; the database also refuses anyone but an admin or the CMO.
 */
export default async function ClinicianChainHealthPage({ searchParams }: { searchParams: Promise<{ r?: string }> }) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  const staff = await getCurrentClinicalStaff();
  if (profile.role !== "admin" && staff?.doctor_tier !== "chief_medical_officer") redirect("/clinician");
  const sp = await searchParams;
  const supabase = await createClient();
  const [h, rel] = await Promise.all([supabase.rpc("chain_health"), supabase.rpc("chain_reliability_report", { p_days: 30 })]);
  const result = sp.r === "started" || sp.r === "wait" || sp.r === "failed" ? sp.r : null;
  return (
    <div className="space-y-6">
      <PageHeader
        title="Chain health"
        description="Whether a reading becomes a grade, a task or a page, a neutral notice and an acknowledgement, and how long each step takes. Counts, seconds and stage names only: no patient appears here."
      />
      <ChainHealthPanel health={h.error ? null : parseChainHealth(h.data)} reliability={rel.error ? null : parseReliability(rel.data)} from="clinician" result={result} />
    </div>
  );
}
