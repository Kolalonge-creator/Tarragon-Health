import { redirect } from "next/navigation";
import { DEFAULT_UI_LANGUAGE } from "@tarragon/shared";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { hasPermission } from "@/lib/auth/permissions";
import { RosterPage } from "@/components/clinician-roster/roster-page";

export const metadata = { title: "Clinician roster" };
export const dynamic = "force-dynamic";

/** S36d: operations' door to the clinician roster (spec 9.4): view, pause with a reason, and ask the clinical lead. */
export default async function OpsClinicians({ searchParams }: { searchParams: Promise<{ n?: string }> }) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (!(await hasPermission("clinical_staff.manage"))) redirect("/admin");
  const locale = DEFAULT_UI_LANGUAGE;
  return <RosterPage door="ops" locale={locale} noticeParam={(await searchParams).n} />;
}
