import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { AdminPayoutsView } from "@/components/payouts/admin-payouts-view";

export const metadata = { title: "Payouts" };
export const dynamic = "force-dynamic";

export default async function AdminPayoutsPage() {
  const profile = await getCurrentProfile();
  // proxy.ts already keeps non-admins out of /admin; this is the page's own check. The database checks the role again.
  if (profile?.role !== "admin") redirect("/admin");
  return <AdminPayoutsView />;
}
