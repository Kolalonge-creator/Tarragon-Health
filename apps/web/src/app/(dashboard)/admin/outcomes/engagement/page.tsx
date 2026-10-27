import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { OutcomesDashboardPage } from "@/components/outcomes/outcomes-dashboard-page";

export const metadata = { title: "Engagement and outcomes" };
export const dynamic = "force-dynamic";

/** The honest outcomes dashboard for a super admin. The database refuses everyone else; this check only sends other roles away. */
export default async function AdminEngagementOutcomes({ searchParams }: { searchParams: Promise<{ r?: string }> }) {
  const profile = await getCurrentProfile();
  if (profile?.role !== "admin") redirect("/");
  return <OutcomesDashboardPage viewer="admin" outcome={(await searchParams).r} />;
}
