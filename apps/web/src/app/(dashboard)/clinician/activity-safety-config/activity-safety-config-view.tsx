"use client";

import { useActionState } from "react";
import { signActivitySafetyConfig } from "./actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type ActivitySafetyConfigRow = { id: string; version: number; approved_at: string | null; created_at: string; config: unknown };

type Rule = { max_intensity: string; blocked_kinds: string[] };
type Cfg = {
  safety?: {
    lookback?: { red_hours?: number; amber_hours?: number; unsettled_bp_days?: number };
    kinds?: Record<string, { effort_met: number; intensity: string }>;
    rules?: Record<string, Rule>;
  };
  goals?: { weekly_active_minutes_default?: number; daily_steps_default?: number };
};

const RULE_LABEL: Record<string, string> = {
  amber: "A recent amber result",
  pregnancy: "Pregnancy",
  pregnancy_high_risk: "High-risk pregnancy",
  hypertension_unsettled: "Blood pressure not settled",
  arthritis: "Arthritis",
  back_pain: "Back pain",
};
const KIND_LABEL: Record<string, string> = {
  walking: "Walking",
  running: "Running",
  cycling: "Cycling",
  dancing: "Dancing",
  football: "Football",
  farm_manual_work: "Farm and manual work",
  chair_based: "Chair-based exercise",
};
const TOUCH = "min-h-11";

export function ActivitySafetyConfigView({ row, canSign }: { row: ActivitySafetyConfigRow | null; canSign: boolean }) {
  const [state, action, pending] = useActionState(signActivitySafetyConfig, undefined);
  const signed = row?.approved_at != null;
  const cfg = (row?.config ?? {}) as Cfg;
  const lb = cfg.safety?.lookback ?? {};
  const rules = Object.entries(cfg.safety?.rules ?? {});
  const kinds = Object.entries(cfg.safety?.kinds ?? {});

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Badge variant={signed ? "green" : "amber"}>{signed ? `Signed ${new Date(row!.approved_at!).toLocaleDateString("en-NG")}` : "Not signed"}</Badge>
        <p className="text-sm text-charcoal-ink/70">
          The gate already applies these rules, because it can only ever make activity gentler or tell someone to rest. Your signature records that you reviewed them.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">When someone is told to rest, or kept to gentle activity</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <ul className="list-disc space-y-1 pl-5">
            <li>A red triage result in the last {lb.red_hours ?? "?"} hours: rest. No workout is offered, and no programme can be started.</li>
            <li>An amber result in the last {lb.amber_hours ?? "?"} hours: gentle activity only.</li>
            <li>Blood pressure counts as not settled when a hypertension record is marked uncontrolled, or an amber or red blood pressure reading came in during the last {lb.unsettled_bp_days ?? "?"} days.</li>
          </ul>
          <p className="text-charcoal-ink/70">Patients are never told which reading or condition caused the advice. They see neutral wording only.</p>
          <p className="text-charcoal-ink/70">
            How each column is applied: the level decides which programmes can be started and which home workouts are listed, and the database refuses a programme above it.
            A kind not suggested is shown in the activity picker as &quot;not suggested right now&quot;; it is never hidden or blocked, because someone must always be able to record what they did.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Condition rules</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto text-sm">
          <table className="w-full min-w-[28rem] text-left">
            <thead>
              <tr className="border-b">
                <th className="py-2 pr-3 font-medium">Situation</th>
                <th className="py-2 pr-3 font-medium">Most intense allowed</th>
                <th className="py-2 font-medium">Kinds not suggested</th>
              </tr>
            </thead>
            <tbody>
              {rules.map(([k, r]) => (
                <tr key={k} className="border-b last:border-0">
                  <td className="py-2 pr-3">{RULE_LABEL[k] ?? k}</td>
                  <td className="py-2 pr-3 capitalize">{r.max_intensity}</td>
                  <td className="py-2">{r.blocked_kinds.length ? r.blocked_kinds.map((b) => KIND_LABEL[b] ?? b).join(", ") : "None"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Activity kinds and their intensity</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          <ul className="grid gap-1 sm:grid-cols-2">
            {kinds.map(([k, v]) => (
              <li key={k}>
                {KIND_LABEL[k] ?? k}: {v.intensity} (effort value {v.effort_met})
              </li>
            ))}
          </ul>
          <p className="mt-3 text-charcoal-ink/70">
            Weekly goal default: {cfg.goals?.weekly_active_minutes_default ?? "?"} minutes. Daily steps default: {cfg.goals?.daily_steps_default ?? "?"}. Effort values are for display only and never decide what is allowed.
          </p>
        </CardContent>
      </Card>

      {canSign && row && !signed ? (
        <form action={action} className="space-y-3 rounded-lg border p-4">
          <input type="hidden" name="id" value={row.id} />
          <p className="text-sm text-charcoal-ink/70">Signing records, under your own name, that you reviewed the rules above.</p>
          <label className="flex items-start gap-2 text-sm">
            <Input type="checkbox" name="reviewed" className="mt-1 h-5 w-5" />
            <span>I have reviewed the activity safety rules.</span>
          </label>
          {state?.error ? <p role="alert" className="text-sm text-red-700">{state.error}</p> : null}
          {state?.success ? <p role="status" className="text-sm text-green-800">Signed.</p> : null}
          <Button type="submit" className={TOUCH} disabled={pending}>Sign the activity safety rules</Button>
        </form>
      ) : null}
    </div>
  );
}
