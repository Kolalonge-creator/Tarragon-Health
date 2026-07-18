import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { hasPermission } from "@/lib/auth/permissions";
import { LabsManager } from "./labs-manager";

export default async function LabsPartnersPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (!(await hasPermission("partners.labs.manage"))) redirect("/admin");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Labs</h1>
        <p className="text-charcoal-ink/60">Add and manage the lab providers patients can book with.</p>
      </div>
      <LabsManager />
    </div>
  );
}
