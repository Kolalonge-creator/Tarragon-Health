import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import type { ScreeningResultStatus } from "@tarragon/shared";

const RESULT_STATUS_BADGE: Record<ScreeningResultStatus, { variant: BadgeProps["variant"]; label: string }> = {
  normal: { variant: "green", label: "Normal" },
  borderline: { variant: "amber", label: "Borderline" },
  abnormal: { variant: "amber", label: "Needs follow-up" },
  critical: { variant: "red", label: "Needs urgent follow-up" },
};

interface StoredInterpretation {
  result_status?: ScreeningResultStatus;
  summary?: string;
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/**
 * Patient's own lab result interpretations (ML/clinician verdicts) —
 * previously written by the clinician-side screening-result-form but never
 * shown to the patient. Renders nothing if the patient has no results yet.
 * Does not duplicate VitalsTrendChart's existing HbA1c trend mode.
 */
export async function LabResults({ patientId }: { patientId: string }) {
  const supabase = await createClient();

  const { data: results } = await supabase
    .from("lab_result_interpretations")
    .select("id, interpretation, created_at")
    .eq("patient_id", patientId)
    .order("created_at", { ascending: false });

  if (!results || results.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your lab results</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {results.map((result) => {
          const interpretation = result.interpretation as StoredInterpretation | null;
          const badge = interpretation?.result_status ? RESULT_STATUS_BADGE[interpretation.result_status] : null;
          return (
            <div
              key={result.id}
              className="space-y-1 border-b border-charcoal-ink/10 pb-4 last:border-0 last:pb-0"
            >
              <div className="flex items-baseline justify-between gap-2">
                {badge ? <Badge variant={badge.variant}>{badge.label}</Badge> : <span />}
                <p className="shrink-0 text-xs text-charcoal-ink/50">{formatDate(result.created_at)}</p>
              </div>
              <p className="text-sm text-charcoal-ink">
                {interpretation?.summary ?? "Results available — ask your care team for details."}
              </p>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
