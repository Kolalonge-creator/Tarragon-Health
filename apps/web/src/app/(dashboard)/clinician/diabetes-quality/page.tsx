import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LoadFailure } from "@/components/ui/load-failure";

function pct(n: number | null, d: number | null): string {
  if (!d || d === 0) return "—";
  return `${Math.round(((n ?? 0) / d) * 100)}%`;
}

/**
 * Diabetes clinical-audit KPIs (§24) for the Clinical Director — the evidence
 * engine that proves clinical quality. Reads the security_invoker
 * diabetes_quality_metrics view, so a clinician only ever sees their own org's
 * aggregate. Targets are the pathway's launch KPIs.
 *
 * HbA1c-at-target, severe-hypo/DKA event rate, and average flag-to-contact
 * time were added to the view 2026-08-10 (previously tracked "separately, as
 * the lab-value and alert pipelines mature" — both pipelines are live now:
 * lab_analyte_readings has real hba1c values via lab-report extraction, and
 * the glucose red-flag engine (assess-glucose.ts) has raised real
 * clinician_alerts / emergency_events since 2026-07-20).
 */
export default async function DiabetesQualityPage() {
  const supabase = await createClient();
  const { data, error } = await supabase.from("diabetes_quality_metrics").select("*").maybeSingle();

  const total = data?.diabetic_patients ?? 0;

  const rows = [
    { label: "Up-to-date foot-risk classification", value: pct(data?.foot_uptodate ?? 0, total), target: "≥ 95%" },
    { label: "Eye (retinal) screening current", value: pct(data?.retinal_uptodate ?? 0, total), target: "≥ 90%" },
    { label: "Renal (eGFR + ACR) check current", value: pct(data?.renal_uptodate ?? 0, total), target: "≥ 90%" },
    {
      label: "Complete annual complication screen",
      value: pct(data?.complete_complication_screen ?? 0, total),
      target: "≥ 90%",
    },
    { label: "Individual glucose target set", value: pct(data?.target_set ?? 0, total), target: "100%" },
    { label: "At individual HbA1c target", value: pct(data?.hba1c_at_target ?? 0, total), target: "" },
  ];

  const eventRows = [
    {
      label: "Severe hypo / DKA events (90 days)",
      value: String(data?.severe_hypo_dka_events_90d ?? 0),
      note:
        data?.severe_hypo_dka_per_100_patients != null
          ? `${data.severe_hypo_dka_per_100_patients} per 100 patients`
          : "—",
    },
    {
      label: "Avg. time from glucose flag to doctor contact",
      value:
        data?.avg_glucose_flag_to_contact_hours != null
          ? `${data.avg_glucose_flag_to_contact_hours} h`
          : "No acknowledged flags yet",
      note: "Urgent target ≤ 24h, routine ≤ 72h (last 90 days)",
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Diabetes quality metrics</h1>
        <p className="text-charcoal-ink/60">
          {error ? (
            "Complication-prevention KPIs (§24) for patients on an active diabetes care plan in your organisation."
          ) : (
            <>
              Complication-prevention KPIs (§24) across {total} patient{total === 1 ? "" : "s"} on an
              active diabetes care plan in your organisation.
            </>
          )}
        </p>
      </div>

      {/* The view read is a single maybeSingle(), so a failure left `data`
          null, `total` 0, and the page rendering "No patients on an active
          diabetes care plan yet." That is a clinical audit board reporting a
          clear denominator it never actually read: every complication-screening
          percentage silently becomes zero, and the Clinical Director reading it
          has no way to tell an unenrolled cohort from an unread one. */}
      {error ? (
        <LoadFailure>
          These quality metrics could not be loaded. Nothing on this page can be read as a score,
          and the missing figures are not zero. Reload the page, and if it keeps failing, raise it
          with the platform team before drawing any conclusion about complication screening.
        </LoadFailure>
      ) : total === 0 ? (
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-charcoal-ink/60">
              No patients on an active diabetes care plan yet. Metrics appear once patients are
              enrolled and complication checks are recorded.
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
