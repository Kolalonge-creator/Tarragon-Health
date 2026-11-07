import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { getSupportDeskAccess } from "@/lib/auth/permissions";
import { isQueueTab } from "@/lib/support-desk/model";
import { QueueWorkspace } from "../_components/queue-workspace";

export const metadata = { title: "Support queue" };
export const dynamic = "force-dynamic";

export default async function SupportQueuePage({ searchParams }: { searchParams: Promise<{ tab?: string; sla?: string }> }) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  const { tab, sla } = await searchParams;
  const access = await getSupportDeskAccess();
  return <QueueWorkspace me={profile.id} isLead={access.isLead} initialTab={isQueueTab(tab) ? tab : "mine"} initialSla={sla} />;
}
