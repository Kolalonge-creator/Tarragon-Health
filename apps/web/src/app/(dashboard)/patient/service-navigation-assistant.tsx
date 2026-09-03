"use client";

import { useState, type FormEvent } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SEMANTIC_ICON } from "@/lib/icons";
import { askServiceNavigationAction, type AskServiceNavigationResult } from "@/lib/service-navigation/actions";

/**
 * "Where can I do my blood test?" -- a friendlier front end on the same
 * public facility directory FacilitySelector reads from, phrased by AI but
 * grounded strictly in the real facilities returned (never invented). See
 * lib/service-navigation/generate.ts's system prompt for the anti-
 * fabrication rule.
 */
export function ServiceNavigationAssistant() {
  const [question, setQuestion] = useState("");
  const [isPending, setIsPending] = useState(false);
  const [result, setResult] = useState<AskServiceNavigationResult | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (question.trim().length === 0 || isPending) return;
    setIsPending(true);
    try {
      setResult(await askServiceNavigationAction(question.trim()));
    } finally {
      setIsPending(false);
    }
  }

  return (
    <Card id="find-a-service">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SEMANTIC_ICON.booking className="h-5 w-5 text-deep-forest dark:text-brand-green-bright" strokeWidth={2} />
          Find a service
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <form onSubmit={handleSubmit} className="flex flex-wrap gap-2">
          <Input
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="e.g. Where can I do a blood test in Lekki?"
            className="min-w-48 flex-1"
          />
          <Button type="submit" size="sm" disabled={isPending || question.trim().length === 0}>
            {isPending ? "Looking…" : "Ask"}
          </Button>
        </form>

        {result && (
          <div className="space-y-2 rounded-md border border-mist-grey/60 dark:border-night-ink/15 bg-mist-grey/20 dark:bg-night-ink/10 p-3">
            <p className="flex items-start gap-1.5 text-xs text-charcoal-ink/60 dark:text-night-ink/60">
              <SEMANTIC_ICON.aiCoach className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden />
              AI-drafted: from our facility directory, not a recommendation
            </p>

            {result.status === "failed" && (
              <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">{result.error}</p>
            )}

            {result.status === "answered" && (
              <>
                <p className="text-sm text-charcoal-ink dark:text-night-ink">{result.answer}</p>
                {result.facilities.length > 0 && (
                  <ul className="space-y-1.5 border-t border-charcoal-ink/10 dark:border-night-ink/15 pt-2">
                    {result.facilities.map((facility) => (
                      <li key={facility.id} className="text-xs text-charcoal-ink/70 dark:text-night-ink/70">
                        <span className="font-medium text-charcoal-ink dark:text-night-ink">{facility.name}</span>
                        {", "}
                        {[facility.address, facility.area, facility.city, facility.state]
                          .filter(Boolean)
                          .join(", ")}
                        {facility.contact_phone && ` · ${facility.contact_phone}`}
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
