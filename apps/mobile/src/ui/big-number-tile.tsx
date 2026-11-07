import type { ReactNode } from "react";
import { View } from "react-native";
import type { SparkPoint } from "@tarragon/shared";
import { space } from "./design";
import { AppText, Card, Icon, PressableScale, type IconName } from "./kit";
import { Sparkline } from "./reading-charts";

export interface BigNumberTileProps {
  icon: IconName;
  label: string;
  value?: string;
  unit?: string;
  /** Replaces the value with a muted hint (never a dash): "No reading yet", "Couldn't load, tap to open". */
  empty?: string;
  /** One short line under the value: "Today, 08:10 · Steady this month". */
  detail?: string | null;
  /** A clinical status line from the caller, in words (colour is never the only signal). */
  status?: { text: string; tone: "text" | "brandText" | "warnText" | "dangerText" } | null;
  /** The 30-day series; fewer than two points draws no line. */
  points?: readonly SparkPoint[];
  /** Any other small chart (the doses bars); hidden from screen readers, so the words must already say it. */
  chart?: ReactNode;
  onPress?: () => void;
}

/**
 * A big-number tile (founder, 2026-11-06, the phone twin of the web's home/big-number-tile.tsx): the label, the value large with
 * its unit, when it was taken and which way it has moved this month in words, and a 30-day trend line. The trend word is never
 * coloured, because "higher" is not "worse" for every reading. A screen reader hears one sentence with everything the tile shows.
 */
export function BigNumberTile({ icon, label, value, unit, empty, detail, status, points, chart, onPress }: BigNumberTileProps) {
  const hasLine = points !== undefined && points.length >= 2;
  const showValue = empty === undefined && value !== undefined;
  const spoken = [
    showValue ? `${label}: ${value}${unit ? ` ${unit}` : ""}` : `${label}: ${empty ?? "No reading yet"}`,
    status?.text,
    detail,
    hasLine ? "Trend line for the last 30 days" : null,
  ]
    .filter(Boolean)
    .join(". ");

  const body = (
    <Card style={{ gap: space.sm, flexGrow: 1 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
        <Icon name={icon} size={18} tone="brandText" />
        <AppText variant="label" tone="textMuted" style={{ flexShrink: 1 }}>
          {label}
        </AppText>
      </View>
      {showValue ? (
        <AppText variant="hero" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
          {value}
          {unit ? (
            <AppText variant="body" tone="textSubtle">
              {" "}
              {unit}
            </AppText>
          ) : null}
        </AppText>
      ) : (
        <AppText variant="bodyLarge" tone="textSubtle" style={{ paddingVertical: space.xs }}>
          {empty ?? "No reading yet"}
        </AppText>
      )}
      {status ? (
        <AppText variant="label" tone={status.tone}>
          {status.text}
        </AppText>
      ) : null}
      {detail ? (
        <AppText variant="caption" tone="textMuted">
          {detail}
        </AppText>
      ) : null}
      {chart ? (
        <View style={{ marginTop: "auto", paddingTop: space.xs }}>{chart}</View>
      ) : hasLine ? (
        <View style={{ marginTop: "auto", paddingTop: space.xs }}>
          <Sparkline points={points} />
          <AppText variant="caption" tone="textSubtle">
            Last 30 days
          </AppText>
        </View>
      ) : null}
    </Card>
  );

  if (!onPress) {
    return (
      <View accessible accessibilityLabel={spoken} style={{ flexGrow: 1 }}>
        {body}
      </View>
    );
  }
  return (
    <PressableScale onPress={onPress} accessibilityRole="button" accessibilityLabel={spoken} style={{ flexGrow: 1 }}>
      {body}
    </PressableScale>
  );
}
