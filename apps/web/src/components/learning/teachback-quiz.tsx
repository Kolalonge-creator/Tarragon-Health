"use client";

import { useState } from "react";
import { t } from "@tarragon/i18n";
import { Button } from "@/components/ui/button";
import { useLessonTeachback, useRecordTeachback, useShareTeachback, type TeachbackMarks } from "@/lib/queries/learning-quality";

/**
 * Teach-back at the end of a lesson (1 to 3 authored questions). A gentle check of what the person understood, for them alone:
 *  - a wrong answer shows the right one and the author's kind explanation;
 *  - the result is stored against the account only; it reaches the care team only if the person presses "Share" (which uses the
 *    existing "ask your care team" save);
 *  - no score is shown to anyone else, there is no streak and no "you lost" wording, and nothing here changes whether the lesson
 *    is finished: it is an optional extra that sits beside the lesson's own controls, never in front of them.
 * It renders nothing when the lesson has no teach-back or the request fails.
 */
export function TeachbackQuiz({ code }: { code: string }) {
  const { data: questions } = useLessonTeachback(code);
  const record = useRecordTeachback(code);
  const share = useShareTeachback(code);
  const [picks, setPicks] = useState<(number | null)[]>([]);
  const [marks, setMarks] = useState<TeachbackMarks | null>(null);
  const [shared, setShared] = useState(false);

  if (!questions || questions.length === 0) return null;

  async function check() {
    if (!questions) return;
    const answers = questions.map((_, i) => picks[i] ?? -1);
    try {
      setMarks(await record.mutateAsync(answers));
      setShared(false);
    } catch {
      /* the failed message below is driven by record.isError */
    }
  }

  async function toggleShare() {
    try {
      const ok = await share.mutateAsync(!shared);
      if (ok) setShared(!shared);
    } catch {
      /* shown through share.isError */
    }
  }

  return (
    <section aria-labelledby={`tb-${code}`} className="space-y-3 rounded-xl border border-charcoal-ink/10 p-3 dark:border-night-ink/15" data-testid="teachback">
      <div>
        <h3 id={`tb-${code}`} className="text-sm font-semibold text-charcoal-ink dark:text-night-ink">
          {t("learn.teachback.title")}
        </h3>
        <p className="text-xs text-charcoal-ink/70 dark:text-night-ink/70">{t("learn.teachback.intro")}</p>
        <p className="text-xs text-charcoal-ink/70 dark:text-night-ink/70">{t("learn.teachback.skip_note")}</p>
      </div>

      {questions.map((q, qi) => {
        const mark = marks?.marks[qi];
        return (
          <fieldset key={qi} className="space-y-1">
            <legend className="text-sm font-medium">{q.question}</legend>
            {q.options.map((opt, oi) => (
              <label key={oi} className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name={`tb-${code}-${qi}`}
                  checked={picks[qi] === oi}
                  disabled={marks !== null}
                  onChange={() => setPicks((p) => Object.assign([...p], { [qi]: oi }))}
                />
                {opt}
              </label>
            ))}
            {mark && (
              <div className="rounded-lg bg-brand-green/5 p-2 text-sm dark:bg-brand-green/10" role="status">
                {mark.correct ? (
                  <p className="font-medium">{t("learn.teachback.right")}</p>
                ) : (
                  <p className="font-medium">{t("learn.teachback.not_yet", "en", { answer: q.options[mark.correct_index] ?? "" })}</p>
                )}
                <p className="mt-0.5 text-charcoal-ink/80 dark:text-night-ink/80">{mark.explanation}</p>
              </div>
            )}
          </fieldset>
        );
      })}

      {marks === null ? (
        <Button size="sm" variant="outline" onClick={check} disabled={record.isPending || picks.every((p) => p == null)}>
          {t("learn.teachback.check")}
        </Button>
      ) : (
        <div className="space-y-2">
          <p className="text-sm font-medium">{t("learn.teachback.result", "en", { correct: marks.correct, total: marks.total })}</p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setMarks(null);
                setPicks([]);
                setShared(false);
              }}
            >
              {t("learn.teachback.again")}
            </Button>
            <Button size="sm" variant="outline" onClick={toggleShare} disabled={share.isPending}>
              {shared ? t("learn.teachback.unshare") : t("learn.teachback.share")}
            </Button>
          </div>
          <p className="text-xs text-charcoal-ink/70 dark:text-night-ink/70">{shared ? t("learn.teachback.shared") : t("learn.teachback.unshared")}</p>
        </div>
      )}
      {(record.isError || share.isError) && <p className="text-xs text-red-700 dark:text-red-300">{t("learn.teachback.failed")}</p>}
    </section>
  );
}
