import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { hasPermission } from "@/lib/auth/permissions";
import { PageHeader } from "@/components/ui/page-header";
import { SpecialistsManager } from "./specialists-manager";

export default async function SpecialistsPartnersPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (!(await hasPermission("partners.specialists.manage"))) redirect("/admin");

  return (
    <div className="space-y-6">
      <PageHeader title="Specialists" description="Add and manage specialist referral providers." />
      <SpecialistsManager />
    </div>
  );
}
