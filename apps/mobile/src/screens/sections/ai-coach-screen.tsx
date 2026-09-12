import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, Pressable, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { CoachChatMessage } from "@tarragon/shared";
import {
  COACH_DISCLAIMER,
  COACH_SUGGESTION_SECTION,
  hasCoachAccess,
  loadAiConversation,
  requestCareTeamHandoff,
  runCoachQuickAction,
  sendCoachMessage,
} from "@/lib/ai-coach";
import type { SectionId } from "@/lib/sections";
import { colors, radius, spacing } from "@/ui/theme";
import { ErrorText, MutedText, SecondaryButton } from "@/ui/components";

interface AiCoachScreenProps {
  patientId: string;
  onNavigate: (section: SectionId) => void;
}

const QUICK_ACTIONS: { kind: "explain_record" | "care_plan_summary" | "appointment_prep"; label: string }[] = [
  { kind: "explain_record", label: "Explain my health record" },
  { kind: "care_plan_summary", label: "What do I need this month?" },
  { kind: "appointment_prep", label: "Help me prepare for my appointment" },
];

function tierStyle(tier: CoachChatMessage["tier"]) {
  if (tier === "emergency") {
    return { borderColor: colors.status.emergency, borderWidth: 1.5, backgroundColor: "#FEF1F1" };
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
  const [access, setAccess] = useState<"checking" | "denied" | "granted">("checking");
  const [conversationId, setConversationId] = useState<string | undefined>(undefined);
  const [messages, setMessages] = useState<CoachChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [handoff, setHandoff] = useState<"idle" | "pending" | "done" | "error">("idle");
  const [handoffError, setHandoffError] = useState<string | null>(null);
  const listRef = useRef<FlatList>(null);

  const load = useCallback(async () => {
    const [canAccess, conversation] = await Promise.all([
      hasCoachAccess(),
      loadAiConversation(patientId),
    ]);
    setAccess(canAccess ? "granted" : "denied");
    setConversationId(conversation.conversationId);
    setMessages(conversation.messages);
  }, [patientId]);

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
      const conversation = await loadAiConversation(patientId);
      setMessages(conversation.messages);
      scrollToEnd();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't do that right now. Try again.");
    } finally {
      setSending(false);
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

  if (access === "denied") {
    return (
      <View style={{ flex: 1, padding: spacing.screen, gap: 8 }}>
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
      <View style={{ padding: spacing.screen, paddingBottom: 8 }}>
        <Text style={{ fontSize: 20, fontWeight: "700", color: colors.ink }}>AI Health Coach</Text>
        <MutedText>Ask me anything about your health. I&apos;m here to help you understand what to do next.</MutedText>
      </View>

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
                    : tierStyle(item.tier)),
                }}
              >
                <Text style={{ fontSize: 13.5, color: fromMe ? "#fff" : colors.ink }}>{item.content}</Text>
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
                    <Text style={{ fontSize: 12, color: colors.brand, textDecorationLine: "underline" }}>
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
        <TextInput
          placeholder="Type a message…"
          placeholderTextColor={colors.faint}
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

      <View style={{ paddingHorizontal: spacing.screen, paddingBottom: 6 }}>
        <MutedText>{COACH_DISCLAIMER}</MutedText>
      </View>

      <View style={{ paddingHorizontal: spacing.screen, paddingBottom: spacing.screen }}>
        {handoff === "idle" && (
          <Pressable onPress={() => void handleHandoff()}>
            <Text style={{ fontSize: 12, color: colors.brand, textDecorationLine: "underline" }}>
              I want to speak to someone
            </Text>
          </Pressable>
        )}
        {handoff === "pending" && <MutedText>Starting a conversation with your care team…</MutedText>}
        {handoff === "done" && (
          <Pressable onPress={() => onNavigate("messages")}>
            <Text style={{ fontSize: 12, color: colors.ink }}>
              Sent. Your care team has what you&apos;ve talked about here.{" "}
              <Text style={{ color: colors.brand, textDecorationLine: "underline" }}>Continue in Messages</Text>
            </Text>
          </Pressable>
        )}
        {handoff === "error" && <ErrorText>{handoffError}</ErrorText>}
      </View>
    </KeyboardAvoidingView>
  );
}
