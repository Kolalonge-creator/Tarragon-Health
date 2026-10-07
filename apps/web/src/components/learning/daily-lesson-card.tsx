"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { t } from "@tarragon/i18n";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { dailyLessonKey, useDailyMicroLesson } from "@/lib/queries/learning-centre";
import { useMarkContentProgress } from "@/lib/queries/health-education";
import { parseKnowledgeCheck, scoreKnowledgeCheck, statusFromCheck } from "@/lib/validation/health-education";
import { LearningItemFooter } from "./learning-item-footer";

/**
 * The daily micro-lesson (spec 9.2): under five minutes, one action, one check question. Reusable: the patient Learn page and
 * the dashboard mount it today, and the Today screen can mount the same component. It renders nothing when there is no
 * in-date lesson, so an empty library never shows an empty card.
 */
export function DailyLessonCard({ patientId, organisationId }: { patientId: string; organisationId: string }) {
  const { data: lesson, isLoading } = useDailyMicroLesson(patientId);
  const mark = useMarkContentProgress(patientId, organisationId);
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<number | null>(null);
  const [result, setResult] = useState<"right" | "again" | null>(null);

  const questions = parseKnowledgeCheck(lesson?.check_question ? [lesson.check_question] : null);
  const question = questions?.[0] ?? null;

  if (isLoading || !lesson) return null;
  const done = lesson.completed_today === true || result === "right";

  async function submit() {
    if (!lesson || !question || picked === null) return;
    const scored = scoreKnowledgeCheck([question], [picked]);
    await mark.mutateAsync({
      contentId: lesson.content_id,
      status: statusFromCheck(scored),
      checkScore: scored.score,
      checkTotal: scored.total,
    });
    setResult(scored.allCorrect ? "right" : "again");
    await qc.invalidateQueries({ queryKey: dailyLessonKey(patientId) });
  }

  return (
    <Card data-testid="daily-lesson-card">
      <CardHeader>
        <p className="text-xs font-semibold uppercase tracking-wide text-brand-green dark:text-brand-green-bright">{t("learn.daily.title")}</p>
        <CardTitle className="text-lg">{lesson.title}</CardTitle>
        {lesson.estimated_minutes ? (
          <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/65">{t("learn.daily.minutes", "en", { minutes: lesson.estimated_minutes })}</p>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-3">
        {done ? (
          <p className="text-sm text-charcoal-ink/80 dark:text-night-ink/80">{t("learn.daily.done")}</p>
        ) : !open ? (
          <Button size="sm" onClick={() => setOpen(true)}>
            {t("learn.daily.start")}
          </Button>
        ) : (
          <div className="space-y-3">
            <div className="whitespace-pre-line text-sm leading-relaxed text-charcoal-ink/90 dark:text-night-ink/90">{lesson.body}</div>
            {lesson.lesson_action && (
              <p className="rounded-lg bg-brand-green/5 p-2 text-sm dark:bg-brand-green/10">
                <span className="font-semibold">{t("learn.daily.action_label")}: </span>
                {lesson.lesson_action}
              </p>
            )}
            {question && (
              <fieldset className="space-y-1">
                <legend className="text-sm font-semibold">{t("learn.daily.check_label")}</legend>
                <p className="text-sm">{question.question}</p>
                {question.options.map((opt, i) => (
                  <label key={i} className="flex items-center gap-2 text-sm">
                    <input type="radio" name="daily-check" checked={picked === i} onChange={() => setPicked(i)} disabled={result !== null} />
                    {opt}
                  </label>
                ))}
                {result === null && (
                  <Button size="sm" variant="outline" onClick={submit} disabled={picked === null || mark.isPending}>
                    {t("common.continue")}
                  </Button>
                )}
                {result === "again" && <p className="text-xs text-charcoal-ink/70 dark:text-night-ink/70">{t("learn.daily.again")}</p>}
              </fieldset>
            )}
            {mark.isError && <p className="text-xs text-red-700 dark:text-red-300">{t("learn.daily.save_failed")}</p>}
            <LearningItemFooter code={lesson.code} title={lesson.title} contentType="article" />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
