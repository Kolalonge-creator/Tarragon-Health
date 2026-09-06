"use client";

import { useMemo, useState } from "react";
import {
  useHealthEducationFeed,
  useHealthEducationLockedCount,
  useHealthEducationCategoryCounts,
  useHealthEducationLibrary,
  useHealthEducationProgrammes,
  useHealthEducationProgrammeDetail,
  useMarkContentProgress,
  useSubmitContentFeedback,
  useHealthEducationRecommendations,
  useDismissRecommendation,
  useMarkRecommendationViewed,
  useLatestHealthLiteracy,
  useSubmitHealthLiteracyAssessment,
  useProposeGoalFromContent,
  HEALTH_EDUCATION_CATEGORIES,
  HEALTH_EDUCATION_READING_LEVELS,
  HEALTH_EDUCATION_FEEDBACK_OPTIONS,
  type HealthEducationFeedItem,
  type HealthEducationLibraryItem,
  type HealthEducationCategory,
  type HealthEducationReadingLevel,
  type HealthEducationFeedbackType,
} from "@/lib/queries/health-education";
import { useCarePlans } from "@/lib/queries/care-plans";
import {
  parseKnowledgeCheck,
  scoreKnowledgeCheck,
  statusFromCheck,
  type KnowledgeCheckQuestion,
} from "@/lib/validation/health-education";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { SEMANTIC_ICON } from "@/lib/icons";
import { cn } from "@/lib/utils";
import { obesityLabelTitleCase } from "@/lib/copy/condition-language";

const CONDITION_LABEL: Record<string, string> = {
  hypertension: "Blood pressure",
  diabetes: "Diabetes",
  ckd: "Kidney health",
  cardiovascular: "Heart health",
  asthma: "Asthma",
  copd: "COPD",
  heart_failure: "Heart failure",
  other: "General",
};

function conditionLabelFor(
  condition: string,
  preference: string | null | undefined
): string {
  return condition === "obesity"
    ? obesityLabelTitleCase(preference)
    : (CONDITION_LABEL[condition] ?? condition);
}

type AnyEducationItem = HealthEducationFeedItem | HealthEducationLibraryItem;

/** §20.1 content types beyond article (article gets no badge — it's the default). */
const CONTENT_TYPE_LABEL: Record<string, string> = {
  video: "Video",
  audio: "Audio",
  infographic: "Infographic",
  faq: "FAQ",
  quiz: "Quiz",
  interactive_module: "Interactive",
};

/** §20.15 patient feedback — a reaction the patient can leave on a content item. */
function ContentFeedback({
  contentId,
  patientId,
  organisationId,
}: {
  contentId: string;
  patientId: string;
  organisationId: string;
}) {
  const [sent, setSent] = useState<HealthEducationFeedbackType | null>(null);
  const submit = useSubmitContentFeedback(patientId, organisationId);

  if (sent) {
    return (
      <p className="text-xs text-charcoal-ink/50 dark:text-night-ink/55">
        {sent === "report_incorrect"
          ? "Thanks. This has been flagged for our clinical team to check."
          : "Thanks for the feedback."}
      </p>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-charcoal-ink/10 dark:border-night-ink/15 pt-2">
      <span className="text-xs text-charcoal-ink/50 dark:text-night-ink/55">Was this helpful?</span>
      {HEALTH_EDUCATION_FEEDBACK_OPTIONS.map(({ value, label }) => (
        <button
          key={value}
          type="button"
          disabled={submit.isPending}
          onClick={() =>
            submit.mutate(
              { contentId, feedbackType: value },
              { onSuccess: () => setSent(value) }
            )
          }
          className={cn(
            "rounded-full border px-2.5 py-1 text-xs transition-colors",
            value === "report_incorrect"
              ? "border-charcoal-ink/15 dark:border-night-ink/20 text-charcoal-ink/50 dark:text-night-ink/55 hover:border-red-400 hover:text-red-600 dark:hover:text-red-400"
              : "border-charcoal-ink/15 dark:border-night-ink/20 text-charcoal-ink/60 dark:text-night-ink/60 hover:border-brand-green hover:text-brand-green dark:hover:text-brand-green-bright"
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function KnowledgeCheck({
  questions,
  onComplete,
  pending,
}: {
  questions: KnowledgeCheckQuestion[];
  onComplete: (result: { score: number; total: number; allCorrect: boolean }) => void;
  pending: boolean;
}) {
  const [answers, setAnswers] = useState<Array<number | undefined>>(() =>
    questions.map(() => undefined)
  );
  const [result, setResult] = useState<ReturnType<typeof scoreKnowledgeCheck> | null>(null);

  const answeredAll = answers.every((a) => a !== undefined);

  function submit() {
    const scored = scoreKnowledgeCheck(questions, answers);
    setResult(scored);
    onComplete(scored);
  }

  return (
    <div className="space-y-4 rounded-md bg-charcoal-ink/5 dark:bg-night-ink/10 p-3">
      <p className="text-xs font-medium uppercase tracking-wide text-charcoal-ink/60 dark:text-night-ink/60">
        Quick check
      </p>
      {questions.map((q, qi) => (
        <fieldset key={qi} className="space-y-1.5">
          <legend className="text-sm text-charcoal-ink dark:text-night-ink">{q.question}</legend>
          <div className="space-y-1">
            {q.options.map((opt, oi) => {
              const chosen = answers[qi] === oi;
              const showCorrect = result !== null && oi === q.answer_index;
              const showWrong = result !== null && chosen && oi !== q.answer_index;
              return (
                <label
                  key={oi}
                  className={`flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm ${
                    showCorrect
                      ? "bg-green-100 dark:bg-green-500/25 text-green-800 dark:text-green-300"
                      : showWrong
                        ? "bg-red-100 dark:bg-red-500/25 text-red-700 dark:text-red-300"
                        : chosen
                          ? "bg-brand-green/10"
                          : ""
                  }`}
                >
                  <input
                    type="radio"
                    name={`kc-${qi}`}
                    checked={chosen}
                    disabled={result !== null}
                    onChange={() =>
                      setAnswers((prev) => prev.map((a, i) => (i === qi ? oi : a)))
                    }
                  />
                  <span>{opt}</span>
                </label>
              );
            })}
          </div>
        </fieldset>
      ))}

      {result === null ? (
        <Button size="sm" disabled={!answeredAll || pending} onClick={submit}>
          Check my answers
        </Button>
      ) : (
        <p className="text-sm text-charcoal-ink dark:text-night-ink">
          You got <strong>{result.score}</strong> of {result.total}.{" "}
          {result.allCorrect
            ? "Nicely done, marked as understood."
            : "Worth another read, we'll keep this handy for you."}
        </p>
      )}
    </div>
  );
}

/**
 * "Learn -> set goal -> track progress" (§79.14). Reuses the existing,
 * clinician-governed `care_plan_goals` table via its patient-propose RLS
 * policy — this does not assert behaviour changed, it only lets a patient
 * turn a lesson into a proposed goal, same as any other patient-sourced
 * goal on the platform (see 20260830022516_health_education_goal_link.sql).
 */
function SetGoalFromLesson({
  item,
  patientId,
  organisationId,
}: {
  item: AnyEducationItem;
  patientId: string;
  organisationId: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [description, setDescription] = useState("");
  const [saved, setSaved] = useState(false);
  const { data: carePlans } = useCarePlans(patientId);
  const propose = useProposeGoalFromContent(patientId, organisationId);

  const matchingCarePlanId =
    (item.condition && carePlans?.find((p) => p.condition === item.condition)?.id) || null;

  if (saved) {
    return (
      <p className="text-xs text-brand-green dark:text-brand-green-bright">
        Goal sent to your care team to confirm. You&apos;ll see it once they approve it.
      </p>
    );
  }

  if (!expanded) {
    return (
      <Button size="sm" variant="ghost" onClick={() => setExpanded(true)}>
        Set a goal based on this
      </Button>
    );
  }

  return (
    <div className="space-y-2 rounded-md bg-brand-green/5 p-3">
      <label className="block text-xs font-medium text-charcoal-ink/70 dark:text-night-ink/70" htmlFor={`goal-${item.content_id}`}>
        What do you want to try?
      </label>
      <Input
        id={`goal-${item.content_id}`}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="e.g. Cut back on added salt this week"
      />
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={!description.trim() || propose.isPending}
          onClick={() =>
            propose.mutate(
              { contentId: item.content_id, carePlanId: matchingCarePlanId, description: description.trim() },
              { onSuccess: () => setSaved(true) }
            )
          }
        >
          Save goal
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setExpanded(false)}>
          Cancel
        </Button>
      </div>
      {propose.isError && (
        <p className="text-xs text-red-600 dark:text-red-300">Could not save that goal. Try again.</p>
      )}
    </div>
  );
}

function EducationItem({
  item,
  patientId,
  organisationId,
  conditionLanguagePreference,
}: {
  item: AnyEducationItem;
  patientId: string;
  organisationId: string;
  conditionLanguagePreference?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const mark = useMarkContentProgress(patientId, organisationId);
  const questions = useMemo(() => parseKnowledgeCheck(item.knowledge_check), [item.knowledge_check]);
  const audioUrl = "audio_url" in item ? item.audio_url : null;

  function toggle() {
    const next = !open;
    setOpen(next);
    // First open of an un-started item counts as "seen" (one write, never
    // downgrades an existing understood/needs_review status).
    if (next && item.status === null) {
      mark.mutate({ contentId: item.content_id, status: "seen" });
    }
  }

  return (
    <li className="space-y-2 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={toggle}
          className="text-left text-sm font-medium text-charcoal-ink dark:text-night-ink hover:text-brand-green dark:hover:text-brand-green-bright"
        >
          {item.title}
        </button>
        {item.condition && (
          <Badge variant="grey">{conditionLabelFor(item.condition, conditionLanguagePreference)}</Badge>
        )}
        {item.content_type !== "article" && (
          <Badge variant="grey">{CONTENT_TYPE_LABEL[item.content_type] ?? item.content_type.replace(/_/g, " ")}</Badge>
        )}
        {item.status === "needs_review" && <Badge variant="blue">Revisit</Badge>}
        {item.status === "understood" && <Badge variant="green">Understood</Badge>}
      </div>

      {item.summary && <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">{item.summary}</p>}

      <div className="flex flex-wrap items-center gap-3 text-xs text-charcoal-ink/50 dark:text-night-ink/55">
        {item.estimated_minutes ? <span>{item.estimated_minutes} min read</span> : null}
        {item.clinician_reviewed && <span>Reviewed by our clinical team</span>}
      </div>

      {open && (
        <div className="space-y-4 pt-1">
          {item.content_type === "video" && item.video_url && (
            <a
              href={item.video_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block text-sm font-medium text-brand-green dark:text-brand-green-bright underline"
            >
              Watch the video
            </a>
          )}
          {item.content_type === "audio" && audioUrl && (
            <audio controls src={audioUrl} className="w-full">
              Your browser does not support inline audio.
            </audio>
          )}
          <div className="whitespace-pre-line text-sm leading-relaxed text-charcoal-ink/90 dark:text-night-ink/90">
            {item.body}
          </div>

          {questions ? (
            <KnowledgeCheck
              questions={questions}
              pending={mark.isPending}
              onComplete={(result) =>
                mark.mutate({
                  contentId: item.content_id,
                  status: statusFromCheck(result),
                  checkScore: result.score,
                  checkTotal: result.total,
                })
              }
            />
          ) : (
            item.status !== "understood" && (
              <Button
                size="sm"
                variant="outline"
                disabled={mark.isPending}
                onClick={() =>
                  mark.mutate({ contentId: item.content_id, status: "understood" })
                }
              >
                Mark as understood
              </Button>
            )
          )}

          {mark.isError && (
            <p className="text-xs text-red-600 dark:text-red-300">Could not save your progress. Try again.</p>
          )}

          <SetGoalFromLesson item={item} patientId={patientId} organisationId={organisationId} />
          <ContentFeedback
            contentId={item.content_id}
            patientId={patientId}
            organisationId={organisationId}
          />
        </div>
      )}
    </li>
  );
}

function RecommendedForYou({
  patientId,
  organisationId,
  conditionLanguagePreference,
}: {
  patientId: string;
  organisationId: string;
  conditionLanguagePreference?: string | null;
}) {
  const { data, isLoading } = useHealthEducationFeed(patientId);
  const { data: lockedCount } = useHealthEducationLockedCount(patientId);

  const items = (data ?? []).filter((item) => item.status !== "understood").slice(0, 4);

  if (isLoading) {
    return <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">Loading your recommendations…</p>;
  }
  if (items.length === 0) {
    return null;
  }

  return (
    <Card className="border-brand-green/25 bg-soft-sage/30 dark:bg-brand-green/15">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <SEMANTIC_ICON.aiCoach className="h-4.5 w-4.5 text-brand-green dark:text-brand-green-bright" aria-hidden />
          Recommended for you
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-charcoal-ink/10 dark:divide-night-ink/15">
          {items.map((item) => (
            <EducationItem
              key={item.content_id}
              item={item}
              patientId={patientId}
              organisationId={organisationId}
              conditionLanguagePreference={conditionLanguagePreference}
            />
          ))}
        </ul>
        {(lockedCount ?? 0) > 0 && (
          <p className="mt-3 text-xs text-charcoal-ink/50 dark:text-night-ink/55">
            {lockedCount} more personalised lesson{lockedCount === 1 ? "" : "s"} unlock over the
            coming weeks, paced so each one sticks. The full library below is never locked, read
            anything, any time.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/** "After a medication change / abnormal result, here's something relevant"
 * (§79.13). Content-linked, dismissible; the recommendation just points at
 * the ordinary catalogue item — no separate reading surface. */
function RecommendationsBanner({ patientId }: { patientId: string }) {
  const { data } = useHealthEducationRecommendations(patientId);
  const dismiss = useDismissRecommendation(patientId);
  const markViewed = useMarkRecommendationViewed(patientId);

  if (!data || data.length === 0) return null;

  return (
    <div className="space-y-2">
      {data.slice(0, 3).map((rec) => (
        <div
          key={rec.id}
          className="flex items-start justify-between gap-3 rounded-lg border border-brand-green/25 bg-soft-sage/20 dark:bg-brand-green/10 p-3"
          onMouseEnter={() => !rec.viewed_at && markViewed.mutate(rec.id)}
        >
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-brand-green dark:text-brand-green-bright">
              {rec.trigger_reason}
            </p>
            <p className="text-sm font-medium text-charcoal-ink dark:text-night-ink">{rec.content?.title}</p>
            {rec.content?.summary && (
              <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">{rec.content.summary}</p>
            )}
          </div>
          <Button size="sm" variant="ghost" onClick={() => dismiss.mutate(rec.id)}>
            Dismiss
          </Button>
        </div>
      ))}
    </div>
  );
}

/** "How confident are you managing your condition?" (§79.7) — engagement-
 * only self-assessment, never a clinical score. Shown once per condition
 * that has no rating on file yet. */
function HealthLiteracyPrompt({
  patientId,
  organisationId,
  condition,
  label,
}: {
  patientId: string;
  organisationId: string;
  condition: string;
  label: string;
}) {
  const { data: latest, isLoading } = useLatestHealthLiteracy(
    patientId,
    condition as Parameters<typeof useLatestHealthLiteracy>[1]
  );
  const submit = useSubmitHealthLiteracyAssessment(patientId, organisationId);
  const [dismissedThisSession, setDismissedThisSession] = useState(false);

  if (isLoading || latest || dismissedThisSession) return null;

  return (
    <Card className="border-charcoal-ink/10 dark:border-night-ink/15">
      <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
        <p className="text-sm text-charcoal-ink dark:text-night-ink">
          How confident do you feel managing your {label.toLowerCase()}?
        </p>
        <div className="flex items-center gap-1">
          {([1, 2, 3, 4, 5] as const).map((n) => (
            <button
              key={n}
              type="button"
              disabled={submit.isPending}
              onClick={() =>
                submit.mutate({
                  confidenceLevel: n,
                  condition: condition as Parameters<typeof submit.mutate>[0]["condition"],
                })
              }
              className="h-8 w-8 rounded-full border border-charcoal-ink/15 dark:border-night-ink/20 text-sm font-medium text-charcoal-ink dark:text-night-ink hover:border-brand-green hover:bg-brand-green/10"
              aria-label={`${n} out of 5`}
            >
              {n}
            </button>
          ))}
          <Button size="sm" variant="ghost" onClick={() => setDismissedThisSession(true)}>
            Skip
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/** Named learning pathways (§79.6) — a syllabus-visible course over
 * existing content, distinct from the personalised "Recommended for you"
 * loop above. health_education_programmes/_programme_modules and their
 * RPCs are shared infrastructure, not new in this component. */
function LearningPathways({
  patientId,
  organisationId,
  conditionLanguagePreference,
}: {
  patientId: string;
  organisationId: string;
  conditionLanguagePreference?: string | null;
}) {
  const { data: programmes, isLoading } = useHealthEducationProgrammes();
  const [activeCode, setActiveCode] = useState<string | null>(null);
  const { data: detail } = useHealthEducationProgrammeDetail(activeCode);

  if (isLoading || !programmes || programmes.length === 0) return null;

  if (activeCode && detail) {
    const programme = programmes.find((p) => p.code === activeCode);
    return (
      <Card>
        <CardHeader>
          <button
            type="button"
            onClick={() => setActiveCode(null)}
            className="mb-1 text-xs font-medium text-charcoal-ink/60 dark:text-night-ink/60 hover:text-brand-green dark:hover:text-brand-green-bright"
          >
            ← All pathways
          </button>
          <CardTitle>{programme?.title}</CardTitle>
          {programme?.description && (
            <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">{programme.description}</p>
          )}
        </CardHeader>
        <CardContent>
          <ul className="divide-y divide-charcoal-ink/10 dark:divide-night-ink/15">
            {detail.map((row) => (
              <li key={row.module_id} className="py-2">
                <p className="text-xs font-medium uppercase tracking-wide text-charcoal-ink/40 dark:text-night-ink/50">
                  Lesson {row.module_number} of {detail.length}
                </p>
                <EducationItem
                  item={{
                    content_id: row.content_id,
                    code: row.content_code,
                    title: row.content_title,
                    summary: row.content_summary,
                    body: row.content_body,
                    content_type: row.content_type,
                    video_url: row.video_url,
                    audio_url: row.audio_url,
                    estimated_minutes: row.estimated_minutes,
                    condition: programme?.condition ?? null,
                    clinician_reviewed: false,
                    reviewed_by_name: null,
                    has_knowledge_check: row.has_knowledge_check,
                    knowledge_check: row.knowledge_check,
                    status: row.status,
                    check_score: row.check_score,
                    check_total: row.check_total,
                  } as unknown as HealthEducationFeedItem}
                  patientId={patientId}
                  organisationId={organisationId}
                  conditionLanguagePreference={conditionLanguagePreference}
                />
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    );
  }

  return (
    <div>
      <h3 className="mb-3 font-heading text-base font-semibold text-charcoal-ink dark:text-night-ink">
        Learning pathways
      </h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {programmes.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setActiveCode(p.code)}
            className="rounded-lg border border-charcoal-ink/10 dark:border-night-ink/15 bg-white dark:bg-night-card p-4 text-left transition-colors hover:border-brand-green hover:bg-soft-sage/40 dark:hover:bg-brand-green/25"
          >
            <p className="font-medium text-charcoal-ink dark:text-night-ink">{p.title}</p>
            {p.description && <p className="mt-1 text-xs text-charcoal-ink/60 dark:text-night-ink/60">{p.description}</p>}
            <p className="mt-2 text-xs text-charcoal-ink/50 dark:text-night-ink/55">
              {p.completed_count} of {p.module_count} lessons complete
            </p>
          </button>
        ))}
      </div>
    </div>
  );
}

function CategoryGrid({
  onSelect,
}: {
  onSelect: (category: HealthEducationCategory) => void;
}) {
  const { data: counts, isLoading } = useHealthEducationCategoryCounts();
  const countByCategory = new Map((counts ?? []).map((c) => [c.category, c.item_count]));

  return (
    <div>
      <h3 className="mb-3 font-heading text-base font-semibold text-charcoal-ink dark:text-night-ink">
        Browse by topic
      </h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {HEALTH_EDUCATION_CATEGORIES.map(({ value, label }) => {
          const count = countByCategory.get(value) ?? 0;
          return (
            <button
              key={value}
              type="button"
              onClick={() => onSelect(value)}
              disabled={isLoading || count === 0}
              className="flex items-center justify-between rounded-lg border border-charcoal-ink/10 dark:border-night-ink/15 bg-white dark:bg-night-card p-4 text-left transition-colors hover:border-brand-green hover:bg-soft-sage/40 dark:hover:bg-brand-green/25 disabled:cursor-default disabled:opacity-50"
            >
              <span className="font-medium text-charcoal-ink dark:text-night-ink">{label}</span>
              <span className="shrink-0 text-xs text-charcoal-ink/50 dark:text-night-ink/55">
                {isLoading ? "…" : `${count} topic${count === 1 ? "" : "s"}`}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * A single category's reading list — exported so a feature page can embed
 * one topic directly (e.g. the Wellbeing dashboard's "mental_health" list,
 * Module 46 §46.6/§46.7) without pulling in the full browsable-library UI.
 * `onBack` is omitted in that embedded case, which also hides the back link.
 */
export function CategoryDetail({
  category,
  onBack,
  patientId,
  organisationId,
  conditionLanguagePreference,
}: {
  category: HealthEducationCategory;
  onBack?: () => void;
  patientId: string;
  organisationId: string;
  conditionLanguagePreference?: string | null;
}) {
  const { data, isLoading, isError } = useHealthEducationLibrary(category);
  const [query, setQuery] = useState("");
  const [readingLevel, setReadingLevel] = useState<HealthEducationReadingLevel | null>(null);

  const label = HEALTH_EDUCATION_CATEGORIES.find((c) => c.value === category)?.label ?? category;

  const items = (data ?? []).filter((item) => {
    if (readingLevel && item.reading_level !== readingLevel) return false;
    if (!query.trim()) return true;
    const q = query.trim().toLowerCase();
    return item.title.toLowerCase().includes(q) || (item.summary ?? "").toLowerCase().includes(q);
  });

  // Only worth showing the reading-level filter when this topic actually has
  // more than one level authored — most content today is "simple" only.
  const hasMultipleLevels =
    new Set((data ?? []).map((item) => item.reading_level)).size > 1;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            {onBack && (
              <button
                type="button"
                onClick={onBack}
                className="mb-1 text-xs font-medium text-charcoal-ink/60 dark:text-night-ink/60 hover:text-brand-green dark:hover:text-brand-green-bright"
              >
                ← All topics
              </button>
            )}
            <CardTitle>{label}</CardTitle>
          </div>
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search this topic…"
            className="w-full sm:w-56"
            aria-label={`Search ${label}`}
          />
        </div>
        {hasMultipleLevels && (
          <div className="flex flex-wrap items-center gap-1.5 pt-2">
            <span className="text-xs text-charcoal-ink/50 dark:text-night-ink/55">Reading level:</span>
            <button
              type="button"
              onClick={() => setReadingLevel(null)}
              className={cn(
                "rounded-full px-2.5 py-0.5 text-xs",
                readingLevel === null ? "bg-brand-green text-white" : "bg-charcoal-ink/5 dark:bg-night-ink/10 text-charcoal-ink/60 dark:text-night-ink/60"
              )}
            >
              All
            </button>
            {HEALTH_EDUCATION_READING_LEVELS.map(({ value, label: levelLabel }) => (
              <button
                key={value}
                type="button"
                onClick={() => setReadingLevel(value)}
                className={cn(
                  "rounded-full px-2.5 py-0.5 text-xs",
                  readingLevel === value
                    ? "bg-brand-green text-white"
                    : "bg-charcoal-ink/5 dark:bg-night-ink/10 text-charcoal-ink/60 dark:text-night-ink/60"
                )}
              >
                {levelLabel}
              </button>
            ))}
          </div>
        )}
      </CardHeader>
      <CardContent>
        {isLoading && <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">Loading…</p>}
        {isError && <p className="text-sm text-red-600 dark:text-red-300">Could not load this topic right now.</p>}
        {data && items.length === 0 && (
          <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">
            {query ? "Nothing matches that search." : "Nothing here yet."}
          </p>
        )}
        {items.length > 0 && (
          <ul className="divide-y divide-charcoal-ink/10 dark:divide-night-ink/15">
            {items.map((item) => (
              <EducationItem
                key={item.content_id}
                item={item}
                patientId={patientId}
                organisationId={organisationId}
                conditionLanguagePreference={conditionLanguagePreference}
              />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * The full patient-facing health library: a "Recommended for you" rail
 * (personalised + paced, from health_education_feed) sitting above a
 * genuinely browsable library of every active topic (health_education_library,
 * deliberately ungated by condition/drip) that the patient can choose into
 * regardless of what's on their own chart. Replaces the old narrow
 * condition-matched, drip-throttled single feed that used to be the entire
 * "Learning for you" card — a patient with no diagnosed condition used to
 * see almost nothing; the library view fixes that.
 */
export function HealthEducationLibrary({
  patientId,
  organisationId,
  conditionLanguagePreference,
}: {
  patientId: string;
  organisationId: string;
  conditionLanguagePreference?: string | null;
}) {
  const [activeCategory, setActiveCategory] = useState<HealthEducationCategory | null>(null);
  const { data: carePlans } = useCarePlans(patientId);
  const firstCondition = carePlans?.[0]?.condition ?? null;

  return (
    <div className={cn("space-y-6")}>
      <RecommendationsBanner patientId={patientId} />

      {firstCondition && (
        <HealthLiteracyPrompt
          patientId={patientId}
          organisationId={organisationId}
          condition={firstCondition}
          label={conditionLabelFor(firstCondition, conditionLanguagePreference)}
        />
      )}

      <RecommendedForYou
        patientId={patientId}
        organisationId={organisationId}
        conditionLanguagePreference={conditionLanguagePreference}
      />

      <LearningPathways
        patientId={patientId}
        organisationId={organisationId}
        conditionLanguagePreference={conditionLanguagePreference}
      />

      {activeCategory ? (
        <CategoryDetail
          category={activeCategory}
          onBack={() => setActiveCategory(null)}
          patientId={patientId}
          organisationId={organisationId}
          conditionLanguagePreference={conditionLanguagePreference}
        />
      ) : (
        <CategoryGrid onSelect={setActiveCategory} />
      )}
    </div>
  );
}
