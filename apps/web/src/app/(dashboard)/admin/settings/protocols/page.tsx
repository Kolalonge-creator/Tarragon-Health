import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { ProtocolVersionsManager } from "./protocol-versions-manager";

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
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">
          Clinical protocols
        </h1>
        <p className="text-charcoal-ink/60">
          The version-signed record behind every &quot;protocols supervised by Dr. X&quot; claim
          shown to patients — docs/CLINICAL_TRUST_MODEL_SPEC.md §1/§4. Append-only: signing a new
          version is how a protocol changes, nothing here is ever edited after the fact. Only the
          org&apos;s active Clinical Director can sign.
        </p>
      </div>
      <ProtocolVersionsManager />
    </div>
  );
}
