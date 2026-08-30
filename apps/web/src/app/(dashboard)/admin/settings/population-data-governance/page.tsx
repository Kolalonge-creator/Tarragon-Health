import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { GovernanceGatesManager, type GateRow } from "./governance-gates-manager";

/**
 * The 3 gates from docs/Tarragon_Health_Master_Operating_Plan_v4.md:378-382
 * that must ALL be met before the §12 population-data-monetisation /
 * research-export / national-network capability can be made external-
 * facing — sufficient real patient volume, NDPC registration + DPO
 * appointment, and a reviewed anonymisation methodology. This page is the
 * real, checkable record of that status, replacing "check CLAUDE.md"
 * folklore. Attesting a gate here is a compliance record, not a feature
 * toggle for its own sake — see supabase/migrations/20260830123554_population_data_governance_gates.sql.
 */
export default async function PopulationDataGovernancePage() {
  const profile = await getCurrentProfile();
  if (profile?.role !== "admin") {
    redirect("/admin");
  }

  const supabase = await createClient();
  const { data } = await supabase
    .from("population_data_governance_gates")
    .select("gate_key, met, evidence, attested_by, attested_at")
    .order("gate_key", { ascending: true });

  const gates = (data as GateRow[] | null) ?? [];
  const allGatesMet = gates.length === 3 && gates.every((g) => g.met);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">
          Population data governance
        </h1>
        <p className="text-charcoal-ink/60">
          Internal-only scaffolding for the §12 external data-monetisation / research-dataset-export
          / national-network capability (docs/FULL_SPECIFICATION_V4.md §12,
          docs/Tarragon_Health_Master_Operating_Plan_v4.md §15). The real aggregation logic exists and
          is tested — it just refuses to return anything but a blocked response until every gate below
          is genuinely met. Clinical-trials patient matching is deliberately not part of this page: it
          needs a separate ethics-committee (NHREC or equivalent) approval this gate list doesn&apos;t
          cover.
        </p>
      </div>
      <GovernanceGatesManager gates={gates} allGatesMet={allGatesMet} />
    </div>
  );
}
