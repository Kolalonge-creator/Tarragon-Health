import { redirect } from "next/navigation";
import { resolveUiLanguage } from "@tarragon/shared";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { hasPermission } from "@/lib/auth/permissions";
import { getPidginEnabled } from "@/lib/language/pidgin-switch";
import { ReliabilityPage } from "@/components/reliability/reliability-page";

export const metadata = { title: "Reliability and SLA (view)" };
export const dynamic = "force-dynamic";

/**
 * S36e: the operations team's aggregate view of queue health, page times and cover (spec 9.4). No clinician name, score or patient is in
 * the answer the database gives this door. The clinical lead uses /clinician/reliability for the named list.
 */
export default async function OpsReliability() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (!(await hasPermission("ops.console.view"))) redirect("/admin");
  const locale = resolveUiLanguage(profile.language, await getPidginEnabled());
  return <ReliabilityPage viewer="ops" locale={locale} />;
}
