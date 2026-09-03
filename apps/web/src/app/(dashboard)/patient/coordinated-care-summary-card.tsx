import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { loadCoordinatedCareSummary } from "@/lib/healthy-ageing/loaders";

/**
 * Spec §50.9: multiple conditions -> one coordinated view -> prioritised
 * actions, instead of four unrelated dashboards. This never re-fetches or
 * duplicates a condition's own care plan; it only turns what already exists
 * into one ranked list. Self-hides when there's genuinely nothing to
 * coordinate (no active conditions and no flagged actions).
 */
export async function CoordinatedCareSummaryCard({ patientId }: { patientId: string }) {
  const supabase = await createClient();
  const summary = await loadCoordinatedCareSummary(supabase, patientId);

  if (summary.activeConditionCount === 0 && summary.actions.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Coordinated care</CardTitle>
        <CardDescription>
          {summary.activeConditionCount > 1
            ? `${summary.activeConditionCount} conditions being managed together: one view, not ${summary.activeConditionCount} separate ones.`
            : "What's active across your care right now."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {summary.actions.length === 0 ? (
          <p className="text-sm text-charcoal-ink/60">Nothing needs attention right now.</p>
        ) : (
          <ul className="space-y-2">
            {summary.actions.map((action) => (
              <li key={action.key} className="rounded-lg border border-charcoal-ink/10 p-3">
                <p className="text-sm font-medium text-charcoal-ink">{action.label}</p>
                <p className="mt-0.5 text-xs text-charcoal-ink/60">{action.detail}</p>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
