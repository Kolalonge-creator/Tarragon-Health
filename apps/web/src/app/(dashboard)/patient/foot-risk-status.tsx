import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { formatPatientDate } from "@/lib/format-date";
const RISK_LABEL: Record<string, { label: string; tone: string }> = {
  low: { label: "Low risk", tone: "text-brand-green dark:text-brand-green-bright" },
  increased: { label: "Increased risk", tone: "text-amber-700 dark:text-amber-300" },
  high: { label: "High risk", tone: "text-orange-700 dark:text-orange-300" },
  active: { label: "Active problem, under care", tone: "text-red-700 dark:text-red-300" },
};

/**
 * Patient-facing view of their latest diabetic foot-risk classification.
 * Null-gated — renders nothing until a clinician has actually recorded an
 * assessment, so it never implies a check that didn't happen (§18.1).
 */
export async function FootRiskStatus({ patientId }: { patientId: string }) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("diabetic_foot_assessments")
    .select("risk_class, assessed_at, next_due_at")
    .eq("patient_id", patientId)
    .order("assessed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return null;
  const risk = RISK_LABEL[data.risk_class] ?? { label: data.risk_class, tone: "text-charcoal-ink dark:text-night-ink" };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your foot check</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1 text-sm">
        <p>
          Care-team classification: <span className={`font-medium ${risk.tone}`}>{risk.label}</span>
        </p>
        <p className="text-charcoal-ink/60 dark:text-night-ink/60">
          Last checked {formatPatientDate(data.assessed_at)}
          {data.next_due_at ? ` · next check due ${formatPatientDate(data.next_due_at)}` : ""}
        </p>
        <p className="text-charcoal-ink/60 dark:text-night-ink/60">
          Check your own feet daily and log anything new above; your care team is told straight away.
        </p>
      </CardContent>
    </Card>
  );
}
