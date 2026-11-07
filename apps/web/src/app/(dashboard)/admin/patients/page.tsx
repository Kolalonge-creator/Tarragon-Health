import Link from "next/link";
import { redirect } from "next/navigation";
import { t } from "@tarragon/i18n";
import { DEFAULT_UI_LANGUAGE } from "@tarragon/shared";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { lookupLabels } from "@/lib/admin-patients/labels";
import { PatientLookup } from "./patient-lookup";
import { PageHeader } from "@/components/ui/page-header";

export const metadata = { title: "Find a patient" };
export const dynamic = "force-dynamic";

/**
 * S36a (OQ-04, INV-10): the admin's way to find a patient for support and investigations. It used to load up to 5000 patients with
 * date of birth, phone and purchases in one read and one audit row. It now shows nothing until a search is typed, search shows
 * minimal identity, and opening a record needs a typed reason that is audited. Admin only, as before: institutions never see
 * an individual (I9). Clinical records are not on this page at all.
 */
export default async function AdminPatientsPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "admin") redirect("/admin");
  const locale = DEFAULT_UI_LANGUAGE;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("adminpatients.title", locale)}
        description={t("adminpatients.intro", locale)}
        actions={
          <p className="flex gap-4 text-sm">
            <Link className="underline" href="/admin/patients/duplicates">{t("adminpatients.links.duplicates", locale)}</Link>
            <Link className="underline" href="/admin/patients/merge">{t("adminpatients.links.merge", locale)}</Link>
          </p>
        }
      />
      <PatientLookup labels={lookupLabels(locale)} />
    </div>
  );
}
