"use client";

import Link from "next/link";
import { useActionState, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAlcoholGoal, useAlcoholConsumptionLogs, drinksThisWeek } from "@/lib/queries/alcohol";
import { setAlcoholGoalAction, logAlcoholConsumptionAction, type AlcoholActionState } from "./actions";
import { ALCOHOL_CONTEXTS, ALCOHOL_CONTEXT_LABELS } from "@/lib/validation/alcohol";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { HeroMetric } from "@/components/ui/hero-metric";
import { SheetButton } from "@/components/ui/sheet-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { LifestyleBarrierPicker } from "@/components/lifestyle-barrier-picker";
import { useT } from "@/components/ui-language-provider";

import { formatPatientDate } from "@/lib/format-date";
const GOAL_KEY = "alcohol-goal";
const LOGS_KEY = "alcohol-consumption-logs";

export function AlcoholClient({ patientId }: { patientId: string }) {
  const t = useT();
  const goal = useAlcoholGoal(patientId);
  const logs = useAlcoholConsumptionLogs(patientId);
  const weekTotal = useMemo(() => drinksThisWeek(logs.data ?? []), [logs.data]);

  const target = goal.data?.target_drinks_per_week ?? null;

  return (
    <div className="space-y-6">
      {/* The page opens on this week's total; logging a drink and setting a goal are one tap away in sheets, not forms on the page
          (design audit P4). */}
      <HeroMetric
        label={t("Weekly goal")}
        value={logs.isLoading || logs.isError ? null : String(weekTotal)}
        unit={weekTotal === 1 ? "drink this week" : "drinks this week"}
        meta={!logs.isError && target != null ? `${weekTotal} of a ${target} drinks/week goal so far this week` : undefined}
        emptyText={logs.isError ? t("We couldn't load this just now. Try again in a moment.") : t("Loading…")}
      />
      <div className="flex flex-wrap items-center gap-3">
        <SheetButton variant="default" label={t("Log today's drinks")}>
          {(close) => <LogForm patientId={patientId} onDone={close} />}
        </SheetButton>
        {!goal.isLoading && (
          <SheetButton label={goal.data ? t("Update") + " " + t("Weekly goal").toLowerCase() : t("Set a goal")} title={t("Weekly goal")}>
            {(close) => <GoalForm patientId={patientId} goal={goal.data} onDone={close} />}
          </SheetButton>
        )}
        {!goal.isLoading && !goal.data && (
          <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">{t("No goal set yet. Set one whenever you're ready.")}</p>
        )}
      </div>

      <Card>
        <CardContent className="flex items-center justify-between gap-3 pt-6">
          <div>
            <p className="text-sm font-medium text-charcoal-ink dark:text-night-ink">{t("Not sure where you stand?")}</p>
            <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">{t("Retake the AUDIT-C screen, or read up on cutting back.")}</p>
          </div>
          <div className="flex gap-2">
            <Link href="/patient/health-check" className="text-sm font-medium text-brand-green dark:text-brand-green-bright hover:underline">
              {t("Screening")}
            </Link>
            <Link href="/patient/learn" className="text-sm font-medium text-brand-green dark:text-brand-green-bright hover:underline">
              {t("Learn")}
            </Link>
          </div>
        </CardContent>
      </Card>

      <LifestyleBarrierPicker domain="alcohol" />

      <Card>
        <CardHeader>
          <CardTitle>{t("History")}</CardTitle>
        </CardHeader>
        <CardContent>
          {logs.isLoading && <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">{t("Loading…")}</p>}
          {!logs.isLoading && (logs.data?.length ?? 0) === 0 && (
            <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">{t("Nothing logged yet.")}</p>
          )}
          <ul className="space-y-2">
            {(logs.data ?? []).map((entry) => (
              <li key={entry.id} className="flex items-center justify-between rounded-lg border border-charcoal-ink/10 dark:border-night-ink/15 p-3">
                <p className="text-sm font-medium text-charcoal-ink dark:text-night-ink">
                  {formatPatientDate(entry.logged_on, { month: "long", day: "numeric" })}:{" "}
                  {entry.drinks_count} drink{entry.drinks_count === 1 ? "" : "s"}
                  {entry.context && ` (${ALCOHOL_CONTEXT_LABELS[entry.context as keyof typeof ALCOHOL_CONTEXT_LABELS]})`}
                </p>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

function GoalForm({
  patientId,
  goal,
  onDone,
}: {
  patientId: string;
  goal: ReturnType<typeof useAlcoholGoal>["data"];
  onDone: () => void;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const [state, formAction, pending] = useActionState<AlcoholActionState, FormData>(
    async (prev, formData) => {
      const result = await setAlcoholGoalAction(prev, formData);
      if (result?.success) {
        queryClient.invalidateQueries({ queryKey: [GOAL_KEY, patientId] });
        onDone();
      }
      return result;
    },
    undefined,
  );

  return (
    <>
      <form action={formAction} className="flex items-end gap-3">
        <div className="grid gap-1">
          <Label htmlFor="target_drinks_per_week">{t("Target drinks per week")}</Label>
          <Input
            id="target_drinks_per_week"
            name="target_drinks_per_week"
            type="number"
            min={0}
            defaultValue={goal?.target_drinks_per_week ?? undefined}
            required
          />
        </div>
        <Button type="submit" disabled={pending}>
          {pending ? t("Saving…") : t("Save goal")}
        </Button>
      </form>
      {state?.error && <p className="mt-2 text-sm text-destructive dark:text-red-400">{state.error}</p>}
    </>
  );
}

function LogForm({ patientId, onDone }: { patientId: string; onDone: () => void }) {
  const t = useT();
  const queryClient = useQueryClient();
  const [state, formAction, pending] = useActionState<AlcoholActionState, FormData>(
    async (prev, formData) => {
      const result = await logAlcoholConsumptionAction(prev, formData);
      if (result?.success) {
        queryClient.invalidateQueries({ queryKey: [LOGS_KEY, patientId] });
        onDone();
      }
      return result;
    },
    undefined,
  );

  return (
    <>
        <form action={formAction} className="grid gap-3 sm:grid-cols-3 sm:items-end">
          <div className="grid gap-1">
            <Label htmlFor="drinks_count">{t("Standard drinks")}</Label>
            <Input id="drinks_count" name="drinks_count" type="number" min={0} defaultValue={0} required />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="context">{t("Context")}</Label>
            <Select id="context" name="context" defaultValue="">
              <option value="">{t("Not specified")}</option>
              {ALCOHOL_CONTEXTS.map((c) => (
                <option key={c} value={c}>
                  {ALCOHOL_CONTEXT_LABELS[c]}
                </option>
              ))}
            </Select>
          </div>
          <Button type="submit" disabled={pending}>
            {pending ? t("Saving…") : t("Save")}
          </Button>
        </form>
        {state?.error && <p className="mt-2 text-sm text-destructive dark:text-red-400">{state.error}</p>}
    </>
  );
}
