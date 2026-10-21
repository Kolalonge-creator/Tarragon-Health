"use client";

import { useActionState } from "react";
import { signNutritionTargetsConfig } from "./actions";
import { parseNutritionTargetConfig } from "@tarragon/shared";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type NutritionTargetsConfigRow = { id: string; version: number; is_active: boolean; approved_at: string | null; created_at: string; config: unknown };

const TOUCH = "min-h-11";

/**
 * Shows every number a patient could be shown, in plain words, next to the Sign control. The Chief Medical Officer is asked to confirm the
 * numbers, the safe minimums above all; the withholding rules are not editable here and not signed here (they are fixed in the database).
 */
export function NutritionTargetsConfigView({ row, canSign }: { row: NutritionTargetsConfigRow | null; canSign: boolean }) {
  const [state, action, pending] = useActionState(signNutritionTargetsConfig, undefined);
  const signed = row?.approved_at != null;
  const cfg = parseNutritionTargetConfig(row?.config);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Badge variant={signed ? "green" : "amber"}>{signed ? `Signed ${new Date(row!.approved_at!).toLocaleDateString("en-NG")}` : "Not signed"}</Badge>
        <p className="text-sm text-charcoal-ink/70">
          {signed
            ? "Patients who are not in a withheld group see daily targets built from the numbers below."
            : "Until this is signed, no patient sees any daily target or word summary."}
        </p>
      </div>

      {!cfg ? (
        <p role="alert" className="text-sm text-red-700">This version could not be read as a valid configuration, so it cannot be signed.</p>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Calories: the safe minimums</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p>
                A calorie target is never shown below <strong>{cfg.energy.floor_kcal.female} kcal a day for a woman</strong> or <strong>{cfg.energy.floor_kcal.male} kcal a day for a man</strong>,
                whatever the formula gives. The database refuses any version with a minimum under 1,000.
              </p>
              <p>
                The target is a maintenance estimate (Mifflin-St Jeor from age, sex, height and weight) times an activity factor of {cfg.energy.activity_factors[cfg.energy.default_activity]} ({cfg.energy.default_activity} activity),
                rounded to the nearest {cfg.energy.round_to_kcal} kcal, and never above {cfg.energy.ceiling_kcal}. It is never a weight-loss target.
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Other daily numbers</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              <p>Carbohydrate {cfg.macros_pct_of_energy.carbs} percent, protein {cfg.macros_pct_of_energy.protein} percent, fat {cfg.macros_pct_of_energy.fat} percent of energy.</p>
              <p>Salt: keep under {(cfg.salt_sugar_fibre.sodium_mg_max * 2.5) / 1000} g a day ({cfg.salt_sugar_fibre.sodium_mg_max} mg sodium).</p>
              <p>Sugar: keep under {cfg.salt_sugar_fibre.sugar_pct_of_energy_max} percent of energy (total sugars; the food list does not separate free sugars).</p>
              <p>Fibre: {cfg.salt_sugar_fibre.fibre_g_per_1000_kcal} g for every 1,000 kcal.</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Word summary of a single meal</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              <p>
                Light under {cfg.meal_summary.light_below_kcal} kcal, heavy over {cfg.meal_summary.heavy_above_kcal} kcal, balanced between. A meal is also called
                salty above {cfg.meal_summary.salty_above_sodium_mg} mg sodium and sugary above {cfg.meal_summary.sugary_above_sugar_g} g sugar. Always words, never colour alone.
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Who never sees a target (fixed in the database, not part of this signature)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              <ul className="list-disc space-y-1 pl-5">
                <li>Anyone who is pregnant, and for a year after a delivery.</li>
                <li>Anyone a clinician has put a hold on.</li>
                <li>Anyone with a positive eating-disorder screen.</li>
                <li>Anyone under {cfg.min_age_years}.</li>
              </ul>
              <p className="text-charcoal-ink/70">For these patients the targets and the word summary are simply absent: the screen shows nothing and gives no reason.</p>
            </CardContent>
          </Card>
        </>
      )}

      {canSign && row && cfg && !signed ? (
        <form action={action} className="space-y-3 rounded-lg border p-4">
          <input type="hidden" name="id" value={row.id} />
          <p className="text-sm text-charcoal-ink/70">Signing records, under your own name, that you reviewed every number above.</p>
          <label className="flex items-start gap-2 text-sm">
            <Input type="checkbox" name="reviewed" className="mt-1 h-5 w-5" />
            <span>I have reviewed the safe minimums and every other number above.</span>
          </label>
          {state?.error ? <p role="alert" className="text-sm text-red-700">{state.error}</p> : null}
          {state?.success ? <p role="status" className="text-sm text-green-800">Signed.</p> : null}
          <Button type="submit" className={TOUCH} disabled={pending}>Sign the numbers</Button>
        </form>
      ) : null}
    </div>
  );
}
