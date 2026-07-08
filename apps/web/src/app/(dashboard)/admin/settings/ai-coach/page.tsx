import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { AiCoachChat } from "@/app/(dashboard)/patient/ai-coach-chat";
import { AccessRulesManager } from "./access-rules-manager";
import { PlanCapsManager } from "./plan-caps-manager";

export default async function AiCoachSettingsPage() {
  const profile = await getCurrentProfile();

  // proxy.ts already blocks non-admins from reaching any /admin/** route at
  // the routing layer — this is a defense-in-depth check on top of that,
  // since this page's content (not just its RLS-protected data) is
  // admin-only.
  if (profile?.role !== "admin") {
    redirect("/admin");
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">
          AI Health Coach — internal testing
        </h1>
        <p className="text-charcoal-ink/60">
          Same LangGraph + Claude flow patients get, running against your own admin profile —
          each message is a real Claude API call, so it&apos;s billed the same as a patient
          conversation. Use the controls below to grant it to specific patients or open it to
          everyone once you&apos;re ready.
        </p>
      </div>
      <AccessRulesManager />
      <PlanCapsManager />
      <AiCoachChat patientId={profile.id} />
    </div>
  );
}
