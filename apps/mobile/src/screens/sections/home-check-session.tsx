import { useEffect, useState } from "react";
import { View } from "react-native";
import { asLocale, t, type MessageKey } from "@tarragon/i18n";
import { planSession, type HomeBpConfig, type HomeBpReading, type SessionStep } from "@tarragon/clinical";
import { sessionLine } from "@/lib/home-check-session-lines";
import { useUiLanguage } from "@/lib/ui-language";
import { radii, space, useTheme } from "@/ui/design";
import { AppText, Badge } from "@/ui/kit";

/**
 * The guided session inside the seven-day home check card (docs/design/BP-home-guided-session.md). It tells the person what to do next,
 * in words, and counts the wait between the two readings. It does NOT save anything and grades nothing: each reading is typed into the one
 * existing blood pressure form below, so on-device triage, the emergency guidance and the offline outbox work exactly as they always do.
 * The step comes from `planSession` over readings already on this phone, so it works with no signal.
 */
export function HomeCheckSession({ readings, config, reloadKey }: { readings: readonly HomeBpReading[]; config: HomeBpConfig; reloadKey?: number }) {
  const language = asLocale(useUiLanguage());
  const tr = (key: MessageKey, params?: Record<string, string | number>) => t(key, language, params);
  const { colors } = useTheme();
  const [nowMs, setNowMs] = useState(() => Date.now());

  // Step on every reload (a reading was just saved) and, while waiting between readings, once a second.
  useEffect(() => {
    setNowMs(Date.now());
  }, [readings, reloadKey]);
  const step: SessionStep = planSession({ readings, nowMs }, config);
  const waiting = step.kind === "wait";
  useEffect(() => {
    if (!waiting) return;
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [waiting]);

  const label = step.kind === "outside_window" ? null : tr(step.part === "morning" ? "hc.session.morning" : "hc.session.evening");
  const body = sessionLine(step, tr);

  return (
    <View
      accessibilityLabel={tr("hc.session.title")}
      style={{ gap: space.sm, padding: space.md, borderRadius: radii.md, backgroundColor: colors.surfaceMuted }}
    >
      <AppText variant="bodyStrong" heading>
        {tr("hc.session.title")}
      </AppText>
      {label ? <Badge label={label} tone="neutral" /> : null}
      <AppText variant="body">{body}</AppText>
      <AppText variant="caption" tone="textMuted">
        {tr("hc.session.not_counted")}
      </AppText>
    </View>
  );
}
