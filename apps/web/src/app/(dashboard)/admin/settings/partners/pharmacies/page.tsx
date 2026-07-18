import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { hasPermission } from "@/lib/auth/permissions";
import { PharmaciesManager } from "./pharmacies-manager";

export default async function PharmaciesPartnersPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (!(await hasPermission("partners.pharmacies.manage"))) redirect("/admin");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Pharmacies</h1>
        <p className="text-charcoal-ink/60">Add and manage partner pharmacies.</p>
      </div>
      <PharmaciesManager />
    </div>
  );
}
