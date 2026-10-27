import { redirect } from "next/navigation";
import { t } from "@tarragon/i18n";
import { getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { canAssignCases } from "@/lib/clinical/doctor-tier";
import { PageHeader } from "@/components/ui/page-header";
import { ExpiryBacklog } from "@/components/learning/expiry-backlog";

export const metadata = { title: "Learning content review list" };

/**
 * The Chief Medical Officer's view of the learning content review list. A CMO account is a `clinician` and cannot open /admin/*, so this is
 * a separate access path to the same database functions the admin page reads (they refuse everyone but an admin and the active CMO).
 * canAssignCases (chief_medical_officer only) is the page gate, the same pattern as /clinician/team-caseload.
 */
export default async function Page() {
  const staff = await getCurrentClinicalStaff();
  if (!canAssignCases(staff)) {
    redirect("/clinician");
  }
  return (
    <div className="space-y-6">
      <PageHeader title={t("learn.expiry.title")} description={t("learn.expiry.intro")} />
      <ExpiryBacklog />
    </div>
  );
}
