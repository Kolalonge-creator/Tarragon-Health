import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { ConditionsManager } from "./conditions-manager";

export default async function ConditionsSettingsPage() {
  const profile = await getCurrentProfile();

  // proxy.ts already blocks non-admins from any /admin/** route — defense in depth.
  if (profile?.role !== "admin") {
    redirect("/admin");
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">
          Chronic conditions
        </h1>
        <p className="text-charcoal-ink/60">
          Every chronic-disease programme lives here. All seven are built; each is dormant until a
          Clinical Director signs its WHO-based protocol and you switch it on — no redeploy. The
          platform launches with hypertension and diabetes; activate the rest (asthma, COPD, heart
          failure, CKD, obesity) as the programme scales. A dormant condition cannot be enrolled,
          enforced at the database.
        </p>
      </div>
      <ConditionsManager />
    </div>
  );
}
