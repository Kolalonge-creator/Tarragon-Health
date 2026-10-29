import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { RESULT_STATUS_BADGE } from "@/lib/worklist/result-status-badge";
import { Disclosure } from "@/components/ui/disclosure";
import { splitRecentResults } from "@/lib/lab-results/fold";
import { EmptyHint } from "@/components/ui/empty-hint";
import type { ScreeningResultStatus } from "@tarragon/shared";

interface StoredInterpretation {
  result_status?: ScreeningResultStatus;
  summary?: string;
}

/**
 * The latest results show; older ones fold. An older result that is not normal (borderline, needs repeat testing, needs follow-up, urgent)
 * is never folded away: it stays in view until the person has dealt with it. Only older normal or unlabelled results fold.
 */
const RECENT = 3;

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", year: "numeric" });
}

/**
 * Patient's own lab result interpretations (ML/clinician verdicts) —
 * previously written by the clinician-side screening-result-form but never
 * shown to the patient. Renders nothing if the patient has no results yet,
 * unless the caller passes `emptyHint` — a page that has already headed this
 * section needs the heading answered rather than left standing over nothing.
 * Does not duplicate VitalsTrendChart's existing HbA1c trend mode.
 */
export async function LabResults({
  patientId,
  emptyHint,
}: {
  patientId: string;
  emptyHint?: string;
}) {
  const supabase = await createClient();

  const { data: results } = await supabase
    .from("lab_result_interpretations")
    .select("id, interpretation, created_at")
    .eq("patient_id", patientId)
    .order("created_at", { ascending: false });

  if (!results || results.length === 0) {
    return emptyHint ? <EmptyHint>{emptyHint}</EmptyHint> : null;
  }

  const { shown, folded } = splitRecentResults(results, (r) => (r.interpretation as StoredInterpretation | null)?.result_status, RECENT);

  const renderRow = (result: (typeof results)[number]) => {
    const interpretation = result.interpretation as StoredInterpretation | null;
    const badge = interpretation?.result_status ? RESULT_STATUS_BADGE[interpretation.result_status] : null;
    return (
      <div
        key={result.id}
        className="space-y-1 border-b border-charcoal-ink/10 dark:border-night-ink/15 pb-4 last:border-0 last:pb-0"
      >
        <div className="flex items-baseline justify-between gap-2">
          {badge ? <Badge variant={badge.variant}>{badge.label}</Badge> : <span />}
          <p className="shrink-0 text-xs text-charcoal-ink/50 dark:text-night-ink/55">{formatDate(result.created_at)}</p>
        </div>
        <p className="text-sm text-charcoal-ink dark:text-night-ink">
          {interpretation?.summary ?? "Results available, ask your care team for details."}
        </p>
      </div>
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your lab results</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {shown.map(renderRow)}
        {folded.length > 0 && (
          <Disclosure title={`Earlier results (${folded.length})`}>
            {folded.map(renderRow)}
          </Disclosure>
        )}
      </CardContent>
    </Card>
  );
}
