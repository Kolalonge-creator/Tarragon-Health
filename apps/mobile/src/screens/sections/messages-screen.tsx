import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, FlatList, KeyboardAvoidingView, Platform, TextInput, View } from "react-native";
import { asLocale, t, type MessageKey } from "@tarragon/i18n";
import { useUiLanguage } from "@/lib/ui-language";
import { loadThreadMessages, loadThreads, postMessage, startThread, type CareMessage } from "@/lib/messages";
import { clearDraft, loadDraft, saveDraft } from "@/lib/drafts";
import { MAX_FONT_SCALE, MIN_TARGET, radii, space, textStyles, useTheme } from "@/ui/design";
import { AppText, Button, EmptyState, Icon, InlineAlert, PressableScale, Skeleton, SkeletonGroup } from "@/ui/kit";

interface MessagesScreenProps {
  patientId: string;
}

const draftKey = (patientId: string) => `messages:draft:${patientId}`;

function formatSentAt(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    timeZone: "Africa/Lagos",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function MessagesScreen({ patientId }: MessagesScreenProps) {
  const { colors, scheme } = useTheme();
  const locale = asLocale(useUiLanguage());
  const tr = (key: MessageKey, params?: Record<string, string | number>) => t(key, locale, params);

  const [threadId, setThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<CareMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  // A failed thread fetch must not render the "send a message to start a
  // conversation" empty state over a thread that exists — loadError replaces
  // the list with an explicit retry state instead.
  const [loadError, setLoadError] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendFailed, setSendFailed] = useState(false);
  const listRef = useRef<FlatList<CareMessage>>(null);

  const load = useCallback(async () => {
    const threads = await loadThreads(patientId);
    const openThread = threads.find((th) => th.status === "open") ?? threads[0] ?? null;
    setThreadId(openThread?.id ?? null);
    if (openThread) {
      setMessages(await loadThreadMessages(openThread.id));
    }
    setLoadError(false);
  }, [patientId]);

  useEffect(() => {
    load()
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  }, [load]);

  // A half-written message survives the app being closed (power cuts, calls).
  useEffect(() => {
    let cancelled = false;
    loadDraft<string>(draftKey(patientId))
      .then((saved) => {
        if (!cancelled && typeof saved === "string" && saved) setDraft((current) => current || saved);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [patientId]);

  const retryLoad = useCallback(() => {
    setLoading(true);
    setLoadError(false);
    load()
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  }, [load]);

  // Live-feeling updates while foregrounded (MOBILE_APP_SPEC.md §2.6) via
  // polling, not Postgres Realtime: care_messages/care_message_threads
  // aren't in the supabase_realtime publication yet, and turning that on
  // needs a migration plus verifying Realtime actually respects this
  // table's RLS (postgres_changes doesn't apply RLS by default — an
  // unverified enable here risks leaking one patient's thread to another,
  // the same class of bug as past cross-tenant incidents in this codebase).
  // That's paused for the same reason as the other production-DB items.
  // Polls only while the app is foregrounded — a background interval both
  // wastes the patient's data and keeps hitting the API for a screen nobody
  // is looking at.
  useEffect(() => {
    if (!threadId) return;
    let appActive = AppState.currentState === "active";
    const subscription = AppState.addEventListener("change", (state) => {
      appActive = state === "active";
    });
    const interval = setInterval(() => {
      if (!appActive) return;
      loadThreadMessages(threadId)
        .then((fresh) => setMessages((prev) => (fresh.length !== prev.length ? fresh : prev)))
        .catch(() => {});
    }, 8000);
    return () => {
      subscription.remove();
      clearInterval(interval);
    };
  }, [threadId]);

  function onChangeDraft(text: string) {
    setDraft(text);
    void saveDraft(draftKey(patientId), text);
  }

  async function handleSend() {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    setSendFailed(false);
    let sent = false;
    try {
      let activeThreadId = threadId;
      if (activeThreadId) {
        await postMessage(activeThreadId, body);
      } else {
        activeThreadId = await startThread("Message from patient", body);
        setThreadId(activeThreadId);
      }
      sent = true;
      // Sent. Clear the box now (unless more was typed meanwhile), so a failed refresh below
      // can never leave the same text there to be sent twice.
      setDraft((current) => (current.trim() === body ? "" : current));
      void clearDraft(draftKey(patientId));
      setMessages(await loadThreadMessages(activeThreadId));
      requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
    } catch {
      // A failed send keeps the draft in the box so nothing the patient wrote is lost.
      // A send that went through but whose refresh failed is not a failed send: the next poll catches up.
      if (!sent) setSendFailed(true);
    } finally {
      setSending(false);
    }
  }

  // Scrolls away with the conversation, so at large text sizes the messages keep the screen.
  const header = (
    <View style={{ paddingBottom: space.sm, gap: space.xs }}>
      <AppText variant="headline" heading>
        {tr("messages.title")}
      </AppText>
      <AppText variant="body" tone="textMuted">
        {tr("messages.subtitle")}
      </AppText>
    </View>
  );

  const canSend = !sending && draft.trim().length > 0;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.canvas }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={90}
    >
      {loading ? (
        <View style={{ padding: space.xl, gap: space.lg }}>
          {header}
          <SkeletonGroup label={tr("messages.loading")}>
            <View style={{ gap: space.md }}>
              <Skeleton height={48} width="70%" radius={radii.lg} />
              <Skeleton height={48} width="55%" radius={radii.lg} style={{ alignSelf: "flex-end" }} />
            </View>
          </SkeletonGroup>
        </View>
      ) : loadError ? (
        <View style={{ flex: 1, padding: space.xl, gap: space.md }}>
          {header}
          <InlineAlert tone="info" message={`${tr("messages.load_error.title")}. ${tr("messages.load_error.body")}`} />
          <Button title={tr("messages.load_error.retry")} variant="secondary" onPress={retryLoad} />
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={messages}
          ListHeaderComponent={header}
          keyExtractor={(m) => m.id}
          contentContainerStyle={{ paddingTop: space.xl, paddingHorizontal: space.xl, gap: space.sm, paddingBottom: space.md, flexGrow: 1 }}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          ListEmptyComponent={<EmptyState icon="messages" title={tr("messages.empty.title")} body={tr("messages.empty.body")} />}
          renderItem={({ item }) => {
            const fromMe = item.author_role === "patient";
            // Attribution is null-gated: a care-team message shows the real name only when
            // the record carries one, otherwise the plain team label. Never an invented name.
            const sender = fromMe ? tr("messages.sender.you") : (item.actor?.full_name ?? tr("messages.sender.team"));
            const sentAt = formatSentAt(item.created_at);
            return (
              <View style={{ flexDirection: "row", justifyContent: fromMe ? "flex-end" : "flex-start" }}>
                <View
                  accessible
                  accessibilityLabel={tr("messages.message.a11y", { sender, time: sentAt, body: item.body })}
                  style={{
                    maxWidth: "85%",
                    gap: space.xs,
                    paddingVertical: space.md,
                    paddingHorizontal: space.lg,
                    borderRadius: radii.lg,
                    backgroundColor: fromMe ? colors.brand : colors.surface,
                    borderWidth: fromMe ? 0 : 1,
                    borderColor: colors.border,
                  }}
                >
                  {fromMe ? null : (
                    <AppText variant="label" tone="brandText">
                      {sender}
                    </AppText>
                  )}
                  <AppText variant="body" tone={fromMe ? "textOnBrand" : "text"}>
                    {item.body}
                  </AppText>
                  <AppText variant="caption" tone={fromMe ? "textOnBrand" : "textSubtle"}>
                    {sentAt}
                  </AppText>
                </View>
              </View>
            );
          }}
        />
      )}

      {sendFailed ? (
        <View style={{ paddingHorizontal: space.xl, paddingBottom: space.sm }}>
          <InlineAlert tone="danger" message={tr("messages.send_error")} />
        </View>
      ) : null}

      <View style={{ flexDirection: "row", alignItems: "flex-end", gap: space.sm, padding: space.xl, paddingTop: space.sm }}>
        <TextInput
          accessibilityLabel={tr("messages.composer.label")}
          placeholder={tr("messages.composer.label")}
          placeholderTextColor={colors.textSubtle}
          value={draft}
          onChangeText={onChangeDraft}
          multiline
          keyboardAppearance={scheme}
          maxFontSizeMultiplier={MAX_FONT_SCALE}
          style={[
            textStyles.body,
            {
              flex: 1,
              minHeight: MIN_TARGET,
              maxHeight: 120,
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: radii.md,
              paddingHorizontal: space.lg,
              paddingVertical: space.md,
              color: colors.text,
              backgroundColor: colors.surface,
            },
          ]}
        />
        <PressableScale
          onPress={() => void handleSend()}
          disabled={!canSend}
          accessibilityRole="button"
          accessibilityLabel={tr("messages.send")}
          accessibilityState={{ disabled: !canSend, busy: sending }}
          style={{
            width: MIN_TARGET,
            borderRadius: radii.md,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: canSend ? colors.brand : colors.surfaceMuted,
          }}
        >
          <Icon name="send" size={18} tone={canSend ? "textOnBrand" : "textSubtle"} />
        </PressableScale>
      </View>
    </KeyboardAvoidingView>
  );
}
