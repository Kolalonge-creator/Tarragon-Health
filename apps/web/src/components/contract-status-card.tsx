import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { ContractPerformance } from "@/lib/outcomes-contracts/get-contract-performance";

const CONTRACT_TYPE_LABEL: Record<ContractPerformance["contractType"], string> = {
  fee_at_risk: "Fee-at-risk (outcomes-based)",
  flat: "Flat fee",
};

/** Shared between /dashboard/hmo and /dashboard/corporate — renders nothing if the org has no contract on file. */
export function ContractStatusCard({ performance }: { performance: ContractPerformance | null }) {
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
          Effective {new Date(performance.effectiveFrom).toLocaleDateString()}
          {performance.payoutTerms ? ` · ${performance.payoutTerms}` : ""}
        </CardDescription>
        {performance.thresholds.length > 0 && (
          <ul className="divide-y divide-charcoal-ink/10">
            {performance.thresholds.map((t) => (
              <li key={t.metric} className="flex items-center justify-between py-2 text-sm">
                <span className="text-charcoal-ink">{t.label}</span>
                <span className="flex items-center gap-2">
                  <span className="text-charcoal-ink/60">
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
