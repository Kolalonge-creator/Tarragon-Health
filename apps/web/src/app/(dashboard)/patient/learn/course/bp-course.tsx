"use client";

import { useMemo, useState } from "react";
import { t, type Locale, type MessageKey, type MessageParams } from "@tarragon/i18n";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useMarkContentProgress, useSubmitContentFeedback } from "@/lib/queries/health-education";
import { scoreKnowledgeCheck } from "@/lib/validation/health-education";
import { lessonDone, paragraphs, summarise, type CourseLesson } from "./course-model";

const MUTED = "text-charcoal-ink/70 dark:text-night-ink/70";

/**
 * The blood pressure course (S33). A list of short lessons and, inside one, the words of the lesson, one thing to try
 * today and one question. No audio on the web yet (the recordings play in the app). A lesson counts as done when its
 * question has been answered; opening it does not finish it. Nothing here reads or asks for a reading.
 */
export function BpCourse({
  lessons,
  locale,
  patientId,
  organisationId,
}: {
  lessons: CourseLesson[];
  locale: Locale;
  patientId: string;
  organisationId: string;
}) {
  const tr = (key: MessageKey, params?: MessageParams) => t(key, locale, params);
  const [open, setOpen] = useState<number | null>(null);
  const [status, setStatus] = useState<Record<number, CourseLesson["status"]>>({});
  const merged = useMemo(() => lessons.map((l) => ({ ...l, status: status[l.moduleNumber] ?? l.status })), [lessons, status]);
  const summary = summarise(merged);
  const current = merged.find((l) => l.moduleNumber === open) ?? null;

  if (merged.length === 0) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className={MUTED}>{tr("course.not_open")}</p>
        </CardContent>
      </Card>
    );
  }

  if (current) {
    return (
      <Lesson
        key={current.contentId}
        lesson={current}
        locale={locale}
        patientId={patientId}
        organisationId={organisationId}
        onBack={() => setOpen(null)}
        onResult={(s) => setStatus((prev) => ({ ...prev, [current.moduleNumber]: s }))}
      />
    );
  }

  return (
    <div className="space-y-4">
      <p className={MUTED}>{tr("course.progress", { done: summary.done, total: summary.total })}</p>
      {summary.finished && (
        <Card>
          <CardHeader>
            <CardTitle>{tr("course.completed_title")}</CardTitle>
          </CardHeader>
          <CardContent>{tr("course.completed_body")}</CardContent>
        </Card>
      )}
      <ol className="space-y-3">
        {merged.map((l) => (
          <li key={l.contentId}>
            <Card>
              <CardHeader>
                <p className={`text-sm ${MUTED}`}>
                  {tr("course.lesson_n", { n: l.moduleNumber })} · {tr("course.minutes", { min: l.estimatedMinutes })}
                  {lessonDone(l) ? ` · ${tr("course.done")}` : ""}
                </p>
                <CardTitle>{l.title}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className={MUTED}>{l.summary}</p>
                <Button variant="outline" onClick={() => setOpen(l.moduleNumber)}>
                  {tr("course.lesson_n", { n: l.moduleNumber })}
                </Button>
              </CardContent>
            </Card>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Lesson({
  lesson,
  locale,
  patientId,
  organisationId,
  onBack,
  onResult,
}: {
  lesson: CourseLesson;
  locale: Locale;
  patientId: string;
  organisationId: string;
  onBack: () => void;
  onResult: (s: "understood" | "needs_review") => void;
}) {
  const tr = (key: MessageKey, params?: MessageParams) => t(key, locale, params);
  const mark = useMarkContentProgress(patientId, organisationId);
  const feedback = useSubmitContentFeedback(patientId, organisationId);
  const [picked, setPicked] = useState<number | undefined>(undefined);
  const [outcome, setOutcome] = useState<"right" | "again" | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  const [clear, setClear] = useState<boolean | null>(null);

  async function check() {
    if (!lesson.check || picked === undefined) return;
    const result = scoreKnowledgeCheck([lesson.check], [picked]);
    const status = result.allCorrect ? ("understood" as const) : ("needs_review" as const);
    setOutcome(result.allCorrect ? "right" : "again");
    try {
      await mark.mutateAsync({ contentId: lesson.contentId, status, checkScore: result.score, checkTotal: result.total });
      setSaveFailed(false);
      onResult(status);
    } catch {
      setSaveFailed(true);
    }
  }

  async function sendClarity(isClear: boolean) {
    setClear(isClear);
    try {
      await feedback.mutateAsync({ contentId: lesson.contentId, feedbackType: isClear ? "helpful" : "unclear" });
    } catch {
      // A missed clarity tap is not worth interrupting the learner for.
    }
  }

  return (
    <div className="space-y-4">
      <Button variant="ghost" onClick={onBack}>
        {tr("common.back")}
      </Button>
      <div>
        <p className={`text-sm ${MUTED}`}>
          {tr("course.lesson_n", { n: lesson.moduleNumber })} · {tr("course.minutes", { min: lesson.estimatedMinutes })}
        </p>
        <h2 className="text-2xl font-semibold">{lesson.title}</h2>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{tr("lesson.transcript")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-base leading-relaxed">
          {paragraphs(lesson.body).map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </CardContent>
      </Card>
      {lesson.nextAction && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">{tr("lesson.action_title")}</CardTitle>
          </CardHeader>
          <CardContent className="text-base">{lesson.nextAction}</CardContent>
        </Card>
      )}
      {lesson.check && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">{tr("lesson.check_title")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="font-medium">{lesson.check.question}</p>
            <div role="radiogroup" aria-label={lesson.check.question} className="space-y-2">
              {lesson.check.options.map((o, i) => (
                <Button
                  key={i}
                  role="radio"
                  aria-checked={picked === i}
                  variant={picked === i ? "default" : "outline"}
                  className="w-full justify-start whitespace-normal text-left"
                  onClick={() => {
                    setPicked(i);
                    setOutcome(null);
                  }}
                >
                  {o}
                </Button>
              ))}
            </div>
            <Button disabled={picked === undefined || mark.isPending} onClick={() => void check()}>
              {tr("lesson.check_submit")}
            </Button>
            <div aria-live="polite">
              {outcome === "right" && <p>{tr("lesson.check_right")}</p>}
              {outcome === "again" && <p>{tr("lesson.check_again")}</p>}
              {saveFailed && <p className={MUTED}>{tr("course.error.save")}</p>}
            </div>
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{tr("lesson.clear_title")}</CardTitle>
        </CardHeader>
        <CardContent>
          {clear === null ? (
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => void sendClarity(true)}>
                {tr("lesson.clear_yes")}
              </Button>
              <Button variant="outline" onClick={() => void sendClarity(false)}>
                {tr("lesson.clear_no")}
              </Button>
            </div>
          ) : (
            <p>{tr("lesson.clear_thanks")}</p>
          )}
        </CardContent>
      </Card>
      <p className={`text-sm ${MUTED}`}>{tr("lesson.not_advice")}</p>
      {lesson.reviewedByName && <p className={`text-sm ${MUTED}`}>{tr("lesson.reviewed_by", { name: lesson.reviewedByName })}</p>}
      {lesson.nextReviewDue && <p className={`text-sm ${MUTED}`}>{tr("lesson.review_due", { date: lesson.nextReviewDue })}</p>}
    </div>
  );
}
