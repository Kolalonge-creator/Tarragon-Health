"use client";

import { useState } from "react";
import {
  useDevelopmentalItems,
  useDevelopmentalScreenings,
  useSubmitDevelopmentalScreening,
} from "@/lib/queries/development";
import { ageMonthsFromDateOfBirth, developmentalAgeBandFor, DEVELOPMENTAL_DOMAIN_LABEL } from "@/lib/development/age-band";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

import { formatPatientDate } from "@/lib/format-date";
type Answer = "yes" | "sometimes" | "not_yet";

const ANSWER_LABEL: Record<Answer, string> = {
  yes: "Yes",
  sometimes: "Sometimes",
  not_yet: "Not yet",
};

/**
 * Developmental monitoring (§48.5). An original, unlicensed starter
 * questionnaire — NOT ASQ-3 or any other validated instrument, see
 * 20260829122052_pediatric_developmental_screening.sql's header — that
 * routes a below-threshold domain to clinical review, never a diagnosis.
 * Renders nothing once the subject is outside this starter item bank's
 * 4-60 month coverage.
 */
export function DevelopmentalScreeningCard({
  patientId,
  organisationId,
  dateOfBirth,
}: {
  patientId: string;
  organisationId: string | null;
  dateOfBirth: string | null;
}) {
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const ageMonths = dateOfBirth ? ageMonthsFromDateOfBirth(dateOfBirth) : null;
  const ageBand = ageMonths !== null ? developmentalAgeBandFor(ageMonths) : null;
  const { data: items, isLoading: itemsLoading } = useDevelopmentalItems(ageBand);
  const { data: screenings } = useDevelopmentalScreenings(patientId);
  const submit = useSubmitDevelopmentalScreening();

  if (!ageBand) return null;

  const latest = screenings && screenings.length > 0 ? screenings[0] : null;
  const answeredCount = Object.keys(answers).length;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!organisationId || !items || answeredCount < items.length) return;
    await submit.mutateAsync({ patientId, organisationId, responses: answers });
    setAnswers({});
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Development</CardTitle>
        <CardDescription>
          A short, informal check across motor, language, social, cognitive and behavioural
          milestones for this age, a screening aid that routes concern to a doctor, not a
          diagnosis.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {latest && (
          <div className="rounded-lg border border-charcoal-ink/10 bg-off-white p-3 text-sm">
            <p className="font-medium text-charcoal-ink">
              Last screening: {formatPatientDate(latest.screening_date)}
            </p>
            {latest.overall_flag ? (
              <p className="mt-1 text-amber-700">
                Flagged for clinical review: {latest.flagged_domains.map((d) => DEVELOPMENTAL_DOMAIN_LABEL[d]).join(", ")}
              </p>
            ) : (
              <p className="mt-1 text-charcoal-ink/60">No domains flagged.</p>
            )}
          </div>
        )}

        {itemsLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}

        {items && items.length > 0 && (
          <form onSubmit={handleSubmit} className="space-y-5">
            {items.map((item) => (
              <div key={item.id} className="space-y-1.5">
                <p className="text-sm font-medium text-charcoal-ink">
                  {DEVELOPMENTAL_DOMAIN_LABEL[item.domain]}: {item.prompt}
                </p>
                <div className="flex gap-2">
                  {(["yes", "sometimes", "not_yet"] as Answer[]).map((answer) => (
                    <button
                      key={answer}
                      type="button"
                      onClick={() => setAnswers((prev) => ({ ...prev, [item.id]: answer }))}
                      aria-pressed={answers[item.id] === answer}
                      className={`min-h-9 rounded-full border px-3 py-1.5 text-xs transition ${
                        answers[item.id] === answer
                          ? "border-brand-green bg-brand-green text-white"
                          : "border-charcoal-ink/20 bg-white text-charcoal-ink hover:border-brand-green/50"
                      }`}
                    >
                      {ANSWER_LABEL[answer]}
                    </button>
                  ))}
                </div>
              </div>
            ))}

            {submit.isError && <p className="text-sm text-red-600">Could not save this screening.</p>}

            <Button type="submit" disabled={submit.isPending || answeredCount < items.length || !organisationId}>
              {submit.isPending
                ? "Saving…"
                : answeredCount < items.length
                  ? `Answer all ${items.length} questions to save`
                  : "Save screening"}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
