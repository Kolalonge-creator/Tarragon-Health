import { redirect } from "next/navigation";
import { DEFAULT_UI_LANGUAGE } from "@tarragon/shared";
import { getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { canAssignCases } from "@/lib/clinical/doctor-tier";
import { readFlash } from "@/lib/go-live/flash";
import { GoLivePage } from "@/components/go-live/go-live-page";

export const metadata = { title: "Go-live guards" };
export const dynamic = "force-dynamic";

/**
 * S37: the Chief Medical Officer's door to the same guards and proposed values. A CMO's account role is `clinician`, which can
 * never open /admin, so the page lives here, gated by canAssignCases like the other CMO-only pages.
 */
export default async function ClinicianGoLive({ searchParams }: { searchParams: Promise<{ n?: string }> }) {
  const staff = await getCurrentClinicalStaff();
  if (!canAssignCases(staff)) redirect("/clinician");
  const flash = await readFlash((await searchParams).n);
  const locale = DEFAULT_UI_LANGUAGE;
  return <GoLivePage viewer="cmo" locale={locale} notice={flash?.notice} detail={flash?.detail} ok={flash?.ok} />;
}
