import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatTile } from "@/components/ui/stat-tile";
import { SEMANTIC_ICON } from "@/lib/icons";
import { koboToNaira, CURRENCY_SYMBOL } from "@tarragon/shared";
import type { CostAvoidedEstimate } from "@/lib/care-gaps/estimate-cost-avoided";
import { CARE_GAP_ESTIMATE_DISCLAIMER } from "@/lib/care-gaps/estimate-cost-avoided";

/**
 * Outcome reporting for renewal conversations (docs/Tarragon_Health_Master_Operating_Plan_v4.md
 * §13 — "outcome reporting"). This is a MODELED estimate, never a real
 * claims-integration feed — the disclaimer must always render alongside
 * the figure, never a bare currency amount (CLAUDE.md's no-overclaiming rule).
 */
export function ClaimsImpactCard({ estimate }: { estimate: CostAvoidedEstimate | null }) {
  if (!estimate) return null;

  const formatted = `${CURRENCY_SYMBOL.NGN}${koboToNaira(estimate.estimatedKobo).toLocaleString()}`;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SEMANTIC_ICON.labs className="h-5 w-5 text-deep-forest" strokeWidth={2} />
          Claims impact
        </CardTitle>
        <CardDescription>{CARE_GAP_ESTIMATE_DISCLAIMER}</CardDescription>
      </CardHeader>
      <CardContent>
        <StatTile icon={SEMANTIC_ICON.labs} label="Estimated cost avoided" value={formatted} />
      </CardContent>
    </Card>
  );
}
