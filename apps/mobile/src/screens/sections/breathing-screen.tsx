import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, AppState, ScrollView, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { asLocale, t, type MessageKey } from "@tarragon/i18n";
import { bre01Pace, cueSchedule, mayStartSession, stateAt, type BreathingState, type BreathingVariant } from "@tarragon/shared";
import { breathParams, dueCues, pacerScale, phaseKey, shouldAnnounce, steppedScale } from "@/lib/breathing-view";
import { useUiLanguage } from "@/lib/ui-language";
import { radii, space, useTheme } from "@/ui/design";
import { AppText, Button, Card, haptic } from "@/ui/kit";

const ACK_KEY = "breathing.safety_ack.v1";
const TICK_MS = 100;
const VARIANTS: { id: BreathingVariant; label: MessageKey }[] = [
  { id: "standard", label: "breathing.variant_standard" },
  { id: "gentle", label: "breathing.variant_gentle" },
  { id: "short", label: "breathing.variant_short" },
];

type Stage = "loading" | "safety" | "ready" | "running" | "done";

/**
 * BRE-01 "Three minute calm" (spec 8.7). A silent visual guide at about six breaths a minute with a longer out-breath, a
 * safety card before the first use, and a Stop button on screen the whole time. It works with no network and no sound.
 * It is a calm moment, never presented as a treatment for blood pressure and never asks for a reading; the screen says
 * to keep taking medicines. It leaves its session when the app goes to the background rather than running unseen.
 */
export function BreathingScreen({ onBack }: { onBack: () => void }) {
  const { colors, reducedMotion } = useTheme();
  const locale = asLocale(useUiLanguage());
  const tr = useCallback((key: MessageKey, params?: Record<string, string | number>) => t(key, locale, params), [locale]);

  const [stage, setStage] = useState<Stage>("loading");
  const [variant, setVariant] = useState<BreathingVariant>("standard");
  const [haptics, setHaptics] = useState(false);
  const [state, setState] = useState<BreathingState | null>(null);
  const startedAt = useRef(0);
  const lastMs = useRef<number | null>(null);
  const lastState = useRef<BreathingState | null>(null);
  const pace = useMemo(() => bre01Pace(variant).pace, [variant]);
  const cues = useMemo(() => cueSchedule(pace), [pace]);

  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(ACK_KEY)
      .then((v) => alive && setStage(mayStartSession(v === "1") ? "ready" : "safety"))
      .catch(() => alive && setStage("safety"));
    return () => {
      alive = false;
    };
  }, []);

  const stop = useCallback(() => {
    lastMs.current = null;
    lastState.current = null;
    setState(null);
    setStage("ready");
  }, []);

  useEffect(() => {
    if (stage !== "running") return;
    const sub = AppState.addEventListener("change", (s) => {
      if (s !== "active") stop();
    });
    const id = setInterval(() => {
      const elapsed = Date.now() - startedAt.current;
      const next = stateAt(pace, elapsed);
      if (haptics) for (let i = 0; i < dueCues(cues, lastMs.current, elapsed).length; i++) haptic.light();
      if (shouldAnnounce(lastState.current, next)) {
        AccessibilityInfo.announceForAccessibility(tr("breathing.a11y_phase", { phase: tr(phaseKey(next.phase)), n: next.secondsLeft }));
      }
      lastMs.current = elapsed;
      lastState.current = next;
      if (next.finished) {
        setState(null);
        setStage("done");
        if (haptics) haptic.success();
      } else {
        setState(next);
      }
    }, TICK_MS);
    return () => {
      clearInterval(id);
      sub.remove();
    };
  }, [stage, pace, cues, haptics, stop, tr]);

  async function acknowledge() {
    try {
      await AsyncStorage.setItem(ACK_KEY, "1");
    } catch {
      // Not saving only means the card shows again next time; the learner can still go on.
    }
    setStage("ready");
  }

  function start() {
    if (!mayStartSession(stage !== "safety")) return;
    startedAt.current = Date.now();
    lastMs.current = null;
    lastState.current = null;
    setState(stateAt(pace, 0));
    setStage("running");
  }

  const size = 220;
  const scale = state ? (reducedMotion ? steppedScale(state.phase) : pacerScale(state.fill)) : 0.55;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.canvas }} contentContainerStyle={{ padding: space.lg, gap: space.lg }}>
      <Button title={tr("common.back")} onPress={() => { stop(); onBack(); }} variant="ghost" fullWidth={false} />
      <View style={{ gap: space.xs }}>
        <AppText variant="headline" heading>{tr("breathing.title")}</AppText>
        <AppText tone="textMuted">{tr("breathing.intro")}</AppText>
        <AppText variant="caption" tone="textMuted">{tr("breathing.keep_medicines")}</AppText>
      </View>

      {stage === "safety" && (
        <Card style={{ gap: space.md }}>
          <AppText variant="title" heading>{tr("breathing.safety_title")}</AppText>
          <AppText>{tr("breathing.safety_stop")}</AppText>
          <AppText>{tr("breathing.safety_ask")}</AppText>
          <AppText>{tr("breathing.safety_emergency")}</AppText>
          <Button title={tr("breathing.safety_ack")} onPress={acknowledge} />
        </Card>
      )}

      {(stage === "ready" || stage === "done") && (
        <View style={{ gap: space.md }}>
          {stage === "done" && <AppText variant="bodyLarge" accessibilityLiveRegion="polite">{tr("breathing.done")}</AppText>}
          <View style={{ flexDirection: "row", gap: space.sm, flexWrap: "wrap" }}>
            {VARIANTS.map((v) => (
              <Button key={v.id} title={tr(v.label)} variant={variant === v.id ? "primary" : "secondary"} fullWidth={false} onPress={() => setVariant(v.id)} />
            ))}
          </View>
          <Button title={tr("breathing.haptics")} variant={haptics ? "primary" : "secondary"} onPress={() => setHaptics((h) => !h)} />
          {reducedMotion && <AppText variant="caption" tone="textMuted">{tr("breathing.reduced_motion")}</AppText>}
          <Button title={stage === "done" ? tr("breathing.again") : tr("breathing.start")} onPress={start} />
        </View>
      )}

      {stage === "running" && state && (
        <View style={{ alignItems: "center", gap: space.lg }}>
          <View
            accessible
            accessibilityRole="timer"
            accessibilityLabel={`${tr(phaseKey(state.phase))}, ${state.secondsLeft}`}
            style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}
          >
            <View
              style={{
                width: size,
                height: size,
                borderRadius: radii.pill,
                backgroundColor: colors.brand,
                opacity: 0.85,
                transform: [{ scale }],
              }}
            />
            <View style={{ position: "absolute", alignItems: "center" }}>
              <AppText variant="headline" tone="textOnBrand">{tr(phaseKey(state.phase))}</AppText>
              <AppText variant="stat" tone="textOnBrand">{state.secondsLeft}</AppText>
            </View>
          </View>
          <AppText variant="caption" tone="textMuted">{tr("breathing.breath_of", breathParams(state))}</AppText>
          <Button title={tr("breathing.stop")} variant="secondary" onPress={stop} />
        </View>
      )}
    </ScrollView>
  );
}
