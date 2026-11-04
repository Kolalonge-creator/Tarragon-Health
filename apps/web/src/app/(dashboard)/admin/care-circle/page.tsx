import { redirect } from "next/navigation";
import { t } from "@tarragon/i18n";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatKobo } from "@/lib/format-money";
import { parseCareCircleMetrics, METRIC_GROUPS } from "./metrics";

export const metadata = { title: "Care Circle" };
export const dynamic = "force-dynamic";

/**
 * Care Circle figures for the admin console (Care Circle P5, spec 21): adoption, engagement, gifts and safety. Counts only, from
 * public.admin_care_circle_metrics (admin only, test accounts excluded). Never a name and nothing clinical.
 */
export default async function CareCircleMetricsPage() {
  const profile = await getCurrentProfile();
  if (profile?.role !== "admin") redirect("/admin");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_care_circle_metrics");
  const metrics = error ? null : parseCareCircleMetrics(data);
  return (
    <div className="space-y-6">
      <PageHeader title={t("circlep5.admin.title", "en")} description={t("circlep5.admin.intro", "en")} />
      {!metrics ? <p role="alert">{t("circlep5.admin.error", "en")}</p> : null}
      {metrics ? (
        <div className="grid gap-4 md:grid-cols-2">
          {METRIC_GROUPS.map((g) => (
            <Card key={g.group}>
              <CardHeader><CardTitle>{t(g.titleKey, "en")}</CardTitle></CardHeader>
              <CardContent>
                <dl className="divide-y">
                  {g.fields.map((f) => (
                    <div key={f.key} className="flex items-baseline justify-between gap-4 py-2">
                      <dt className="text-sm">{t(f.labelKey, "en")}</dt>
                      <dd className="font-heading text-lg font-semibold tabular-nums">
                        {f.key === "gift_revenue_kobo" ? formatKobo(metrics[g.group][f.key] ?? 0) : (metrics[g.group][f.key] ?? 0)}
                      </dd>
                    </div>
                  ))}
                </dl>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : null}
    </div>
  );
}
