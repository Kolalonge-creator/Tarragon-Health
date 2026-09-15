import { useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import {
  loadWellbeingCheckinHistory,
  bandHigherIsBetter,
  bandLowerIsBetter,
  wellbeingBandLabel,
  type WellbeingTrendPoint,
  type WellbeingBand,
} from "@/lib/wellbeing";
import { colors, radius } from "@/ui/theme";
import { Card, ErrorText, MutedText } from "@/ui/components";

type TrendMode = "mood_score" | "stress_score" | "sleep_quality";

const MODE_CONFIG: Record<TrendMode, { label: string; band: (score: number) => WellbeingBand }> = {
  mood_score: { label: "Mood", band: bandHigherIsBetter },
  stress_score: { label: "Stress", band: bandLowerIsBetter },
  sleep_quality: { label: "Sleep", band: bandHigherIsBetter },
};

const BAND_COLOR: Record<WellbeingBand, string> = {
  attention: colors.status.critical,
  moderate: colors.status.warn,
  stable: colors.brand,
};

const BAR_MAX_HEIGHT = 84;
const BAR_WIDTH = 18;
const COLUMN_WIDTH = 40;

function formatShortDate(checkedInAt: string): string {
  return new Date(checkedInAt).toLocaleDateString("en-GB", {
    timeZone: "Africa/Lagos",
    day: "numeric",
    month: "short",
  });
}

/**
 * Mood/stress/sleep trend (Module 46) — mobile counterpart to
 * apps/web/.../patient/wellbeing-trend-chart.tsx. There is no chart library
 * anywhere in apps/mobile (no react-native-svg, victory-native, etc.), and
 * adding one is a native-affecting dependency that would need a fresh EAS
 * build before the next OTA publish reaches devices (see the mobile OTA
 * runtimeVersion note). So this draws a plain-View bar chart instead — no
 * new native module, ships over the existing JS-only OTA channel. Purely
 * descriptive, same as the tiles above: engagement telemetry, never fed into
 * escalation/risk scoring.
 */
export function WellbeingTrendChart({ patientId, reloadToken }: { patientId: string; reloadToken: number }) {
  const [mode, setMode] = useState<TrendMode>("mood_score");
  const [points, setPoints] = useState<WellbeingTrendPoint[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadWellbeingCheckinHistory(patientId)
      .then((rows) => {
        if (!cancelled) {
          setPoints(rows);
          setError(false);
        }
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [patientId, reloadToken]);

  const rows = points ?? [];
  const lastIndex = rows.length - 1;
  const latest = rows[lastIndex];
  const config = MODE_CONFIG[mode];

  return (
    <Card style={{ gap: 12 }}>
      <Text style={{ fontSize: 14.5, fontWeight: "700", color: colors.ink }}>Wellbeing trend</Text>

      <View style={{ flexDirection: "row", gap: 6 }}>
        {(Object.keys(MODE_CONFIG) as TrendMode[]).map((key) => (
          <Text
            key={key}
            onPress={() => setMode(key)}
            style={{
              fontSize: 12.5,
              fontWeight: "600",
              paddingVertical: 6,
              paddingHorizontal: 12,
              borderRadius: 999,
              backgroundColor: mode === key ? colors.brand : colors.groupBg,
              color: mode === key ? "#FFFFFF" : colors.ink,
              overflow: "hidden",
            }}
          >
            {MODE_CONFIG[key].label}
          </Text>
        ))}
      </View>

      {loading && <ActivityIndicator color={colors.brand} />}
      {!loading && error && <ErrorText>Could not load the trend chart.</ErrorText>}
      {!loading && !error && rows.length < 2 && (
        <MutedText>Log a few more check-ins to see your trend over time.</MutedText>
      )}
      {!loading && !error && rows.length >= 2 && (
        <View style={{ gap: 6 }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 0 }}>
              {rows.map((row, index) => {
                const value = row[mode];
                const band = config.band(value);
                const barHeight = Math.max(4, (value / 5) * BAR_MAX_HEIGHT);
                const isLast = index === lastIndex;
                return (
                  <View key={row.checked_in_at + index} style={{ width: COLUMN_WIDTH, alignItems: "center" }}>
                    <Text
                      style={{
                        fontSize: 11,
                        fontWeight: "700",
                        color: colors.ink,
                        height: 14,
                        opacity: isLast ? 1 : 0,
                      }}
                    >
                      {value}
                    </Text>
                    <View style={{ height: BAR_MAX_HEIGHT, justifyContent: "flex-end" }}>
                      <View
                        style={{
                          width: BAR_WIDTH,
                          height: barHeight,
                          borderRadius: radius.control / 2,
                          backgroundColor: BAND_COLOR[band],
                        }}
                      />
                    </View>
                    <Text
                      numberOfLines={1}
                      style={{ fontSize: 9.5, color: colors.muted, marginTop: 4 }}
                    >
                      {formatShortDate(row.checked_in_at)}
                    </Text>
                  </View>
                );
              })}
            </View>
          </ScrollView>
          {latest && (
            <MutedText>
              Latest: {latest[mode]}/5 ({wellbeingBandLabel(config.band(latest[mode]))})
            </MutedText>
          )}
        </View>
      )}
    </Card>
  );
}
