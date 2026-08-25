import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { hasPermission } from "@/lib/auth/permissions";
import { DevicesManager } from "./devices-manager";

export default async function DevicesPartnersPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (!(await hasPermission("partners.devices.manage"))) redirect("/admin");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Devices</h1>
        <p className="text-charcoal-ink/60">
          Manage the BP monitor / glucometer / scale listings patients see in their device shop.
          Tarragon links patients out to buy from a retailer — it doesn&apos;t sell or fulfil
          devices itself.
        </p>
      </div>
      <DevicesManager />
    </div>
  );
}
