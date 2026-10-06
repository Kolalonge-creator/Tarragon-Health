import { redirect } from "next/navigation";
import { resolveUiLanguage } from "@tarragon/shared";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { getPidginEnabled } from "@/lib/language/pidgin-switch";
import { PayoutsView } from "@/components/payouts/payouts-view";

export const metadata = { title: "Payouts" };
export const dynamic = "force-dynamic";

/** S36f: the founder approves or cancels payout drafts here. Admin only; the database checks the role and the maker-checker rule again. */
export default async function AdminPayouts({ searchParams }: { searchParams: Promise<{ n?: string }> }) {
  const profile = await getCurrentProfile();
  if (profile?.role !== "admin") redirect("/admin");
  const locale = resolveUiLanguage(profile.language, await getPidginEnabled());
  return <PayoutsView viewer="admin" locale={locale} notice={(await searchParams).n} />;
}
