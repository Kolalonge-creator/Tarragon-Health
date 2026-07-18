import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { hasPermission } from "@/lib/auth/permissions";
import { SpecialistsManager } from "./specialists-manager";

export default async function SpecialistsPartnersPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (!(await hasPermission("partners.specialists.manage"))) redirect("/admin");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Specialists</h1>
        <p className="text-charcoal-ink/60">Add and manage specialist referral providers.</p>
      </div>
      <SpecialistsManager />
    </div>
  );
}
