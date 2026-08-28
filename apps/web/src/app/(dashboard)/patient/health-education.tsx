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
  HEALTH_EDUCATION_CATEGORIES,
  HEALTH_EDUCATION_READING_LEVELS,
  HEALTH_EDUCATION_FEEDBACK_OPTIONS,
  type HealthEducationFeedItem,
  type HealthEducationLibraryItem,
  type HealthEducationCategory,
  type HealthEducationReadingLevel,
  type HealthEducationFeedbackType,
} from "@/lib/queries/health-education";
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
      <p className="text-xs text-charcoal-ink/50">
        {sent === "report_incorrect"
          ? "Thanks — this has been flagged for our clinical team to check."
          : "Thanks for the feedback."}
      </p>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-charcoal-ink/10 pt-2">
      <span className="text-xs text-charcoal-ink/50">Was this helpful?</span>
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
              ? "border-charcoal-ink/15 text-charcoal-ink/50 hover:border-red-400 hover:text-red-600"
              : "border-charcoal-ink/15 text-charcoal-ink/60 hover:border-brand-green hover:text-brand-green"
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
    <div className="space-y-4 rounded-md bg-charcoal-ink/5 p-3">
      <p className="text-xs font-medium uppercase tracking-wide text-charcoal-ink/60">
        Quick check
      </p>
      {questions.map((q, qi) => (
        <fieldset key={qi} className="space-y-1.5">
          <legend className="text-sm text-charcoal-ink">{q.question}</legend>
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
                      ? "bg-green-100 text-green-800"
                      : showWrong
                        ? "bg-red-100 text-red-700"
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
        <p className="text-sm text-charcoal-ink">
          You got <strong>{result.score}</strong> of {result.total}.{" "}
          {result.allCorrect
            ? "Nicely done, marked as understood."
            : "Worth another read, we'll keep this handy for you."}
        </p>
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
          className="text-left text-sm font-medium text-charcoal-ink hover:text-brand-green"
        >
          {item.title}
        </button>
        {item.condition && (
          <Badge variant="grey">{conditionLabelFor(item.condition, conditionLanguagePreference)}</Badge>
        )}
        {item.content_type !== "article" && (
          <Badge variant="grey">{CONTENT_TYPE_LABEL[item.content_type] ?? item.content_type}</Badge>
        )}
        {item.status === "needs_review" && <Badge variant="blue">Revisit</Badge>}
        {item.status === "understood" && <Badge variant="green">Understood</Badge>}
      </div>

      {item.summary && <p className="text-sm text-charcoal-ink/70">{item.summary}</p>}

      <div className="flex flex-wrap items-center gap-3 text-xs text-charcoal-ink/50">
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
              className="inline-block text-sm font-medium text-brand-green underline"
            >
              Watch the video
            </a>
          )}
          {item.content_type === "audio" && item.audio_url && (
            <audio controls src={item.audio_url} className="w-full" />
          )}
          <div className="whitespace-pre-line text-sm leading-relaxed text-charcoal-ink/90">
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
            <p className="text-xs text-red-600">Could not save your progress. Try again.</p>
          )}

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
    return <p className="text-sm text-charcoal-ink/60">Loading your recommendations…</p>;
  }
  if (items.length === 0) {
    return null;
  }

  return (
    <Card className="border-brand-green/25 bg-soft-sage/30">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <SEMANTIC_ICON.aiCoach className="h-4.5 w-4.5 text-brand-green" aria-hidden />
          Recommended for you
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-charcoal-ink/10">
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
          <p className="mt-3 text-xs text-charcoal-ink/50">
            {lockedCount} more personalised lesson{lockedCount === 1 ? "" : "s"} unlock over the
            coming weeks, paced so each one sticks. The full library below is never locked, read
            anything, any time.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * §20.13 Education programmes — a named, ordered module sequence on one
 * condition ("Hypertension Education Programme, Module 1..."), distinct from
 * the free-browse category library above. Modules reuse the same catalogue
 * content rows the feed/library already show; this is just a guided order.
 */
function ProgrammeDetail({
  code,
  onBack,
  patientId,
  organisationId,
}: {
  code: string;
  onBack: () => void;
  patientId: string;
  organisationId: string;
}) {
  const { data, isLoading } = useHealthEducationProgrammeDetail(code);
  const mark = useMarkContentProgress(patientId, organisationId);

  const title = data?.[0]?.programme_title ?? "Programme";

  return (
    <Card>
      <CardHeader>
        <button
          type="button"
          onClick={onBack}
          className="mb-1 text-xs font-medium text-charcoal-ink/60 hover:text-brand-green"
        >
          ← All programmes
        </button>
        <CardTitle>{title}</CardTitle>
        {data?.[0]?.programme_description && (
          <p className="text-sm text-charcoal-ink/60">{data[0].programme_description}</p>
        )}
      </CardHeader>
      <CardContent>
        {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
        {data && data.length > 0 && (
          <ol className="divide-y divide-charcoal-ink/10">
            {data.map((mod) => (
              <li key={mod.module_id} className="flex items-start gap-3 py-3">
                <span
                  className={cn(
                    "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-medium",
                    mod.status === "understood"
                      ? "bg-brand-green text-white"
                      : "bg-charcoal-ink/10 text-charcoal-ink/60"
                  )}
                >
                  {mod.status === "understood" ? "✓" : mod.module_number}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-charcoal-ink">{mod.module_title}</p>
                  {mod.content_summary && (
                    <p className="text-xs text-charcoal-ink/60">{mod.content_summary}</p>
                  )}
                  {mod.status !== "understood" && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="mt-1.5 h-7 px-2 text-xs"
                      disabled={mark.isPending}
                      onClick={() =>
                        mark.mutate({ contentId: mod.content_id, status: "understood" })
                      }
                    >
                      Mark module {mod.module_number} as understood
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

function HealthEducationProgrammes({
  patientId,
  organisationId,
}: {
  patientId: string;
  organisationId: string;
}) {
  const { data: programmes, isLoading } = useHealthEducationProgrammes();
  const [activeCode, setActiveCode] = useState<string | null>(null);

  if (isLoading || !programmes || programmes.length === 0) return null;

  if (activeCode) {
    return (
      <ProgrammeDetail
        code={activeCode}
        onBack={() => setActiveCode(null)}
        patientId={patientId}
        organisationId={organisationId}
      />
    );
  }

  return (
    <div>
      <h3 className="mb-3 font-heading text-base font-semibold text-charcoal-ink">
        Guided programmes
      </h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {programmes.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setActiveCode(p.code)}
            className="rounded-lg border border-charcoal-ink/10 bg-white p-4 text-left transition-colors hover:border-brand-green hover:bg-soft-sage/40"
          >
            <p className="font-medium text-charcoal-ink">{p.title}</p>
            {p.description && <p className="mt-0.5 text-xs text-charcoal-ink/60">{p.description}</p>}
            <p className="mt-2 text-xs text-charcoal-ink/50">
              {p.completed_count} of {p.module_count} modules completed
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
      <h3 className="mb-3 font-heading text-base font-semibold text-charcoal-ink">
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
              className="flex items-center justify-between rounded-lg border border-charcoal-ink/10 bg-white p-4 text-left transition-colors hover:border-brand-green hover:bg-soft-sage/40 disabled:cursor-default disabled:opacity-50"
            >
              <span className="font-medium text-charcoal-ink">{label}</span>
              <span className="shrink-0 text-xs text-charcoal-ink/50">
                {isLoading ? "…" : `${count} topic${count === 1 ? "" : "s"}`}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function CategoryDetail({
  category,
  onBack,
  patientId,
  organisationId,
  conditionLanguagePreference,
}: {
  category: HealthEducationCategory;
  onBack: () => void;
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
            <button
              type="button"
              onClick={onBack}
              className="mb-1 text-xs font-medium text-charcoal-ink/60 hover:text-brand-green"
            >
              ← All topics
            </button>
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
            <span className="text-xs text-charcoal-ink/50">Reading level:</span>
            <button
              type="button"
              onClick={() => setReadingLevel(null)}
              className={cn(
                "rounded-full px-2.5 py-0.5 text-xs",
                readingLevel === null ? "bg-brand-green text-white" : "bg-charcoal-ink/5 text-charcoal-ink/60"
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
                    : "bg-charcoal-ink/5 text-charcoal-ink/60"
                )}
              >
                {levelLabel}
              </button>
            ))}
          </div>
        )}
      </CardHeader>
      <CardContent>
        {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
        {isError && <p className="text-sm text-red-600">Could not load this topic right now.</p>}
        {data && items.length === 0 && (
          <p className="text-sm text-charcoal-ink/60">
            {query ? "Nothing matches that search." : "Nothing here yet."}
          </p>
        )}
        {items.length > 0 && (
          <ul className="divide-y divide-charcoal-ink/10">
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

  return (
    <div className={cn("space-y-6")}>
      <RecommendedForYou
        patientId={patientId}
        organisationId={organisationId}
        conditionLanguagePreference={conditionLanguagePreference}
      />

      <HealthEducationProgrammes patientId={patientId} organisationId={organisationId} />

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
