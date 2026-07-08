import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { FacilityManager } from "./facility-manager";

export default async function AdminFacilitiesPage() {
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
          Facility directory
        </h1>
        <p className="text-charcoal-ink/60">
          Add and maintain the curated facility directory patients browse, and what each
          facility offers.
        </p>
      </div>
      <FacilityManager />
    </div>
  );
}
