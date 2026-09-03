"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { describeInsight, type CycleInsight } from "@/lib/rules/cycle-insights";
import {
  describeThermalShift,
  THERMAL_SHIFT_DISCLAIMER,
  type ThermalShiftResult,
} from "@/lib/rules/cycle-thermal-shift";
import { PHASE_LABEL } from "@/lib/rules/cycle-prediction";

/**
 * What the logging was for: the app finally saying something back.
 *
 * Patterns are described, never explained. "Cramps: usually around day 1, in
 * every one of your last 6 cycles" is a summary of what she recorded; "your
 * cramps are caused by X" would be a diagnosis, and this card never crosses
 * that line.
 */

const SYMPTOM_LABEL: Record<string, string> = {
  cramps: "Cramps",
  headache: "Headache",
  bloating: "Bloating",
  breast_tenderness: "Sore breasts",
  acne: "Skin breakouts",
  fatigue: "Tiredness",
  nausea: "Nausea",
  back_pain: "Back pain",
  diarrhoea: "Loose stool",
  constipation: "Constipation",
  food_cravings: "Cravings",
  insomnia: "Trouble sleeping",
};

const MOOD_LABEL: Record<string, string> = {
  calm: "Feeling calm",
  happy: "Feeling happy",
  energetic: "Feeling energetic",
  irritable: "Feeling irritable",
  anxious: "Feeling anxious",
  low: "Feeling low",
  mood_swings: "Ups and downs",
};

function labelFor(insight: CycleInsight): string {
  return (
    (insight.kind === "mood" ? MOOD_LABEL[insight.key] : SYMPTOM_LABEL[insight.key]) ??
    insight.key.replace(/_/g, " ")
  );
}

export function CycleInsightsCard({
  insights,
  thermalShift,
  hasAnyLogs,
}: {
  insights: CycleInsight[];
  thermalShift: ThermalShiftResult;
  hasAnyLogs: boolean;
}) {
  const showThermal = thermalShift.reason !== "not_enough_readings" || hasAnyLogs;

  if (insights.length === 0 && !showThermal) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Your patterns over time</CardTitle>
        <CardDescription>
          Built from what you logged, described rather than explained. Worth mentioning at your
          next review if any of it bothers you.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {insights.length > 0 ? (
          <ul className="space-y-2">
            {insights.slice(0, 8).map((insight) => (
              <li key={`${insight.kind}-${insight.key}`} className="flex items-start gap-2">
                <span
                  aria-hidden
                  className="mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-brand-green"
                />
                <span className="text-sm text-charcoal-ink/80">
                  {describeInsight(insight, labelFor(insight))}{" "}
                  <span className="text-charcoal-ink/50">
                    Usually in your {PHASE_LABEL[insight.phase].toLowerCase()}.
                  </span>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-charcoal-ink/70">
            Keep logging how you feel each day. Once the same thing shows up across two or more
            cycles, we can tell you when it usually turns up.
          </p>
        )}

        {showThermal && (
          <div className="rounded-lg bg-warm-ivory p-3">
            <p className="text-[11px] uppercase tracking-wide text-charcoal-ink/50">
              Temperature
            </p>
            <p className="mt-0.5 text-sm text-charcoal-ink/80">
              {describeThermalShift(thermalShift)}
            </p>
            {thermalShift.detected && (
              <p className="mt-1 text-xs text-charcoal-ink/55">{THERMAL_SHIFT_DISCLAIMER}</p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
