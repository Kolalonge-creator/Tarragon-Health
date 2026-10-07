import { redirect } from "next/navigation";
import { t } from "@tarragon/i18n";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { getSignedReport, listSignedReports } from "@/lib/health-report/queries";
import { buildRenderModel } from "@/lib/health-report/render-model";
import { HealthReportView } from "@/components/health-report-view";
import { ScreeningDisclaimer } from "@/components/screening-disclaimer";
import { PrintButton } from "./print-button";

/**
 * The patient's yearly Tarragon Health Report (S46, function 3.15). Only a report a named clinician has signed can be read here: the database policy returns
 * nothing for an unsigned draft, so a patient with a draft waiting sees "not ready yet" and nothing else (spec acceptance test).
 */
export default async function PatientHealthReportPage({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const { id } = await searchParams;
  const supabase = await createClient();

  const [report, all] = await Promise.all([getSignedReport(supabase, id), listSignedReports(supabase)]);

  if (!report) {
    return (
      <div className="space-y-4">
        <h1 className="font-heading text-2xl font-semibold">{t("report.title", "en")}</h1>
        <p className="text-sm">{all.length === 0 ? t("report.none", "en") : t("report.not_ready", "en")}</p>
        <ScreeningDisclaimer />
      </div>
    );
  }

  const model = buildRenderModel(report.row, report.config, "self");
  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 print:max-w-none print:px-0">
      <div className="flex flex-wrap gap-2 print:hidden">
        <PrintButton label={t("report.print", "en")} />
        <a className="inline-flex min-h-11 items-center rounded border px-3 text-sm" href={`/api/patient/health-report/${report.id}/pdf`}>
          {t("report.download", "en")}
        </a>
        <a className="inline-flex min-h-11 items-center rounded border px-3 text-sm" href={`/api/patient/health-report/${report.id}/pdf?variant=shared`}>
          {t("report.section.share", "en")}
        </a>
      </div>
      <HealthReportView model={model} />
      <ScreeningDisclaimer />
    </div>
  );
}
