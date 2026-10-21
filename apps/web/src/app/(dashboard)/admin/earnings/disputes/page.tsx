import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { AdminDisputesView } from "@/components/earnings/admin-disputes-view";

export const metadata = { title: "Earnings questions" };
export const dynamic = "force-dynamic";

export default async function AdminEarningsDisputesPage() {
  const profile = await getCurrentProfile();
  // proxy.ts already keeps non-admins out of /admin; this is the page's own check. The database checks the role again.
  if (profile?.role !== "admin") redirect("/admin");
  return <AdminDisputesView />;
}
