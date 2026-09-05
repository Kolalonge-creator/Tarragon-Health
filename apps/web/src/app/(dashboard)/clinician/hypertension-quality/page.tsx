import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LoadFailure } from "@/components/ui/load-failure";

function pct(n: number | null, d: number | null): string {
  if (!d || d === 0) return "—";
  return `${Math.round(((n ?? 0) / d) * 100)}%`;
}

/**
 * Hypertension clinical-audit KPIs (docs spec §88.12) — same shape as
 * diabetes-quality (diabetes_quality_metrics), reading the new
 * hypertension_quality_metrics security_invoker view.
 */
export default async function HypertensionQualityPage() {
  const supabase = await createClient();
  const { data, error } = await supabase.from("hypertension_quality_metrics").select("*").maybeSingle();

  const total = data?.hypertensive_patients ?? 0;

  const rows = [
    { label: "BP target set", value: pct(data?.target_set ?? 0, total), target: "100%" },
    { label: "At individual BP target", value: pct(data?.at_target ?? 0, total), target: "" },
    { label: "Reading within last 30 days", value: pct(data?.reading_within_30d ?? 0, total), target: "≥ 90%" },
  ];

  const eventRows = [
    {
      label: "Severe (hypertensive-crisis) events (90 days)",
      value: String(data?.severe_events_90d ?? 0),
      note:
        data?.severe_events_per_100_patients != null
          ? `${data.severe_events_per_100_patients} per 100 patients`
          : "—",
    },
    {
      label: "Avg. time from BP flag to doctor contact",
      value:
        data?.avg_bp_flag_to_contact_hours != null
          ? `${data.avg_bp_flag_to_contact_hours} h`
          : "No acknowledged flags yet",
      note: "Last 90 days",
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Hypertension quality metrics</h1>
        <p className="text-charcoal-ink/60">
          {error ? (
            "Complication-prevention KPIs for patients on an active hypertension care plan in your organisation."
          ) : (
            <>
              Complication-prevention KPIs across {total} patient{total === 1 ? "" : "s"} on an
              active hypertension care plan in your organisation.
            </>
          )}
        </p>
      </div>

      {/* Same failure as the diabetes board: a failed view read left `total`
          at 0 and printed "No patients on an active hypertension care plan
          yet", which is a clinical audit surface claiming a clean denominator
          it never read. Percent-at-target and flag-to-contact time would both
          have rendered as zero. */}
      {error ? (
        <LoadFailure>
          These quality metrics could not be loaded. Nothing on this page can be read as a score,
          and the missing figures are not zero. Reload the page, and if it keeps failing, raise it
          with the platform team before drawing any conclusion about BP control.
        </LoadFailure>
      ) : total === 0 ? (
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-charcoal-ink/60">
              No patients on an active hypertension care plan yet. Metrics appear once patients are
              enrolled and BP readings are recorded.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            {rows.map((r) => (
              <Card key={r.label}>
                <CardHeader>
                  <CardTitle className="text-base">{r.label}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-3xl font-semibold text-deep-forest">{r.value}</p>
                  {r.target && <p className="text-xs text-charcoal-ink/60">Target {r.target}</p>}
                </CardContent>
              </Card>
            ))}
          </div>

          <div>
            <h2 className="font-heading text-lg font-semibold text-charcoal-ink">
              Safety events (last 90 days)
            </h2>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              {eventRows.map((r) => (
                <Card key={r.label}>
                  <CardHeader>
                    <CardTitle className="text-base">{r.label}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-3xl font-semibold text-deep-forest">{r.value}</p>
                    <p className="text-xs text-charcoal-ink/60">{r.note}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
