import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

function pct(n: number | null, d: number | null): string {
  if (!d || d === 0) return "—";
  return `${Math.round(((n ?? 0) / d) * 100)}%`;
}

/**
 * Diabetes clinical-audit KPIs (§24) for the Clinical Director — the evidence
 * engine that proves clinical quality. Reads the security_invoker
 * diabetes_quality_metrics view, so a clinician only ever sees their own org's
 * aggregate. Targets are the pathway's launch KPIs.
 */
export default async function DiabetesQualityPage() {
  const supabase = await createClient();
  const { data } = await supabase.from("diabetes_quality_metrics").select("*").maybeSingle();

  const total = data?.diabetic_patients ?? 0;

  const rows = [
    { label: "Up-to-date foot-risk classification", value: pct(data?.foot_uptodate ?? 0, total), target: "≥ 95%" },
    { label: "Eye (retinal) screening current", value: pct(data?.retinal_uptodate ?? 0, total), target: "≥ 90%" },
    { label: "Renal (eGFR + ACR) check current", value: pct(data?.renal_uptodate ?? 0, total), target: "≥ 90%" },
    { label: "Individual glucose target set", value: pct(data?.target_set ?? 0, total), target: "100%" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Diabetes quality metrics</h1>
        <p className="text-charcoal-ink/60">
          Complication-prevention KPIs (§24) across {total} patient{total === 1 ? "" : "s"} on an active
          diabetes care plan in your organisation.
        </p>
      </div>

      {total === 0 ? (
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-charcoal-ink/60">
              No patients on an active diabetes care plan yet — metrics appear once patients are
              enrolled and complication checks are recorded.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {rows.map((r) => (
            <Card key={r.label}>
              <CardHeader>
                <CardTitle className="text-base">{r.label}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-semibold text-deep-forest">{r.value}</p>
                <p className="text-xs text-charcoal-ink/60">Target {r.target}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      <p className="text-xs text-charcoal-ink/50">
        HbA1c-at-target and severe-hypo/DKA event rates are tracked separately as the lab-value and
        alert pipelines mature — this view covers the complication-surveillance KPIs.
      </p>
    </div>
  );
}
