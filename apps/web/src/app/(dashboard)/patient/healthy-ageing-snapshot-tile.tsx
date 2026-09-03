import { createClient } from "@/lib/supabase/server";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  loadCoordinatedCareSummary,
  loadLatestAgeingAssessment,
  loadOpenFallsRisk,
  missingDomains,
} from "@/lib/healthy-ageing/loaders";
import { FALLS_RISK_LEVEL_LABEL } from "@/lib/healthy-ageing/types";

const FALLS_BADGE_VARIANT = { low: "green", moderate: "amber", high: "red" } as const;

/** The "YOUR HEALTH" snapshot from spec §50.2 — a scan-friendly stat grid,
 * not a new record: every number here is read from data that already lives
 * elsewhere (patient_conditions, medications, this module's own tables). */
export async function HealthyAgeingSnapshotTile({ patientId }: { patientId: string }) {
  const supabase = await createClient();
  const [summary, assessment, fallsRisk] = await Promise.all([
    loadCoordinatedCareSummary(supabase, patientId),
    loadLatestAgeingAssessment(supabase, patientId),
    loadOpenFallsRisk(supabase, patientId),
  ]);

  const missing = missingDomains(assessment);
  const checkInComplete = assessment?.status === "completed";

  return (
    <Card>
      <CardContent className="grid grid-cols-2 gap-4 p-6 sm:grid-cols-4">
        <Stat label="Conditions" value={`${summary.activeConditionCount} active`} />
        <Stat
          label="Medications"
          value={`${summary.activeMedicationCount} medicine${summary.activeMedicationCount === 1 ? "" : "s"}`}
          badge={summary.isPolypharmacy ? { text: "Polypharmacy", variant: "amber" } : undefined}
        />
        <Stat
          label="Falls risk"
          value={fallsRisk ? FALLS_RISK_LEVEL_LABEL[fallsRisk.riskLevel ?? "low"] : "Not checked"}
          badge={fallsRisk ? { text: FALLS_RISK_LEVEL_LABEL[fallsRisk.riskLevel ?? "low"], variant: FALLS_BADGE_VARIANT[fallsRisk.riskLevel ?? "low"] } : undefined}
        />
        <Stat
          label="Check-in"
          value={checkInComplete ? "Up to date" : missing.length === 9 ? "Not started" : `${9 - missing.length}/9 sections`}
        />
      </CardContent>
    </Card>
  );
}

function Stat({
  label,
  value,
  badge,
}: {
  label: string;
  value: string;
  badge?: { text: string; variant: "red" | "amber" | "green" | "blue" | "grey" };
}) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium uppercase tracking-wide text-charcoal-ink/50 dark:text-night-ink/55">{label}</p>
      <p className="font-heading text-lg font-semibold text-charcoal-ink dark:text-night-ink">{value}</p>
      {badge && <Badge variant={badge.variant}>{badge.text}</Badge>}
    </div>
  );
}
