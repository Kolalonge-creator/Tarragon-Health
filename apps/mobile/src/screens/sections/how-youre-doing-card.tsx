import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import { asLocale, t, type MessageKey } from "@tarragon/i18n";
import { useUiLanguage } from "@/lib/ui-language";
import { getLatestHealthScore, type LatestHealthScore } from "@/lib/health-score";
import { HEALTH_STATUS_METER, HEALTH_STATUS_WORD } from "@/lib/health-status";
import { getLagosGreetingWord } from "@/lib/greeting";
import { radii, space } from "@/ui/design";
import { AppText, Card, Skeleton } from "@/ui/kit";

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
 * web's client-side useLatestHealthScore. Deliberately a surface Card, never
 * the green hero band below it -- clinical status colours (the dot/meter
 * here) are a separate system from brand colour and must never share a
 * surface with it (CLAUDE.md). The status dot and meter keep their fixed
 * clinical colours in both schemes; the word beside them carries the meaning.
 */
export function HowYoureDoingCard({ patientId, reloadToken = 0 }: HowYoureDoingCardProps) {
  const locale = asLocale(useUiLanguage());
  const tr = (key: MessageKey) => t(key, locale);
  const [state, setState] = useState<CardState>({ status: "loading" });

  const load = useCallback(async () => {
    const result = await getLatestHealthScore(patientId);
    setState(result.ok ? { status: "ready", data: result.data } : { status: "error" });
  }, [patientId]);

  useEffect(() => {
    void load();
  }, [load, reloadToken]);

  return (
    <Card style={{ gap: space.sm }}>
      <AppText variant="body" tone="textMuted">
        {tr(`home.score.eyebrow.${getLagosGreetingWord()}` as MessageKey)}
      </AppText>
      <AppText variant="label" tone="textMuted" heading style={{ textTransform: "uppercase", letterSpacing: 0.5 }}>
        {tr("home.score.title")}
      </AppText>

      {state.status === "loading" ? <Skeleton height={40} width="50%" /> : null}

      {state.status === "error" ? (
        <AppText variant="body" tone="textMuted">
          {tr("home.score.error")}
        </AppText>
      ) : null}

      {state.status === "ready" && !state.data ? (
        <AppText variant="body" tone="textMuted">
          {tr("home.score.empty")}
        </AppText>
      ) : null}

      {state.status === "ready" && state.data ? (
        <>
          <AppText variant="hero">
            {state.data.score}
            <AppText variant="bodyLarge" tone="textMuted">
              {" "}
              /100
            </AppText>
          </AppText>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: HEALTH_STATUS_WORD[state.data.riskLevel].dot }} />
            <AppText variant="bodyStrong">{tr(`home.score.word.${state.data.riskLevel}` as MessageKey)}</AppText>
          </View>
          <View
            accessible
            accessibilityRole="progressbar"
            accessibilityValue={{ min: 0, max: 100, now: state.data.score }}
            accessibilityLabel={tr("home.score.a11y")}
            style={{ height: 8, borderRadius: radii.sm, overflow: "hidden", backgroundColor: HEALTH_STATUS_METER[state.data.riskLevel].track }}
          >
            <View
              style={{
                height: "100%",
                borderRadius: radii.sm,
                width: `${Math.min(100, Math.max(0, state.data.score))}%`,
                backgroundColor: HEALTH_STATUS_METER[state.data.riskLevel].fill,
              }}
            />
          </View>
          <AppText variant="caption" tone="textMuted">
            {tr("home.score.note")}
          </AppText>
        </>
      ) : null}
    </Card>
  );
}
