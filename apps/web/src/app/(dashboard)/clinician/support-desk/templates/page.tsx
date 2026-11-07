import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { getSupportDeskAccess } from "@/lib/auth/permissions";
import { TemplatesManager } from "../_components/templates-manager";

export const metadata = { title: "Reply templates" };
export const dynamic = "force-dynamic";

export default async function Page() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  const access = await getSupportDeskAccess();
  return <TemplatesManager me={profile.id} isLead={access.isLead} />;
}
