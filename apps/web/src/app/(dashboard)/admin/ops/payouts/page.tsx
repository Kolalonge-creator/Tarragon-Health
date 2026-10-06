import { redirect } from "next/navigation";
import { resolveUiLanguage } from "@tarragon/shared";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { hasPermission } from "@/lib/auth/permissions";
import { getPidginEnabled } from "@/lib/language/pidgin-switch";
import { PayoutsView } from "@/components/payouts/payouts-view";

export const metadata = { title: "Prepare payouts" };
export const dynamic = "force-dynamic";

/**
 * S36f: the operations door to payouts (spec 9.4, payout drafts). Holders of payouts.prepare see unpaid totals and prepare or withdraw
 * drafts. There is no approve button on this page; approval is the founder's, on /admin/payouts, and the database refuses anyone else.
 */
export default async function OpsPayouts({ searchParams }: { searchParams: Promise<{ n?: string }> }) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (!(await hasPermission("payouts.prepare"))) redirect("/admin");
  const locale = resolveUiLanguage(profile.language, await getPidginEnabled());
  return <PayoutsView viewer="ops" locale={locale} notice={(await searchParams).n} />;
}
