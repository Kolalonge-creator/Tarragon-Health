import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { ContractPerformance } from "@/lib/outcomes-contracts/get-contract-performance";

const CONTRACT_TYPE_LABEL: Record<ContractPerformance["contractType"], string> = {
  capitation: "Capitation",
  fee_at_risk: "Fee-at-risk (outcomes-based)",
  flat: "Flat fee",
};

/** Shared between /dashboard/hmo and /dashboard/corporate — renders nothing if the org has no contract on file. */
export function ContractStatusCard({ performance }: { performance: ContractPerformance | null }) {
  if (!performance) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Contract status</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-charcoal-ink">
          <span className="font-medium">{CONTRACT_TYPE_LABEL[performance.contractType]}</span>
          <span className="text-charcoal-ink/60">
            {" "}
            · effective {new Date(performance.effectiveFrom).toLocaleDateString()}
          </span>
        </p>
        {performance.payoutTerms && (
          <p className="text-sm text-charcoal-ink/70">{performance.payoutTerms}</p>
        )}
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
