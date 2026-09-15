"use client";

import { useMemo } from "react";
import { useLabCatalogue, type PanelBundle } from "@/lib/queries/lab-orders";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ConfidentialResultNotice } from "@/components/confidential-result-notice";
import { SEMANTIC_ICON } from "@/lib/icons";
import { TestGuidanceCard, TestGuidanceIntro } from "@/components/test-guidance";

/** The self-bookable STI/BBV-relevant bundles, in the order we want them to
 * read: individual tests first, the combined panel last.
 *
 * `single_chlamydia_gonorrhoea` and `sti_panel_full` were withdrawn in the
 * 2026-09-03 catalogue rebuild (Synlab's real combined NAAT/PCR price is
 * ₦200,000 — no viable product at the price these were sold at) and
 * `sti_panel_full` was replaced by `blood_borne_virus_screen` (HIV + HepB +
 * HepC only, no chlamydia/gonorrhoea component). Both withdrawn codes would
 * disappear from this list on their own via the `is_active && self_bookable`
 * filter below even if left in, but they're removed here rather than kept as
 * dead entries. */
const STI_BUNDLE_CODES = [
  "single_hiv",
  "single_syphilis",
  "single_hep_b",
  "single_hep_c",
  "blood_borne_virus_screen",
] as const;

/**
 * Rewritten 2026-09-10 from a checkout to guidance. Tarragon no longer sells
 * tests -- its recorded cost was the laboratory's own retail price -- so this
 * lists what is worth testing for, what to expect it to cost, and where to go.
 *
 * The confidentiality notice stays exactly where it was and matters more here
 * than anywhere else on the platform: someone reading this page needs to know
 * who can see the result before they decide to test, and that is unaffected by
 * who bills for it.
 */
export function StiTestingPanel() {
  const { data: bundles, isLoading, isError } = useLabCatalogue();

  const stiBundles = useMemo(() => {
    const byCode = new Map((bundles ?? []).map((b) => [b.code, b] as [string, PanelBundle]));
    return STI_BUNDLE_CODES.map((code) => byCode.get(code)).filter(
      (b): b is PanelBundle => !!b && b.is_active
    );
  }, [bundles]);

  return (
    <Card id="sti-testing-panel">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SEMANTIC_ICON.labs className="h-5 w-5 text-deep-forest dark:text-brand-green-bright" strokeWidth={2} aria-hidden />
          STI testing
        </CardTitle>
        <CardDescription>
          Test on your own schedule, whether or not you did the check-in above. Take the request
          to any laboratory, then upload the result and a doctor will read it with you.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ConfidentialResultNotice />

        <TestGuidanceIntro />

        {isLoading && <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">Loading…</p>}
        {isError && <p className="text-sm text-red-600 dark:text-red-400">Could not load the testing catalogue.</p>}
        {!isLoading && !isError && stiBundles.length === 0 && (
          <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">
            Nothing is listed here yet.
          </p>
        )}

        <ul className="divide-y divide-charcoal-ink/10 dark:divide-night-ink/15">
          {stiBundles.map((bundle) => (
            <TestGuidanceCard
              key={bundle.id}
              name={bundle.name}
              description={bundle.description}
              bundle={bundle}
            />
          ))}
        </ul>


        {/* Home test kits (spec §47.4): screen_types.home_kit_available is
         * a real catalogue flag (migration 20260829120000) for a genuinely
         * separate service — a self-administered kit, no lab visit — but no
         * partner exists to fulfil it yet (the platform currently has one
         * active laboratory at all, for in-clinic/collection testing). This
         * says so plainly rather than staying silent, the same honesty this
         * codebase uses for dormant imaging screens and wearable providers
         * with no real credentials yet. */}
        <p className="border-t border-charcoal-ink/10 dark:border-night-ink/15 pt-3 text-xs text-charcoal-ink/50 dark:text-night-ink/55">
          Home test kits aren&apos;t available from a partner yet. For now, take the request to a
          laboratory of your choice.
        </p>
      </CardContent>
    </Card>
  );
}
