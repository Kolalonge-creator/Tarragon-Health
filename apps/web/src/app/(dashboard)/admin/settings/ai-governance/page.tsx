import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { getCallerPermissions } from "@/lib/auth/permissions";
import { AiGovernanceManager } from "./ai-governance-manager";

export default async function AiGovernanceSettingsPage() {
  const profile = await getCurrentProfile();
  const { isSuperAdmin, keys } = await getCallerPermissions();

  if (!profile || (!isSuperAdmin && !keys.has("ai_governance.manage"))) {
    redirect("/admin");
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">AI governance</h1>
        <p className="text-charcoal-ink/60">
          Every AI system running on the platform, its incident/interaction volume, and its
          kill switch. This page can only disable — or re-enable once release-ready — a
          registered AI system; there is no equivalent one-click rollback yet for a clinical
          rule, price, or notification template.
        </p>
      </div>
      <AiGovernanceManager />
    </div>
  );
}
