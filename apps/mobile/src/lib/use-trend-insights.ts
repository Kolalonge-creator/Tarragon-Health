import { useMemo } from "react";
import { buildTrendInsights, type TrendInsights } from "./bp-trend-insights";
import type { TrendWindowDays } from "./bp-trend";
import { loadAverageGate, loadHomeProtocol, loadStartingSuggestionTarget, loadTrendDisplay, suggestionForAge } from "./s07-config";
import { usePatientAge } from "./use-patient-age";
import { useBpTarget } from "./use-bp-target";
import type { BpReading } from "./vitals";

// Versioned S07 values (averaging gate, chart minimum, protocol gap). Read once.
const PROTOCOL = loadHomeProtocol();
const GATE = loadAverageGate();
const DISPLAY = loadTrendDisplay();
const SUGGESTION_BASE = loadStartingSuggestionTarget();

export const MIN_READINGS_FOR_CHART = DISPLAY.minReadingsForChart;

/**
 * What the trends card needs, for the readings already loaded on the Vitals
 * screen. Loads the care team's target itself and recomputes when the readings,
 * the window or the target change.
 */
export function useTrendInsights(patientId: string, readings: readonly BpReading[], nowMs: number, windowDays: TrendWindowDays): TrendInsights {
  const personal = useBpTarget(patientId);
  const age = usePatientAge(patientId, nowMs);
  const suggestion = useMemo(() => suggestionForAge(SUGGESTION_BASE, age), [age]);
  return useMemo(
    () =>
      buildTrendInsights({
        readings,
        nowMs,
        windowDays,
        personal,
        protocol: PROTOCOL,
        gate: GATE,
        display: DISPLAY,
        suggestion,
      }),
    [readings, nowMs, windowDays, personal],
  );
}
