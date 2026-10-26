import { useCallback, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, AppState, Modal, Pressable, ScrollView, Switch, Text, View } from "react-native";
import { advancePanic, groundingKey, initialPanicState, panicBreathView, panicCircleScale, panicSteppedScale, panicToolConfig, type PanicState } from "@tarragon/shared";
import { t, type MessageKey } from "@tarragon/i18n";
import { CrisisCard } from "@/components/mental-health/crisis-card";
import { supabase } from "@/lib/supabase";
import { useLegacyColors, useTheme } from "@/ui/design";

const tr = (key: string, params?: Record<string, string | number>) => t(key as MessageKey, "en", params);

/**
 * The calm tool on the phone (S56b, function 4): one tap from the wellbeing home and the check-in opens a full-screen, scripted exercise for
 * acute anxiety. Every word is bundled and every step is pure code in @tarragon/shared, so it needs no network and no account data. The only
 * network calls are the ones the person starts: "Tell my care team" (the existing hand-off) and the crisis card (which falls back to its
 * bundled copy). Nothing is logged, counted or sent otherwise. The way out to the crisis card is on screen at every step. No sound, no model, no
 * analytics. Reduced motion (or the words-only switch) removes the moving circle; large tap targets; the phase is announced to a screen reader.
 */
export function CalmToolButton({ enabled }: { enabled: boolean }) {
  const colors = useLegacyColors();
  const [open, setOpen] = useState(false);
  if (!enabled) return null;
  return (
    <View style={{ gap: 4 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={tr("panic.button")}
        accessibilityHint={tr("panic.button_hint")}
        onPress={() => setOpen(true)}
        style={{ minHeight: 56, borderRadius: 14, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center", paddingHorizontal: 16 }}
      >
        <Text style={{ color: "#FFFFFF", fontSize: 17, fontWeight: "700" }}>{tr("panic.button")}</Text>
      </Pressable>
      <Text style={{ fontSize: 12, color: colors.muted, textAlign: "center" }}>{tr("panic.button_hint")}</Text>
      <Modal visible={open} animationType="slide" presentationStyle="fullScreen" onRequestClose={() => setOpen(false)}>
        {open ? <CalmToolScreen onClose={() => setOpen(false)} /> : null}
      </Modal>
    </View>
  );
}

function BigButton({ title, onPress, tone = "primary", disabled = false }: { title: string; onPress: () => void; tone?: "primary" | "secondary" | "danger"; disabled?: boolean }) {
  const colors = useLegacyColors();
  const bg = tone === "primary" ? colors.brand : tone === "danger" ? colors.status.critical : "transparent";
  const fg = tone === "secondary" ? colors.brand : "#FFFFFF";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={{ minHeight: 56, borderRadius: 14, backgroundColor: bg, borderWidth: tone === "secondary" ? 2 : 0, borderColor: colors.brand, alignItems: "center", justifyContent: "center", paddingHorizontal: 18, paddingVertical: 12, alignSelf: "stretch" }}
    >
      <Text style={{ color: fg, fontSize: 17, fontWeight: "700", textAlign: "center" }}>{title}</Text>
    </Pressable>
  );
}

function CalmToolScreen({ onClose }: { onClose: () => void }) {
  const colors = useLegacyColors();
  const { reducedMotion } = useTheme();
  const cfg = panicToolConfig();
  const [state, setState] = useState<PanicState>(initialPanicState());
  const [elapsed, setElapsed] = useState(0);
  const [help, setHelp] = useState(false);
  const [textOverride, setTextOverride] = useState<boolean | null>(null);
  const [told, setTold] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const textOnly = textOverride ?? reducedMotion;
  const startedAt = useRef(0);
  const lastPhase = useRef<string | null>(null);

  const dispatch = useCallback((e: Parameters<typeof advancePanic>[1]) => setState((s) => advancePanic(s, e, cfg)), [cfg]);

  useEffect(() => {
    if (state.stage !== "breathing" || help) return;
    startedAt.current = Date.now() - elapsed * 1000;
    const id = setInterval(() => {
      const e = (Date.now() - startedAt.current) / 1000;
      setElapsed(e);
      const v = panicBreathView(e, cfg);
      if (v.done) dispatch("breathing_finished");
      else if (v.phase !== lastPhase.current) {
        lastPhase.current = v.phase;
        AccessibilityInfo.announceForAccessibility(tr("panic.a11y_phase", { phase: v.phase === "inhale" ? tr("panic.breathe_in") : tr("panic.breathe_out"), n: v.secondsLeft }));
      }
    }, 200);
    // a background app must not keep counting: return to the start rather than resume a stale breath
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "background") { clearInterval(id); setElapsed(0); lastPhase.current = null; setState(initialPanicState()); }
    });
    return () => { clearInterval(id); sub.remove(); };
    // elapsed is read once at (re)start so a pause for the help card resumes where it stopped
  }, [state.stage, help, cfg, dispatch]);

  async function tellTeam() {
    setTold("sending");
    try {
      const { error } = await supabase.rpc("request_mental_health_handoff", { p_note: tr("panic.tell_team_note") });
      setTold(error ? "error" : "sent");
    } catch {
      setTold("error");
    }
  }

  const view = panicBreathView(elapsed, cfg);
  const scale = textOnly ? panicSteppedScale(view.phase) : panicCircleScale(view);
  const phaseWord = view.phase === "inhale" ? tr("panic.breathe_in") : view.phase === "exhale" ? tr("panic.breathe_out") : "";
  const big = { fontSize: 22, fontWeight: "700" as const, color: colors.ink, textAlign: "center" as const };
  const body = { fontSize: 18, color: colors.ink, textAlign: "center" as const };

  return (
    <View accessibilityViewIsModal style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, padding: 16, paddingTop: 48 }}>
        <Text style={{ flex: 1, fontSize: 12, color: colors.muted }}>{tr("panic.not_saved")}</Text>
        <Pressable accessibilityRole="button" onPress={onClose} style={{ minHeight: 48, justifyContent: "center", paddingHorizontal: 16, borderRadius: 12, borderWidth: 2, borderColor: colors.border }}>
          <Text style={{ fontSize: 16, fontWeight: "700", color: colors.ink }}>{tr("panic.close")}</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, gap: 22, alignItems: "center" }}>
        {help ? (
          <View style={{ alignSelf: "stretch", gap: 16 }}>
            <CrisisCard />
            <BigButton title={tr("panic.danger_back")} tone="secondary" onPress={() => setHelp(false)} />
          </View>
        ) : (
          <>
            <Text accessibilityRole="header" style={{ fontSize: 26, fontWeight: "700", color: colors.ink, textAlign: "center" }}>
              {state.stage === "done" ? tr("panic.done_title") : tr("panic.title")}
            </Text>

            {state.stage === "intro" && (
              <>
                <Text style={body}>{tr("panic.intro_1")}</Text>
                <Text style={body}>{tr("panic.intro_2")}</Text>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <Switch accessibilityLabel={tr("panic.text_mode")} value={textOnly} onValueChange={(v) => setTextOverride(v)} />
                  <Text style={{ fontSize: 16, color: colors.ink }}>{tr("panic.text_mode")}</Text>
                </View>
                <BigButton title={tr("panic.start")} onPress={() => dispatch("start")} />
              </>
            )}

            {state.stage === "breathing" && (
              <>
                {!textOnly && (
                  <View
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                    style={{ width: 220, height: 220, borderRadius: 110, borderWidth: 4, borderColor: colors.brand, backgroundColor: colors.brandTint, transform: [{ scale }] }}
                  />
                )}
                <Text accessibilityLiveRegion="polite" style={big}>{phaseWord}</Text>
                <Text accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ fontSize: 40, color: colors.ink }}>{view.secondsLeft}</Text>
                <Text style={{ fontSize: 15, color: colors.muted }}>{tr("panic.breath_count", { n: view.breath, total: view.totalBreaths })}</Text>
                <BigButton title={tr("panic.skip")} tone="secondary" onPress={() => dispatch("skip")} />
              </>
            )}

            {state.stage === "grounding" && (
              <>
                {state.step === 0 && <Text style={body}>{tr("panic.ground_intro")}</Text>}
                <Text style={{ fontSize: 14, color: colors.muted }}>{tr("panic.step_of", { n: state.step + 1, total: cfg.grounding_counts.length })}</Text>
                <Text accessibilityLiveRegion="polite" style={big}>{tr(groundingKey(cfg.grounding_counts[state.step] ?? 1))}</Text>
                <BigButton title={tr("panic.next")} onPress={() => dispatch("next")} />
              </>
            )}

            {state.stage === "done" && (
              <>
                <Text style={body}>{tr("panic.done_line")}</Text>
                <BigButton title={tr("panic.again")} onPress={() => { setElapsed(0); lastPhase.current = null; dispatch("restart"); }} />
                {told === "sent" ? (
                  <Text accessibilityRole="alert" style={{ fontSize: 16, fontWeight: "600", color: colors.ink, textAlign: "center" }}>{tr("panic.tell_team_sent")}</Text>
                ) : (
                  <BigButton title={told === "sending" ? tr("panic.tell_team_sending") : tr("panic.tell_team")} tone="secondary" disabled={told === "sending"} onPress={() => void tellTeam()} />
                )}
                {told === "error" && <Text accessibilityRole="alert" style={{ fontSize: 15, color: colors.status.critical, textAlign: "center" }}>{tr("panic.tell_team_error")}</Text>}
              </>
            )}
          </>
        )}
      </ScrollView>

      {!help && (
        <View style={{ padding: 16, paddingBottom: 28, gap: 6, borderTopWidth: 1, borderTopColor: colors.status.critical }}>
          <BigButton title={tr("panic.danger")} tone="danger" onPress={() => setHelp(true)} />
          <Text style={{ fontSize: 12, color: colors.muted, textAlign: "center" }}>{tr("panic.danger_hint")}</Text>
        </View>
      )}
    </View>
  );
}
