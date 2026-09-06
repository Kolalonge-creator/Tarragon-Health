"use client";

import { useActionState, useMemo } from "react";
import { koboToNaira, type Enums } from "@tarragon/shared";
import { useLabCatalogue, type PanelBundle } from "@/lib/queries/lab-orders";
import { createAndPayForPartnerLabOrder } from "./lab-tests/actions";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SEMANTIC_ICON } from "@/lib/icons";

/** Sex-specific tracks — never offer the wrong one. Sex unknown (not yet
 * recorded) hides all four rather than guessing, same posture as
 * PreventiveProgrammes' Men's/Women's Health gating. */
const CANCER_SCREENING_CODES = [
  "cancer_screen_cervical_under30",
  "cancer_screen_cervical_30plus",
  "cancer_screen_women_45plus",
  "cancer_screen_men_45plus",
] as const;

function isOfferedFor(code: string, sex: Enums<"sex"> | null): boolean {
  if (sex === null) return false;
  if (code === "cancer_screen_men_45plus") return sex === "male";
  return sex === "female"; // the other three are all cervical/women's-track
}

/**
 * One-off cancer screening bundles (2026-09-03 catalogue rebuild, reworked
 * 2026-09-06): real panel_bundles billed through the same partner-billed
 * lab-order checkout every other bundle on this platform uses
 * (createAndPayForPartnerLabOrder) — not a standalone credit that only marks
 * a calendar date. A prior version of this card sold these on the
 * service_products credit primitive, which never created a lab_orders row,
 * so nothing was ever actually sent to a lab; see the fix-up migration.
 */
export function CancerScreeningCard({ sex }: { sex: Enums<"sex"> | null }) {
  const { data: bundles, isLoading, isError } = useLabCatalogue();
  const [payState, payAction, payPending] = useActionState(createAndPayForPartnerLabOrder, undefined);

  const cancerBundles = useMemo(() => {
    const byCode = new Map((bundles ?? []).map((b) => [b.code, b] as [string, PanelBundle]));
    return CANCER_SCREENING_CODES.filter((code) => isOfferedFor(code, sex))
      .map((code) => byCode.get(code))
      .filter((b): b is PanelBundle => !!b && b.is_active && b.self_bookable);
  }, [bundles, sex]);

  if (sex === null) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SEMANTIC_ICON.preventive className="h-5 w-5 text-deep-forest" strokeWidth={2} />
          Cancer screening
        </CardTitle>
        <CardDescription>
          A guideline-backed step up from the Annual Health Check, with a doctor consult built in
          to walk through the result either way.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
        {isError && <p className="text-sm text-red-600">Could not load these screenings.</p>}
        {!isLoading && cancerBundles.length === 0 && (
          <p className="text-sm text-charcoal-ink/60">No cancer screening bundles are available yet.</p>
        )}

        <ul className="divide-y divide-charcoal-ink/10">
          {cancerBundles.map((bundle) => (
            <li key={bundle.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-charcoal-ink">{bundle.name}</p>
                {bundle.description && (
                  <p className="text-xs text-charcoal-ink/60">{bundle.description}</p>
                )}
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium text-charcoal-ink">
                  ₦{koboToNaira(bundle.price_kobo).toLocaleString("en-NG")}
                </span>
                <form action={payAction}>
                  <input type="hidden" name="panelBundleId" value={bundle.id} />
                  <Button type="submit" size="sm" disabled={payPending}>
                    {payPending ? "Taking you to payment…" : "Book & pay"}
                  </Button>
                </form>
              </div>
            </li>
          ))}
        </ul>

        {payState?.error && <p className="text-sm text-red-600">{payState.error}</p>}
      </CardContent>
    </Card>
  );
}
