import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SectionUnavailable } from "@/components/institution/section-unavailable";
import type { ContractPerformance } from "@/lib/outcomes-contracts/get-contract-performance";

import { formatPatientDate } from "@/lib/format-date";
const CONTRACT_TYPE_LABEL: Record<ContractPerformance["contractType"], string> = {
  fee_at_risk: "Fee-at-risk (outcomes-based)",
  flat: "Flat fee",
};

/** Shared between /dashboard/hmo and /dashboard/corporate — renders nothing if the org has no contract on file, and says so when the read failed. */
export function ContractStatusCard({
  performance,
  failed = false,
}: {
  performance: ContractPerformance | null;
  /** The contract read failed: say so, rather than render nothing as if there were no contract. */
  failed?: boolean;
}) {
  if (failed) return <SectionUnavailable title="Contract status" />;
  if (!performance) return null;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle>Contract status</CardTitle>
        <Badge variant="blue" className="shrink-0">
          {CONTRACT_TYPE_LABEL[performance.contractType]}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-3">
        <CardDescription>
          Effective {formatPatientDate(performance.effectiveFrom)}
          {performance.payoutTerms ? ` · ${performance.payoutTerms}` : ""}
        </CardDescription>
        {performance.thresholds.length > 0 && (
          <ul className="divide-y divide-charcoal-ink/10 dark:divide-night-ink/15">
            {performance.thresholds.map((t) => (
              <li key={t.metric} className="flex items-center justify-between py-2 text-sm">
                <span className="text-charcoal-ink dark:text-night-ink">{t.label}</span>
                <span className="flex items-center gap-2">
                  <span className="text-charcoal-ink/60 dark:text-night-ink/60">
                    {t.actual !== null ? `${t.actual}%` : "—"} / target {t.target}%
                  </span>
                  {t.meetsTarget !== null && (
                    <Badge variant={t.meetsTarget ? "green" : "amber"}>
                      {t.meetsTarget ? "On target" : "Below target"}
                    </Badge>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
