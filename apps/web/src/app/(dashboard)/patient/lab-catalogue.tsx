"use client";

import { useLabCatalogue } from "@/lib/queries/lab-orders";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { testCodeLabels } from "@/lib/labs/test-code-labels";
import { testPreparationForCodes } from "@/lib/labs/test-preparation";

/**
 * Read-only per the clinician-originated-orders guardrail (see
 * docs/FULL_SPECIFICATION_V4.md's Care Coordination guardrail section):
 * browsing the full catalogue never self-books directly any more — that
 * would let a patient order any ad hoc test without clinical judgment. The
 * only self-service lab booking path is a currently-due screening on
 * PreventiveScreeningCalendar; anything else needs a clinician to generate
 * the order.
 *
 * No price shown here on purpose, even though some bundles now carry a real
 * contracted price (2026-08-21, Synlab): this catalogue is self-arranged
 * browsing only, and showing a price next to a bundle a patient cannot act
 * on from here would misleadingly imply this view can charge them. Where a
 * bundle genuinely can be billed by Tarragon, that option lives on the
 * booking action itself (PreventiveScreeningCalendar / AnnualHealthCheckBooking),
 * right next to the bundle it applies to — not here.
 */
export function LabCatalogue() {
  const { data: bundles, isLoading, isError } = useLabCatalogue();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Lab tests</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading && <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">Loading…</p>}
        {isError && <p className="text-sm text-red-600 dark:text-red-300">Could not load the lab catalogue.</p>}
        {bundles && bundles.length === 0 && (
          <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">No lab tests available yet.</p>
        )}
        {bundles && bundles.length > 0 && (
          <>
            <ul className="divide-y divide-charcoal-ink/10 dark:divide-night-ink/15">
              {bundles.map((bundle) => {
                const preparation = testPreparationForCodes(bundle.test_codes);
                return (
                  <li key={bundle.id} className="py-3">
                    <p className="text-sm font-medium text-charcoal-ink dark:text-night-ink">{bundle.name}</p>
                    {bundle.description && (
                      <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">{bundle.description}</p>
                    )}
                    <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
                      Includes: {testCodeLabels(bundle.test_codes).join(", ")}
                    </p>
                    {preparation.length > 0 && (
                      <ul className="mt-1.5 space-y-0.5">
                        {preparation.map((prep) => (
                          <li key={prep.specimenType + prep.instructions} className="text-xs text-charcoal-ink/70 dark:text-night-ink/70">
                            <span className="font-medium">{prep.specimenType}.</span> {prep.instructions}
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
            <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">
              Due screenings can be booked directly from your screening calendar below. For
              anything else here, message your care team in the app and they&apos;ll write you a
              request to take to a laboratory of your choice. You pay the lab directly, at
              whatever they charge, and we take nothing on top.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
