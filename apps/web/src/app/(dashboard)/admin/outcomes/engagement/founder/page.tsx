import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { FounderView } from "@/components/outcomes/founder-view";

export const metadata = { title: "Founder view" };
export const dynamic = "force-dynamic";

/**
 * The founder's unfrozen view of the outcomes dashboard. Super admin only: there is deliberately NO /clinician twin (the CMO does not get it) and no
 * export route. The database function is the real gate (role, switch, reason, audit); this check only sends other roles away.
 */
export default async function AdminFounderView() {
  const profile = await getCurrentProfile();
  if (profile?.role !== "admin") redirect("/");
  return <FounderView />;
}
