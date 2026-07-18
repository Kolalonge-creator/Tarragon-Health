"use client";

import { useLabCatalogue } from "@/lib/queries/lab-orders";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { koboToNaira } from "@tarragon/shared";

/**
 * Read-only per the clinician-originated-orders guardrail (see
 * docs/FULL_SPECIFICATION_V4.md's Care Coordination guardrail section):
 * browsing the full catalogue never self-books directly any more — that
 * would let a patient order any ad hoc test without clinical judgment. The
 * only self-service lab booking path is a currently-due screening on
 * PreventiveScreeningCalendar; anything else needs a clinician to generate
 * the order.
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
              {bundles.map((bundle) => (
                <li key={bundle.id} className="flex items-start justify-between gap-2 py-3">
                  <div>
                    <p className="text-sm font-medium text-charcoal-ink">{bundle.name}</p>
                    {bundle.description && (
                      <p className="text-xs text-charcoal-ink/60">{bundle.description}</p>
                    )}
                    <p className="text-xs text-charcoal-ink/60">
                      Includes: {bundle.test_codes.join(", ")}
                    </p>
                  </div>
                  <p className="shrink-0 text-sm font-medium text-charcoal-ink">
                    ₦{koboToNaira(bundle.price_kobo).toLocaleString()}
                  </p>
                </li>
              ))}
            </ul>
            <p className="text-sm text-charcoal-ink/70">
              Due screenings can be booked directly from your screening calendar below. For
              anything else here, message your care team on WhatsApp and they&apos;ll arrange it.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
