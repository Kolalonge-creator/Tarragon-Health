import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, ScrollView, View } from "react-native";
import { asLocale, t, type MessageKey } from "@tarragon/i18n";
import { loadCourse, saveClarity, saveLessonResult } from "@/lib/course";
import { courseIsOpen, lessonDone, paragraphs, pidginComing, summarise, type CourseLesson } from "@/lib/course-model";
import { scoreKnowledgeCheck } from "@/lib/health-education";
import { getAudioService } from "@/lib/audio/service";
import { useUiLanguage } from "@/lib/ui-language";
import { space, useTheme } from "@/ui/design";
import { AppText, Badge, Button, Card, InlineAlert } from "@/ui/kit";

type Tr = (key: MessageKey, params?: Record<string, string | number>) => string;

function useTr(): { tr: Tr; locale: "en" | "pcm" } {
  const locale = asLocale(useUiLanguage());
  const tr = useCallback<Tr>((key, params) => t(key, locale, params), [locale]);
  return { tr, locale };
}

/** The course entry on the Learn tab. Shown only when the server returns lessons: nothing published, nothing shown. */
export function CourseCard({ onOpen }: { onOpen: () => void }) {
  const { tr } = useTr();
  const [lessons, setLessons] = useState<CourseLesson[] | null>(null);
  useEffect(() => {
    let alive = true;
    void loadCourse().then((r) => alive && setLessons(r.ok ? r.lessons : []));
    return () => {
      alive = false;
    };
  }, []);
  if (!lessons || !courseIsOpen(lessons)) return null;
  const s = summarise(lessons);
  return (
    <Card style={{ gap: space.sm }}>
      <AppText variant="title" heading>{tr("course.title")}</AppText>
      <AppText tone="textMuted">{tr("course.subtitle")}</AppText>
      <AppText variant="label">{tr("course.progress", { done: s.done, total: s.total })}</AppText>
      <Button
        title={s.finished ? tr("course.title") : s.done === 0 ? tr("course.start") : tr("course.resume", { n: s.next?.moduleNumber ?? 1 })}
        onPress={onOpen}
      />
    </Card>
  );
}

/** The course: an ordered list of short lessons and, inside one, the text, the audio, the action and the question. */
export function CourseScreen({ userId, organisationId, onBack }: { userId: string; organisationId: string; onBack: () => void }) {
  const { colors } = useTheme();
  const { tr } = useTr();
  const [lessons, setLessons] = useState<CourseLesson[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    const r = await loadCourse();
    setFailed(!r.ok);
    if (r.ok) setLessons(r.lessons);
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const current = lessons?.find((l) => l.moduleNumber === open) ?? null;
  const summary = useMemo(() => summarise(lessons ?? []), [lessons]);

  if (!lessons && !failed) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.canvas }}>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.canvas }} contentContainerStyle={{ padding: space.lg, gap: space.lg }}>
      <Button
        title={tr("common.back")}
        variant="ghost"
        fullWidth={false}
        onPress={() => {
          getAudioService().stop();
          if (current) setOpen(null);
          else onBack();
        }}
      />
      {failed && <InlineAlert tone="warn" message={tr("course.error.load")} />}
      {current ? (
        <LessonView
          key={current.contentId}
          lesson={current}
          userId={userId}
          organisationId={organisationId}
          onDone={async () => {
            await refresh();
          }}
        />
      ) : (
        <View style={{ gap: space.md }}>
          <AppText variant="headline" heading>{tr("course.title")}</AppText>
          <AppText tone="textMuted">{tr("course.progress", { done: summary.done, total: summary.total })}</AppText>
          {summary.finished && (
            <Card style={{ gap: space.xs }}>
              <AppText variant="title" heading>{tr("course.completed_title")}</AppText>
              <AppText>{tr("course.completed_body")}</AppText>
            </Card>
          )}
          {(lessons ?? []).map((l) => (
            <Card key={l.contentId} style={{ gap: space.xs }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <AppText variant="label" tone="textMuted">{tr("course.lesson_n", { n: l.moduleNumber })} · {tr("course.minutes", { min: l.estimatedMinutes })}</AppText>
                {lessonDone(l) && <Badge label={tr("course.done")} tone="positive" />}
              </View>
              <AppText variant="bodyStrong">{l.title}</AppText>
              <AppText tone="textMuted">{l.summary}</AppText>
              <Button title={tr("course.lesson_n", { n: l.moduleNumber })} variant="secondary" onPress={() => setOpen(l.moduleNumber)} />
            </Card>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

function LessonView({
  lesson,
  userId,
  organisationId,
  onDone,
}: {
  lesson: CourseLesson;
  userId: string;
  organisationId: string;
  onDone: () => Promise<void>;
}) {
  const { tr, locale } = useTr();
  const [audioSoon, setAudioSoon] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [picked, setPicked] = useState<number | undefined>(undefined);
  const [outcome, setOutcome] = useState<"right" | "again" | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  const [clear, setClear] = useState<boolean | null>(null);

  useEffect(() => () => getAudioService().stop(), []);

  async function listen() {
    if (!lesson.audioClipId) {
      setAudioSoon(true);
      return;
    }
    setAudioSoon(false);
    setPlaying(true);
    const spoken = await getAudioService().playClips([lesson.audioClipId], lesson.languageServed === "pcm" ? "pcm" : "en");
    setPlaying(false);
    // No recording yet (or not signed): the transcript below is the lesson. Say so once, calmly.
    if (!spoken.played) setAudioSoon(true);
  }

  async function check() {
    if (!lesson.check || picked === undefined) return;
    const result = scoreKnowledgeCheck([lesson.check], [picked]);
    const saved = await saveLessonResult(userId, organisationId, lesson, result);
    setSaveFailed(!saved.ok);
    setOutcome(result.allCorrect ? "right" : "again");
    if (saved.ok) await onDone();
  }

  async function sendClarity(isClear: boolean) {
    setClear(isClear);
    await saveClarity(userId, organisationId, lesson, isClear);
  }

  return (
    <View style={{ gap: space.md }}>
      <AppText variant="label" tone="textMuted">{tr("course.lesson_n", { n: lesson.moduleNumber })} · {tr("course.minutes", { min: lesson.estimatedMinutes })}</AppText>
      <AppText variant="headline" heading>{lesson.title}</AppText>
      {pidginComing(locale, lesson) && <InlineAlert tone="info" message={tr("lesson.pcm_coming")} />}

      <Button
        title={playing ? tr("lesson.pause") : tr("lesson.listen")}
        variant="secondary"
        accessibilityHint={tr("lesson.a11y_play", { n: lesson.moduleNumber })}
        onPress={playing ? () => { getAudioService().stop(); setPlaying(false); } : () => void listen()}
      />
      {audioSoon && <InlineAlert tone="info" message={tr("lesson.audio_soon")} />}
      <AppText variant="caption" tone="textMuted">{tr("lesson.earphones")}</AppText>

      <Card style={{ gap: space.sm }}>
        <AppText variant="label" tone="textMuted">{tr("lesson.transcript")}</AppText>
        {paragraphs(lesson.body).map((p, i) => (
          <AppText key={i} variant="bodyLarge">{p}</AppText>
        ))}
      </Card>

      {lesson.nextAction && (
        <Card style={{ gap: space.xs }}>
          <AppText variant="label" tone="brandText">{tr("lesson.action_title")}</AppText>
          <AppText variant="bodyLarge">{lesson.nextAction}</AppText>
        </Card>
      )}

      {lesson.check && (
        <Card style={{ gap: space.sm }}>
          <AppText variant="label" tone="textMuted">{tr("lesson.check_title")}</AppText>
          <AppText variant="bodyStrong">{lesson.check.question}</AppText>
          {lesson.check.options.map((o, i) => (
            <Button key={i} title={o} variant={picked === i ? "primary" : "secondary"} onPress={() => { setPicked(i); setOutcome(null); }} />
          ))}
          <Button title={tr("lesson.check_submit")} disabled={picked === undefined} onPress={() => void check()} />
          {outcome === "right" && <InlineAlert tone="info" message={tr("lesson.check_right")} />}
          {outcome === "again" && <InlineAlert tone="info" message={tr("lesson.check_again")} />}
          {saveFailed && <InlineAlert tone="warn" message={tr("course.error.save")} />}
        </Card>
      )}

      <Card style={{ gap: space.sm }}>
        <AppText variant="label" tone="textMuted">{tr("lesson.clear_title")}</AppText>
        {clear === null ? (
          <View style={{ flexDirection: "row", gap: space.sm }}>
            <Button title={tr("lesson.clear_yes")} variant="secondary" fullWidth={false} onPress={() => void sendClarity(true)} />
            <Button title={tr("lesson.clear_no")} variant="secondary" fullWidth={false} onPress={() => void sendClarity(false)} />
          </View>
        ) : (
          <AppText>{tr("lesson.clear_thanks")}</AppText>
        )}
      </Card>

      <AppText variant="caption" tone="textMuted">{tr("lesson.not_advice")}</AppText>
      {lesson.reviewedByName && <AppText variant="caption" tone="textMuted">{tr("lesson.reviewed_by", { name: lesson.reviewedByName })}</AppText>}
      {lesson.nextReviewDue && <AppText variant="caption" tone="textMuted">{tr("lesson.review_due", { date: lesson.nextReviewDue })}</AppText>}
    </View>
  );
}
