import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, AppState, View } from "react-native";
import { asLocale, t, type MessageKey } from "@tarragon/i18n";
import { planSession, preMeasureChecklist, type HomeBpConfig, type HomeBpReading, type SessionStep } from "@tarragon/clinical";
import { sessionLine } from "@/lib/home-check-session-lines";
import { useUiLanguage } from "@/lib/ui-language";
import { radii, space, useTheme } from "@/ui/design";
import { AppText, Badge } from "@/ui/kit";

/**
 * The guided session inside the seven-day home check card (docs/design/BP-home-guided-session.md). It tells the person what to do next,
 * in words, and counts the wait between the two readings. It does NOT save anything and grades nothing: each reading is typed into the one
 * existing blood pressure form below, so on-device triage, the emergency guidance (INV-06) and the offline outbox work exactly as they always do.
 * The step comes from `planSession` over the readings the Vitals screen already holds (its own copy plus anything waiting to send), so it works with no signal.
 *
 * `hold` is true while the screen is showing guidance for the reading just saved (emergency guidance, an urgent banner, a repeat prompt or the
 * emergency-symptom question). The steps then give way to a single line, so the panel can never sit beside that guidance telling the person to carry on.
 */
export function HomeCheckSession({
  readings,
  config,
  hold,
  overallComplete,
}: {
  readings: readonly HomeBpReading[];
  config: HomeBpConfig;
  hold: boolean;
  overallComplete: boolean;
}) {
  const language = asLocale(useUiLanguage());
  const tr = (key: MessageKey, params?: Record<string, string | number>) => t(key, language, params);
  const { colors } = useTheme();
  const [nowMs, setNowMs] = useState(() => Date.now());

  // The step follows the clock: every reading saved (new `readings`), every return to the app, every 30 seconds (so a window that opens or closes while the
  // screen is left open is noticed), and once a second only while waiting between two readings.
  useEffect(() => {
    setNowMs(Date.now());
  }, [readings]);
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") setNowMs(Date.now());
    });
    return () => sub.remove();
  }, []);
  const step: SessionStep = planSession({ readings, nowMs }, config);
  const waiting = step.kind === "wait" && !hold;
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), waiting ? 1000 : 30_000);
    return () => clearInterval(id);
  }, [waiting]);

  const label = step.kind === "outside_window" ? null : tr(step.part === "morning" ? "hc.session.morning" : "hc.session.evening");
  const body = sessionLine(step, tr, { hold, overallComplete });

  // Say a change of step out loud once (not the countdown, which would be read every second).
  const spoken = useRef<string | null>(null);
  const key = hold ? "hold" : step.kind;
  useEffect(() => {
    if (spoken.current !== null && spoken.current !== key) AccessibilityInfo.announceForAccessibility(body);
    spoken.current = key;
  }, [key, body]);

  return (
    <View
      accessibilityLabel={tr("hc.session.title")}
      style={{ gap: space.sm, padding: space.md, borderRadius: radii.md, backgroundColor: colors.surfaceMuted }}
    >
      <AppText variant="bodyStrong" heading>
        {tr("hc.session.title")}
      </AppText>
      {label && !hold ? <Badge label={label} tone="neutral" /> : null}
      <AppText variant="body">{body}</AppText>
      {/* S70b: before the first reading of a session, what to do before measuring. The numbers come from the signed configuration. */}
      {!hold && step.kind === "rest" && step.number === 1 ? (
        <View style={{ gap: space.xs }} accessibilityLabel={tr("hbp.prep.title")}>
          <AppText variant="bodyStrong">{tr("hbp.prep.title")}</AppText>
          {preMeasureChecklist(config).map((item) => (
            <AppText key={item.id} variant="caption" tone="textMuted">
              {"\u2022 "}
              {tr(item.key as MessageKey, item.params as Record<string, number>)}
            </AppText>
          ))}
        </View>
      ) : null}
      <AppText variant="caption" tone="textMuted">
        {tr("hc.session.not_counted")}
      </AppText>
    </View>
  );
}
