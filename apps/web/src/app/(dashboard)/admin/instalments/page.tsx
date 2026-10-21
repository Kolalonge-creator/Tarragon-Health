import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { PageHeader } from "@/components/ui/page-header";
import { InstalmentsAdmin } from "./instalments-admin";

export const metadata = { title: "Pay in parts" };

export default async function AdminInstalmentsPage() {
  const profile = await getCurrentProfile();
  if (profile?.role !== "admin") redirect("/admin");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Pay in parts"
        description="Memberships paid in parts: who is on a plan, who is behind, and how much is still to come."
      />
      <InstalmentsAdmin />
    </div>
  );
}
