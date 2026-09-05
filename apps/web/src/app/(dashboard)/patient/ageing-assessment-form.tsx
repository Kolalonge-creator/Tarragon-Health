"use client";

import { useActionState, useState } from "react";
import { submitAgeingAssessmentDomains } from "./healthy-ageing-actions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { FormError, FormSuccess, fieldErrorId } from "@/components/ui/form-error";
import { DOMAIN_LABEL, type AgeingAssessmentDomain, type AgeingAssessmentOutcome } from "@/lib/healthy-ageing/types";

const OUTCOME_OPTIONS: { value: AgeingAssessmentOutcome; label: string }[] = [
  { value: "no_concern", label: "No concerns" },
  { value: "monitor", label: "Something to keep an eye on" },
  { value: "further_assessment_suggested", label: "I'd like this looked at more closely" },
];

type Answers = Record<AgeingAssessmentDomain, { outcome: AgeingAssessmentOutcome | null; note: string }>;

export function AgeingAssessmentForm({ domains }: { domains: AgeingAssessmentDomain[] }) {
  const [state, formAction, pending] = useActionState(submitAgeingAssessmentDomains, undefined);
  const errorId = fieldErrorId("ageing-assessment");
  const [answers, setAnswers] = useState<Answers>(
    () =>
      Object.fromEntries(domains.map((d) => [d, { outcome: null, note: "" }])) as Answers,
  );

  const answeredCount = domains.filter((d) => answers[d]?.outcome).length;

  function submit(formData: FormData) {
    const payload = domains
      .filter((d) => answers[d]?.outcome)
      .map((d) => ({ domain: d, outcome: answers[d]!.outcome!, note: answers[d]!.note || undefined }));
    formData.set("answers_json", JSON.stringify(payload));
    formAction(formData);
  }

  return (
    <form action={submit} className="space-y-5">
      {domains.map((domain) => (
        <fieldset key={domain} className="space-y-2 border-t border-charcoal-ink/10 dark:border-night-ink/15 pt-3 first:border-t-0 first:pt-0">
          <legend className="text-sm font-medium text-charcoal-ink dark:text-night-ink">{DOMAIN_LABEL[domain]}</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {OUTCOME_OPTIONS.map((opt) => (
              <label key={opt.value} className="flex items-center gap-1.5 text-sm text-charcoal-ink/80 dark:text-night-ink/80">
                <input
                  type="radio"
                  name={`domain-${domain}`}
                  checked={answers[domain]?.outcome === opt.value}
                  onChange={() =>
                    setAnswers((prev) => ({ ...prev, [domain]: { ...prev[domain], outcome: opt.value } }))
                  }
                  className="h-4 w-4"
                />
                {opt.label}
              </label>
            ))}
          </div>
          {answers[domain]?.outcome && answers[domain]?.outcome !== "no_concern" && (
            <Textarea
              aria-label={`Anything you'd like your care team to know about ${DOMAIN_LABEL[domain]} (optional)`}
              placeholder="Anything you'd like your care team to know (optional)"
              maxLength={500}
              value={answers[domain]?.note ?? ""}
              onChange={(e) =>
                setAnswers((prev) => ({ ...prev, [domain]: { ...prev[domain], note: e.target.value } }))
              }
            />
          )}
        </fieldset>
      ))}

      <FormError id={errorId} message={state?.error} />
      <FormSuccess message={state?.success && "Saved. Thank you."} />

      <Button type="submit" disabled={pending || answeredCount === 0}>
        {pending ? "Saving…" : `Save ${answeredCount || ""} answer${answeredCount === 1 ? "" : "s"}`}
      </Button>
    </form>
  );
}
