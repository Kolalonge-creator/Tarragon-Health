"use client";

import { useMemo, useState } from "react";
import {
  useHealthEducationFeed,
  useHealthEducationLockedCount,
  useHealthEducationCategoryCounts,
  useHealthEducationLibrary,
  useMarkContentProgress,
  HEALTH_EDUCATION_CATEGORIES,
  type HealthEducationFeedItem,
  type HealthEducationLibraryItem,
  type HealthEducationCategory,
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
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
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
        {item.content_type === "video" && <Badge variant="grey">Video</Badge>}
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
    return (
      <Card className="border-brand-green/25 bg-soft-sage/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <SEMANTIC_ICON.aiCoach className="h-4.5 w-4.5 text-brand-green" aria-hidden />
            Recommended for you
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
        </CardContent>
      </Card>
    );
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

  const label = HEALTH_EDUCATION_CATEGORIES.find((c) => c.value === category)?.label ?? category;

  const items = (data ?? []).filter((item) => {
    if (!query.trim()) return true;
    const q = query.trim().toLowerCase();
    return item.title.toLowerCase().includes(q) || (item.summary ?? "").toLowerCase().includes(q);
  });

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
      </CardHeader>
      <CardContent>
        {isLoading && (
          <ul className="divide-y divide-charcoal-ink/10">
            {[0, 1, 2].map((i) => (
              <li key={i} className="space-y-2 py-3">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3 w-full" />
              </li>
            ))}
          </ul>
        )}
        {isError && <p className="text-sm text-red-600">Could not load this topic right now.</p>}
        {data && items.length === 0 && (
          query ? (
            <p className="text-sm text-charcoal-ink/60">Nothing matches that search.</p>
          ) : (
            <EmptyState
              icon={SEMANTIC_ICON.learn}
              title="Nothing here yet"
              description="Check back soon, we're adding to this topic."
            />
          )
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
