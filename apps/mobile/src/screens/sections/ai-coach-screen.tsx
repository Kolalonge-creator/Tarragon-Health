import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, Pressable, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { CoachChatMessage, CoachSource } from "@tarragon/shared";
import {
  COACH_DISCLAIMER,
  COACH_SUGGESTION_SECTION,
  describeCoachSource,
  hasCoachAccess,
  isAssistantOpen,
  loadAiConversation,
  loadAssistantNudges,
  requestCareTeamHandoff,
  runCoachQuickAction,
  sendApprovedPrepDraft,
  sendCoachMessage,
} from "@/lib/ai-coach";
import type { SectionId } from "@/lib/sections";
import { radius, spacing } from "@/ui/theme";
import { useLegacyColors, useTheme } from "@/ui/design";
import { ErrorText, MutedText, SecondaryButton } from "@/ui/legacy-kit";
import { EmergencyBlock, LimitsBlock, MemoryBlock, ReportBlock } from "./ai-coach-extras";

interface AiCoachScreenProps {
  patientId: string;
  onNavigate: (section: SectionId) => void;
}

const QUICK_ACTIONS: { kind: "explain_record" | "care_plan_summary" | "appointment_prep"; label: string }[] = [
  { kind: "explain_record", label: "Explain my health record" },
  { kind: "care_plan_summary", label: "What do I need this month?" },
  { kind: "appointment_prep", label: "Help me prepare for my appointment" },
];

function tierStyle(tier: CoachChatMessage["tier"], colors: ReturnType<typeof useLegacyColors>) {
  if (tier === "emergency") {
    return { borderColor: colors.status.emergency, borderWidth: 1.5, backgroundColor: colors.dangerBg };
  }
  if (tier === "clinician_review") {
    return { borderColor: colors.status.warn, borderWidth: 1, backgroundColor: colors.status.warnBg };
  }
  return { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card };
}

/**
 * Native AI Health Coach. Web's version (ai-coach-chat.tsx) has no native
 * counterpart at all -- the app previously only reached it by opening the
 * live web page in the system browser (care-support-screen.tsx). This is a
 * real native chat screen, but the turn itself (entitlement, rate limiting,
 * the governed Claude call, the emergency-keyword safety net, the audit
 * write) only runs server-side -- see apps/web/src/app/api/mobile/ai-coach/
 * -- so this file is UI only, never a second implementation of that logic.
 *
 * Deliberately not built here: the "this was wrong" report (§40.12,
 * ReportAiAnswer on web) and the daily-pass rate-limit upsell CTA -- both
 * are non-safety-critical add-ons on top of a working chat, not part of
 * closing the "no native AI Coach at all" gap this screen closes.
 */
export function AiCoachScreen({ patientId, onNavigate }: AiCoachScreenProps) {
  const colors = useLegacyColors();
  const { scheme } = useTheme();
  const [access, setAccess] = useState<"checking" | "denied" | "not_open" | "granted">("checking");
  const [conversationId, setConversationId] = useState<string | undefined>(undefined);
  const [messages, setMessages] = useState<CoachChatMessage[]>([]);
  // A report is about the LATEST assistant answer on screen, and only when that answer carries its own id (also after the app is reopened).
  const reportableId = [...messages].reverse().find((m) => m.role === "assistant")?.interactionId ?? null;
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [handoff, setHandoff] = useState<"idle" | "pending" | "done" | "error">("idle");
  const [handoffError, setHandoffError] = useState<string | null>(null);
  // S51 (7.7, INV-11): the pre-visit draft. Editable, sent only when the patient presses Send, never written to the record.
  const [nudge, setNudge] = useState<{ text: string; week: string; section: string } | null>(null);
  const [prepDraft, setPrepDraft] = useState<string | null>(null);
  const [prepState, setPrepState] = useState<"editing" | "sending" | "sent" | "error">("editing");
  const [prepError, setPrepError] = useState<string | null>(null);
  const listRef = useRef<FlatList>(null);

  const load = useCallback(async () => {
    const [open, canAccess, conversation] = await Promise.all([
      isAssistantOpen(),
      hasCoachAccess(),
      loadAiConversation(patientId),
    ]);
    setAccess(!open ? "not_open" : canAccess ? "granted" : "denied");
    setConversationId(conversation.conversationId);
    setMessages(conversation.messages);
  }, [patientId]);

  useEffect(() => {
    // S51 (7.5): today's nudge and the weekly reflection. Best effort: the chat works without it.
    loadAssistantNudges()
      .then((n) => {
        if (n.daily) setNudge({ text: n.daily.text, week: n.weekly?.text ?? "", section: n.daily.target.section });
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    load()
      .catch(() => setAccess("denied"))
      .finally(() => setLoading(false));
  }, [load]);

  function scrollToEnd() {
    requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
  }

  async function handleSend() {
    const message = draft.trim();
    if (!message || sending) return;
    setDraft("");
    setError(null);
    setSending(true);
    try {
      const result = await sendCoachMessage(message, conversationId);
      if (result.error) {
        setError(result.error);
        return;
      }
      setConversationId(result.conversationId);
      const conversation = await loadAiConversation(patientId);
      setMessages(conversation.messages);
      scrollToEnd();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't send that. Try again.");
    } finally {
      setSending(false);
    }
  }

  async function handleQuickAction(kind: (typeof QUICK_ACTIONS)[number]["kind"]) {
    if (sending) return;
    setError(null);
    setSending(true);
    try {
      const result = await runCoachQuickAction(kind, conversationId);
      if (result.error) {
        setError(result.error);
        return;
      }
      setConversationId(result.conversationId);
      setPrepDraft(result.draft ?? null);
      setPrepState("editing");
      setPrepError(null);
      const conversation = await loadAiConversation(patientId);
      setMessages(conversation.messages);
      scrollToEnd();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't do that right now. Try again.");
    } finally {
      setSending(false);
    }
  }

  async function handleSendPrepDraft() {
    if (prepDraft === null || prepState === "sending") return;
    setPrepState("sending");
    setPrepError(null);
    const result = await sendApprovedPrepDraft(prepDraft, conversationId);
    if (result.error) {
      setPrepState("error");
      setPrepError(result.error);
    } else {
      setPrepState("sent");
    }
  }

  async function handleHandoff() {
    setHandoff("pending");
    setHandoffError(null);
    const result = await requestCareTeamHandoff(conversationId);
    if (result.error) {
      setHandoff("error");
      setHandoffError(result.error);
    } else {
      setHandoff("done");
    }
  }

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }

  if (access === "not_open") {
    return (
      <View style={{ flex: 1, padding: spacing.screen, gap: 8 }}>
        <EmergencyBlock patientId={patientId} />
        <Text style={{ fontSize: 20, fontWeight: "700", color: colors.ink }}>AI Health Coach</Text>
        <MutedText>The assistant is not open yet. If you need help now, send your care team a message in the app.</MutedText>
      </View>
    );
  }

  if (access === "denied") {
    return (
      <View style={{ flex: 1, padding: spacing.screen, gap: 8 }}>
        <EmergencyBlock patientId={patientId} />
        <Text style={{ fontSize: 20, fontWeight: "700", color: colors.ink }}>AI Health Coach</Text>
        <MutedText>
          The AI Coach isn&apos;t included on your current plan. Contact your care team if you think
          this is a mistake.
        </MutedText>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.background }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={90}
    >
      <View style={{ padding: spacing.screen, paddingBottom: 8, gap: 6 }}>
        {/* S52 (7.8): the emergency button is on every assistant screen, always visible, never behind a guard */}
        <EmergencyBlock patientId={patientId} />
        <Text style={{ fontSize: 20, fontWeight: "700", color: colors.ink }}>AI Health Coach</Text>
        <MutedText>Ask me anything about your health. I&apos;m here to help you understand what to do next.</MutedText>
      </View>

      {nudge ? (
        <View style={{ paddingHorizontal: spacing.screen, paddingBottom: 8, gap: 2 }}>
          <Text style={{ fontSize: 13, color: colors.ink }}>{nudge.text}</Text>
          {nudge.week ? <MutedText>{nudge.week}</MutedText> : null}
        </View>
      ) : null}

      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(m) => m.id}
        contentContainerStyle={{ paddingHorizontal: spacing.screen, gap: 8, paddingBottom: 12 }}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
        ListEmptyComponent={
          <MutedText>Ask a question below, or try one of the suggestions.</MutedText>
        }
        renderItem={({ item }) => {
          const fromMe = item.role === "user";
          const suggestedAction = item.suggestedAction;
          const suggestion =
            suggestedAction && suggestedAction !== "none"
              ? COACH_SUGGESTION_SECTION[suggestedAction as keyof typeof COACH_SUGGESTION_SECTION]
              : null;
          return (
            <View style={{ flexDirection: "row", justifyContent: fromMe ? "flex-end" : "flex-start" }}>
              <View
                style={{
                  maxWidth: "85%",
                  paddingVertical: 8,
                  paddingHorizontal: 12,
                  borderRadius: 14,
                  ...(fromMe
                    ? { backgroundColor: colors.brand }
                    : tierStyle(item.tier, colors)),
                }}
              >
                <Text style={{ fontSize: 13.5, color: fromMe ? "#fff" : colors.ink }}>{item.content}</Text>
                {!fromMe && item.sources && item.sources.length > 0 ? (
                  <View style={{ marginTop: 4 }}>
                    <MutedText>{"Sources: " + item.sources.map((s: CoachSource) => describeCoachSource(s)).join("; ")}</MutedText>
                  </View>
                ) : null}
                <Text
                  style={{
                    fontSize: 10,
                    marginTop: 2,
                    color: fromMe ? "rgba(255,255,255,0.7)" : colors.faint,
                  }}
                >
                  {new Date(item.created_at).toLocaleString()}
                </Text>
                {suggestion && (
                  <Pressable onPress={() => onNavigate(suggestion.section as SectionId)} style={{ marginTop: 4 }}>
                    <Text style={{ fontSize: 12, color: colors.brandPressed, textDecorationLine: "underline" }}>
                      {suggestion.label} →
                    </Text>
                  </Pressable>
                )}
              </View>
            </View>
          );
        }}
        ListFooterComponent={
          sending ? (
            <View
              style={{
                maxWidth: "85%",
                borderRadius: 14,
                paddingVertical: 8,
                paddingHorizontal: 12,
                backgroundColor: colors.card,
                borderWidth: 1,
                borderColor: colors.border,
              }}
            >
              <MutedText>Thinking…</MutedText>
            </View>
          ) : null
        }
      />

      {error ? (
        <View style={{ paddingHorizontal: spacing.screen }}>
          <ErrorText>{error}</ErrorText>
        </View>
      ) : null}

      {prepDraft !== null && prepState !== "sent" ? (
        <View style={{ paddingHorizontal: spacing.screen, paddingTop: 8, gap: 6 }}>
          <MutedText>Your message for your care team. Change anything you like. Nothing is sent until you press Send.</MutedText>
          <TextInput
            keyboardAppearance={scheme}
            placeholderTextColor={colors.subtle}
            multiline
            value={prepDraft}
            onChangeText={setPrepDraft}
            maxLength={4000}
            accessibilityLabel="Message for your care team"
            style={{
              minHeight: 120,
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: radius.control,
              padding: 10,
              fontSize: 13.5,
              color: colors.ink,
              backgroundColor: colors.card,
              textAlignVertical: "top",
            }}
          />
          {prepError ? <ErrorText>{prepError}</ErrorText> : null}
          <View style={{ flexDirection: "row", gap: 8 }}>
            <SecondaryButton title="Send to my care team" disabled={prepState === "sending" || prepDraft.trim().length < 10} onPress={() => void handleSendPrepDraft()} />
            <SecondaryButton title="Discard" onPress={() => setPrepDraft(null)} />
          </View>
        </View>
      ) : null}
      {prepState === "sent" ? (
        <View style={{ paddingHorizontal: spacing.screen, paddingTop: 8 }}>
          <MutedText>Sent to your care team. You will see their reply in Messages.</MutedText>
        </View>
      ) : null}

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, paddingHorizontal: spacing.screen, paddingTop: 8 }}>
        {QUICK_ACTIONS.map((action) => (
          <SecondaryButton
            key={action.kind}
            title={action.label}
            disabled={sending}
            onPress={() => void handleQuickAction(action.kind)}
          />
        ))}
      </View>

      <View style={{ flexDirection: "row", gap: 8, padding: spacing.screen, paddingTop: 8 }}>
        <TextInput keyboardAppearance={scheme}
          placeholder="Type a message…"
          placeholderTextColor={colors.subtle}
          value={draft}
          onChangeText={setDraft}
          editable={!sending}
          style={{
            flex: 1,
            height: 42,
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: radius.control,
            paddingHorizontal: 12,
            fontSize: 13.5,
            color: colors.ink,
            backgroundColor: colors.card,
          }}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Send message"
          accessibilityState={{ disabled: sending || !draft.trim() }}
          onPress={() => void handleSend()}
          disabled={sending || !draft.trim()}
          style={{
            backgroundColor: sending || !draft.trim() ? colors.faint : colors.brand,
            borderRadius: radius.control,
            paddingHorizontal: 16,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Ionicons name="send" size={16} color="#fff" />
        </Pressable>
      </View>

      <View style={{ paddingHorizontal: spacing.screen, paddingBottom: 6, gap: 6 }}>
        <MutedText>{COACH_DISCLAIMER}</MutedText>
        <LimitsBlock />
        {messages.length > 0 ? <ReportBlock key={reportableId ?? "none"} interactionId={reportableId} /> : null}
        <MemoryBlock />
      </View>

      <View style={{ paddingHorizontal: spacing.screen, paddingBottom: spacing.screen }}>
        {handoff === "idle" && (
          <Pressable onPress={() => void handleHandoff()}>
            <Text style={{ fontSize: 12, color: colors.brandPressed, textDecorationLine: "underline" }}>
              I want to speak to someone
            </Text>
          </Pressable>
        )}
        {handoff === "pending" && <MutedText>Starting a conversation with your care team…</MutedText>}
        {handoff === "done" && (
          <Pressable onPress={() => onNavigate("messages")}>
            <Text style={{ fontSize: 12, color: colors.ink }}>
              Sent. Your care team has what you&apos;ve talked about here.{" "}
              <Text style={{ color: colors.brandPressed, textDecorationLine: "underline" }}>Continue in Messages</Text>
            </Text>
          </Pressable>
        )}
        {handoff === "error" && <ErrorText>{handoffError}</ErrorText>}
      </View>
    </KeyboardAvoidingView>
  );
}
