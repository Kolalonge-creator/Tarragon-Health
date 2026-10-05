import { useMemo } from "react";
import { buildTrendInsights, type TrendInsights } from "./bp-trend-insights";
import type { TrendWindowDays } from "./bp-trend";
import { loadAverageGate, loadHomeProtocol, loadStartingSuggestionTarget, loadTrendDisplay } from "./s07-config";
import { useBpTarget } from "./use-bp-target";
import type { BpReading } from "./vitals";

// Versioned S07 values (averaging gate, chart minimum, protocol gap). Read once.
const PROTOCOL = loadHomeProtocol();
const GATE = loadAverageGate();
const DISPLAY = loadTrendDisplay();
const SUGGESTION = loadStartingSuggestionTarget();

export const MIN_READINGS_FOR_CHART = DISPLAY.minReadingsForChart;

/**
 * What the trends card needs, for the readings already loaded on the Vitals
 * screen. Loads the care team's target itself and recomputes when the readings,
 * the window or the target change.
 */
export function useTrendInsights(patientId: string, readings: readonly BpReading[], nowMs: number, windowDays: TrendWindowDays): TrendInsights {
  const personal = useBpTarget(patientId);
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
        suggestion: SUGGESTION,
      }),
    [readings, nowMs, windowDays, personal],
  );
}
