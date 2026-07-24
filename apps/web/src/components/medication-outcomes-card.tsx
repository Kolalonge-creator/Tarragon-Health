import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatTile } from "@/components/ui/stat-tile";
import { SEMANTIC_ICON } from "@/lib/icons";
import {
  MEDICATION_OUTCOMES_DISCLAIMER,
  type MedicationOutcomesSummary,
} from "@/lib/outcomes/medication-outcomes";

/**
 * De-prescribing + control evidence for the B2B dashboards (the Virta
 * outcome-language borrow). Renders nothing with no data — no invented zeros
 * paraded as evidence.
 */
export function MedicationOutcomesCard({
  outcomes,
}: {
  outcomes: MedicationOutcomesSummary | null;
}) {
  if (!outcomes) return null;
  const hasAnything =
    outcomes.medsStoppedLast180Days > 0 || outcomes.bpMonitoredCount > 0;
  if (!hasAnything) return null;

  const inRangePercent =
    outcomes.bpMonitoredCount > 0
      ? Math.round((outcomes.bpInRangeCount / outcomes.bpMonitoredCount) * 100)
      : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SEMANTIC_ICON.medication className="h-5 w-5 text-deep-forest" strokeWidth={2} />
          Medication &amp; control outcomes
        </CardTitle>
        <CardDescription>
          What managed care changes on the ground — medicines safely reduced, numbers back
          in range.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <StatTile
            icon={SEMANTIC_ICON.medication}
            label="Medications stopped by a doctor (180 days)"
            value={String(outcomes.medsStoppedLast180Days)}
            unit={
              outcomes.patientsWithStops > 0
                ? `across ${outcomes.patientsWithStops} member${outcomes.patientsWithStops === 1 ? "" : "s"}`
                : undefined
            }
          />
          {inRangePercent !== null && (
            <StatTile
              icon={SEMANTIC_ICON.bp}
              label="Members in BP range at latest check"
              value={`${inRangePercent}%`}
              unit={`of ${outcomes.bpMonitoredCount} monitored`}
            />
          )}
        </div>
        <p className="text-xs text-charcoal-ink/50">{MEDICATION_OUTCOMES_DISCLAIMER}</p>
      </CardContent>
    </Card>
  );
}
