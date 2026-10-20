"use client";

import { t } from "@tarragon/i18n";
import { activityGateMessageKey } from "@tarragon/clinical/activity-gate";
import { useActivityGate } from "@/lib/queries/activity-gate";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

/**
 * What the activity safety gate says right now, in care-team words. It never names a reading, a condition or a pregnancy. Colour is always paired
 * with a word (Rest, Gentle only, All clear) so it does not depend on colour alone. No fear language: this is advice, not an alarm.
 */
export function ActivityGateBanner() {
  const q = useActivityGate();
  if (q.isLoading) return null;
  const answer = q.data;
  // The query only ever resolves to an answer (fail-closed on error), but guard anyway: say nothing rather than something permissive.
  if (!answer) return null;
  const { gate, unavailable } = answer;
  if (gate.decision === "allow") return null;

  const label = gate.decision === "rest" ? "Rest" : "Gentle only";
  const text = unavailable ? t("activity.gate.unavailable") : t(activityGateMessageKey(gate));
  return (
    <Card role="status" aria-live="polite">
      <CardContent className="flex items-start gap-3 pt-6">
        <Badge variant={gate.decision === "rest" ? "blue" : "amber"}>{label}</Badge>
        <p className="text-sm text-charcoal-ink dark:text-night-ink">{text}</p>
      </CardContent>
    </Card>
  );
}
