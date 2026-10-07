import { redirect } from "next/navigation";
import Link from "next/link";
import { t } from "@tarragon/i18n";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { getCaregiverReport, listCaregiverReports } from "@/lib/health-report/caregiver";
import { buildRenderModel } from "@/lib/health-report/render-model";
import { HealthReportView } from "@/components/health-report-view";
import { ScreeningDisclaimer } from "@/components/screening-disclaimer";

export const metadata = { title: "Yearly health reports for people you support" };

/**
 * A caregiver's or guardian's view of a dependant's SIGNED yearly report (S46c). The database function decides what this person may see, section by section
 * (access categories, adolescent confidentiality, hand-over at 18); a refusal of any kind shows the same "nothing shared" page. `?variant=shared` renders the
 * shared copy (heart risk, questionnaire answers and reproductive screening left out), the same one the patient can print for someone else.
 */
export default async function CaregiverHealthReportsPage({ searchParams }: { searchParams: Promise<{ patient?: string; variant?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const { patient, variant } = await searchParams;
  const supabase = await createClient();

  if (!patient || !/^[0-9a-f-]{36}$/.test(patient)) {
    const people = await listCaregiverReports(supabase);
    return (
      <div className="space-y-4">
        <h1 className="font-heading text-2xl font-semibold">{t("report.caregiver.title", "en")}</h1>
        {people.length === 0 ? <p className="text-sm">{t("report.caregiver.none", "en")}</p> : null}
        <ul className="space-y-2">
          {people.map((p) => (
            <li key={p.patientId} className="rounded border p-3 text-sm">
              <Link className="font-medium underline" href={`/patient/family/health-reports?patient=${p.patientId}`}>
                {p.firstName}: {t("report.year", "en", { year: p.year })}
              </Link>
            </li>
          ))}
        </ul>
        <ScreeningDisclaimer />
      </div>
    );
  }

  const report = await getCaregiverReport(supabase, patient);
  if (!report) {
    return (
      <div className="space-y-4">
        <h1 className="font-heading text-2xl font-semibold">{t("report.caregiver.title", "en")}</h1>
        <p className="text-sm">{t("report.caregiver.none", "en")}</p>
        <Link className="text-sm underline" href="/patient/family/health-reports">Back</Link>
      </div>
    );
  }

  const shared = variant === "shared";
  const model = buildRenderModel(report.row, report.config, shared ? "shared" : "self", [], report.caregiver);
  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 print:max-w-none print:px-0">
      <div className="flex flex-wrap gap-2 print:hidden">
        <Link className="inline-flex min-h-11 items-center rounded border px-3 text-sm" href={shared ? `/patient/family/health-reports?patient=${patient}` : `/patient/family/health-reports?patient=${patient}&variant=shared`}>
          {shared ? t("report.title", "en") : t("report.section.share", "en")}
        </Link>
        <a className="inline-flex min-h-11 items-center rounded border px-3 text-sm" href={`/api/caregiver/health-report/${patient}/pdf${shared ? "?variant=shared" : ""}`}>
          {t("report.download", "en")}
        </a>
      </div>
      <p className="text-sm font-medium">{report.firstName}</p>
      <HealthReportView model={model} />
      <ScreeningDisclaimer />
    </div>
  );
}
