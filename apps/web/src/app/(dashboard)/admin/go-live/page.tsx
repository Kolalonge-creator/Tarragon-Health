import { redirect } from "next/navigation";
import { resolveUiLanguage } from "@tarragon/shared";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { getPidginEnabled } from "@/lib/language/pidgin-switch";
import { readFlash } from "@/lib/go-live/flash";
import { GoLivePage } from "@/components/go-live/go-live-page";

export const metadata = { title: "Go-live guards" };
export const dynamic = "force-dynamic";

/** S37: the founder's door to the go-live guards and the proposed values they own. The CMO uses /clinician/go-live. */
export default async function AdminGoLive({ searchParams }: { searchParams: Promise<{ n?: string }> }) {
  const profile = await getCurrentProfile();
  if (profile?.role !== "admin") redirect("/admin");
  const flash = await readFlash((await searchParams).n);
  const locale = resolveUiLanguage(profile.language, await getPidginEnabled());
  return <GoLivePage viewer="admin" locale={locale} notice={flash?.notice} detail={flash?.detail} ok={flash?.ok} />;
}
