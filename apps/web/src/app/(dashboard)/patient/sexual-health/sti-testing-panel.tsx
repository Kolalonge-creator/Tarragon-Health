"use client";

import { useActionState, useMemo } from "react";
import { koboToNaira } from "@tarragon/shared";
import { useLabCatalogue, type PanelBundle } from "@/lib/queries/lab-orders";
import { createAndPayForPartnerLabOrder } from "../lab-tests/actions";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ConfidentialResultNotice } from "@/components/confidential-result-notice";
import { SEMANTIC_ICON } from "@/lib/icons";

/** The self-bookable STI-relevant bundles (migration 20260829090000 +
 * pre-existing single_hiv/single_syphilis/single_hep_c), in the order we
 * want them to read: individual tests first, the combined panel last. */
const STI_BUNDLE_CODES = [
  "single_hiv",
  "single_syphilis",
  "single_hep_c",
  "single_chlamydia_gonorrhoea",
  "sti_panel_full",
] as const;

export function StiTestingPanel() {
  const { data: bundles, isLoading, isError } = useLabCatalogue();
  const [payState, payAction, payPending] = useActionState(createAndPayForPartnerLabOrder, undefined);

  const stiBundles = useMemo(() => {
    const byCode = new Map((bundles ?? []).map((b) => [b.code, b] as [string, PanelBundle]));
    return STI_BUNDLE_CODES.map((code) => byCode.get(code)).filter(
      (b): b is PanelBundle => !!b && b.is_active && b.self_bookable
    );
  }, [bundles]);

  return (
    <Card id="sti-testing-panel">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SEMANTIC_ICON.labs className="h-5 w-5 text-deep-forest" strokeWidth={2} />
          STI testing
        </CardTitle>
        <CardDescription>
          Test on your own schedule, whether or not you did the check-in above. Results are
          reviewed by a doctor either way.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ConfidentialResultNotice />

        {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
        {isError && <p className="text-sm text-red-600">Could not load the testing catalogue.</p>}
        {!isLoading && stiBundles.length === 0 && (
          <p className="text-sm text-charcoal-ink/60">No STI tests are available to book yet.</p>
        )}

        <ul className="divide-y divide-charcoal-ink/10">
          {stiBundles.map((bundle) => (
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

        {/* Home test kits (spec §47.4): screen_types.home_kit_available is
         * a real catalogue flag (migration 20260829120000) for a genuinely
         * separate service — a self-administered kit, no lab visit — but no
         * partner exists to fulfil it yet (the platform currently has one
         * active laboratory at all, for in-clinic/collection testing). This
         * says so plainly rather than staying silent, the same honesty this
         * codebase uses for dormant imaging screens and wearable providers
         * with no real credentials yet. */}
        <p className="border-t border-charcoal-ink/10 pt-3 text-xs text-charcoal-ink/50">
          Home test kits aren&apos;t available from a partner yet. For now, book above and
          we&apos;ll arrange the sample collection.
        </p>
      </CardContent>
    </Card>
  );
}
