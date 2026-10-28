"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { REASON_KIND_LABEL, type FoodSwap, type SwapReasonKind } from "@tarragon/shared";
import type { FoodCatalogueItem } from "@/lib/nutrition/food-catalogue";
import { useFoodCatalogue } from "@/lib/queries/food-catalogue";
import { useMyBookingTerms } from "@/lib/queries/appointments";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { loadEatingGuidanceAction } from "./nutrition-actions";

/**
 * Condition eating plans and healthier swaps (S50a, v5 6.8 and 6.9). Everything shown comes from the CMO-signed `nutrition_guidance_config`
 * through `my_nutrition_guidance()`. When the database says "unavailable" (not signed yet, or not for this person: it never says which)
 * this renders NOTHING: no empty card, no hint, so the absence tells nobody anything. A swap is an idea, never a verdict on a food.
 */
const KEY = "eating-guidance";

export function useEatingGuidance() {
  return useQuery({
    queryKey: [KEY],
    queryFn: () => loadEatingGuidanceAction(),
    staleTime: 60 * 1000,
  });
}

function foodName(code: string, catalogue: readonly FoodCatalogueItem[]): string {
  return (catalogue.find((f) => f.code === code)?.name ?? code.replace(/_/g, " ")).toLowerCase();
}

/** "You could try X instead of Y. Reason." */
export function signedSwapMessage(swap: FoodSwap, catalogue: readonly FoodCatalogueItem[]): string {
  const to = swap.toFoodCodes.map((c) => foodName(c, catalogue)).join(" or ");
  return `You could try ${to} instead of ${foodName(swap.fromFoodCode, catalogue)}. ${swap.reason}`;
}

const KIND_ORDER: SwapReasonKind[] = ["less_salt", "less_refined_carbohydrate", "more_fibre", "less_sugar", "lighter_cooking"];

export function EatingPlansCard() {
  const { data } = useEatingGuidance();
  const { data: catalogue } = useFoodCatalogue();
  // the booking link shows only while a dietitian visit can be booked and paid for (S64: offered only while its price is set)
  const dietitianTerms = useMyBookingTerms("dietitian");
  const canBookDietitian = dietitianTerms.data?.bookable === true;
  if (!data || data.guidance.state !== "ok") return null;
  const { plans, swaps } = data.guidance;
  const foods = (catalogue ?? []) as FoodCatalogueItem[];
  const kinds = KIND_ORDER.filter((k) => swaps.some((s) => s.reasonKind === k));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Eating plans and swaps</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {plans.map((plan) => (
          <details key={plan.code} className="rounded-md border border-charcoal-ink/10 p-3 dark:border-night-ink/20">
            <summary className="min-h-11 cursor-pointer text-sm font-semibold text-charcoal-ink dark:text-night-ink">{plan.title}</summary>
            <div className="mt-2 space-y-2 text-sm text-charcoal-ink/80 dark:text-night-ink/80">
              <p>{plan.intro}</p>
              <ul className="list-disc space-y-1 pl-5">
                {plan.tips.map((t) => (
                  <li key={t.heading}>
                    <strong>{t.heading}.</strong> {t.body}
                  </li>
                ))}
              </ul>
              <p>{plan.careTeamPrompt}</p>
              {(plan.code === "kidney" || plan.code === "weight") && canBookDietitian ? (
                <p>
                  <Link className="font-medium underline" href="/patient/appointments?type=dietitian">
                    Book a dietitian visit
                  </Link>
                </p>
              ) : null}
            </div>
          </details>
        ))}
        {kinds.length > 0 ? (
          <div className="space-y-3">
            <p className="text-sm font-semibold text-charcoal-ink dark:text-night-ink">Ideas for swaps</p>
            {kinds.map((kind) => (
              <div key={kind}>
                <p className="text-sm font-medium text-charcoal-ink/80 dark:text-night-ink/80">{REASON_KIND_LABEL[kind]}</p>
                <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-charcoal-ink/80 dark:text-night-ink/80">
                  {swaps
                    .filter((s) => s.reasonKind === kind)
                    .map((s) => (
                      <li key={s.code}>{signedSwapMessage(s, foods)}</li>
                    ))}
                </ul>
              </div>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
