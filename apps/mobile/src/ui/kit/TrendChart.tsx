import { useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import { Canvas, Circle, DashPathEffect, Line, Path, Skia } from "@shopify/react-native-skia";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { runOnJS, useSharedValue, withTiming } from "react-native-reanimated";
import { buildTrendModel, nearestPointIndex, type TrendModel } from "@/lib/bp-trend";
import type { BpThresholds } from "@/lib/bp-classification";
import type { TrendWindowDays } from "@/lib/bp-trend";
import type { BpReading } from "@/lib/vitals";
import { duration, space, useTheme } from "../design";
import { AppText } from "./AppText";
import { haptic } from "./haptics";

const HEIGHT = 200;

interface TrendChartProps {
  readings: BpReading[];
  windowDays: TrendWindowDays;
  nowMs: number;
  thresholds: Pick<BpThresholds, "amber">;
  /** One sentence describing the chart for screen readers. */
  summary: string;
  /** Called when the selected reading changes, or null when none is selected. */
  onSelect: (reading: BpReading | null) => void;
  formatDay: (ms: number) => string;
}

function linePath(model: TrendModel, pick: "ySys" | "yDia") {
  const path = Skia.Path.Make();
  model.points.forEach((p, i) => (i === 0 ? path.moveTo(p.x, p[pick]) : path.lineTo(p.x, p[pick])));
  return path;
}

/**
 * Systolic and diastolic over time, drawn with Skia. Drag a finger across it to
 * read any point (a light haptic ticks as the selection moves). The dashed lines
 * mark the app's own above-target levels; the chart never calls a trend good or
 * bad. A screen reader gets a one sentence summary instead of the drawing, and
 * the readings are also listed under the chart on the screen.
 */
export function TrendChart({ readings, windowDays, nowMs, thresholds, summary, onSelect, formatDay }: TrendChartProps) {
  const { colors, reducedMotion } = useTheme();
  const [width, setWidth] = useState(0);
  const [selected, setSelected] = useState(-1);
  const progress = useSharedValue(reducedMotion ? 1 : 0);

  const model = useMemo(
    () => (width > 0 ? buildTrendModel(readings, windowDays, nowMs, width, HEIGHT, thresholds) : null),
    [readings, windowDays, nowMs, width, thresholds]
  );

  // Draw the lines in once per data change; skipped under reduced motion.
  useEffect(() => {
    if (reducedMotion) {
      progress.value = 1;
      return;
    }
    progress.value = 0;
    progress.value = withTiming(1, { duration: duration.slow * 2 });
  }, [readings, windowDays, reducedMotion, progress]);

  useEffect(() => {
    setSelected(-1);
  }, [readings, windowDays]);

  const sysPath = useMemo(() => (model ? linePath(model, "ySys") : null), [model]);
  const diaPath = useMemo(() => (model ? linePath(model, "yDia") : null), [model]);

  const choose = (x: number) => {
    if (!model) return;
    const index = nearestPointIndex(model.points, x);
    setSelected((current) => {
      if (current !== index && index >= 0) haptic.light();
      return index;
    });
    onSelect(index >= 0 ? model.points[index].reading : null);
  };

  // A tap picks a point; a horizontal drag scrubs across them. The pan only activates
  // after a horizontal move and fails on a vertical one, so scrolling the page with a
  // finger that lands on the chart still scrolls.
  const tap = Gesture.Tap().onEnd((e) => runOnJS(choose)(e.x));
  const pan = Gesture.Pan()
    .activeOffsetX([-8, 8])
    .failOffsetY([-10, 10])
    .onBegin((e) => runOnJS(choose)(e.x))
    .onUpdate((e) => runOnJS(choose)(e.x));
  const gesture = Gesture.Race(pan, tap);

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={summary}
      onLayout={(e) => setWidth(Math.floor(e.nativeEvent.layout.width))}
      style={{ height: HEIGHT }}
    >
      {model && sysPath && diaPath ? (
        <GestureDetector gesture={gesture}>
          <View style={{ width, height: HEIGHT }}>
            <Canvas style={{ width, height: HEIGHT }}>
              {model.yTicks.map((t) => (
                <Line key={t.value} p1={{ x: model.plot.left, y: t.y }} p2={{ x: model.plot.right, y: t.y }} color={colors.border} strokeWidth={1} />
              ))}
              <Line p1={{ x: model.plot.left, y: model.refSysY }} p2={{ x: model.plot.right, y: model.refSysY }} color={colors.warnText} strokeWidth={1.5}>
                <DashPathEffect intervals={[6, 5]} />
              </Line>
              <Line p1={{ x: model.plot.left, y: model.refDiaY }} p2={{ x: model.plot.right, y: model.refDiaY }} color={colors.warnText} strokeWidth={1.5}>
                <DashPathEffect intervals={[6, 5]} />
              </Line>
              {model.points.length > 1 ? (
                <>
                  <Path path={sysPath} style="stroke" strokeWidth={2.5} strokeCap="round" strokeJoin="round" color={colors.brandText} start={0} end={progress} />
                  <Path path={diaPath} style="stroke" strokeWidth={2.5} strokeCap="round" strokeJoin="round" color={colors.textMuted} start={0} end={progress} />
                </>
              ) : null}
              {model.points.map((p, i) => (
                <Circle key={`s${p.reading.id}`} cx={p.x} cy={p.ySys} r={i === selected ? 6 : 3.5} color={colors.brandText} />
              ))}
              {model.points.map((p, i) => (
                <Circle key={`d${p.reading.id}`} cx={p.x} cy={p.yDia} r={i === selected ? 6 : 3.5} color={colors.textMuted} />
              ))}
              {selected >= 0 ? (
                <Line p1={{ x: model.points[selected].x, y: model.plot.top }} p2={{ x: model.points[selected].x, y: model.plot.bottom }} color={colors.textSubtle} strokeWidth={1} />
              ) : null}
            </Canvas>
            {/* Axis labels are plain Text so they scale with the system text size and read aloud. */}
            {model.yTicks.map((t) => (
              <AppText key={t.value} variant="caption" tone="textSubtle" style={{ position: "absolute", left: 0, top: t.y - 8, width: model.plot.left - space.xs, textAlign: "right" }}>
                {t.value}
              </AppText>
            ))}
            <AppText variant="caption" tone="textSubtle" style={{ position: "absolute", left: model.plot.left, bottom: 0 }}>
              {formatDay(model.startMs)}
            </AppText>
            <AppText variant="caption" tone="textSubtle" style={{ position: "absolute", right: 12, bottom: 0 }}>
              {formatDay(model.endMs)}
            </AppText>
          </View>
        </GestureDetector>
      ) : null}
    </View>
  );
}
