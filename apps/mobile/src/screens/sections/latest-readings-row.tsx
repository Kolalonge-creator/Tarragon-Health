import { useEffect, useState } from "react";
import { View } from "react-native";
import { HOME_PIN_ICON } from "@/lib/home-pin-targets";
import { useGlucoseDisplayUnit } from "@/lib/glucose-unit";
import { LATEST_ROW_KEYS, latestReadingContent } from "@/lib/latest-readings";
import { useMeasurementUnits } from "@/lib/measurement-units";
import { loadPinSeries, type PinSeriesMap } from "@/lib/reading-series";
import { space } from "@/ui/design";
import { BigNumberTile } from "@/ui/big-number-tile";

/** The clock and the reads stay outside the component (react-hooks/purity). A thrown read marks every tile failed. */
async function loadRow(subjectId: string): Promise<{ nowMs: number; series: PinSeriesMap }> {
  const nowMs = Date.now();
  try {
    return { nowMs, series: await loadPinSeries(subjectId, LATEST_ROW_KEYS, nowMs) };
  } catch {
    return { nowMs, series: { glucose: "failed", weight: "failed", pulse: "failed" } };
  }
}

/**
 * Vitals opens with the latest readings as big numbers (founder, 2026-11-06, the phone twin of the web row). Blood pressure keeps its
 * own larger card above this row; this row adds blood sugar, weight and pulse, each with when it was taken, which way it has moved
 * this month in words, and a 30-day trend line. A failed read says so. `reloadToken` re-reads after a reading is saved.
 */
export function LatestReadingsRow({ subjectId, reloadToken }: { subjectId: string; reloadToken: number }) {
  const glucoseUnit = useGlucoseDisplayUnit();
  const units = useMeasurementUnits();
  const [state, setState] = useState<{ nowMs: number; series: PinSeriesMap } | null>(null);

  useEffect(() => {
    let live = true;
    void loadRow(subjectId).then((next) => {
      if (live) setState(next);
    });
    return () => {
      live = false;
    };
  }, [subjectId, reloadToken]);

  return (
    <View accessibilityLabel="Your latest readings" style={{ gap: space.md }}>
      {LATEST_ROW_KEYS.map((key) => {
        const c = latestReadingContent(key, state?.series[key], glucoseUnit, units, state?.nowMs ?? 0);
        return <BigNumberTile key={key} icon={HOME_PIN_ICON[key]} label={c.label} value={c.value} unit={c.unit} empty={c.empty} detail={c.detail} points={c.points} />;
      })}
    </View>
  );
}
