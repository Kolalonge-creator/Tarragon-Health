import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { PageHeader } from "@/components/ui/page-header";
import { ProtocolVersionsManager } from "./protocol-versions-manager";
import { ProtocolDraftsManager } from "./protocol-drafts-manager";

export default async function ProtocolsSettingsPage() {
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
        title="Clinical protocols"
        description={`The version-signed record behind every "protocols supervised by Dr. X" claim shown to patients: docs/CLINICAL_TRUST_MODEL_SPEC.md §1/§4. Append-only: signing a new version is how a protocol changes, nothing here is ever edited after the fact. Only the org's active Clinical Director can sign.`}
      />
      <ProtocolDraftsManager />
      <ProtocolVersionsManager />
    </div>
  );
}
