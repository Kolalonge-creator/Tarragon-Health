import { redirect } from "next/navigation";
import { resolveUiLanguage } from "@tarragon/shared";
import { getCurrentClinicalStaff, getCurrentProfile } from "@/lib/auth/current-profile";
import { canAssignCases } from "@/lib/clinical/doctor-tier";
import { getPidginEnabled } from "@/lib/language/pidgin-switch";
import { GoLivePage } from "@/components/go-live/go-live-page";

export const metadata = { title: "Go-live guards" };
export const dynamic = "force-dynamic";

/**
 * S37: the Chief Medical Officer's door to the same guards and proposed values. A CMO's account role is `clinician`, which can
 * never open /admin, so the page lives here, gated by canAssignCases like the other CMO-only pages.
 */
export default async function ClinicianGoLive({ searchParams }: { searchParams: Promise<{ notice?: string; detail?: string; ok?: string }> }) {
  const staff = await getCurrentClinicalStaff();
  if (!canAssignCases(staff)) redirect("/clinician");
  const profile = await getCurrentProfile();
  const sp = await searchParams;
  const locale = resolveUiLanguage(profile?.language, await getPidginEnabled());
  return <GoLivePage viewer="cmo" locale={locale} notice={sp.notice} detail={sp.detail} ok={sp.ok === "1"} />;
}
