import Link from "next/link";
import { t } from "@tarragon/i18n";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { loadAdherenceReport } from "@/lib/medicines/adherence-report-data";
import { PageHeader } from "@/components/ui/page-header";
import { LoadFailure } from "@/components/ui/load-failure";
import { Card, CardContent } from "@/components/ui/card";

export const metadata = { title: "Doses marked taken" };

const day = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

/** The patient's weekly "doses you marked taken" record, on screen and as a PDF to hand to any clinic or pharmacy. Free, not paywalled. */
export default async function MedicineReportPage() {
  const profile = await getCurrentProfile();
  const supabase = await createClient();
  const report = profile ? await loadAdherenceReport(supabase, profile.id) : null;

  return (
    <div className="space-y-6">
      <PageHeader title={t("medicines.report.title")} description={t("medicines.report.page_intro")} />
      {!report || !report.ok ? (
        <LoadFailure>We could not build the report just now. Please try again in a moment.</LoadFailure>
      ) : (
        <>
          <Link href="/api/patient/medicine-report/pdf" prefetch={false} className="inline-block rounded-md bg-brand-green px-4 py-2 text-sm font-medium text-white">
            {t("medicines.report.download")}
          </Link>
          <Card>
            <CardContent className="overflow-x-auto pt-6">
              {report.data.hasScheduledMedicines ? (
                <table className="w-full text-left text-sm">
                  <thead className="text-charcoal-ink/60">
                    <tr>
                      <th className="p-2 font-medium">{t("medicines.report.col_week")}</th>
                      <th className="p-2 font-medium">{t("medicines.report.col_percent")}</th>
                      <th className="p-2 font-medium">{t("medicines.report.col_taken")}</th>
                      <th className="p-2 font-medium">{t("medicines.report.col_skipped")}</th>
                      <th className="p-2 font-medium">{t("medicines.report.col_no_record")}</th>
                      <th className="p-2 font-medium">{t("medicines.report.col_could_not_get")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.data.weeks.map((w) => (
                      <tr key={w.weekStart} className="border-t border-mist-grey/30">
                        <td className="p-2">{day(w.weekStart)} to {day(w.weekEnd)}</td>
                        <td className="p-2">{w.percent === null ? t("medicines.report.not_enough") : `${w.percent}% (${w.markedTaken} of ${w.due})`}</td>
                        <td className="p-2">{w.markedTaken}</td>
                        <td className="p-2">{w.skipped}</td>
                        <td className="p-2">{w.noRecord}</td>
                        <td className="p-2">{w.couldNotGet}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="text-sm">{t("medicines.report.none")}</p>
              )}
              <p className="mt-4 text-xs text-charcoal-ink/60">{t("medicines.report.footnote_self_report")}</p>
              <p className="mt-2 text-xs text-charcoal-ink/60">{t("medicines.report.footnote_definition", undefined, { min: report.data.minDoses })}</p>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
