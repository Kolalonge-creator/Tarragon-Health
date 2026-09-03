import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { ProviderRestrictionsManager } from "./provider-restrictions-manager";

export default async function ProviderRestrictionsSettingsPage() {
  const profile = await getCurrentProfile();

  // Matches the DB's real authorization boundary (private.is_complaints_handler():
  // admin or an active Clinical Director) — not the RBAC delegation system, since
  // provider_restrictions' own RLS checks that function directly, not
  // private.has_permission(). A Clinical Director who isn't the super admin still
  // gets write access at the DB layer regardless of this page-level gate.
  if (profile?.role !== "admin") {
    redirect("/admin");
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">
          Provider restrictions
        </h1>
        <p className="text-charcoal-ink/60">
          A staged, reason-coded suspension workflow for clinical staff, separate from (and
          more complete than) the plain active/inactive toggle on their account.
        </p>
      </div>
      <ProviderRestrictionsManager />
    </div>
  );
}
