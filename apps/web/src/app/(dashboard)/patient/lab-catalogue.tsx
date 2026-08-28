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
 * No price shown: since the 2026-08-03 self-arranged-fulfilment decision,
 * Tarragon does not bill for tests — `bundle.price_kobo` is a stale
 * pre-pivot figure that would read as "this is what Tarragon charges,"
 * exactly the framing the marketing site (`YOU PAY THE LAB`, see
 * `_content/pricing.ts`) deliberately never shows. What a patient actually
 * pays depends on the lab they choose.
 */
export function LabCatalogue() {
  const { data: bundles, isLoading, isError } = useLabCatalogue();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Lab tests</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
        {isError && <p className="text-sm text-red-600">Could not load the lab catalogue.</p>}
        {bundles && bundles.length === 0 && (
          <p className="text-sm text-charcoal-ink/60">No lab tests available yet.</p>
        )}
        {bundles && bundles.length > 0 && (
          <>
            <ul className="divide-y divide-charcoal-ink/10">
              {bundles.map((bundle) => {
                const preparation = testPreparationForCodes(bundle.test_codes);
                return (
                  <li key={bundle.id} className="py-3">
                    <p className="text-sm font-medium text-charcoal-ink">{bundle.name}</p>
                    {bundle.description && (
                      <p className="text-xs text-charcoal-ink/60">{bundle.description}</p>
                    )}
                    <p className="text-xs text-charcoal-ink/60">
                      Includes: {testCodeLabels(bundle.test_codes).join(", ")}
                    </p>
                    {preparation.length > 0 && (
                      <ul className="mt-1.5 space-y-0.5">
                        {preparation.map((prep) => (
                          <li key={prep.specimenType + prep.instructions} className="text-xs text-charcoal-ink/70">
                            <span className="font-medium">{prep.specimenType}.</span> {prep.instructions}
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
            <p className="text-sm text-charcoal-ink/70">
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
