import { useState } from "react";
import { Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { hasAnyChoice, NOTHING_CHOSEN, parseWellbeingSummary, shareSummaryConfig, summarySections, type SummaryChoices, type WellbeingSummary } from "@tarragon/shared";
import { t, type MessageKey } from "@tarragon/i18n";
import { supabase } from "@/lib/supabase";
import { useLegacyColors, useTextInputStyle } from "@/ui/design";
import { Card, ErrorText, MutedText, PrimaryButton, SecondaryButton } from "@/ui/legacy-kit";

const tr = (key: string, params?: Record<string, string | number>) => t(key as MessageKey, "en", params);

function Check({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  const colors = useLegacyColors();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: value }}
      onPress={() => onChange(!value)}
      style={{ flexDirection: "row", alignItems: "center", gap: 12, minHeight: 48 }}
    >
      <View style={{ width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: colors.brand, backgroundColor: value ? colors.brand : "transparent", alignItems: "center", justifyContent: "center" }}>
        {value ? <Text style={{ color: "#FFFFFF", fontWeight: "700" }}>✓</Text> : null}
      </View>
      <Text style={{ flex: 1, fontSize: 14, color: colors.ink }}>{label}</Text>
    </Pressable>
  );
}

/**
 * "Share with my doctor" on the phone (S56b, function 1). Same rules as the web card: every box starts unticked, the person sees a preview of
 * exactly what would be sent before anything leaves, sending is a separate tap, and the same words can be shown full screen to read out at a
 * visit. Only scores, check-in averages and the sleep diary can be chosen (the database builder cannot reach anything else).
 */
export function ShareSummaryCard({ enabled }: { enabled: boolean }) {
  const colors = useLegacyColors();
  const inputStyle = useTextInputStyle();
  const cfg = shareSummaryConfig();
  const [choices, setChoices] = useState<SummaryChoices>(NOTHING_CHOSEN);
  const [preview, setPreview] = useState<{ summary: WellbeingSummary; note: string } | null>(null);
  const [state, setState] = useState<"idle" | "previewing" | "sending" | "sent" | "error" | "preview_error">("idle");
  const [aloud, setAloud] = useState(false);
  if (!enabled) return null;

  const change = (next: Partial<SummaryChoices>) => {
    setChoices((c) => ({ ...c, ...next }));
    setPreview(null); // a changed choice means the old preview no longer shows what would be sent
    setState("idle");
  };

  async function buildPreview() {
    setState("previewing");
    try {
      const { data, error } = await supabase.rpc("preview_wellbeing_summary", { p_include_screens: choices.screens, p_include_checkins: choices.checkins, p_include_sleep: choices.sleep });
      if (error) throw error;
      setPreview({ summary: parseWellbeingSummary(data), note: choices.note.trim() });
      setState("idle");
    } catch {
      setPreview(null);
      setState("preview_error");
    }
  }

  async function send() {
    setState("sending");
    try {
      const { error } = await supabase.rpc("share_wellbeing_summary_with_care_team", {
        p_include_screens: choices.screens, p_include_checkins: choices.checkins, p_include_sleep: choices.sleep,
        ...(choices.note.trim() === "" ? {} : { p_note: choices.note.trim() }),
      });
      if (error) throw error;
      setState("sent");
    } catch {
      setState("error");
    }
  }

  const sections = preview ? summarySections(preview.summary, preview.note, tr) : [];

  return (
    <Card style={{ gap: 10 }}>
      <Text accessibilityRole="header" style={{ fontSize: 14.5, fontWeight: "700", color: colors.ink }}>{tr("wsum.title")}</Text>
      <MutedText>{tr("wsum.intro")}</MutedText>
      {state === "sent" ? (
        <Text accessibilityRole="alert" style={{ fontSize: 13.5, fontWeight: "600", color: colors.ink }}>{tr("wsum.sent")}</Text>
      ) : (
        <>
          <Check label={tr("wsum.opt_screens")} value={choices.screens} onChange={(v) => change({ screens: v })} />
          <Check label={tr("wsum.opt_checkins")} value={choices.checkins} onChange={(v) => change({ checkins: v })} />
          <Check label={tr("wsum.opt_sleep")} value={choices.sleep} onChange={(v) => change({ sleep: v })} />
          <Text style={{ fontSize: 13, fontWeight: "600", color: colors.ink }}>{tr("wsum.note_label")}</Text>
          <TextInput
            accessibilityLabel={tr("wsum.note_label")}
            multiline
            maxLength={cfg.note_max_chars}
            value={choices.note}
            onChangeText={(v) => change({ note: v })}
            style={[inputStyle, { minHeight: 72, textAlignVertical: "top" }]}
          />
          <MutedText>{tr("wsum.note_hint", { max: cfg.note_max_chars })}</MutedText>
          {!hasAnyChoice(choices) && <MutedText>{tr("wsum.nothing")}</MutedText>}
          <SecondaryButton title={tr("wsum.preview")} onPress={() => void buildPreview()} disabled={!hasAnyChoice(choices)} loading={state === "previewing"} />
          {state === "preview_error" && <ErrorText>{tr("wsum.preview_error")}</ErrorText>}
          {preview && (
            <View style={{ gap: 8, borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 10 }}>
              <Text style={{ fontSize: 13, fontWeight: "700", color: colors.ink }}>{tr("wsum.preview_title")}</Text>
              {sections.map((s) => (
                <View key={s.heading} style={{ gap: 2 }}>
                  <Text style={{ fontSize: 13, fontWeight: "600", color: colors.ink }}>{s.heading}</Text>
                  {s.lines.map((l, i) => <Text key={i} style={{ fontSize: 13, color: colors.ink }}>{`• ${l}`}</Text>)}
                </View>
              ))}
              <PrimaryButton title={state === "sending" ? tr("wsum.sending") : tr("wsum.send")} onPress={() => void send()} loading={state === "sending"} />
              <SecondaryButton title={tr("wsum.read_aloud")} onPress={() => setAloud(true)} />
              {state === "error" && <ErrorText>{tr("wsum.error")}</ErrorText>}
            </View>
          )}
        </>
      )}
      <Modal visible={aloud} animationType="slide" presentationStyle="fullScreen" onRequestClose={() => setAloud(false)}>
        <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: 20, paddingTop: 56, gap: 20 }}>
          <SecondaryButton title={tr("wsum.close_screen")} onPress={() => setAloud(false)} />
          {sections.map((s) => (
            <View key={s.heading} style={{ gap: 6 }}>
              <Text accessibilityRole="header" style={{ fontSize: 22, fontWeight: "700", color: colors.ink }}>{s.heading}</Text>
              {s.lines.map((l, i) => <Text key={i} style={{ fontSize: 18, color: colors.ink }}>{`• ${l}`}</Text>)}
            </View>
          ))}
        </ScrollView>
      </Modal>
    </Card>
  );
}
