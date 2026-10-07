"use client";

import { useState } from "react";
import { t } from "@tarragon/i18n";
import type { TherapyAnswers } from "@tarragon/shared";
import { Button } from "@/components/ui/button";
import type { EntryQuestion } from "@tarragon/shared";

/**
 * The entry questions, used at enrolment and again before every session. Every question must be answered: an unanswered question
 * never reaches the server as "no" (the database also treats a missing answer as a stop). Yes or no for a symptom, a whole number for a score.
 */
export function TherapyQuestionForm({
  questions,
  submitLabel,
  busy,
  onSubmit,
}: {
  questions: EntryQuestion[];
  submitLabel: string;
  busy: boolean;
  onSubmit: (answers: TherapyAnswers) => void;
}) {
  const [answers, setAnswers] = useState<Record<string, boolean | number | undefined>>({});
  const [missing, setMissing] = useState(false);

  function submit() {
    const complete = questions.every((q) => {
      const a = answers[q.code];
      return q.kind === "yes_no" ? typeof a === "boolean" : typeof a === "number" && Number.isInteger(a) && a >= 0;
    });
    if (!complete) {
      setMissing(true);
      return;
    }
    setMissing(false);
    onSubmit(answers);
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      {questions.map((q) => (
        <fieldset key={q.code} className="space-y-2">
          <legend className="text-sm font-medium">{q.question}</legend>
          {q.kind === "yes_no" ? (
            <div className="flex gap-4">
              {([true, false] as const).map((v) => (
                <label key={String(v)} className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name={`q-${q.code}`}
                    checked={answers[q.code] === v}
                    onChange={() => setAnswers((a) => ({ ...a, [q.code]: v }))}
                  />
                  {v ? t("therapy.enrol.yes") : t("therapy.enrol.no")}
                </label>
              ))}
            </div>
          ) : (
            <div className="space-y-1">
              <label htmlFor={`q-${q.code}`} className="text-xs text-charcoal-ink/70 dark:text-night-ink/70">{t("therapy.enrol.score_label")}</label>
              <input
                id={`q-${q.code}`}
                inputMode="numeric"
                autoComplete="off"
                className="block w-24 rounded-md border border-charcoal-ink/20 dark:border-night-ink/25 bg-transparent px-2 py-1.5 text-sm"
                value={typeof answers[q.code] === "number" ? String(answers[q.code]) : ""}
                onChange={(e) => {
                  const digits = e.target.value.replace(/\D/g, "").slice(0, 3);
                  setAnswers((a) => ({ ...a, [q.code]: digits === "" ? undefined : Number(digits) }));
                }}
              />
            </div>
          )}
        </fieldset>
      ))}
      {missing && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{t("therapy.enrol.answer_all")}</p>}
      <Button type="submit" disabled={busy}>{busy ? t("therapy.enrol.checking") : submitLabel}</Button>
    </form>
  );
}
