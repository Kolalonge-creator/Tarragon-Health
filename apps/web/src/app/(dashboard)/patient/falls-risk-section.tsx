import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { loadOpenFallsRisk } from "@/lib/healthy-ageing/loaders";
import { FALLS_PATHWAY_STAGE_LABEL, FALLS_RISK_LEVEL_LABEL } from "@/lib/healthy-ageing/types";
import { FallsRiskForm } from "./falls-risk-form";

const LEVEL_BADGE_VARIANT = { low: "green", moderate: "amber", high: "red" } as const;

/** Falls-risk pathway (spec §50.4): Risk identified -> Clinical assessment ->
 * Intervention -> Follow-up. A patient/caregiver can only ever start it —
 * every later stage is clinical work done from the care-team side. */
export async function FallsRiskSection({ patientId }: { patientId: string }) {
  const supabase = await createClient();
  const open = await loadOpenFallsRisk(supabase, patientId);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Falls risk</CardTitle>
        <CardDescription>A few quick questions to flag anything worth a closer look.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {open ? (
          <div className="flex items-center justify-between rounded-lg border border-charcoal-ink/10 p-3">
            <div>
              <p className="text-sm font-medium text-charcoal-ink">
                {FALLS_PATHWAY_STAGE_LABEL[open.pathwayStage]}
              </p>
              <p className="mt-0.5 text-xs text-charcoal-ink/60">
                Flagged {new Date(open.identifiedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
              </p>
            </div>
            {open.riskLevel && (
              <Badge variant={LEVEL_BADGE_VARIANT[open.riskLevel]}>{FALLS_RISK_LEVEL_LABEL[open.riskLevel]}</Badge>
            )}
          </div>
        ) : (
          <FallsRiskForm />
        )}
      </CardContent>
    </Card>
  );
}
