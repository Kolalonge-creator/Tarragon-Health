import { redirect } from "next/navigation";
import { resolveUiLanguage } from "@tarragon/shared";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { getPidginEnabled } from "@/lib/language/pidgin-switch";
import { GoLivePage } from "@/components/go-live/go-live-page";

export const metadata = { title: "Go-live guards" };
export const dynamic = "force-dynamic";

/** S37: the founder's door to the go-live guards and the proposed values they own. The CMO uses /clinician/go-live. */
export default async function AdminGoLive({ searchParams }: { searchParams: Promise<{ notice?: string; detail?: string; ok?: string }> }) {
  const profile = await getCurrentProfile();
  if (profile?.role !== "admin") redirect("/admin");
  const sp = await searchParams;
  const locale = resolveUiLanguage(profile.language, await getPidginEnabled());
  return <GoLivePage viewer="admin" locale={locale} notice={sp.notice} detail={sp.detail} ok={sp.ok === "1"} />;
}
