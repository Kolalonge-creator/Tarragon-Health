"use client";

import { useActionState, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { en } from "@tarragon/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FormError, FormSuccess } from "@/components/ui/form-error";
import { logInhalerUse, logObservation, type ObservationActionState } from "./observation-actions";

/**
 * S47a (BUILD-SPEC-v5 4.2, 6.6): the web entry for water, sleep, mood and inhaler use. The parent page renders this only when the
 * `extended_observations` module is on (the action and the database check it too). `types` picks which entries the card offers: the nutrition area
 * shows water alone, the vitals page shows all four.
 */
export type LifestyleKind = "water_ml" | "sleep_hours" | "mood" | "inhaler_use";

const LABEL: Record<LifestyleKind, string> = {
  water_ml: en["observation.type.water_ml"],
  sleep_hours: en["observation.type.sleep_hours"],
  mood: en["observation.type.mood"],
  inhaler_use: en["observation.type.inhaler_use"],
};

const REASONS = ["breathless_or_wheeze", "before_exercise", "routine_dose", "night_symptoms", "other"] as const;

export function LifestyleLogCard({ types, title }: { types: readonly LifestyleKind[]; title?: string }) {
  const [kind, setKind] = useState<LifestyleKind>(types[0] ?? "water_ml");
  const [observationState, observationAction, observationPending] = useActionState<ObservationActionState, FormData>(logObservation, undefined);
  const [inhalerState, inhalerAction, inhalerPending] = useActionState<ObservationActionState, FormData>(logInhalerUse, undefined);
  const queryClient = useQueryClient();
  const state = kind === "inhaler_use" ? inhalerState : observationState;
  const pending = kind === "inhaler_use" ? inhalerPending : observationPending;
  const action = kind === "inhaler_use" ? inhalerAction : observationAction;
  const [confirmed, setConfirmed] = useState(false);

  const afterSubmit = () => {
    void queryClient.invalidateQueries({ queryKey: ["vitals-readings-page"] });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title ?? (types.length === 1 ? `Log ${LABEL[types[0]!].toLowerCase()}` : "Log water, sleep, mood or inhaler")}</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={action} onSubmit={afterSubmit} className="space-y-4" noValidate>
          {types.length > 1 && (
            <div className="space-y-1.5">
              <Label htmlFor="lifestyle_kind">What to log</Label>
              <Select
                id="lifestyle_kind"
                value={kind}
                onChange={(e) => {
                  setKind(e.target.value as LifestyleKind);
                  setConfirmed(false);
                }}
              >
                {types.map((t) => (
                  <option key={t} value={t}>
                    {LABEL[t]}
                  </option>
                ))}
              </Select>
            </div>
          )}

          {kind !== "inhaler_use" && <input type="hidden" name="vital_type" value={kind} />}
          {state?.confirm || confirmed ? <input type="hidden" name="confirm_unusual" value={confirmed ? "yes" : "no"} /> : null}

          {kind === "water_ml" && (
            <div className="space-y-1.5">
              <Label htmlFor="water_ml">Water (ml)</Label>
              <Input id="water_ml" name="water_ml" type="number" inputMode="numeric" step="1" required />
              <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">A glass is about 250 ml. A small bottle is about 500 ml.</p>
            </div>
          )}
          {kind === "sleep_hours" && (
            <div className="space-y-1.5">
              <Label htmlFor="sleep_hours">Sleep last night (hours)</Label>
              <Input id="sleep_hours" name="sleep_hours" type="number" inputMode="decimal" step="0.5" required />
            </div>
          )}
          {kind === "mood" && (
            <div className="space-y-1.5">
              <Label htmlFor="mood">{en["observation.mood_label"]}</Label>
              <Select id="mood" name="mood" required defaultValue="">
                <option value="" disabled>
                  Pick a number
                </option>
                <option value="1">1 (a hard day)</option>
                <option value="2">2</option>
                <option value="3">3</option>
                <option value="4">4</option>
                <option value="5">5 (a good day)</option>
              </Select>
              <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">{en["observation.mood_hint"]}</p>
            </div>
          )}
          {kind === "inhaler_use" && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="puffs">{en["observation.inhaler.puffs_label"]}</Label>
                <Input id="puffs" name="puffs" type="number" inputMode="numeric" step="1" required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="reason">{en["observation.inhaler.reason_group"]}</Label>
                <Select id="reason" name="reason" required defaultValue="">
                  <option value="" disabled>
                    Pick a reason
                  </option>
                  {REASONS.map((r) => (
                    <option key={r} value={r}>
                      {en[`observation.inhaler.reason.${r}` as const]}
                    </option>
                  ))}
                </Select>
              </div>
            </>
          )}

          {state?.confirm ? (
            <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/15 dark:text-amber-300">
              <p className="font-medium">{state.confirm}</p>
              <label className="mt-2 flex items-center gap-2">
                <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
                <span>Yes, the number is right</span>
              </label>
            </div>
          ) : null}

          <FormError id="lifestyle-error" message={state?.error} />
          <FormSuccess message={state?.success ? "Saved. Thank you." : undefined} />
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
