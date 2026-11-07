import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { getSupportDeskAccess } from "@/lib/auth/permissions";
import { HandoffList } from "@/components/support-desk/handoff-list";

export const metadata = { title: "Support hand-offs" };
export const dynamic = "force-dynamic";

export default async function SupportHandoffsPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  const access = await getSupportDeskAccess();
  return <HandoffList mode="support" me={profile.id} isLead={access.isLead} />;
}
