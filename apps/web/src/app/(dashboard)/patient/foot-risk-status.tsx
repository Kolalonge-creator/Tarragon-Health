import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const RISK_LABEL: Record<string, { label: string; tone: string }> = {
  low: { label: "Low risk", tone: "text-brand-green" },
  increased: { label: "Increased risk", tone: "text-amber-700" },
  high: { label: "High risk", tone: "text-orange-700" },
  active: { label: "Active problem — under care", tone: "text-red-700" },
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
  const risk = RISK_LABEL[data.risk_class] ?? { label: data.risk_class, tone: "text-charcoal-ink" };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your foot check</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1 text-sm">
        <p>
          Care-team classification: <span className={`font-medium ${risk.tone}`}>{risk.label}</span>
        </p>
        <p className="text-charcoal-ink/60">
          Last checked {new Date(data.assessed_at).toLocaleDateString()}
          {data.next_due_at ? ` · next check due ${new Date(data.next_due_at).toLocaleDateString()}` : ""}
        </p>
        <p className="text-charcoal-ink/60">
          Check your own feet daily and log anything new above — your care team is told straight away.
        </p>
      </CardContent>
    </Card>
  );
}
