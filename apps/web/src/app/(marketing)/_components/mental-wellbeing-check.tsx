"use client";

import { useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import {
  scoreWellbeingPulse,
  WELLBEING_BAND_COPY,
  WELLBEING_QUESTIONS,
  type WellbeingBand,
} from "@/lib/wellbeing/mental-wellbeing-pulse";

const SCALE_LABELS = [
  "Strongly disagree",
  "Disagree",
  "Neutral",
  "Agree",
  "Strongly agree",
];

const BAND_TONE: Record<WellbeingBand, string> = {
  thriving: "border-brand-green bg-brand-green/5",
  steady: "border-deep-forest/40 bg-soft-sage",
  under_strain: "border-amber-400 bg-amber-50",
  struggling: "border-red-300 bg-red-50",
};

/**
 * Public, anonymous, non-diagnostic wellbeing pulse-check. Nothing here is
 * stored or sent anywhere; scoring happens entirely in the browser. This is
 * deliberately not the platform's real clinical screen (see
 * lib/wellbeing/mental-wellbeing-pulse.ts's header comment) and asks nothing
 * about self-harm, so the safety note below is always visible, not gated
 * behind a "low score" result.
 */
export function MentalWellbeingCheck() {
  const [answers, setAnswers] = useState<(number | undefined)[]>(
    new Array(WELLBEING_QUESTIONS.length).fill(undefined)
  );
  const [submitted, setSubmitted] = useState(false);

  const allAnswered = answers.every((value) => value !== undefined);
  const result =
    submitted && allAnswered ? scoreWellbeingPulse(answers as number[]) : null;
  const bandCopy = result ? WELLBEING_BAND_COPY[result.band] : null;

  function reset() {
    setAnswers(new Array(WELLBEING_QUESTIONS.length).fill(undefined));
    setSubmitted(false);
  }

  if (result && bandCopy) {
    return (
      <div className="mx-auto max-w-2xl">
        <div className={cn("rounded-2xl border-2 p-6 sm:p-8", BAND_TONE[result.band])}>
          <p className="text-xs font-semibold uppercase tracking-wide text-charcoal-ink/60">
            Your result
          </p>
          <h3 className="mt-1 font-heading text-2xl font-semibold text-charcoal-ink">
            {bandCopy.label}
          </h3>
          <p className="mt-3 text-sm leading-relaxed text-charcoal-ink/75">{bandCopy.body}</p>
          <p className="mt-3 text-sm font-medium leading-relaxed text-charcoal-ink">
            {bandCopy.nextStep}
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href="/signup"
              className="inline-flex items-center justify-center rounded-full bg-brand-green px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-deep-forest focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green focus-visible:ring-offset-2"
            >
              Talk to a Tarragon doctor
            </Link>
            <button
              type="button"
              onClick={reset}
              className="inline-flex items-center justify-center rounded-full border border-charcoal-ink/15 px-5 py-2.5 text-sm font-medium text-charcoal-ink transition-colors hover:border-charcoal-ink/30"
            >
              Take it again
            </button>
          </div>
        </div>
        <p className="mt-4 text-center text-xs leading-relaxed text-charcoal-ink/65">
          This is a self-check, not a diagnosis, and nothing you answered was saved or sent
          anywhere.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl rounded-2xl border border-charcoal-ink/10 bg-white p-6 shadow-sm sm:p-8">
      <p className="text-sm leading-relaxed text-charcoal-ink/70">
        Thinking about the past two weeks, how much do you agree with each statement? There are
        no right answers.
      </p>
      <div className="mt-6 space-y-6">
        {WELLBEING_QUESTIONS.map((question, index) => (
          <fieldset key={question}>
            <legend className="text-sm font-medium text-charcoal-ink">
              {index + 1}. {question}
            </legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {SCALE_LABELS.map((label, scaleIndex) => {
                const value = scaleIndex + 1;
                const selected = answers[index] === value;
                return (
                  <button
                    key={label}
                    type="button"
                    aria-pressed={selected}
                    onClick={() =>
                      setAnswers((prev) => {
                        const next = [...prev];
                        next[index] = value;
                        return next;
                      })
                    }
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green focus-visible:ring-offset-2 sm:text-sm",
                      selected
                        ? "border-brand-green bg-brand-green/10 font-medium text-deep-forest"
                        : "border-charcoal-ink/15 text-charcoal-ink/70 hover:border-charcoal-ink/30 hover:text-charcoal-ink"
                    )}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </fieldset>
        ))}
      </div>
      <div className="mt-8 flex items-center justify-between gap-4">
        <p className="text-xs text-charcoal-ink/65">
          {answers.filter((v) => v !== undefined).length} of {WELLBEING_QUESTIONS.length} answered
        </p>
        <button
          type="button"
          disabled={!allAnswered}
          onClick={() => setSubmitted(true)}
          className={cn(
            "inline-flex items-center justify-center rounded-full px-6 py-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green focus-visible:ring-offset-2",
            allAnswered
              ? "bg-brand-green text-white hover:bg-deep-forest"
              : "cursor-not-allowed bg-charcoal-ink/10 text-charcoal-ink/40"
          )}
        >
          See my result
        </button>
      </div>
    </div>
  );
}
