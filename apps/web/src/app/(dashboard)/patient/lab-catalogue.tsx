"use client";

import { useLabCatalogue } from "@/lib/queries/lab-orders";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { testCodeLabels } from "@/lib/labs/test-code-labels";
import { SEMANTIC_ICON } from "@/lib/icons";

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
        {isLoading && (
          <div className="space-y-4">
            {[0, 1, 2].map((i) => (
              <div key={i} className="space-y-2 py-1">
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-3 w-2/3" />
              </div>
            ))}
          </div>
        )}
        {isError && <p className="text-sm text-red-600">Could not load the lab catalogue.</p>}
        {bundles && bundles.length === 0 && (
          <EmptyState
            icon={SEMANTIC_ICON.labs}
            title="No lab tests available yet"
            description="Check back soon, we're adding to the catalogue."
          />
        )}
        {bundles && bundles.length > 0 && (
          <>
            <ul className="divide-y divide-charcoal-ink/10">
              {bundles.map((bundle) => (
                <li key={bundle.id} className="py-3">
                  <p className="text-sm font-medium text-charcoal-ink">{bundle.name}</p>
                  {bundle.description && (
                    <p className="text-xs text-charcoal-ink/60">{bundle.description}</p>
                  )}
                  <p className="text-xs text-charcoal-ink/60">
                    Includes: {testCodeLabels(bundle.test_codes).join(", ")}
                  </p>
                </li>
              ))}
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
