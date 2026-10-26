import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Text, View } from "react-native";
import Svg, { Circle, Path, Rect } from "react-native-svg";
import { asLocale, portionPhrase, t, type MessageKey } from "@tarragon/i18n";
import {
  HAND_SHAPES,
  getProposedConfig,
  parsePortionGuide,
  portionFor,
  splitByGlossary,
  type GlossaryTerm,
  type PortionAudience,
  type PortionGuideConfig,
  type PortionHand,
} from "@tarragon/shared";
import { useUiLanguage } from "@/lib/ui-language";
import {
  loadGlossary,
  loadRecordLesson,
  loadTeachback,
  recordTeachback,
  shareTeachback,
  type GlossaryEntry,
  type RecordLessonState,
  type TeachbackMarks,
  type TeachbackQuestionPublic,
} from "@/lib/learning-quality";
import { radii, space, useTheme } from "@/ui/design";
import { AppText, Button, Card, InlineAlert, PressableScale } from "@/ui/kit";

function useTr() {
  const language = asLocale(useUiLanguage());
  return (key: MessageKey, params?: Record<string, string | number>) => t(key, language, params);
}

/** A plain line drawing of one hand measure. Outline only, drawn from the shared shapes; no image file, no emoji. */
export function HandIconNative({ hand, size = 40 }: { hand: PortionHand; size?: number }) {
  const { colors } = useTheme();
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Svg width={size} height={size} viewBox="0 0 48 48" fill="none" stroke={colors.brandText} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        {HAND_SHAPES[hand].map((s, i) =>
          s.t === "rect" ? (
            <Rect key={i} x={s.x} y={s.y} width={s.w} height={s.h} rx={s.r} />
          ) : s.t === "circle" ? (
            <Circle key={i} cx={s.cx} cy={s.cy} r={s.r} />
          ) : (
            <Path key={i} d={s.d} />
          ),
        )}
      </Svg>
    </View>
  );
}

/**
 * Local food portion guide on the phone. Text first, hand drawing as a helper. Amounts come only from the bundled versioned configuration
 * (`learning.portion_guide`), so the guide works offline from a downloaded lesson; while the amounts are still proposed a note says so.
 */
export function PortionGuideNative({
  body,
  audience,
  config,
  confirmed,
}: {
  body: string;
  audience: PortionAudience;
  config?: PortionGuideConfig;
  confirmed?: boolean;
}) {
  const tr = useTr();
  const language = asLocale(useUiLanguage());
  const { colors } = useTheme();
  const bundled = getProposedConfig("learning.portion_guide");
  const value = config ?? (bundled.value as unknown as PortionGuideConfig);
  const isConfirmed = confirmed ?? bundled.status === "confirmed";
  const parsed = parsePortionGuide(body);
  return (
    <View style={{ gap: space.md }}>
      {parsed.intro.map((l, i) => (
        <AppText key={i}>{l}</AppText>
      ))}
      <AppText variant="caption" tone="textMuted">{tr("learn.portion.legend")}</AppText>
      {!isConfirmed ? <InlineAlert tone="warn" message={tr("learn.portion.draft_numbers")} /> : null}
      {parsed.foods.map((f) => {
        const amount = portionFor(value, f.ref, audience);
        return (
          <View
            key={f.ref + f.name}
            accessible
            accessibilityLabel={[f.name, amount ? portionPhrase(amount, language) : "", f.tip].filter(Boolean).join(". ")}
            style={{ flexDirection: "row", gap: space.md, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, padding: space.md }}
          >
            <HandIconNative hand={f.hand} />
            <View style={{ flex: 1, gap: 2 }}>
              <AppText variant="bodyStrong">{f.name}</AppText>
              {amount ? <AppText tone="brandText">{portionPhrase(amount, language)}</AppText> : null}
              {f.tip ? <AppText variant="caption" tone="textMuted">{f.tip}</AppText> : null}
            </View>
          </View>
        );
      })}
      {parsed.notes.map((l, i) => (
        <AppText key={i} variant="caption" tone="textMuted">{l}</AppText>
      ))}
    </View>
  );
}

/**
 * Lesson text with tap-to-define words. Only reviewed, in-date terms are ever fetched; with no terms, or no signal, it is plain text
 * (the glossary never blocks a lesson).
 */
export function GlossaryTextNative({ text }: { text: string }) {
  const tr = useTr();
  const [entries, setEntries] = useState<GlossaryEntry[]>([]);
  const [open, setOpen] = useState<GlossaryTerm | null>(null);
  useEffect(() => {
    let alive = true;
    loadGlossary()
      .then((r) => alive && setEntries(r))
      .catch(() => alive && setEntries([]));
    return () => {
      alive = false;
    };
  }, []);
  const segments = useMemo(() => splitByGlossary(text, entries), [text, entries]);
  const hasTerms = segments.some((s) => s.term);
  if (!hasTerms) return <AppText>{text}</AppText>;
  return (
    <View style={{ gap: space.sm }}>
      <AppText>
        {segments.map((s, i) =>
          s.term ? (
            <Text
              key={i}
              accessibilityRole="button"
              accessibilityLabel={s.text}
              accessibilityHint={tr("learn.glossary.hint")}
              onPress={() => setOpen(open === s.term ? null : (s.term ?? null))}
              style={{ textDecorationLine: "underline", textDecorationStyle: "dotted", fontWeight: "600" }}
            >
              {s.text}
            </Text>
          ) : (
            s.text
          ),
        )}
      </AppText>
      {open ? (
        <View accessibilityRole="alert" style={{ gap: space.xs }}>
          <AppText variant="bodyStrong">{open.term}</AppText>
          <AppText>{open.definition}</AppText>
          <Button title={tr("learn.glossary.close")} variant="ghost" fullWidth={false} onPress={() => setOpen(null)} />
        </View>
      ) : (
        <AppText variant="caption" tone="textMuted">{tr("learn.glossary.hint")}</AppText>
      )}
    </View>
  );
}

/**
 * Teach-back at the end of a lesson: private to the person, optional, kind about wrong answers, never a streak or a score board, and it
 * never changes whether the lesson is finished. Sharing with the care team is a separate press. Nothing is drawn if the lesson has none.
 */
export function TeachbackQuizNative({ code }: { code: string }) {
  const tr = useTr();
  const [questions, setQuestions] = useState<TeachbackQuestionPublic[] | null>(null);
  const [picks, setPicks] = useState<(number | null)[]>([]);
  const [marks, setMarks] = useState<TeachbackMarks | null>(null);
  const [shared, setShared] = useState(false);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    loadTeachback(code)
      .then((q) => alive && setQuestions(q))
      .catch(() => alive && setQuestions(null));
    return () => {
      alive = false;
    };
  }, [code]);

  if (!questions || questions.length === 0) return null;

  async function check() {
    if (!questions) return;
    setBusy(true);
    setFailed(false);
    try {
      setMarks(await recordTeachback(code, questions.map((_, i) => picks[i] ?? -1)));
      setShared(false);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }
  async function toggleShare() {
    setBusy(true);
    setFailed(false);
    try {
      if (await shareTeachback(code, !shared)) setShared(!shared);
      else setFailed(true); // refused by the database: say so rather than look like it worked
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card style={{ gap: space.sm }}>
      <AppText variant="bodyStrong" heading>{tr("learn.teachback.title")}</AppText>
      <AppText variant="caption" tone="textMuted">{tr("learn.teachback.intro")}</AppText>
      <AppText variant="caption" tone="textMuted">{tr("learn.teachback.skip_note")}</AppText>
      {questions.map((q, qi) => {
        const mark = marks?.marks[qi];
        return (
          <View key={qi} style={{ gap: space.xs }}>
            <AppText variant="bodyStrong">{q.question}</AppText>
            {q.options.map((opt, oi) => (
              <PressableScale
                key={oi}
                accessibilityRole="radio"
                accessibilityState={{ selected: picks[qi] === oi }}
                accessibilityLabel={opt}
                onPress={() => (marks === null ? setPicks((p) => Object.assign([...p], { [qi]: oi })) : undefined)}
                style={{ minHeight: 44, justifyContent: "center", paddingHorizontal: space.md }}
              >
                <AppText tone={picks[qi] === oi ? "brandText" : "text"}>{`${picks[qi] === oi ? "(x) " : "( ) "}${opt}`}</AppText>
              </PressableScale>
            ))}
            {mark ? (
              <View style={{ gap: 2 }} accessibilityRole="alert">
                <AppText variant="bodyStrong">
                  {mark.correct ? tr("learn.teachback.right") : tr("learn.teachback.not_yet", { answer: q.options[mark.correct_index] ?? "" })}
                </AppText>
                <AppText>{mark.explanation}</AppText>
              </View>
            ) : null}
          </View>
        );
      })}
      {marks === null ? (
        <Button title={tr("learn.teachback.check")} variant="secondary" disabled={busy || picks.every((p) => p == null)} onPress={() => void check()} />
      ) : (
        <View style={{ gap: space.xs }}>
          <AppText variant="bodyStrong">{tr("learn.teachback.result", { correct: marks.correct, total: marks.total })}</AppText>
          <Button
            title={tr("learn.teachback.again")}
            variant="secondary"
            onPress={() => {
              setMarks(null);
              setPicks([]);
              setShared(false);
            }}
          />
          <Button title={shared ? tr("learn.teachback.unshare") : tr("learn.teachback.share")} variant="secondary" disabled={busy} onPress={() => void toggleShare()} />
          <AppText variant="caption" tone="textMuted">{shared ? tr("learn.teachback.shared") : tr("learn.teachback.unshared")}</AppText>
        </View>
      )}
      {failed ? <AppText variant="caption" tone="dangerText">{tr("learn.teachback.failed")}</AppText> : null}
    </Card>
  );
}

/**
 * "What this reading means". Behind the record_triggered_lessons_enabled guard (OFF), so by default nothing is drawn. A recent red or
 * emergency reading shows the urgent-help guidance and never a lesson.
 */
export function RecordLessonCardNative({ patientId, renderFooter }: { patientId: string; renderFooter: (code: string, title: string) => ReactNode }) {
  const tr = useTr();
  const [state, setState] = useState<RecordLessonState>({ kind: "off" });
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let alive = true;
    loadRecordLesson(patientId)
      .then((r) => alive && setState(r))
      .catch(() => alive && setState({ kind: "none" }));
    return () => {
      alive = false;
    };
  }, [patientId]);

  if (state.kind === "off" || state.kind === "none") return null;
  if (state.kind === "urgent") {
    return (
      <Card style={{ gap: space.sm }}>
        <AppText>{tr("learn.record.urgent_lead")}</AppText>
        <InlineAlert tone="warn" message={`${tr("learn.urgent.title")}. ${tr("learn.urgent.body")}`} />
      </Card>
    );
  }
  return (
    <Card style={{ gap: space.sm }}>
      <AppText variant="caption" tone="brandText">{tr("learn.record.title")}</AppText>
      <AppText variant="title" heading>{state.title}</AppText>
      {!open ? (
        <Button title={tr("learn.record.open")} onPress={() => setOpen(true)} />
      ) : (
        <View style={{ gap: space.sm }}>
          <GlossaryTextNative text={state.body} />
          {renderFooter(state.code, state.title)}
          <Button title={tr("learn.record.hide")} variant="secondary" onPress={() => setOpen(false)} />
        </View>
      )}
    </Card>
  );
}
