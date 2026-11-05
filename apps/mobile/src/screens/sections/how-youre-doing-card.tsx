import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import { asLocale, t, type MessageKey } from "@tarragon/i18n";
import {
  HEALTH_STATUS_DISCLAIMER,
  HEALTH_STATUS_WORDS,
  INDICATOR_FLAG_WORDS,
  healthStatusSummary,
  trendWords,
  type HealthStatusDomain,
} from "@tarragon/shared";
import { useUiLanguage } from "@/lib/ui-language";
import { getHealthStatusDomains } from "@/lib/health-status-domains";
import { HEALTH_STATUS_WORD } from "@/lib/health-status";
import { getLagosGreetingWord } from "@/lib/greeting";
import { space } from "@/ui/design";
import { AppText, Card, Skeleton } from "@/ui/kit";

type CardState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; domains: HealthStatusDomain[] };

interface HowYoureDoingCardProps {
  patientId: string;
  /** Bump to refetch without resetting to a loading state -- wired to the screen's own pull-to-refresh, same as its other cards. */
  reloadToken?: number;
}

/** Clinical status colours (a separate system from brand colour): the same green and amber the web dot uses, grey for "no range yet". */
const DOT: Record<HealthStatusDomain["status"], string> = {
  within_range: HEALTH_STATUS_WORD.low.dot,
  worth_discussing: HEALTH_STATUS_WORD.moderate.dot,
  not_enough_yet: "#9CA3AF",
};

/**
 * Native counterpart to web's Overview hero-score-zone.tsx ("How you're doing"). T2-06 (founder, 2026-11-04): the composite Health Score
 * number is no longer shown; this card shows health status BY DOMAIN (each result against its own printed range or the person's own
 * target, which way it moved, what is outstanding), from the same shared builder web uses. Self-contained fetch so a slow read never
 * blocks the rest of Overview.
 */
export function HowYoureDoingCard({ patientId, reloadToken = 0 }: HowYoureDoingCardProps) {
  const locale = asLocale(useUiLanguage());
  const tr = (key: MessageKey) => t(key, locale);
  const [state, setState] = useState<CardState>({ status: "loading" });

  const load = useCallback(async () => {
    const result = await getHealthStatusDomains(patientId);
    setState(result.ok ? { status: "ready", domains: result.data } : { status: "error" });
  }, [patientId]);

  useEffect(() => {
    void load();
  }, [load, reloadToken]);

  const summary = state.status === "ready" ? healthStatusSummary(state.domains) : null;

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

      {state.status === "ready" && !summary ? (
        <AppText variant="body" tone="textMuted">
          {tr("home.score.empty")}
        </AppText>
      ) : null}

      {state.status === "ready" && summary ? (
        <>
          <AppText variant="bodyStrong">{summary}</AppText>
          {state.domains.map((d) => (
            <View key={d.key} style={{ gap: 2 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: DOT[d.status] }} />
                <AppText variant="bodyStrong">
                  {d.label}: {HEALTH_STATUS_WORDS[d.status].toLowerCase()}
                </AppText>
              </View>
              {d.indicators.map((i) => {
                const trend = trendWords(i);
                return (
                  <AppText key={i.key} variant="caption" tone="textMuted">
                    {i.label} {i.value}
                    {i.unit ? ` ${i.unit}` : ""}, {i.at.slice(0, 10)}
                    {i.rangeText ? `, range ${i.rangeText}` : ""}, {INDICATOR_FLAG_WORDS[i.flag]}
                    {trend ? `. ${trend}` : ""}
                  </AppText>
                );
              })}
              {d.actions.map((a) => (
                <AppText key={a} variant="caption">
                  {a}
                </AppText>
              ))}
            </View>
          ))}
          <AppText variant="caption" tone="textMuted">
            {HEALTH_STATUS_DISCLAIMER}
          </AppText>
        </>
      ) : null}
    </Card>
  );
}
