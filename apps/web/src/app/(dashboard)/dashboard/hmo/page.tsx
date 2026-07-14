import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { DashboardPlaceholder } from "@/components/dashboard-placeholder";
import { ContractStatusCard } from "@/components/contract-status-card";
import { getContractPerformance } from "@/lib/outcomes-contracts/get-contract-performance";

export default async function HmoPage() {
  const profile = await getCurrentProfile();
  const greeting = `Welcome${profile?.full_name ? `, ${profile.full_name}` : ""}`;

  const performance = profile?.organisation_id
    ? await getContractPerformance(await createClient(), profile.organisation_id)
    : null;

  return (
    <DashboardPlaceholder
      greeting={greeting}
      roleLabel="HMO admin"
      comingUp={[
        "Member population risk distribution",
        "Care gap tracking across enrolled members",
        "Outcome / claims-prevented reporting",
      ]}
    >
      <ContractStatusCard performance={performance} />
    </DashboardPlaceholder>
  );
}
