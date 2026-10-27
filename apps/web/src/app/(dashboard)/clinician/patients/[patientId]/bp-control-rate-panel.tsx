import { t } from "@tarragon/i18n";
import { createClient } from "@/lib/supabase/server";
import { CONTROL_PERIOD_DAYS, loadBpControlRate } from "@/lib/clinical/bp-control-rate-data";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Share of the patient's home readings in their own target over the last 30 days (S07x follow-up). Home readings only, described, never
 * graded or called a diagnosis. Below the existing average gate it shows a count and no figure. A refused or failed read says so: it never
 * reads as "no readings".
 */
export async function BpControlRatePanel({ patientId }: { patientId: string }) {
  const result = await loadBpControlRate(await createClient(), patientId);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("bpcontrol.title")}</CardTitle>
        {result.status === "ok" && (
          <CardDescription>
            {t("bpcontrol.description", "en", { days: CONTROL_PERIOD_DAYS, sys: result.target.systolic, dia: result.target.diastolic })}
          </CardDescription>
        )}
      </CardHeader>
      <CardContent>
        {result.status === "denied" ? (
          <p className="text-sm text-charcoal-ink/60">{t("bpcontrol.denied")}</p>
        ) : result.status === "error" ? (
          <p role="alert" className="text-sm text-red-700">
            {t("bpcontrol.failed")}
          </p>
        ) : result.rate.gateMet ? (
          <p className="text-sm text-charcoal-ink">
            {t("bpcontrol.value", "en", {
              pct: result.rate.percentInTarget ?? 0,
              inTarget: result.rate.inTarget ?? 0,
              total: result.rate.counted,
              days: result.rate.days,
              sys: result.rate.meanSystolic ?? 0,
              dia: result.rate.meanDiastolic ?? 0,
            })}
          </p>
        ) : (
          <p className="text-sm text-charcoal-ink/70">
            {t("bpcontrol.not_enough", "en", { total: result.rate.counted, days: result.rate.days, period: CONTROL_PERIOD_DAYS })}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
