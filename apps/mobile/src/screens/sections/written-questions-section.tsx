import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Image, Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { asLocale, t, type MessageKey } from "@tarragon/i18n";
import { clearDraft, loadDraft, saveDraft } from "@/lib/drafts";
import { useUiLanguage } from "@/lib/ui-language";
import { supabase } from "@/lib/supabase";
import { isTerminalWrittenQuestionError } from "@/lib/written-questions/errors";
import {
  loadAllowance,
  loadWrittenQuestions,
  postWrittenQuestionMessage,
  submitWrittenQuestion,
  uploadQuestionPhoto,
} from "@/lib/written-questions/api";
import {
  checkPhotoAdd,
  checkQuestionLength,
  DEFAULT_MAX_PHOTO_BYTES,
  DEFAULT_MAX_PHOTOS,
  DURATION_MAX_CHARS,
  QUESTION_MAX_CHARS,
  QUESTION_MIN_CHARS,
} from "@/lib/written-questions/limits";
import { nextGate, redFlagForQuestion } from "@/lib/written-questions/red-flag";
import { viewQuestion } from "@/lib/written-questions/status";
import {
  WRITTEN_QUESTION_CATEGORIES,
  type WrittenQuestion,
  type WrittenQuestionAllowance,
  type WrittenQuestionCategory,
} from "@/lib/written-questions/types";
import { colors as themeColors, radius, spacing } from "@/ui/theme";
import { placeholderColorFor, useLegacyColors, useTextInputStyle, useTheme } from "@/ui/design";
import { Badge, Card, ErrorText, MutedText, PrimaryButton, SecondaryButton } from "@/ui/legacy-kit";

const DRAFT_KEY = "written-question";

interface QuestionDraft {
  category: WrittenQuestionCategory;
  question: string;
  duration: string;
}

interface PickedPhoto {
  uri: string;
}

function lagos(iso: string, withTime: boolean): string {
  return new Date(iso).toLocaleString("en-GB", {
    timeZone: "Africa/Lagos",
    day: "numeric",
    month: "short",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  });
}

/**
 * "Ask your care team" (S22): a written question that is answered in the app.
 * Everything goes through the database functions; there is no direct table
 * access. The red-flag check runs on the phone before anything is sent (INV-01,
 * INV-06) and works with no signal. The draft is saved on every change so a
 * dead battery loses nothing. No price, balance or credit is shown (INV-09).
 *
 * Offline: the S06 outbox carries single-row logs (readings, symptoms, doses)
 * and cannot carry a question followed by photo uploads, so a send with no
 * signal keeps the draft and says so rather than queueing half a submission.
 */
export function WrittenQuestionsSection() {
  const colors = useLegacyColors();
  const textInputStyle = useTextInputStyle();
  const { scheme } = useTheme();
  const locale = asLocale(useUiLanguage());
  const tr = useCallback(
    (key: MessageKey, params?: Record<string, string | number>) => t(key, locale, params),
    [locale],
  );

  const [allowance, setAllowance] = useState<WrittenQuestionAllowance | null>(null);
  const [questions, setQuestions] = useState<WrittenQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState<WrittenQuestionCategory>("general");
  const [question, setQuestion] = useState("");
  const [duration, setDuration] = useState("");
  const [photos, setPhotos] = useState<PickedPhoto[]>([]);
  const [draftReady, setDraftReady] = useState(false);
  const [draftSaved, setDraftSaved] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorKey, setErrorKey] = useState<MessageKey | null>(null);
  const [sent, setSent] = useState(false);
  const [photoFailed, setPhotoFailed] = useState(false);
  const [gateOpen, setGateOpen] = useState(false);

  const refresh = useCallback(async () => {
    const [a, q] = await Promise.all([loadAllowance(), loadWrittenQuestions()]);
    if (a.ok) setAllowance(a.data);
    if (q.ok) setQuestions(q.data);
  }, []);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const draft = await loadDraft<QuestionDraft>(DRAFT_KEY);
      if (alive && draft) {
        setCategory(draft.category);
        setQuestion(draft.question);
        setDuration(draft.duration);
        setDraftSaved(draft.question.length > 0);
      }
      if (alive) setDraftReady(true);
      await refresh();
      if (alive) setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [refresh]);

  // Saved on every change (power-cut resilience, spec section 11).
  useEffect(() => {
    if (!draftReady) return;
    if (question.length === 0 && duration.length === 0) {
      void clearDraft(DRAFT_KEY);
      setDraftSaved(false);
      return;
    }
    void saveDraft(DRAFT_KEY, { category, question, duration } satisfies QuestionDraft).then(() => setDraftSaved(true));
  }, [draftReady, category, question, duration]);

  const maxPhotos = allowance?.maxPhotos ?? DEFAULT_MAX_PHOTOS;
  const maxBytes = allowance?.maxPhotoBytes ?? DEFAULT_MAX_PHOTO_BYTES;
  const windowHours = Math.round((allowance?.windowMinutes ?? 1440) / 60);

  const canAsk = allowance !== null && (allowance.hasCredit || (allowance.isMember && allowance.remaining > 0));
  const lockedKey: MessageKey | null =
    allowance === null || canAsk ? null : allowance.isMember ? "wq.allowance.none" : "wq.members_only";

  async function pickPhoto() {
    setErrorKey(null);
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.6,
      exif: false,
      allowsMultipleSelection: false,
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    const check = checkPhotoAdd(photos.length, asset.fileSize ?? 1, maxPhotos, maxBytes);
    if (!check.ok) {
      setErrorKey(check.reason === "limit" ? "wq.photos.limit" : "wq.error.photo_rejected");
      return;
    }
    setPhotos((prev) => [...prev, { uri: asset.uri }]);
  }

  function attemptSend() {
    setSent(false);
    setPhotoFailed(false);
    const length = checkQuestionLength(question);
    if (!length.ok) {
      setErrorKey(length.key);
      return;
    }
    setErrorKey(null);
    const gate = nextGate(redFlagForQuestion(question, duration), false);
    if (gate === "blocked") {
      setGateOpen(true);
      return;
    }
    void send();
  }

  async function send() {
    setSubmitting(true);
    setErrorKey(null);
    const result = await submitWrittenQuestion({ category, question, durationNote: duration });
    if (!result.ok) {
      // The draft stays: nothing the patient typed is lost.
      setErrorKey(result.key);
      setSubmitting(false);
      return;
    }
    const consultId = result.data;
    const { data: auth } = await supabase.auth.getUser();
    const userId = auth.user?.id;
    let failed = false;
    for (const photo of photos) {
      const ok = userId ? await uploadQuestionPhoto({ userId, consultId, uri: photo.uri, maxBytes }) : false;
      if (!ok) failed = true;
    }
    await clearDraft(DRAFT_KEY);
    setQuestion("");
    setDuration("");
    setPhotos([]);
    setSent(true);
    setPhotoFailed(failed);
    setSubmitting(false);
    await refresh();
  }

  function onAcknowledge() {
    setGateOpen(false);
    void send();
  }

  return (
    <View style={{ gap: 10 }}>
      <Text accessibilityRole="header" style={{ fontSize: 15, fontWeight: "700", color: colors.ink }}>
        {tr("wq.title")}
      </Text>
      <MutedText>{tr("wq.intro", { hours: windowHours })}</MutedText>

      {loading ? <ActivityIndicator color={colors.brand} /> : null}

      {allowance && canAsk && allowance.isMember ? (
        <MutedText>{tr("wq.allowance.left", { left: allowance.remaining, total: allowance.allowance })}</MutedText>
      ) : null}
      {allowance && canAsk ? <MutedText>{tr("wq.window", { hours: windowHours })}</MutedText> : null}

      {lockedKey ? (
        <Card style={{ backgroundColor: colors.brandTint }}>
          <Text style={{ fontSize: 14, color: colors.brandPressed }}>{tr(lockedKey)}</Text>
        </Card>
      ) : null}

      {canAsk ? (
        <View style={{ gap: 10 }}>
          <Text style={{ fontSize: 13, fontWeight: "600", color: colors.ink }}>{tr("wq.category.label")}</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {WRITTEN_QUESTION_CATEGORIES.map((c) => {
              const selected = c === category;
              return (
                <Pressable
                  key={c}
                  onPress={() => setCategory(c)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  accessibilityLabel={tr(`wq.category.${c}` as MessageKey)}
                  style={{
                    minHeight: 44,
                    justifyContent: "center",
                    borderRadius: 999,
                    paddingHorizontal: 14,
                    backgroundColor: selected ? colors.brand : colors.groupBg,
                  }}
                >
                  <Text style={{ fontSize: 13, fontWeight: "600", color: selected ? "#FFFFFF" : colors.ink }}>
                    {tr(`wq.category.${c}` as MessageKey)}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={{ fontSize: 13, fontWeight: "600", color: colors.ink }}>{tr("wq.question.label")}</Text>
          <TextInput
            keyboardAppearance={scheme}
            placeholderTextColor={placeholderColorFor(scheme)}
            value={question}
            onChangeText={setQuestion}
            placeholder={tr("wq.question.placeholder")}
            accessibilityLabel={tr("wq.question.label")}
            multiline
            maxLength={QUESTION_MAX_CHARS}
            style={[textInputStyle, { minHeight: 96, textAlignVertical: "top" }]}
          />
          <MutedText>{tr("wq.question.help", { min: QUESTION_MIN_CHARS })}</MutedText>

          <Text style={{ fontSize: 13, fontWeight: "600", color: colors.ink }}>{tr("wq.duration.label")}</Text>
          <TextInput
            keyboardAppearance={scheme}
            placeholderTextColor={placeholderColorFor(scheme)}
            value={duration}
            onChangeText={setDuration}
            accessibilityLabel={tr("wq.duration.label")}
            maxLength={DURATION_MAX_CHARS}
            style={[textInputStyle, { minHeight: 44 }]}
          />

          <Text style={{ fontSize: 13, fontWeight: "600", color: colors.ink }}>{tr("wq.photos.title")}</Text>
          <MutedText>{tr("wq.photos.guidance")}</MutedText>
          {photos.length > 0 ? (
            <ScrollView horizontal contentContainerStyle={{ gap: 10 }}>
              {photos.map((p, index) => (
                <View key={p.uri} style={{ gap: 6 }}>
                  <Image
                    source={{ uri: p.uri }}
                    accessibilityIgnoresInvertColors
                    style={{ width: 84, height: 84, borderRadius: radius.control }}
                  />
                  <Pressable
                    onPress={() => setPhotos((prev) => prev.filter((_, i) => i !== index))}
                    accessibilityRole="button"
                    accessibilityLabel={tr("wq.photos.remove")}
                    style={{ minHeight: 44, minWidth: 44, justifyContent: "center", alignItems: "center" }}
                  >
                    <Text style={{ fontSize: 13, color: colors.brandPressed }}>{tr("wq.photos.remove")}</Text>
                  </Pressable>
                </View>
              ))}
            </ScrollView>
          ) : null}
          {photos.length < maxPhotos ? (
            <SecondaryButton title={tr("wq.photos.add")} onPress={() => void pickPhoto()} disabled={submitting} />
          ) : (
            <MutedText>{tr("wq.photos.limit", { max: maxPhotos })}</MutedText>
          )}

          {draftSaved ? <MutedText>{tr("wq.draft.saved")}</MutedText> : null}
          {errorKey ? (
            <ErrorText>
              {errorKey === "wq.error.length"
                ? tr("wq.error.length", { min: QUESTION_MIN_CHARS })
                : errorKey === "wq.photos.limit"
                  ? tr("wq.photos.limit", { max: maxPhotos })
                  : tr(errorKey)}
            </ErrorText>
          ) : null}
          {sent ? <Text style={{ fontSize: 13.5, color: colors.brandPressed }}>{tr("wq.sent")}</Text> : null}
          {photoFailed ? <ErrorText>{tr("wq.error.photo_later")}</ErrorText> : null}
          <PrimaryButton
            title={submitting ? tr("wq.sending") : tr("wq.send")}
            onPress={attemptSend}
            loading={submitting}
            disabled={question.trim().length === 0}
          />
        </View>
      ) : null}

      {errorKey && !canAsk && isTerminalWrittenQuestionError(errorKey) ? <ErrorText>{tr(errorKey)}</ErrorText> : null}

      {!loading && questions.length === 0 ? <MutedText>{tr("wq.empty")}</MutedText> : null}
      {questions.map((q) => (
        <QuestionCard key={q.id} q={q} windowHours={windowHours} tr={tr} onChanged={refresh} />
      ))}

      <RedFlagModal visible={gateOpen} tr={tr} onBack={() => setGateOpen(false)} onAcknowledge={onAcknowledge} />
    </View>
  );
}

type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

function RedFlagModal({
  visible,
  tr,
  onBack,
  onAcknowledge,
}: {
  visible: boolean;
  tr: Translate;
  onBack: () => void;
  onAcknowledge: () => void;
}) {
  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onBack}>
      <View
        style={{ flex: 1, backgroundColor: "rgba(18,50,75,0.7)", justifyContent: "center", padding: spacing.screen }}
      >
        <View
          accessibilityViewIsModal
          style={{ backgroundColor: "#FFFFFF", borderRadius: radius.card, overflow: "hidden", maxHeight: "85%" }}
        >
          <View style={{ backgroundColor: themeColors.status.emergency, padding: spacing.screen }}>
            <Text accessibilityRole="header" style={{ color: "#FFFFFF", fontSize: 18, fontWeight: "700" }}>
              {tr("wq.red_flag.title")}
            </Text>
          </View>
          <ScrollView contentContainerStyle={{ padding: spacing.screen, gap: 14 }}>
            <Text style={{ fontSize: 16, lineHeight: 24, color: themeColors.ink }}>{tr("wq.red_flag.body")}</Text>
            <PrimaryButton title={tr("wq.red_flag.back")} onPress={onBack} />
            <SecondaryButton title={tr("wq.red_flag.dismiss")} onPress={onAcknowledge} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function QuestionCard({
  q,
  windowHours,
  tr,
  onChanged,
}: {
  q: WrittenQuestion;
  windowHours: number;
  tr: Translate;
  onChanged: () => Promise<void>;
}) {
  const colors = useLegacyColors();
  const textInputStyle = useTextInputStyle();
  const { scheme } = useTheme();
  const view = viewQuestion(q, new Date());
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<MessageKey | null>(null);

  const hours = q.windowDueAt
    ? Math.max(1, Math.round((new Date(q.windowDueAt).getTime() - new Date(q.createdAt).getTime()) / 3_600_000))
    : windowHours;

  async function sendReply() {
    if (reply.trim().length === 0) return;
    setBusy(true);
    setErrorKey(null);
    const result = await postWrittenQuestionMessage(q.id, reply);
    setBusy(false);
    if (!result.ok) {
      setErrorKey(result.key);
      return;
    }
    setReply("");
    await onChanged();
  }

  const badgeTone = view.tone === "answered" ? "brand" : "neutral";

  return (
    <Card style={{ gap: 8 }}>
      <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
        <Text style={{ fontSize: 14, fontWeight: "600", color: colors.ink, flex: 1 }}>{q.question}</Text>
        <Badge tone={badgeTone}>{tr(view.statusKey)}</Badge>
      </View>
      <MutedText>{lagos(q.createdAt, true)}</MutedText>

      {view.tone === "waiting" && q.windowDueAt ? (
        <MutedText>{`${tr("wq.window", { hours })} (${lagos(q.windowDueAt, true)})`}</MutedText>
      ) : null}

      {view.showAnswer && q.answer ? (
        <Text style={{ fontSize: 14, lineHeight: 21, color: colors.ink }}>{q.answer}</Text>
      ) : null}
      {view.showCallNote ? <MutedText>{tr("wq.call.note")}</MutedText> : null}

      {q.messages.map((m) => (
        <View
          key={m.id}
          style={{
            alignSelf: m.authorRole === "patient" ? "flex-end" : "flex-start",
            maxWidth: "88%",
            borderRadius: radius.control,
            padding: 10,
            backgroundColor: m.authorRole === "patient" ? colors.brandTint : colors.groupBg,
          }}
        >
          <Text style={{ fontSize: 14, color: colors.ink }}>{m.body}</Text>
          <Text style={{ fontSize: 11, color: colors.subtle, marginTop: 4 }}>{lagos(m.createdAt, true)}</Text>
        </View>
      ))}

      {view.showFollowUpUntil && q.followUpUntil ? (
        <MutedText>{tr("wq.followup.until", { date: lagos(q.followUpUntil, false) })}</MutedText>
      ) : null}
      {view.followUpEnded ? <MutedText>{tr("wq.followup.ended")}</MutedText> : null}

      {view.canReply ? (
        <View style={{ gap: 8 }}>
          <Text style={{ fontSize: 13, fontWeight: "600", color: colors.ink }}>{tr("wq.thread.reply.label")}</Text>
          <TextInput
            keyboardAppearance={scheme}
            placeholderTextColor={placeholderColorFor(scheme)}
            value={reply}
            onChangeText={setReply}
            accessibilityLabel={tr("wq.thread.reply.label")}
            multiline
            maxLength={QUESTION_MAX_CHARS}
            style={[textInputStyle, { minHeight: 70, textAlignVertical: "top" }]}
          />
          {errorKey ? <ErrorText>{tr(errorKey)}</ErrorText> : null}
          <PrimaryButton
            title={tr("wq.thread.reply.send")}
            onPress={() => void sendReply()}
            loading={busy}
            disabled={reply.trim().length === 0}
          />
        </View>
      ) : null}
    </Card>
  );
}
