"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { submitSexualHealthScreen } from "./sexual-wellness-actions";
import {
  SEXUAL_HEALTH_INSTRUMENTS,
  SEXUAL_HEALTH_INSTRUMENT_LABEL,
  BETTER_DIRECTION_OPTIONS,
  WORSE_DIRECTION_OPTIONS,
  IIEF5_QUESTIONS,
  FSFI_PAIN_QUESTIONS,
  LIBIDO_BRIEF_QUESTIONS,
  PE_DIAGNOSTIC_TOOL_QUESTIONS,
  type SexualHealthInstrument,
} from "@/lib/validation/sexual-health-screen";
import { SEXUAL_HEALTH_SEVERITY_BAND_LABEL, type SexualHealthSeverityBand } from "@/lib/rules/sexual-health-scoring";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { SEMANTIC_ICON } from "@/lib/icons";

type LikertOption = { value: number; label: string };

const INSTRUMENT_CONFIG: Record<
  SexualHealthInstrument,
  { questions: readonly string[]; options: readonly LikertOption[] }
> = {
  iief5: { questions: IIEF5_QUESTIONS, options: BETTER_DIRECTION_OPTIONS },
  libido_brief: { questions: LIBIDO_BRIEF_QUESTIONS, options: BETTER_DIRECTION_OPTIONS },
  fsfi_pain: { questions: FSFI_PAIN_QUESTIONS, options: WORSE_DIRECTION_OPTIONS },
  pe_diagnostic_tool: { questions: PE_DIAGNOSTIC_TOOL_QUESTIONS, options: WORSE_DIRECTION_OPTIONS },
};

/** Warm, never clinical-sounding framing for a result — the same four
 * phrases regardless of which of the four instruments produced them, since
 * the point is reassurance and a next step, not a label. */
const SEVERITY_COPY: Record<SexualHealthSeverityBand, string> = {
  none_minimal: "This doesn't seem to be much of a concern right now.",
  mild: "This seems like a mild concern — common, and it often eases with small changes.",
  moderate: "This seems like a moderate concern — worth talking to your care team about.",
  severe: "This seems like a significant concern, and your care team can help — worth reaching out soon.",
};

function LikertQuestion({
  name,
  prompt,
  options,
}: {
  name: string;
  prompt: string;
  options: readonly LikertOption[];
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm text-charcoal-ink">{prompt}</legend>
      <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
        {options.map((opt) => (
          <label
            key={opt.value}
            className="flex cursor-pointer flex-col items-center gap-1 rounded-md border border-charcoal-ink/15 px-1.5 py-1.5 text-center text-[11px] text-charcoal-ink/80 has-[:checked]:border-brand-green has-[:checked]:bg-brand-green/5"
          >
            <input type="radio" name={name} value={opt.value} required className="accent-[color:var(--brand-green,#0E7C52)]" />
            {opt.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/**
 * Sexual dysfunction ("Sexual Wellness") screening flow (spec §47.10). A
 * concern picker opens one of four short instruments; the result is always
 * framed warmly, never as an alarm, and a moderate/severe erectile-function
 * result nudges toward the existing CV-risk questionnaire rather than
 * inventing a second risk engine.
 */
export function SexualWellnessPanel() {
  const [view, setView] = useState<"picker" | "form" | "result">("picker");
  const [instrument, setInstrument] = useState<SexualHealthInstrument | null>(null);
  const [state, formAction, pending] = useActionState(submitSexualHealthScreen, undefined);

  // Adjust state during render (React's endorsed pattern for "react once a
  // new value arrives") rather than in an effect, so a fresh successful
  // submission can't cascade an extra render — see risk-assessment-form.tsx's
  // identical prefill pattern and https://react.dev/learn/you-might-not-need-an-effect.
  const [lastHandledState, setLastHandledState] = useState(state);
  if (state !== lastHandledState) {
    setLastHandledState(state);
    if (state?.success) setView("result");
  }

  function pickConcern(next: SexualHealthInstrument) {
    setInstrument(next);
    setView("form");
  }

  function checkAnotherConcern() {
    setInstrument(null);
    setView("picker");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SEMANTIC_ICON.mood className="h-5 w-5 text-deep-forest" strokeWidth={2} />
          Sexual wellness
        </CardTitle>
        <CardDescription>
          A short, private check-in — never a diagnosis, and only your care team can see it.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {view === "picker" && (
          <div className="grid gap-2 sm:grid-cols-2">
            {SEXUAL_HEALTH_INSTRUMENTS.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => pickConcern(option)}
                className="rounded-lg border border-brand-green/30 bg-brand-green/5 px-4 py-3 text-left text-sm font-medium text-charcoal-ink transition hover:border-brand-green"
              >
                {SEXUAL_HEALTH_INSTRUMENT_LABEL[option]}
              </button>
            ))}
          </div>
        )}

        {view === "form" && instrument && (
          <form action={formAction} className="space-y-5">
            <input type="hidden" name="instrument" value={instrument} />
            <p className="text-sm text-charcoal-ink/70">
              {SEXUAL_HEALTH_INSTRUMENT_LABEL[instrument]} — over the last few weeks:
            </p>
            {INSTRUMENT_CONFIG[instrument].questions.map((prompt, i) => (
              <LikertQuestion
                key={`${instrument}_${i + 1}`}
                name={`${instrument}_${i + 1}`}
                prompt={prompt}
                options={INSTRUMENT_CONFIG[instrument].options}
              />
            ))}

            {state?.error && <p className="text-sm text-red-600">{state.error}</p>}

            <div className="flex gap-2">
              <Button type="submit" disabled={pending}>
                {pending ? "Checking…" : "Get my result"}
              </Button>
              <Button type="button" variant="outline" onClick={checkAnotherConcern} disabled={pending}>
                Back
              </Button>
            </div>
          </form>
        )}

        {view === "result" && state?.success && state.severityBand && state.instrument && (
          <div className="space-y-4">
            <div className="rounded-lg bg-brand-green/5 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-deep-forest">
                {SEXUAL_HEALTH_INSTRUMENT_LABEL[state.instrument]} —{" "}
                {SEXUAL_HEALTH_SEVERITY_BAND_LABEL[state.severityBand]}
              </p>
              <p className="mt-1 text-sm text-charcoal-ink/80">
                {SEVERITY_COPY[state.severityBand]}
              </p>
            </div>

            {state.cardiometabolicFlag && (
              <div className="rounded-lg border border-sprout-gold/40 bg-sprout-gold/5 p-4">
                <p className="text-sm text-charcoal-ink/80">
                  Sexual health is often connected to heart and metabolic health — it&apos;s worth
                  checking your cardiovascular risk too.
                </p>
                <Link
                  href="/patient/prevention#risk-assessment"
                  className="mt-2 inline-block text-sm font-medium text-brand-green underline underline-offset-4"
                >
                  Check your cardiovascular risk
                </Link>
              </div>
            )}

            <Button type="button" variant="outline" size="sm" onClick={checkAnotherConcern}>
              Check a different concern
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
