"use client";

import { useActionState, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { generateMealPlanAction } from "./nutrition-actions";
import { useMealPlan } from "@/lib/queries/nutrition";
import { FOOD_COST_TIERS } from "@/lib/nutrition/food-catalogue";
import type { CarePlanCondition } from "@/lib/nutrition/condition-guidance";
import type { ValidatedMealPlan, MealPlanSlot } from "@/lib/nutrition/meal-plan-validate";
import { MEAL_TYPE_LABELS, MEAL_TYPES } from "@/lib/validation/nutrition";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * 7-day meal planner (spec 19.8) — LLM-generated, grounded against the
 * Nigerian food catalogue, condition-aware (see meal-plan-generate.ts), and
 * recomputed server-side rather than trusting the model's own arithmetic
 * (meal-plan-validate.ts). CKD gets no generated plan at all — routed to the
 * nutrition-support request above it instead.
 */

const BUDGET_TIER_LABELS: Record<(typeof FOOD_COST_TIERS)[number], string> = {
  budget: "Keep it affordable",
  mid: "Standard",
  premium: "No budget limit",
};

export function MealPlanSection({
  patientId,
  activeConditions,
  generationConfigured,
}: {
  patientId: string;
  activeConditions: CarePlanCondition[];
  generationConfigured: boolean;
}) {
  const queryClient = useQueryClient();
  const { data: mealPlanRow, isLoading } = useMealPlan(patientId);
  const [state, formAction, isPending] = useActionState(generateMealPlanAction, undefined);
  const [selectedDay, setSelectedDay] = useState(1);

  useEffect(() => {
    if (state?.status === "generated") {
      queryClient.invalidateQueries({ queryKey: ["nutrition-meal-plan", patientId] });
      // Deferred a tick so this isn't a same-frame setState-in-effect
      // (react-hooks/set-state-in-effect) — same technique as
      // ResultExplainer's own load() deferral.
      const id = setTimeout(() => setSelectedDay(1), 0);
      return () => clearTimeout(id);
    }
  }, [state, queryClient, patientId]);

  const isCkd = activeConditions.includes("ckd");
  const plan = (mealPlanRow?.plan ?? null) as unknown as ValidatedMealPlan | null;
  const currentDay = plan?.days.find((d) => d.day === selectedDay);

  return (
    <Card>
      <CardHeader>
        <CardTitle>7-day meal plan</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {isCkd ? (
          <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">
            CKD nutrition needs careful, individual balancing of sodium, potassium and phosphorus.
            A generated generic plan isn&apos;t the right tool here. Use the nutrition support
            request above to get a plan built around your own lab results with a dietitian.
          </p>
        ) : !generationConfigured ? (
          <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">Meal plan generation isn&apos;t switched on yet.</p>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <Badge variant="grey">AI-generated: a starting point, not a prescription</Badge>
            </div>
            <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">
              Generated from our Nigerian food list and tailored to your active conditions. Swap
              anything that doesn&apos;t suit you. It&apos;s a coaching starting point, not a rule.
            </p>

            <form action={formAction} className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-1.5">
                  <Label htmlFor="budget_tier">Budget (optional)</Label>
                  <Select id="budget_tier" name="budget_tier" defaultValue="">
                    <option value="">No preference</option>
                    {FOOD_COST_TIERS.map((tier) => (
                      <option key={tier} value={tier}>
                        {BUDGET_TIER_LABELS[tier]}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="preferences_note">Preferences (optional)</Label>
                  <Textarea
                    id="preferences_note"
                    name="preferences_note"
                    placeholder="e.g. no seafood, less spicy, mostly vegetarian"
                    maxLength={300}
                    className="min-h-[38px]"
                  />
                </div>
              </div>
              <Button type="submit" disabled={isPending}>
                {isPending
                  ? "Generating your plan… this can take a moment"
                  : mealPlanRow
                    ? "Regenerate plan"
                    : "Generate my 7-day plan"}
              </Button>
              {state?.status === "error" && <p className="text-sm text-red-600 dark:text-red-300">{state.error}</p>}
            </form>

            {isLoading && <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">Loading…</p>}

            {plan && plan.days.length > 0 && (
              <div className="space-y-3 border-t border-charcoal-ink/10 dark:border-night-ink/15 pt-4">
                {plan.summary && <p className="text-sm text-charcoal-ink/80 dark:text-night-ink/80">{plan.summary}</p>}

                <div className="flex flex-wrap gap-1.5">
                  {plan.days.map((d) => (
                    <button
                      key={d.day}
                      type="button"
                      onClick={() => setSelectedDay(d.day)}
                      aria-pressed={selectedDay === d.day}
                      className={cn(
                        "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                        selectedDay === d.day
                          ? "bg-brand-green text-white"
                          : "bg-charcoal-ink/5 dark:bg-night-ink/10 text-charcoal-ink/70 dark:text-night-ink/70 hover:bg-charcoal-ink/10 dark:hover:bg-night-ink/15",
                      )}
                    >
                      Day {d.day}
                    </button>
                  ))}
                </div>

                {currentDay && (
                  <div className="space-y-3">
                    {MEAL_TYPES.map((slot: MealPlanSlot) => {
                      const items = currentDay.meals[slot];
                      if (!items || items.length === 0) return null;
                      return (
                        <div key={slot}>
                          <p className="text-xs font-semibold uppercase tracking-wide text-charcoal-ink/50 dark:text-night-ink/55">
                            {MEAL_TYPE_LABELS[slot]}
                          </p>
                          <ul className="mt-1 space-y-1">
                            {items.map((item, i) => (
                              <li key={i} className="text-sm text-charcoal-ink dark:text-night-ink">
                                {item.foodName}: {item.quantity} {item.unit}
                                {item.quantity > 1 ? "s" : ""}
                                {item.rationale && (
                                  <span className="text-charcoal-ink/60 dark:text-night-ink/60"> · {item.rationale}</span>
                                )}
                              </li>
                            ))}
                          </ul>
                        </div>
                      );
                    })}

                    {currentDay.analysis && (
                      <p className="rounded-md bg-charcoal-ink/5 dark:bg-night-ink/10 p-2 text-xs text-charcoal-ink/70 dark:text-night-ink/70">
                        ~{Math.round(currentDay.analysis.caloriesKcal)} kcal ·{" "}
                        {Math.round(currentDay.analysis.carbsG)}g carbs ·{" "}
                        {Math.round(currentDay.analysis.proteinG)}g protein ·{" "}
                        {Math.round(currentDay.analysis.fatG)}g fat ·{" "}
                        {Math.round(currentDay.analysis.fibreG)}g fibre ·{" "}
                        {Math.round(currentDay.analysis.sodiumMg)}mg sodium
                      </p>
                    )}
                  </div>
                )}

                {plan.notes && <p className="text-xs text-amber-700 dark:text-amber-300">{plan.notes}</p>}
                {plan.droppedItems.length > 0 && (
                  <p className="text-xs text-charcoal-ink/40 dark:text-night-ink/50">
                    Some suggested items weren&apos;t in our food list and were left out of this plan.
                  </p>
                )}
              </div>
            )}

            {!plan && !isLoading && mealPlanRow?.ai_status === "failed" && (
              <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">
                Couldn&apos;t generate a plan last time. Give it another try.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
