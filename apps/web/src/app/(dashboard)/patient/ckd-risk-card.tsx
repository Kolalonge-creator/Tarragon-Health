import Link from "next/link";
import type { Enums } from "@tarragon/shared";
import type { EgfrWithProvenance } from "@/lib/rules/egfr";
import type { KdigoRiskResult } from "@/lib/rules/kdigo-ckd-risk";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SEMANTIC_ICON } from "@/lib/icons";

// Same dashboard-status system as RiskAssessmentDisplay's TIER_BADGE — grey
// reads as "not assessed", never as reassuring.
const RISK_BADGE: Record<Enums<"risk_level">, "green" | "amber" | "red" | "grey"> = {
  low: "green",
  moderate: "amber",
  high: "red",
  very_high: "red",
  unknown: "grey",
};

const RISK_LABEL: Record<Enums<"risk_level">, string> = {
  low: "Low",
  moderate: "Moderate",
  high: "High",
  very_high: "Very high",
  unknown: "Unknown",
};

/**
 * Kidney (CKD) risk — the KDIGO 2012 GFR × albuminuria grid
 * (kdigo-ckd-risk.ts), the same calculation the clinician view uses
 * (patient-clinical-context.ts), computed here from the patient's own
 * creatinine and urine ACR results. Unlike FINDRISC/the heart-disease check,
 * this one can't be answered from memory — it needs real lab numbers — so
 * this card is a read of the patient's own record, not a questionnaire, and
 * points them at booking the missing test rather than asking them to guess.
 */
export function CkdRiskCard({
  egfr,
  egfrUnavailableReason,
  ckdRisk,
  ckdRiskUnavailableReason,
}: {
  egfr: EgfrWithProvenance | null;
  egfrUnavailableReason: string | null;
  ckdRisk: KdigoRiskResult | null;
  ckdRiskUnavailableReason: string | null;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SEMANTIC_ICON.labs className="h-5 w-5 text-deep-forest dark:text-brand-green-bright" strokeWidth={2} aria-hidden />
          Kidney disease risk
        </CardTitle>
      </CardHeader>
      <CardContent>
        {ckdRisk ? (
          <div className="space-y-2 text-sm">
            <div className="flex items-center gap-2">
              <span className="font-medium text-charcoal-ink dark:text-night-ink">Combined risk</span>
              <Badge variant={RISK_BADGE[ckdRisk.riskLevel]}>{RISK_LABEL[ckdRisk.riskLevel]}</Badge>
            </div>
            <p className="text-charcoal-ink/70 dark:text-night-ink/70">
              Kidney function: {egfr?.categoryLabel} (eGFR {egfr?.egfr}). Urine protein:{" "}
              {ckdRisk.acrCategoryLabel}.
            </p>
            {ckdRisk.invisibleToEgfrAlone && (
              <p className="text-charcoal-ink/70 dark:text-night-ink/70">
                Your kidney function alone looked reassuring — this risk only shows up when combined
                with your urine protein result, which is why both tests matter together.
              </p>
            )}
            {egfr?.stale && (
              <p className="text-amber-700 dark:text-amber-300">
                These results are over a year old — a fresh test would give a more current picture.
              </p>
            )}
            <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
              Based on your most recent kidney function and urine protein results, not a diagnosis —
              your care team reviews what this means for you.
            </p>
          </div>
        ) : (
          <div className="space-y-2 text-sm">
            <p className="text-charcoal-ink/70 dark:text-night-ink/70">
              {ckdRiskUnavailableReason ?? egfrUnavailableReason}
            </p>
            <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
              You can book a kidney function panel (creatinine and urine ACR) from{" "}
              <Link href="/patient/labs" className="font-medium text-deep-forest dark:text-brand-green-bright hover:underline">
                the labs section
              </Link>
              .
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
