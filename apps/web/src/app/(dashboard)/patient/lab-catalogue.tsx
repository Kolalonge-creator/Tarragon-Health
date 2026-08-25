"use client";

import { useLabCatalogue } from "@/lib/queries/lab-orders";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { testCodeLabels } from "@/lib/labs/test-code-labels";
import { koboToNaira } from "@tarragon/shared";

/**
 * Read-only per the clinician-originated-orders guardrail (see
 * docs/FULL_SPECIFICATION_V4.md's Care Coordination guardrail section):
 * browsing the full catalogue never self-books directly any more — that
 * would let a patient order any ad hoc test without clinical judgment. The
 * only self-service lab booking path is a currently-due screening on
 * PreventiveScreeningCalendar; anything else needs a clinician to generate
 * the order.
 *
 * Price shown (restored 2026-08-25): with Synlab Nigeria back as a real,
 * signed, nationwide partner, `bundle.price_kobo` is what Tarragon actually
 * bills to book the test — see `_content/pricing.ts`'s "BOOK & PAY" label.
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
                <li key={bundle.id} className="py-3">
                  <p className="text-sm font-medium text-charcoal-ink">{bundle.name}</p>
                  {bundle.description && (
                    <p className="text-xs text-charcoal-ink/60">{bundle.description}</p>
                  )}
                  <p className="text-xs text-charcoal-ink/60">
                    Includes: {testCodeLabels(bundle.test_codes).join(", ")}
                  </p>
                  <p className="text-xs text-charcoal-ink/60">
                    ₦{koboToNaira(bundle.price_kobo).toLocaleString()} at Synlab Nigeria
                  </p>
                </li>
              ))}
            </ul>
            <p className="text-sm text-charcoal-ink/70">
              Due screenings can be booked directly from your screening calendar below. For
              anything else here, message your care team in the app and they&apos;ll book it with
              Synlab Nigeria on your behalf.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
