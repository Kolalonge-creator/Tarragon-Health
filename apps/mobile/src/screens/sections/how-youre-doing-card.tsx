import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { Card, MutedText } from "@/ui/components";
import { colors, typeScale } from "@/ui/theme";
import { getLatestHealthScore, type LatestHealthScore } from "@/lib/health-score";
import { HEALTH_STATUS_METER, HEALTH_STATUS_WORD } from "@/lib/health-status";
import { getLagosGreetingWord } from "@/lib/greeting";

type CardState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; data: LatestHealthScore | null };

interface HowYoureDoingCardProps {
  patientId: string;
  /** Bump to refetch without resetting to a loading state -- wired to the
   * screen's own pull-to-refresh, same as its other cards. */
  reloadToken?: number;
}

/**
 * Native counterpart to web's Overview hero-score-zone.tsx ("How you're
 * doing" -- HeroScoreZone). Self-contained fetch so a slow or failed score
 * read never blocks the rest of Overview from rendering, same reasoning as
 * web's client-side useLatestHealthScore. Deliberately a white Card, never
 * the green hero band below it -- clinical status colours (the dot/meter
 * here) are a separate system from brand colour and must never share a
 * surface with it (CLAUDE.md).
 */
export function HowYoureDoingCard({ patientId, reloadToken = 0 }: HowYoureDoingCardProps) {
  const [state, setState] = useState<CardState>({ status: "loading" });

  const load = useCallback(async () => {
    const result = await getLatestHealthScore(patientId);
    setState(result.ok ? { status: "ready", data: result.data } : { status: "error" });
  }, [patientId]);

  useEffect(() => {
    void load();
  }, [load, reloadToken]);

  const eyebrow = `Good ${getLagosGreetingWord()}. Here's how this week is going.`;

  return (
    <Card style={{ gap: 8 }}>
      <MutedText>{eyebrow}</MutedText>
      <Text
        style={{
          fontSize: typeScale.caption,
          fontWeight: "700",
          letterSpacing: 0.5,
          textTransform: "uppercase",
          color: colors.muted,
        }}
      >
        How you&apos;re doing
      </Text>

      {state.status === "loading" ? (
        <View style={{ paddingVertical: 10 }}>
          <ActivityIndicator color={colors.brand} />
        </View>
      ) : null}

      {state.status === "error" ? (
        <MutedText>
          Your Health Score is taking a moment to load. Pull to refresh to try again.
        </MutedText>
      ) : null}

      {state.status === "ready" && !state.data ? (
        <MutedText>
          Log your first readings and your score appears here. It builds from the everyday
          numbers you already track.
        </MutedText>
      ) : null}

      {state.status === "ready" && state.data ? (
        <>
          <Text style={{ fontSize: typeScale.hero, fontWeight: "700", color: colors.ink }}>
            {state.data.score}
            <Text style={{ fontSize: typeScale.body, fontWeight: "500", color: colors.muted }}>
              {" "}
              /100
            </Text>
          </Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <View
              style={{
                width: 8,
                height: 8,
                borderRadius: 4,
                backgroundColor: HEALTH_STATUS_WORD[state.data.riskLevel].dot,
              }}
            />
            <Text style={{ fontSize: typeScale.body, fontWeight: "600", color: colors.ink }}>
              {HEALTH_STATUS_WORD[state.data.riskLevel].word}
            </Text>
          </View>
          <View
            accessible
            accessibilityRole="progressbar"
            accessibilityValue={{ min: 0, max: 100, now: state.data.score }}
            accessibilityLabel="Health Score"
            style={{
              height: 8,
              borderRadius: 4,
              overflow: "hidden",
              backgroundColor: HEALTH_STATUS_METER[state.data.riskLevel].track,
            }}
          >
            <View
              style={{
                height: "100%",
                borderRadius: 4,
                width: `${Math.min(100, Math.max(0, state.data.score))}%`,
                backgroundColor: HEALTH_STATUS_METER[state.data.riskLevel].fill,
              }}
            />
          </View>
          <MutedText>A summary of your recent numbers, not a diagnosis.</MutedText>
        </>
      ) : null}
    </Card>
  );
}
