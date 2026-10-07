"use client";

import { useState } from "react";
import { t, type MessageKey } from "@tarragon/i18n";
import {
  CONDITION_CODES,
  GOAL_CODES,
  hasCondition,
  validateOnboardingAnswers,
  type OnboardingAnswers,
} from "@tarragon/shared";
import { Button } from "@/components/ui/button";
import { OnboardingNarration } from "./onboarding-narration";

/** What the intake questionnaire's intro line is keyed on (see intake-step.tsx). Derived from the answers, never asked twice. */
export type OnboardingIntent = "manage" | "prevent" | "unsure";

export function intentFromAnswers(a: OnboardingAnswers): OnboardingIntent {
  if (a.goals.includes("manage_condition") || hasCondition(a)) return "manage";
  if (a.goals.includes("stay_ahead") || a.goals.includes("screening_check")) return "prevent";
  return "unsure";
}

function toggle<T extends string>(list: readonly T[], code: T, exclusive: T): T[] {
  if (list.includes(code)) return list.filter((x) => x !== code);
  // "None of these" and "I am not sure yet" stand alone: choosing one clears the others, choosing another clears it.
  if (code === exclusive) return [code];
  return [...list.filter((x) => x !== exclusive), code];
}

/**
 * Step 1 of onboarding (spec 1.10): what the person wants help with and any condition that applies. Saved against the account
 * once they have agreed to the terms (see onboarding-flow.tsx), then used by Home and the plan preview. It gates nothing, and
 * it never changes a threshold or a rule: it only decides what is shown first.
 */
export function AnswersStep({
  initial,
  onComplete,
}: {
  initial?: OnboardingAnswers | null;
  onComplete: (answers: OnboardingAnswers) => void;
}) {
  const [goals, setGoals] = useState<string[]>([...(initial?.goals ?? [])]);
  const [conditions, setConditions] = useState<string[]>([...(initial?.conditions ?? [])]);
  const [error, setError] = useState<MessageKey | null>(null);

  function submit() {
    const v = validateOnboardingAnswers(goals, conditions);
    if (!v.ok) {
      setError(v.reason === "mixed" ? "onb.answers.error_mixed" : "onb.answers.error_choose");
      return;
    }
    setError(null);
    onComplete(v.value);
  }

  return (
    <div className="space-y-5 rounded-xl border border-charcoal-ink/10 bg-white p-6 shadow-sm">
      <div>
        <h2 className="font-heading text-lg font-semibold text-charcoal-ink">{t("onb.answers.title")}</h2>
        <p className="mt-1 text-sm text-charcoal-ink/60">{t("onb.answers.subtitle")}</p>
      </div>
      <OnboardingNarration clipId="ONB-011" />

      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-medium text-charcoal-ink">{t("onb.answers.goals_legend")}</legend>
        {GOAL_CODES.map((code) => (
          <label key={code} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-charcoal-ink/10 px-4 py-2 text-sm text-charcoal-ink has-[:checked]:border-brand-green/50 has-[:checked]:bg-brand-green/[0.04]">
            <input
              type="checkbox"
              className="h-4 w-4 accent-brand-green"
              checked={goals.includes(code)}
              onChange={() => setGoals((g) => toggle(g, code, "not_sure"))}
            />
            {t(`onb.goal.${code}` as MessageKey)}
          </label>
        ))}
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-medium text-charcoal-ink">{t("onb.answers.conditions_legend")}</legend>
        {CONDITION_CODES.map((code) => (
          <label key={code} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-charcoal-ink/10 px-4 py-2 text-sm text-charcoal-ink has-[:checked]:border-brand-green/50 has-[:checked]:bg-brand-green/[0.04]">
            <input
              type="checkbox"
              className="h-4 w-4 accent-brand-green"
              checked={conditions.includes(code)}
              onChange={() => setConditions((c) => toggle(c, code, "none"))}
            />
            {t(`onb.condition.${code}` as MessageKey)}
          </label>
        ))}
        <p className="text-xs text-charcoal-ink/50">{t("onb.answers.note")}</p>
      </fieldset>

      {error ? (
        <p role="alert" className="text-sm text-red-600">
          {t(error)}
        </p>
      ) : null}
      <Button type="button" onClick={submit}>
        {t("onb.answers.continue")}
      </Button>
    </div>
  );
}
