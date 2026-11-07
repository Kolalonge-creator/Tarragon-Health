import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { getSupportDeskAccess } from "@/lib/auth/permissions";
import { SlaSettings } from "../_components/sla-settings";

export const metadata = { title: "Support targets and hours" };
export const dynamic = "force-dynamic";

export default async function Page() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  const access = await getSupportDeskAccess();
  return <SlaSettings me={profile.id} isLead={access.isLead} />;
}
