import { useState } from "react";
import { View, type LayoutChangeEvent } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";
import { sparkPath, type SparkPoint } from "@tarragon/shared";
import type { DoseDay } from "@tarragon/medicines";
import { doseBars } from "@/lib/dose-bars";
import { radii, space, useTheme } from "./design";
import { AppText } from "./kit";

/**
 * A single-series trend line for a big-number tile (2026-11-06, the phone twin of the web's components/charts/sparkline.tsx). One
 * series, so no legend: the tile names it. A 2px brand-green line, the latest point marked, no axes or grid. The drawing is hidden
 * from screen readers; the tile's own label says the value, when and the trend in words.
 */
export function Sparkline({ points, height = 32 }: { points: readonly SparkPoint[]; height?: number }) {
  const { colors } = useTheme();
  const [width, setWidth] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setWidth(Math.round(e.nativeEvent.layout.width));
  const path = width > 0 ? sparkPath(points, width, height) : null;
  return (
    <View onLayout={onLayout} style={{ height }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {path ? (
        <Svg width={width} height={height}>
          <Path d={path.d} fill="none" stroke={colors.brand} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
          <Circle cx={path.last.x} cy={path.last.y} r={3} fill={colors.brand} />
        </Svg>
      ) : null}
    </View>
  );
}

/**
 * Doses per day as bars (the phone twin of the web's DoseBars). Each bar's full height is the doses due that day; the filled part
 * is the doses marked taken, in brand green, the rest a light neutral, never red: a record, not a grade. A day with nothing due is
 * a short tick. The drawing is hidden from screen readers (the caller gives a sentence instead), and the full chart has its legend
 * in words.
 */
export function DoseBars({ days, compact = false }: { days: readonly DoseDay[]; compact?: boolean }) {
  const { colors } = useTheme();
  const height = compact ? 32 : 96;
  const bars = doseBars(days, height);
  return (
    <View>
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ flexDirection: "row", alignItems: "flex-end", gap: 2, height }}>
        {bars.map((bar) => (
          <View key={bar.date} style={{ flex: 1, height, justifyContent: "flex-end" }}>
            <View
              style={{
                height: bar.total,
                backgroundColor: colors.surfaceMuted,
                borderTopLeftRadius: bar.empty ? 2 : 4,
                borderTopRightRadius: bar.empty ? 2 : 4,
                overflow: "hidden",
                justifyContent: "flex-end",
              }}
            >
              {bar.empty ? null : <View style={{ height: bar.taken, backgroundColor: colors.brand }} />}
            </View>
          </View>
        ))}
      </View>
      {compact ? null : (
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ flexDirection: "row", flexWrap: "wrap", gap: space.lg, marginTop: space.sm }}>
          <LegendKey color={colors.brand} label="Marked taken" />
          <LegendKey color={colors.surfaceMuted} label="Not marked taken" />
        </View>
      )}
    </View>
  );
}

function LegendKey({ color, label }: { color: string; label: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
      <View style={{ width: 10, height: 10, borderRadius: radii.sm, backgroundColor: color }} />
      <AppText variant="caption" tone="textMuted">
        {label}
      </AppText>
    </View>
  );
}
