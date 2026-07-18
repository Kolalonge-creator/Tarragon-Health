import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { hasPermission } from "@/lib/auth/permissions";
import { FacilityManager } from "./facility-manager";

export default async function AdminFacilitiesPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  // The super admin or a member delegated `partners.facilities.manage` may
  // manage facilities. Content-level guard on top of the RLS the writes obey.
  if (!(await hasPermission("partners.facilities.manage"))) {
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
