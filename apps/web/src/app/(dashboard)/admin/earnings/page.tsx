import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { AdminEarningsView } from "@/components/earnings/admin-earnings-view";

export const metadata = { title: "Fees and earnings" };
export const dynamic = "force-dynamic";

export default async function AdminEarningsPage() {
  const profile = await getCurrentProfile();
  // proxy.ts already keeps non-admins out of /admin; this is the page's own check. The database checks the role again.
  if (profile?.role !== "admin") redirect("/admin");
  return <AdminEarningsView />;
}
