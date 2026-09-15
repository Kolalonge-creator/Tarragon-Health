"use client";

import { useMemo } from "react";
import { type Enums } from "@tarragon/shared";
import { useLabCatalogue, type PanelBundle } from "@/lib/queries/lab-orders";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { SEMANTIC_ICON } from "@/lib/icons";
import { TestGuidanceCard, TestGuidanceIntro } from "@/components/test-guidance";

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
 * Cancer screening, as guidance rather than a checkout.
 *
 * Rewritten 2026-09-10, and the reason matters more than the layout. These four
 * bundles were sold, and three of them billed for tests the platform could not
 * order: Cervical Cancer Screening (30 and over) charged 222,500 naira for
 * "liquid-based cytology plus HPV DNA co-test" while its test_codes contained
 * only the smear, because HPV DNA has no row in lab_tests at all. A woman
 * paying that would reasonably have believed she had been co-tested.
 *
 * The fix is not a better checkout. Tarragon's recorded cost for a test was the
 * laboratory's own retail price, so it was never able to beat the laboratory on
 * price anyway. What it can do — and what a laboratory will not — is tell you
 * exactly what to ask for, what it should cost, and read the result when it
 * comes back. So this card now says precisely that, and the descriptions it
 * renders were rewritten in the same migration to name the test a patient
 * should request ("ask for LBC and HPV as a single request") rather than
 * describe something Tarragon would do.
 */
export function CancerScreeningCard({ sex }: { sex: Enums<"sex"> | null }) {
  const { data: bundles, isLoading, isError } = useLabCatalogue();

  const cancerBundles = useMemo(() => {
    const byCode = new Map((bundles ?? []).map((b) => [b.code, b] as [string, PanelBundle]));
    return CANCER_SCREENING_CODES.filter((code) => isOfferedFor(code, sex))
      .map((code) => byCode.get(code))
      .filter((b): b is PanelBundle => !!b && b.is_active);
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
          The screening worth doing at your age, what to ask a laboratory for, and roughly what it
          costs.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <TestGuidanceIntro />

        {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
        {isError && <p className="text-sm text-red-600">Could not load these screenings.</p>}
        {!isLoading && !isError && cancerBundles.length === 0 && (
          <p className="text-sm text-charcoal-ink/60">
            Nothing is recommended for you here yet. Your screening calendar will tell you when
            something falls due.
          </p>
        )}

        <ul className="divide-y divide-charcoal-ink/10">
          {cancerBundles.map((bundle) => (
            <TestGuidanceCard
              key={bundle.id}
              name={bundle.name}
              description={bundle.description}
              bundle={bundle}
            />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
