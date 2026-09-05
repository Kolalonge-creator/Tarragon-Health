import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { PageHeader } from "@/components/ui/page-header";
import { AiCoachChat } from "@/app/(dashboard)/patient/ai-coach-chat";
import { AccessRulesManager } from "./access-rules-manager";
import { ServiceCapsManager } from "./service-caps-manager";

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
      <PageHeader
        title="AI Health Coach: internal testing"
        description="Same LangGraph + Claude flow patients get, running against your own admin profile. Each message is a real Claude API call, so it's billed the same as a patient conversation. Use the controls below to grant it to specific patients or open it to everyone once you're ready."
      />
      <AccessRulesManager />
      <ServiceCapsManager />
      <AiCoachChat patientId={profile.id} />
    </div>
  );
}
