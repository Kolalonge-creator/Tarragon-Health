import { redirect } from "next/navigation";
import { resolveUiLanguage } from "@tarragon/shared";
import { getCurrentClinicalStaff, getCurrentProfile } from "@/lib/auth/current-profile";
import { canAssignCases } from "@/lib/clinical/doctor-tier";
import { getPidginEnabled } from "@/lib/language/pidgin-switch";
import { RosterPage } from "@/components/clinician-roster/roster-page";

export const metadata = { title: "Clinician roster" };
export const dynamic = "force-dynamic";

/** S36d: the clinical lead's door (CMO only): decide requests, grant or end a competency, pause or reinstate. */
export default async function LeadRoster({ searchParams }: { searchParams: Promise<{ n?: string }> }) {
  const staff = await getCurrentClinicalStaff();
  if (!canAssignCases(staff)) redirect("/clinician");
  const profile = await getCurrentProfile();
  const locale = resolveUiLanguage(profile?.language, await getPidginEnabled());
  return <RosterPage door="lead" locale={locale} noticeParam={(await searchParams).n} />;
}
