import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, ScrollView, Text, TextInput, View } from "react-native";
import {
  HEALTH_EDUCATION_CATEGORIES,
  HEALTH_EDUCATION_FEEDBACK_OPTIONS,
  HEALTH_EDUCATION_READING_LEVELS,
  dismissRecommendation,
  loadFirstCarePlanCondition,
  loadHealthEducationCategoryCounts,
  loadHealthEducationFeed,
  loadHealthEducationLibrary,
  loadHealthEducationLockedCount,
  loadHealthEducationRecommendations,
  loadLatestHealthLiteracy,
  markContentProgress,
  markRecommendationViewed,
  parseKnowledgeCheck,
  scoreKnowledgeCheck,
  statusFromCheck,
  submitContentFeedback,
  submitHealthLiteracyAssessment,
  type AnyEducationItem,
  type CategoryCount,
  type EducationRecommendation,
  type HealthEducationCategory,
  type HealthEducationFeedbackType,
  type HealthEducationReadingLevel,
  type KnowledgeCheckQuestion,
} from "@/lib/health-education";
import { colors, radius, spacing } from "@/ui/theme";
import { Badge, Card, ErrorText, MutedText, PrimaryButton, ScreenTitle, SecondaryButton } from "@/ui/components";

const CONDITION_LABEL: Record<string, string> = {
  hypertension: "blood pressure",
  diabetes: "diabetes",
  ckd: "kidney health",
  cardiovascular: "heart health",
  asthma: "asthma",
  copd: "COPD",
  heart_failure: "heart failure",
  obesity: "weight",
  other: "condition",
};

const textInputStyle = {
  borderWidth: 1,
  borderColor: colors.border,
  borderRadius: radius.control,
  paddingHorizontal: 10,
  paddingVertical: 8,
  fontSize: 14,
  color: colors.ink,
} as const;

interface LearnScreenProps {
  userId: string;
  organisationId: string;
}

/**
 * "Learn" — the patient health library: a "Recommended for you" rail
 * (personalised, paced) above a genuinely browsable library of every
 * active topic, deliberately ungated by diagnosis/drip. Mirrors
 * apps/web/.../patient/health-education.tsx. See
 * apps/mobile/src/lib/health-education.ts's header comment for the two
 * pieces deliberately left for a later pass (Learning pathways, goal-
 * from-lesson).
 */
export function LearnScreen({ userId, organisationId }: LearnScreenProps) {
  const [loading, setLoading] = useState(true);
  const [feed, setFeed] = useState<AnyEducationItem[]>([]);
  const [lockedCount, setLockedCount] = useState(0);
  const [categoryCounts, setCategoryCounts] = useState<CategoryCount[]>([]);
  const [recommendations, setRecommendations] = useState<EducationRecommendation[]>([]);
  const [firstCondition, setFirstCondition] = useState<string | null>(null);
  const [literacyRated, setLiteracyRated] = useState(true);
  const [activeCategory, setActiveCategory] = useState<HealthEducationCategory | null>(null);
  const [libraryItems, setLibraryItems] = useState<AnyEducationItem[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [readingLevel, setReadingLevel] = useState<HealthEducationReadingLevel | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refreshTop = useCallback(async () => {
    const [feedData, locked, counts, recs, condition] = await Promise.all([
      loadHealthEducationFeed(),
      loadHealthEducationLockedCount(),
      loadHealthEducationCategoryCounts(),
      loadHealthEducationRecommendations(userId),
      loadFirstCarePlanCondition(userId),
    ]);
    setFeed(feedData);
    setLockedCount(locked);
    setCategoryCounts(counts);
    setRecommendations(recs);
    setFirstCondition(condition);
    if (condition) {
      const latest = await loadLatestHealthLiteracy(userId, condition);
      setLiteracyRated(!!latest);
    } else {
      setLiteracyRated(true);
    }
  }, [userId]);

  useEffect(() => {
    refreshTop()
      .catch(() => setLoadError("Could not load your Learn library."))
      .finally(() => setLoading(false));
  }, [refreshTop]);

  useEffect(() => {
    if (!activeCategory) return;
    setLibraryLoading(true);
    loadHealthEducationLibrary(activeCategory)
      .then(setLibraryItems)
      .catch(() => setLibraryItems([]))
      .finally(() => setLibraryLoading(false));
  }, [activeCategory]);

  const countByCategory = useMemo(() => new Map(categoryCounts.map((c) => [c.category, c.item_count])), [categoryCounts]);

  const recommendedItems = feed.filter((item) => item.status !== "understood").slice(0, 4);

  const filteredLibraryItems = libraryItems.filter((item) => {
    if (readingLevel && item.reading_level !== readingLevel) return false;
    if (!query.trim()) return true;
    const q = query.trim().toLowerCase();
    return item.title.toLowerCase().includes(q) || (item.summary ?? "").toLowerCase().includes(q);
  });
  const hasMultipleLevels = new Set(libraryItems.map((i) => i.reading_level)).size > 1;

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background }}>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: spacing.screen, gap: 16 }}>
      <View>
        <ScreenTitle>Learn</ScreenTitle>
        <MutedText>
          Clear, plain-language reading on your conditions and on staying healthy generally. Browse by
          topic, or start with what&apos;s recommended for you.
        </MutedText>
      </View>

      {loadError && (
        <Card>
          <ErrorText>{loadError}</ErrorText>
        </Card>
      )}

      {recommendations.length > 0 && (
        <View style={{ gap: 8 }}>
          {recommendations.slice(0, 3).map((rec) => (
            <RecommendationRow key={rec.id} rec={rec} onChanged={refreshTop} />
          ))}
        </View>
      )}

      {firstCondition && !literacyRated && (
        <HealthLiteracyPrompt
          userId={userId}
          organisationId={organisationId}
          condition={firstCondition}
          label={CONDITION_LABEL[firstCondition] ?? firstCondition}
          onDone={() => setLiteracyRated(true)}
        />
      )}

      {recommendedItems.length > 0 && (
        <Card style={{ gap: 8 }}>
          <Text style={{ fontSize: 14.5, fontWeight: "700", color: colors.ink }}>Recommended for you</Text>
          {recommendedItems.map((item) => (
            <EducationItemRow key={item.content_id} item={item} userId={userId} organisationId={organisationId} onChanged={refreshTop} />
          ))}
          {lockedCount > 0 && (
            <MutedText>
              {lockedCount} more personalised lesson{lockedCount === 1 ? "" : "s"} unlock over the coming
              weeks, paced so each one sticks. The full library below stays open.
            </MutedText>
          )}
        </Card>
      )}

      {activeCategory ? (
        <Card style={{ gap: 10 }}>
          <Text onPress={() => setActiveCategory(null)} style={{ fontSize: 12.5, fontWeight: "600", color: colors.brand }}>
            ← All topics
          </Text>
          <Text style={{ fontSize: 14.5, fontWeight: "700", color: colors.ink }}>
            {HEALTH_EDUCATION_CATEGORIES.find((c) => c.value === activeCategory)?.label ?? activeCategory}
          </Text>
          <TextInput value={query} onChangeText={setQuery} placeholder="Search this topic…" style={textInputStyle} />
          {hasMultipleLevels && (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              <LevelChip label="All" active={readingLevel === null} onPress={() => setReadingLevel(null)} />
              {HEALTH_EDUCATION_READING_LEVELS.map((l) => (
                <LevelChip key={l.value} label={l.label} active={readingLevel === l.value} onPress={() => setReadingLevel(l.value)} />
              ))}
            </View>
          )}
          {libraryLoading ? (
            <ActivityIndicator color={colors.brand} />
          ) : filteredLibraryItems.length === 0 ? (
            <MutedText>{query ? "Nothing matches that search." : "Nothing here yet."}</MutedText>
          ) : (
            filteredLibraryItems.map((item) => (
              <EducationItemRow key={item.content_id} item={item} userId={userId} organisationId={organisationId} onChanged={refreshTop} />
            ))
          )}
        </Card>
      ) : (
        <Card style={{ gap: 8 }}>
          <Text style={{ fontSize: 14.5, fontWeight: "700", color: colors.ink }}>Browse by topic</Text>
          {HEALTH_EDUCATION_CATEGORIES.map((c) => {
            const count = countByCategory.get(c.value) ?? 0;
            return (
              <Text
                key={c.value}
                onPress={() => (count > 0 ? setActiveCategory(c.value) : null)}
                style={{
                  fontSize: 13.5,
                  color: count > 0 ? colors.ink : colors.faint,
                  paddingVertical: 8,
                  borderTopWidth: 1,
                  borderTopColor: colors.border,
                }}
              >
                {c.label} <Text style={{ color: colors.muted, fontSize: 12 }}>· {count} topic{count === 1 ? "" : "s"}</Text>
              </Text>
            );
          })}
        </Card>
      )}
    </ScrollView>
  );
}

function LevelChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Text
      onPress={onPress}
      style={{
        fontSize: 12,
        fontWeight: "600",
        paddingVertical: 5,
        paddingHorizontal: 10,
        borderRadius: 999,
        backgroundColor: active ? colors.brand : colors.groupBg,
        color: active ? "#FFFFFF" : colors.ink,
      }}
    >
      {label}
    </Text>
  );
}

function RecommendationRow({ rec, onChanged }: { rec: EducationRecommendation; onChanged: () => void }) {
  async function dismiss() {
    await dismissRecommendation(rec.id);
    onChanged();
  }

  useEffect(() => {
    if (!rec.viewed_at) void markRecommendationViewed(rec.id);
  }, [rec.id, rec.viewed_at]);

  return (
    <Card style={{ borderColor: colors.brand, gap: 4 }}>
      <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 11, fontWeight: "700", color: colors.brand, textTransform: "uppercase" }}>{rec.trigger_reason}</Text>
          <Text style={{ fontSize: 13.5, fontWeight: "600", color: colors.ink }}>{rec.content?.title}</Text>
          {rec.content?.summary && <MutedText>{rec.content.summary}</MutedText>}
        </View>
        <SecondaryButton title="Dismiss" onPress={dismiss} />
      </View>
    </Card>
  );
}

function HealthLiteracyPrompt({
  userId,
  organisationId,
  condition,
  label,
  onDone,
}: {
  userId: string;
  organisationId: string;
  condition: string;
  label: string;
  onDone: () => void;
}) {
  const [submitting, setSubmitting] = useState<number | null>(null);
  const [skipped, setSkipped] = useState(false);

  async function rate(n: 1 | 2 | 3 | 4 | 5) {
    setSubmitting(n);
    await submitHealthLiteracyAssessment(userId, organisationId, { confidenceLevel: n, condition });
    setSubmitting(null);
    onDone();
  }

  if (skipped) return null;

  return (
    <Card style={{ gap: 8 }}>
      <Text style={{ fontSize: 13.5, color: colors.ink }}>How confident do you feel managing your {label}?</Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        {([1, 2, 3, 4, 5] as const).map((n) => (
          <Text
            key={n}
            onPress={() => (submitting === null ? rate(n) : null)}
            style={{
              width: 32,
              height: 32,
              textAlign: "center",
              lineHeight: 32,
              borderRadius: 16,
              borderWidth: 1,
              borderColor: colors.border,
              fontSize: 13,
              fontWeight: "600",
              color: colors.ink,
            }}
          >
            {submitting === n ? "…" : n}
          </Text>
        ))}
        <SecondaryButton title="Skip" onPress={() => setSkipped(true)} />
      </View>
    </Card>
  );
}

const CONTENT_TYPE_LABEL: Record<string, string> = {
  video: "Video",
  audio: "Audio",
  infographic: "Infographic",
  faq: "FAQ",
  quiz: "Quiz",
  interactive_module: "Interactive",
};

function EducationItemRow({
  item,
  userId,
  organisationId,
  onChanged,
}: {
  item: AnyEducationItem;
  userId: string;
  organisationId: string;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [marking, setMarking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const questions = useMemo(() => parseKnowledgeCheck(item.knowledge_check), [item.knowledge_check]);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && item.status === null) {
      await markContentProgress(userId, organisationId, { contentId: item.content_id, status: "seen" });
    }
  }

  async function markUnderstood() {
    setMarking(true);
    const result = await markContentProgress(userId, organisationId, { contentId: item.content_id, status: "understood" });
    setMarking(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onChanged();
  }

  async function completeCheck(questionsList: KnowledgeCheckQuestion[], answers: Array<number | undefined>) {
    const result = scoreKnowledgeCheck(questionsList, answers);
    setMarking(true);
    await markContentProgress(userId, organisationId, {
      contentId: item.content_id,
      status: statusFromCheck(result),
      checkScore: result.score,
      checkTotal: result.total,
    });
    setMarking(false);
    onChanged();
    return result;
  }

  return (
    <View style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 8, gap: 6 }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
        <Text onPress={toggle} style={{ fontSize: 13.5, fontWeight: "600", color: colors.ink }}>
          {item.title}
        </Text>
        {item.content_type !== "article" && <Badge>{CONTENT_TYPE_LABEL[item.content_type] ?? item.content_type}</Badge>}
        {item.status === "needs_review" && <Badge tone="brand">Revisit</Badge>}
        {item.status === "understood" && <Badge tone="brand">Understood</Badge>}
      </View>
      {item.summary && <MutedText>{item.summary}</MutedText>}
      {item.estimated_minutes ? <MutedText>{item.estimated_minutes} min read</MutedText> : null}

      {open && (
        <View style={{ gap: 10, paddingTop: 4 }}>
          <Text style={{ fontSize: 13, color: colors.ink, lineHeight: 19 }}>{item.body}</Text>

          {questions ? (
            <KnowledgeCheck questions={questions} pending={marking} onComplete={completeCheck} />
          ) : (
            item.status !== "understood" && (
              <SecondaryButton title="Mark as understood" onPress={markUnderstood} loading={marking} />
            )
          )}
          {error && <ErrorText>{error}</ErrorText>}

          <ContentFeedbackRow contentId={item.content_id} userId={userId} organisationId={organisationId} />
        </View>
      )}
    </View>
  );
}

function KnowledgeCheck({
  questions,
  pending,
  onComplete,
}: {
  questions: KnowledgeCheckQuestion[];
  pending: boolean;
  onComplete: (questions: KnowledgeCheckQuestion[], answers: Array<number | undefined>) => Promise<{ score: number; total: number; allCorrect: boolean }>;
}) {
  const [answers, setAnswers] = useState<Array<number | undefined>>(() => questions.map(() => undefined));
  const [result, setResult] = useState<{ score: number; total: number; allCorrect: boolean } | null>(null);
  const answeredAll = answers.every((a) => a !== undefined);

  async function submit() {
    setResult(await onComplete(questions, answers));
  }

  return (
    <View style={{ gap: 10, backgroundColor: colors.groupBg, borderRadius: radius.card, padding: 10 }}>
      <Text style={{ fontSize: 11, fontWeight: "700", color: colors.muted, textTransform: "uppercase" }}>Quick check</Text>
      {questions.map((q, qi) => (
        <View key={qi} style={{ gap: 4 }}>
          <Text style={{ fontSize: 13, color: colors.ink }}>{q.question}</Text>
          {q.options.map((opt, oi) => {
            const chosen = answers[qi] === oi;
            const showCorrect = result !== null && oi === q.answer_index;
            const showWrong = result !== null && chosen && oi !== q.answer_index;
            return (
              <Text
                key={oi}
                onPress={() => (result === null ? setAnswers((prev) => prev.map((a, i) => (i === qi ? oi : a))) : null)}
                style={{
                  fontSize: 13,
                  paddingVertical: 4,
                  paddingHorizontal: 8,
                  borderRadius: radius.control,
                  backgroundColor: showCorrect ? colors.brandTint : showWrong ? colors.status.warnBg : chosen ? colors.groupBg : "transparent",
                  color: colors.ink,
                }}
              >
                {opt}
              </Text>
            );
          })}
        </View>
      ))}
      {result === null ? (
        <PrimaryButton title="Check my answers" onPress={submit} disabled={!answeredAll || pending} loading={pending} />
      ) : (
        <Text style={{ fontSize: 13, color: colors.ink }}>
          You got {result.score} of {result.total}.{" "}
          {result.allCorrect ? "Nicely done, marked as understood." : "Worth another read, we'll keep this handy for you."}
        </Text>
      )}
    </View>
  );
}

function ContentFeedbackRow({ contentId, userId, organisationId }: { contentId: string; userId: string; organisationId: string }) {
  const [sent, setSent] = useState<HealthEducationFeedbackType | null>(null);

  async function send(value: HealthEducationFeedbackType) {
    const result = await submitContentFeedback(userId, organisationId, { contentId, feedbackType: value });
    if (result.ok) setSent(value);
  }

  if (sent) {
    return (
      <MutedText>
        {sent === "report_incorrect" ? "Thanks. This has been flagged for our clinical team to check." : "Thanks for the feedback."}
      </MutedText>
    );
  }

  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 8 }}>
      <MutedText>Was this helpful?</MutedText>
      {HEALTH_EDUCATION_FEEDBACK_OPTIONS.map((opt) => (
        <Text
          key={opt.value}
          onPress={() => send(opt.value)}
          style={{
            fontSize: 12,
            paddingVertical: 4,
            paddingHorizontal: 9,
            borderRadius: 999,
            borderWidth: 1,
            borderColor: colors.border,
            color: colors.muted,
          }}
        >
          {opt.label}
        </Text>
      ))}
    </View>
  );
}
