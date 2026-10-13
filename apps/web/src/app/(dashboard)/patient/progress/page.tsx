import { redirect } from "next/navigation";
import { getPatientDashboardContext } from "@/app/(dashboard)/patient/dashboard-context";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { parseMonthlyList } from "@/lib/progress/monthly-report";
import { t } from "@tarragon/i18n";

export const metadata = { title: "Your month" };
export const dynamic = "force-dynamic";

/**
 * The personal monthly progress report (S38c, Module 22.5). It shows the person's own readings only: no comparison with anyone else, no
 * ranking, no risk score. When there are too few readings it says so instead of showing an average. Each report is written once after
 * the month ends and is read here through `my_monthly_reports`, which only ever returns the caller's own rows.
 */
export default async function PatientProgressPage() {
  const { acting, uiLanguage } = await getPatientDashboardContext();
  // A report belongs to the person it is about; a supporter has their own, not the account they are helping with.
  if (acting) redirect("/patient");

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("my_monthly_reports", { p_limit: 12 });
  const reports = error ? null : parseMonthlyList(data, uiLanguage);

  return (
    <div className="space-y-6">
      <PageHeader backTo={{ href: "/patient", label: "Dashboard" }} title={t("progress.title", uiLanguage)} description={reports?.[0]?.headline} />
      {reports === null ? (
        <p role="alert">{t("progress.load_error", uiLanguage)}</p>
      ) : reports.length === 0 ? (
        <p>{t("progress.empty", uiLanguage)}</p>
      ) : (
        <>
          {reports.slice(0, 1).map((r) => (
            <Card key={r.month}>
              <CardHeader>
                <CardTitle>{r.monthLabel}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <ul className="space-y-2">
                  {r.lines.map((l) => (
                    <li key={l}>{l}</li>
                  ))}
                </ul>
                <div>
                  <h2 className="text-sm font-medium">{t("progress.weekly_title", uiLanguage)}</h2>
                  <ul className="mt-1 space-y-1 text-sm">
                    {r.weeks.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                </div>
              </CardContent>
            </Card>
          ))}
          {reports.length > 1 ? (
            <section aria-labelledby="progress-earlier" className="space-y-2">
              <h2 id="progress-earlier" className="text-sm font-medium">
                {t("progress.earlier", uiLanguage)}
              </h2>
              {reports.slice(1).map((r) => (
                <details key={r.month} className="rounded border p-3">
                  <summary className="min-h-11 cursor-pointer">{r.monthLabel}</summary>
                  <ul className="mt-2 space-y-1 text-sm">
                    {r.lines.map((l) => (
                      <li key={l}>{l}</li>
                    ))}
                  </ul>
                </details>
              ))}
            </section>
          ) : null}
          <p className="text-sm">{t("progress.footer", uiLanguage)}</p>
        </>
      )}
    </div>
  );
}
