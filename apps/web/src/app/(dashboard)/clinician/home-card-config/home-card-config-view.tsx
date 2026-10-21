"use client";

import { useActionState } from "react";
import { signHomeCardConfig } from "./actions";
import { parseHomeCardConfig, parseReadinessConfig, parseWeeklyConfig } from "@tarragon/clinical/today";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type HomeCardConfigRow = { id: string; version: number; is_active: boolean; approved_at: string | null; created_at: string; config: unknown };

const TOUCH = "min-h-11";

const CARD_WORDS: Record<string, string> = {
  task_due: "A task from the care team",
  medicines: "Medicines for today",
  readings: "Today's reading",
  goal: "One small goal",
  lesson: "One short lesson",
  assistant_nudge: "A nudge to ask the assistant",
  streak: "Days logged (gentle streak)",
  weekly_summary: "Weekly summary",
  readiness: "Wearable readiness line",
};

function read(config: unknown) {
  try {
    const raw = (config ?? {}) as { readiness?: unknown; weekly?: unknown };
    return { cards: parseHomeCardConfig(1, config), readiness: parseReadinessConfig(raw.readiness), weekly: parseWeeklyConfig(raw.weekly) };
  } catch {
    return null;
  }
}

/** Shows every card and number a patient could meet, in plain words, next to the Sign control. */
export function HomeCardConfigView({ row, canSign }: { row: HomeCardConfigRow | null; canSign: boolean }) {
  const [state, action, pending] = useActionState(signHomeCardConfig, undefined);
  const signed = row?.approved_at != null;
  const cfg = read(row?.config);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Badge variant={signed ? "green" : "amber"}>{signed ? `Signed ${new Date(row!.approved_at!).toLocaleDateString("en-NG")}` : "Not signed"}</Badge>
        <p className="text-sm text-charcoal-ink/70">
          {signed ? "The Today screen, weekly summary and readiness line follow the numbers below." : "Until this is signed, nobody sees the new Today cards, the streak card, the weekly summary or the readiness line."}
        </p>
      </div>

      {!cfg ? (
        <p role="alert" className="text-sm text-red-700">This version could not be read as a valid configuration, so it cannot be signed.</p>
      ) : (
        <>
          <Card>
            <CardHeader><CardTitle className="text-base">Today screen: at most {cfg.cards.maxPrimaryActions} things to do</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p>The Today screen shows at most two main actions, whatever is signed. Everything else is tucked under &quot;More for today&quot;. An overdue task always comes first.</p>
              <ul className="list-disc space-y-1 pl-5">
                {[...cfg.cards.cards].sort((a, b) => a.priority - b.priority).map((c) => (
                  <li key={c.code}>
                    {CARD_WORDS[c.code] ?? c.code}: order {c.priority}, {c.primaryEligible ? "can be a main action" : "always under More for today"}
                    {c.rules.requiresDevice ? ", only for people with a connected device" : ""}
                    {c.rules.pathwaysAny.length > 0 ? `, only for pathways: ${c.rules.pathwaysAny.join(", ")}` : ""}
                    {c.rules.goalsAny.length > 0 ? `, only for goals: ${c.rules.goalsAny.join(", ")}` : ""}
                  </li>
                ))}
              </ul>
              <p>Days-logged card: {cfg.cards.streakEnabled ? "on. A high reading counts like any other, a saved rest day covers a missed day, and there is never a shame line." : "off."}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">Weekly summary</CardTitle></CardHeader>
            <CardContent className="space-y-1 text-sm">
              <p>Four small cards over the last {cfg.weekly.windowDays} days: blood pressure, activity against the person&apos;s own goal, meals logged and medicines marked taken (same formula as the adherence report).</p>
              <p>Blood pressure shows only from {cfg.weekly.minBpReadings} readings in the week; below that it says there is not enough yet. It counts readings under the person&apos;s own target and never calls a number good or bad.</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">Wearable readiness line (an estimate, never a medical claim)</CardTitle></CardHeader>
            <CardContent className="space-y-1 text-sm">
              <p>Only for people with a connected device, and only when it has stored data newer than {cfg.readiness.maxAgeHours} hours. It compares today with the person&apos;s own median of the earlier days in the last {cfg.readiness.baselineDays} days (at least {cfg.readiness.minBaselineDays} needed) and needs at least {cfg.readiness.minSignals} of the 3 signals.</p>
              <p>A signal moves the unhelpful way when sleep is {cfg.readiness.sleepDropPct} percent or more under usual, heart rate variability {cfg.readiness.hrvDropPct} percent or more under usual, or resting heart rate {cfg.readiness.restingHrRiseBpm} beats a minute or more over usual. It moves the helpful way when heart rate variability is {cfg.readiness.hrvRisePct} percent or more over usual.</p>
              <p>Two unhelpful signals: &quot;Take it easier today&quot;. None, and one helpful: &quot;Rested&quot;. Anything else: &quot;Steady&quot;. It is {cfg.readiness.enabled ? "switched on" : "switched off"}.</p>
            </CardContent>
          </Card>
        </>
      )}

      {canSign && row && cfg && !signed ? (
        <form action={action} className="space-y-3 rounded-lg border p-4">
          <input type="hidden" name="id" value={row.id} />
          <p className="text-sm text-charcoal-ink/70">Signing records, under your own name, that you reviewed every card and number above.</p>
          <label className="flex items-start gap-2 text-sm">
            <Input type="checkbox" name="reviewed" className="mt-1 h-5 w-5" />
            <span>I have reviewed the cards, the weekly summary numbers and the readiness thresholds above.</span>
          </label>
          {state?.error ? <p role="alert" className="text-sm text-red-700">{state.error}</p> : null}
          {state?.success ? <p role="status" className="text-sm text-green-800">Signed.</p> : null}
          <Button type="submit" className={TOUCH} disabled={pending}>Sign the Today screen settings</Button>
        </form>
      ) : null}
    </div>
  );
}
