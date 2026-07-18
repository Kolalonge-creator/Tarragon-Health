"use client";

import { useMemo, useState } from "react";
import {
  useHealthEducationFeed,
  useMarkContentProgress,
  type HealthEducationFeedItem,
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
import { SEMANTIC_ICON } from "@/lib/icons";

const CONDITION_LABEL: Record<string, string> = {
  hypertension: "Blood pressure",
  diabetes: "Diabetes",
  obesity: "Weight",
  ckd: "Kidney health",
  cardiovascular: "Heart health",
  other: "General",
};

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
            ? "Nicely done — marked as understood."
            : "Worth another read — we'll keep this handy for you."}
        </p>
      )}
    </div>
  );
}

function EducationItem({
  item,
  patientId,
  organisationId,
}: {
  item: HealthEducationFeedItem;
  patientId: string;
  organisationId: string;
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
          <Badge variant="grey">{CONDITION_LABEL[item.condition] ?? item.condition}</Badge>
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

export function HealthEducation({
  patientId,
  organisationId,
}: {
  patientId: string;
  organisationId: string;
}) {
  const { data, isLoading, isError } = useHealthEducationFeed(patientId);
  const Icon = SEMANTIC_ICON.preventive;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Icon className="h-5 w-5 text-brand-green" aria-hidden />
          Learning for you
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
        {isError && (
          <p className="text-sm text-red-600">Could not load your learning right now.</p>
        )}
        {data && data.length === 0 && (
          <p className="text-sm text-charcoal-ink/60">
            Nothing new to read just yet — check back as your care progresses.
          </p>
        )}
        {data && data.length > 0 && (
          <ul className="divide-y divide-charcoal-ink/10">
            {data.map((item) => (
              <EducationItem
                key={item.content_id}
                item={item}
                patientId={patientId}
                organisationId={organisationId}
              />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
