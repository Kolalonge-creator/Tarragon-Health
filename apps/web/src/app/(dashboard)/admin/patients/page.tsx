import Link from "next/link";
import { redirect } from "next/navigation";
import { t } from "@tarragon/i18n";
import { resolveUiLanguage } from "@tarragon/shared";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { getPidginEnabled } from "@/lib/language/pidgin-switch";
import { lookupLabels } from "@/lib/admin-patients/labels";
import { PatientLookup } from "./patient-lookup";

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
  const locale = resolveUiLanguage(profile.language, await getPidginEnabled());

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight text-charcoal-ink sm:text-3xl">{t("adminpatients.title", locale)}</h1>
        <p className="mt-1 max-w-3xl text-sm text-charcoal-ink/70">{t("adminpatients.intro", locale)}</p>
        <p className="mt-2 flex gap-4 text-sm">
          <Link className="underline" href="/admin/patients/duplicates">{t("adminpatients.links.duplicates", locale)}</Link>
          <Link className="underline" href="/admin/patients/merge">{t("adminpatients.links.merge", locale)}</Link>
        </p>
      </div>
      <PatientLookup labels={lookupLabels(locale)} />
    </div>
  );
}
