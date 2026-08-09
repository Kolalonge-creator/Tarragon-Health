import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, Text, TextInput, View } from "react-native";
import { loadThreadMessages, loadThreads, postMessage, startThread, type CareMessage } from "@/lib/messages";
import { colors, radius, spacing } from "@/ui/theme";
import { ErrorText, MutedText } from "@/ui/components";
import { Ionicons } from "@expo/vector-icons";
import { Pressable } from "react-native";

interface MessagesScreenProps {
  patientId: string;
}

export function MessagesScreen({ patientId }: MessagesScreenProps) {
  const [threadId, setThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<CareMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<FlatList>(null);

  const load = useCallback(async () => {
    const threads = await loadThreads(patientId);
    const openThread = threads.find((t) => t.status === "open") ?? threads[0] ?? null;
    setThreadId(openThread?.id ?? null);
    if (openThread) {
      setMessages(await loadThreadMessages(openThread.id));
    }
  }, [patientId]);

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, [load]);

  async function handleSend() {
    const body = draft.trim();
    if (!body) return;
    setSending(true);
    setError(null);
    try {
      if (threadId) {
        await postMessage(threadId, body);
        setMessages(await loadThreadMessages(threadId));
      } else {
        const newThreadId = await startThread("Message from patient", body);
        setThreadId(newThreadId);
        setMessages(await loadThreadMessages(newThreadId));
      }
      setDraft("");
      requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't send that — try again.");
    } finally {
      setSending(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.background }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={90}
    >
      <View style={{ padding: spacing.screen, paddingBottom: 8 }}>
        <Text style={{ fontSize: 20, fontWeight: "700", color: colors.ink }}>Messages</Text>
        <MutedText>Your care team, in-app only.</MutedText>
      </View>

      {loading ? (
        <ActivityIndicator color={colors.brand} style={{ marginTop: 20 }} />
      ) : (
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(m) => m.id}
          contentContainerStyle={{ paddingHorizontal: spacing.screen, gap: 8, paddingBottom: 12 }}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          ListEmptyComponent={<MutedText>Send a message to start a conversation with your care team.</MutedText>}
          renderItem={({ item }) => {
            const fromMe = item.author_role === "patient";
            return (
              <View style={{ flexDirection: "row", justifyContent: fromMe ? "flex-end" : "flex-start" }}>
                <View
                  style={{
                    maxWidth: "80%",
                    paddingVertical: 8,
                    paddingHorizontal: 12,
                    borderRadius: 14,
                    backgroundColor: fromMe ? colors.brand : colors.card,
                    borderWidth: fromMe ? 0 : 1,
                    borderColor: colors.border,
                  }}
                >
                  <Text style={{ fontSize: 13, color: fromMe ? "#fff" : colors.ink }}>{item.body}</Text>
                  <Text style={{ fontSize: 10, marginTop: 2, color: fromMe ? "rgba(255,255,255,0.7)" : colors.faint }}>
                    {new Date(item.created_at).toLocaleString()}
                  </Text>
                </View>
              </View>
            );
          }}
        />
      )}

      {error ? <View style={{ paddingHorizontal: spacing.screen }}><ErrorText>{error}</ErrorText></View> : null}

      <View style={{ flexDirection: "row", gap: 8, padding: spacing.screen, paddingTop: 8 }}>
        <TextInput
          placeholder="Message your care team…"
          placeholderTextColor={colors.faint}
          value={draft}
          onChangeText={setDraft}
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
          onPress={handleSend}
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
    </KeyboardAvoidingView>
  );
}
