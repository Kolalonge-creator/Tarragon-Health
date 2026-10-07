import { useCallback, useEffect, useState } from "react";
import { Alert, Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { ASSISTANT_LIMITS, EMERGENCY_BUTTON_LABEL, EMERGENCY_GUIDANCE, SELF_HARM_GUIDANCE } from "@tarragon/shared";
import {
  REPORT_REASONS,
  addMemoryItem,
  deleteAllMemory,
  deleteMemoryItem,
  emergencyAddendum,
  exportMemory,
  loadMemoryState,
  reportCoachAnswer,
  setMemoryConsent,
  updateMemoryItem,
  type MemoryState,
  type ReportCategory,
} from "@/lib/ai-coach-safety";
import { radius, spacing } from "@/ui/theme";
import { useLegacyColors, useTheme } from "@/ui/design";
import { ErrorText, MutedText, SecondaryButton } from "@/ui/legacy-kit";

/**
 * S52 on the phone: the emergency button (spec 7.8), the limits panel and report-an-answer (7.9) and the patient's own memory (7.12).
 * The emergency guidance is bundled in the app (INV-06): it shows at once with no signal, then the nearest hospitals and the patient's
 * own emergency contact are added when they can be read.
 */
export function EmergencyBlock({ patientId }: { patientId: string }) {
  const colors = useLegacyColors();
  const [open, setOpen] = useState(false);
  const [extra, setExtra] = useState("");
  const guidance = EMERGENCY_GUIDANCE;

  async function show() {
    setOpen(true);
    try {
      setExtra(await emergencyAddendum(patientId));
    } catch {
      // no signal: the bundled guidance already says what to do
    }
  }

  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Emergency"
        onPress={() => void show()}
        style={{ alignSelf: "flex-start", borderWidth: 1.5, borderColor: colors.status.emergency, borderRadius: radius.control, paddingVertical: 6, paddingHorizontal: 14 }}
      >
        <Text style={{ color: colors.status.emergency, fontWeight: "700" }}>{EMERGENCY_BUTTON_LABEL}</Text>
      </Pressable>
      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={{ flex: 1, backgroundColor: colors.background, padding: spacing.screen, paddingTop: 48 }}>
          <ScrollView contentContainerStyle={{ gap: 10 }}>
            <Text accessibilityRole="header" style={{ fontSize: 20, fontWeight: "700", color: colors.ink }}>
              {guidance.title}
            </Text>
            {guidance.lines.map((line) => (
              <Text key={line} style={{ fontSize: 15, color: colors.ink }}>
                {line}
              </Text>
            ))}
            <Text accessibilityRole="header" style={{ fontSize: 16, fontWeight: "700", color: colors.ink, marginTop: 8 }}>
              {SELF_HARM_GUIDANCE.title}
            </Text>
            {SELF_HARM_GUIDANCE.lines.map((line) => (
              <Text key={line} style={{ fontSize: 15, color: colors.ink }}>
                {line}
              </Text>
            ))}
            {extra ? <Text style={{ fontSize: 14, color: colors.ink }}>{extra}</Text> : null}
          </ScrollView>
          <SecondaryButton title="Close" onPress={() => setOpen(false)} />
        </View>
      </Modal>
    </View>
  );
}

export function LimitsBlock() {
  const [open, setOpen] = useState(false);
  return (
    <View style={{ gap: 4 }}>
      <Pressable accessibilityRole="button" onPress={() => setOpen((v) => !v)}>
        <MutedText>{open ? "Hide: " : "Show: "}{ASSISTANT_LIMITS.title}</MutedText>
      </Pressable>
      {open ? ASSISTANT_LIMITS.lines.map((l) => <MutedText key={l}>{l}</MutedText>) : null}
    </View>
  );
}

export function ReportBlock({ interactionId }: { interactionId: string | null }) {
  const colors = useLegacyColors();
  const { scheme } = useTheme();
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<ReportCategory>("incorrect_information");
  const [text, setText] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  if (state === "sent") return <MutedText>Thank you. Your care team has this. Someone will look at it.</MutedText>;
  if (!open) {
    return (
      <Pressable accessibilityRole="button" onPress={() => setOpen(true)}>
        <Text style={{ fontSize: 12, color: colors.brandPressed, textDecorationLine: "underline" }}>Something not right about that answer?</Text>
      </Pressable>
    );
  }
  return (
    <View style={{ gap: 6 }}>
      {REPORT_REASONS.map((r) => (
        <Pressable key={r.value} accessibilityRole="radio" accessibilityState={{ selected: category === r.value }} onPress={() => setCategory(r.value)}>
          <Text style={{ fontSize: 13, color: colors.ink, fontWeight: category === r.value ? "700" : "400" }}>
            {category === r.value ? "(x) " : "( ) "}
            {r.label}
          </Text>
        </Pressable>
      ))}
      <TextInput
        keyboardAppearance={scheme}
        placeholder="What was wrong?"
        placeholderTextColor={colors.subtle}
        multiline
        value={text}
        onChangeText={setText}
        accessibilityLabel="What was wrong with the answer"
        style={{ minHeight: 70, borderWidth: 1, borderColor: colors.border, borderRadius: radius.control, padding: 10, fontSize: 13.5, color: colors.ink, backgroundColor: colors.card, textAlignVertical: "top" }}
      />
      {error ? <ErrorText>{error}</ErrorText> : null}
      <View style={{ flexDirection: "row", gap: 8 }}>
        <SecondaryButton
          title="Send report"
          disabled={state === "sending" || text.trim().length < 5}
          onPress={() => {
            setState("sending");
            setError(null);
            void reportCoachAnswer(category, text.trim(), interactionId).then((r) => {
              if (r.error) {
                setState("error");
                setError(r.error);
              } else setState("sent");
            });
          }}
        />
        <SecondaryButton title="Cancel" onPress={() => setOpen(false)} />
      </View>
    </View>
  );
}

export function MemoryBlock() {
  const colors = useLegacyColors();
  const { scheme } = useTheme();
  const [state, setState] = useState<MemoryState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<"goal" | "preference">("goal");
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [exported, setExported] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const refresh = useCallback(async () => setState(await loadMemoryState()), []);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function run(step: () => Promise<string | null>): Promise<boolean> {
    setError(null);
    const message = await step();
    if (message) setError(message);
    await refresh();
    return !message;
  }

  if (!state) return null;
  const header = (
    <Pressable accessibilityRole="button" onPress={() => setOpen((v) => !v)}>
      <MutedText>{open ? "Hide: " : "Show: "}What I remember about you</MutedText>
    </Pressable>
  );
  if (!state.available) {
    return (
      <View style={{ gap: 4 }}>
        {header}
        {open ? <MutedText>The memory is not switched on yet. Nothing is remembered about you.</MutedText> : null}
      </View>
    );
  }
  return (
    <View style={{ gap: 6 }}>
      {header}
      {open && !state.consented ? (
        <View style={{ gap: 6 }}>
          <MutedText>
            If you switch this on, I will remember the goals and preferences you write here, so I can be more helpful from one chat to the next. I never
            remember health details. You can change, remove or export everything at any time, and switch it off.
          </MutedText>
          <SecondaryButton title="Switch the memory on" onPress={() => void run(() => setMemoryConsent(true))} />
        </View>
      ) : null}
      {open && state.consented ? (
        <View style={{ gap: 6 }}>
          {state.items.length === 0 ? <MutedText>Nothing yet.</MutedText> : null}
          {state.items.map((item) => (
            <View key={item.id} style={{ gap: 4 }}>
              {editing?.id === item.id ? (
                <>
                  <TextInput
                    keyboardAppearance={scheme}
                    placeholderTextColor={colors.subtle}
                    value={editing.text}
                    maxLength={state.maxChars}
                    onChangeText={(t) => setEditing({ id: item.id, text: t })}
                    accessibilityLabel="Change this item"
                    style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.control, padding: 8, fontSize: 13.5, color: colors.ink, backgroundColor: colors.card }}
                  />
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    <SecondaryButton title="Save" onPress={() => void run(() => updateMemoryItem(item.id, editing.text)).then((ok) => ok && setEditing(null))} />
                    <SecondaryButton title="Cancel" onPress={() => setEditing(null)} />
                  </View>
                </>
              ) : (
                <>
                  <Text style={{ fontSize: 13.5, color: colors.ink }}>
                    {item.kind === "goal" ? "Goal: " : "Preference: "}
                    {item.text}
                  </Text>
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    <SecondaryButton title="Change" onPress={() => setEditing({ id: item.id, text: item.text })} />
                    <SecondaryButton title="Remove" onPress={() => void run(() => deleteMemoryItem(item.id))} />
                  </View>
                </>
              )}
            </View>
          ))}
          <View style={{ flexDirection: "row", gap: 8 }}>
            <SecondaryButton title={kind === "goal" ? "Goal" : "Preference"} onPress={() => setKind((k) => (k === "goal" ? "preference" : "goal"))} />
          </View>
          <TextInput
            keyboardAppearance={scheme}
            placeholder="For example: walk after dinner"
            placeholderTextColor={colors.subtle}
            value={draft}
            maxLength={state.maxChars}
            onChangeText={setDraft}
            accessibilityLabel="What to remember"
            style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.control, padding: 8, fontSize: 13.5, color: colors.ink, backgroundColor: colors.card }}
          />
          <SecondaryButton
            title="Remember"
            disabled={draft.trim().length < 3 || state.items.length >= state.maxItems}
            onPress={() => void run(() => addMemoryItem(kind, draft)).then((ok) => ok && setDraft(""))}
          />
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            <SecondaryButton
              title="Export"
              onPress={() =>
                void exportMemory().then((r) => {
                  if ("json" in r) setExported(r.json);
                  else setError(r.error);
                })
              }
            />
            <SecondaryButton title="Remove everything" onPress={() => void run(() => deleteAllMemory())} />
            <SecondaryButton
              title="Switch the memory off"
              onPress={() =>
                Alert.alert(
                  "Switch the memory off?",
                  "This also removes everything it remembers. Export first if you want to keep a copy.",
                  [
                    { text: "Keep it on", style: "cancel" },
                    { text: "Switch off and remove", style: "destructive", onPress: () => void run(() => setMemoryConsent(false)) },
                  ],
                )
              }
            />
          </View>
          {exported ? <Text selectable style={{ fontSize: 12, color: colors.ink }}>{exported}</Text> : null}
        </View>
      ) : null}
      {error ? <ErrorText>{error}</ErrorText> : null}
    </View>
  );
}
