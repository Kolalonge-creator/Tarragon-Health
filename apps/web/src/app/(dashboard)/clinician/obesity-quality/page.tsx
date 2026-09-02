import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

function pct(n: number | null, d: number | null): string {
  if (!d || d === 0) return "—";
  return `${Math.round(((n ?? 0) / d) * 100)}%`;
}

/**
 * Obesity/lifestyle-programme clinical-audit KPIs (docs spec §88.12) — same
 * shape as diabetes-quality, reading the new obesity_quality_metrics
 * security_invoker view.
 */
export default async function ObesityQualityPage() {
  const supabase = await createClient();
  const { data } = await supabase.from("obesity_quality_metrics").select("*").maybeSingle();

  const total = data?.obesity_patients ?? 0;

  const rows = [
    { label: "Weight goal set", value: pct(data?.weight_goal_set ?? 0, total), target: "100%" },
    { label: "Actively engaged in programme", value: pct(data?.actively_engaged ?? 0, total), target: "" },
    {
      label: "ED/mental-health screen current and clear",
      value: pct(data?.ed_screen_current_and_clear ?? 0, total),
      target: "≥ 90%",
    },
  ];

  const eventRows = [
    {
      label: "Red-flag events (90 days)",
      value: String(data?.red_flag_events_90d ?? 0),
      note:
        data?.red_flag_events_per_100_patients != null
          ? `${data.red_flag_events_per_100_patients} per 100 patients`
          : "—",
    },
    {
      label: "Avg. time from red flag to doctor contact",
      value:
        data?.avg_red_flag_to_contact_hours != null
          ? `${data.avg_red_flag_to_contact_hours} h`
          : "No acknowledged flags yet",
      note: "Last 90 days",
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Obesity quality metrics</h1>
        <p className="text-charcoal-ink/60">
          Complication-prevention KPIs across {total} patient{total === 1 ? "" : "s"} on an active
          obesity care plan or lifestyle-programme enrolment in your organisation.
        </p>
      </div>

      {total === 0 ? (
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-charcoal-ink/60">
              No patients on an active obesity care plan or lifestyle programme yet. Metrics appear
              once patients are enrolled.
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
