"use client";

import { useMemo, useState, type FormEvent } from "react";
import {
  useReproductiveHealthProfile,
  useSaveReproductiveHealthProfile,
  type ReproductiveLifeStage,
} from "@/lib/queries/reproductive-health";
import { computeCycleNudges } from "@/lib/rules/cycle-nudges";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { SEMANTIC_ICON } from "@/lib/icons";

const LIFE_STAGE_LABEL: Record<ReproductiveLifeStage, string> = {
  menstruating: "Menstruating",
  trying_to_conceive: "Trying to conceive",
  pregnant: "Pregnant",
  postpartum: "Postpartum (within the last year)",
  perimenopausal: "Perimenopausal",
  menopausal: "Menopausal",
  not_applicable: "Prefer not to say / not applicable",
};

/**
 * Women's-health bridge, part 2: a self-reported life stage that drives a
 * small honestly-labelled nudge engine (see lib/rules/cycle-nudges.ts).
 * Never a diagnosis, never fed into risk/escalation scoring — a preference
 * the patient can change any time, same as the reminder-preference toggle.
 * Part 1 (real cervical/breast screening status inside the Women's Health
 * preventive programme) lives in preventive-programmes.tsx.
 */
export function ReproductiveHealthCard({
  patientId,
  organisationId,
}: {
  patientId: string;
  organisationId: string;
}) {
  const profile = useReproductiveHealthProfile(patientId);
  const save = useSaveReproductiveHealthProfile();

  const [lifeStage, setLifeStage] = useState<ReproductiveLifeStage | null>(null);
  const [lastPeriodDate, setLastPeriodDate] = useState<string | null>(null);
  const [cycleLength, setCycleLength] = useState<string>("");

  const effectiveLifeStage = lifeStage ?? profile.data?.life_stage ?? "not_applicable";
  const effectiveLastPeriodDate =
    lastPeriodDate !== null ? lastPeriodDate : profile.data?.last_period_date ?? null;
  const effectiveCycleLength =
    cycleLength !== ""
      ? Number(cycleLength)
      : profile.data?.average_cycle_length_days ?? null;

  const nudges = useMemo(
    () =>
      computeCycleNudges({
        lifeStage: effectiveLifeStage,
        lastPeriodDate: effectiveLastPeriodDate,
        averageCycleLengthDays: effectiveCycleLength,
      }),
    [effectiveLifeStage, effectiveLastPeriodDate, effectiveCycleLength]
  );

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    save.mutate({
      patientId,
      organisationId,
      life_stage: effectiveLifeStage,
      last_period_date: effectiveLastPeriodDate,
      average_cycle_length_days: effectiveCycleLength,
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SEMANTIC_ICON.family className="h-5 w-5 text-deep-forest" strokeWidth={2} />
          Your cycle & life stage
        </CardTitle>
        <CardDescription>
          Tell us where you are so we can give a useful nudge — never a diagnosis, and you can
          change this any time.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {nudges.length > 0 && (
          <div className="rounded-lg bg-brand-green/5 p-3">
            <ul className="space-y-1">
              {nudges.map((nudge) => (
                <li key={nudge.id} className="text-xs text-charcoal-ink/80">
                  {nudge.label}
                </li>
              ))}
            </ul>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {save.isError && (
            <p className="text-sm text-red-600">
              {(save.error as Error)?.message ?? "Could not save."}
            </p>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="life_stage">Life stage</Label>
            <Select
              id="life_stage"
              value={effectiveLifeStage}
              onChange={(event) => setLifeStage(event.target.value as ReproductiveLifeStage)}
            >
              {(Object.keys(LIFE_STAGE_LABEL) as ReproductiveLifeStage[]).map((stage) => (
                <option key={stage} value={stage}>
                  {LIFE_STAGE_LABEL[stage]}
                </option>
              ))}
            </Select>
          </div>

          {effectiveLifeStage === "menstruating" && (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="last_period_date">Last period start date</Label>
                <Input
                  id="last_period_date"
                  type="date"
                  value={effectiveLastPeriodDate ?? ""}
                  onChange={(event) => setLastPeriodDate(event.target.value || null)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cycle_length">Average cycle length (days)</Label>
                <Input
                  id="cycle_length"
                  type="number"
                  min={15}
                  max={60}
                  placeholder="28"
                  value={cycleLength !== "" ? cycleLength : effectiveCycleLength ?? ""}
                  onChange={(event) => setCycleLength(event.target.value)}
                />
              </div>
            </div>
          )}

          <Button type="submit" size="sm" disabled={save.isPending}>
            {save.isPending ? "Saving…" : "Save"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
