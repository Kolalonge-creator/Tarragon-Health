"use client";

import { useActionState } from "react";
import { signObservationLimits } from "./actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type ObservationLimitsRow = { id: string; version: number; approved_at: string | null; created_at: string; config: unknown };
type Limit = { min: number; max: number; unit: string; integer: boolean; softMin?: number; softMax?: number };

const LABEL: Record<string, string> = {
  glucose_mmol_l: "Glucose (mmol/L)",
  glucose_mg_dl: "Glucose (mg/dL)",
  weight_kg: "Weight",
  waist_cm: "Waist",
  temperature_c: "Temperature",
  spo2_pct: "SpO2",
  pulse_bpm: "Pulse",
  systolic_mmhg: "Blood pressure, top number",
  diastolic_mmhg: "Blood pressure, bottom number",
  water_ml: "Water, one log (new)",
  sleep_hours: "Sleep, one night (new)",
  mood: "Mood score (new)",
  inhaler_puffs: "Inhaler puffs, one use (new)",
};

const TOUCH = "min-h-11";

export function ObservationLimitsView({ row, canSign }: { row: ObservationLimitsRow | null; canSign: boolean }) {
  const [state, action, pending] = useActionState(signObservationLimits, undefined);
  const signed = row?.approved_at != null;
  const limits = (row?.config ?? {}) as Record<string, Limit>;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Badge variant={signed ? "green" : "amber"}>{signed ? `Signed ${new Date(row!.approved_at!).toLocaleDateString("en-NG")}` : "Not signed"}</Badge>
        <p className="text-sm text-charcoal-ink/70">
          These are typo limits: a number outside them is refused with a plain sentence. They are wider than any clinical band on purpose, so a true emergency
          reading can always be typed and reach the red-flag rules.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Version {row?.version ?? "none"}</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto text-sm">
          <table className="w-full text-left">
            <thead>
              <tr>
                <th className="py-1 pr-4">Number</th>
                <th className="py-1 pr-4">Refused outside</th>
                <th className="py-1">Asks to confirm outside</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(limits).map(([key, l]) => (
                <tr key={key} className="border-t">
                  <td className="py-1 pr-4">{LABEL[key] ?? key}</td>
                  <td className="py-1 pr-4">
                    {l.min} to {l.max} {l.unit}
                    {l.integer ? ", whole numbers" : ""}
                  </td>
                  <td className="py-1">{l.softMin !== undefined || l.softMax !== undefined ? `${l.softMin ?? "-"} to ${l.softMax ?? "-"} ${l.unit}` : "Never"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-charcoal-ink/70">
            The rows marked new need your view. The first nine restate limits already enforced on the phone, the web and the API. Signing does not switch the
            water, sleep, mood or inhaler logs on, and no alert rule exists for them.
          </p>
        </CardContent>
      </Card>

      {canSign && row && !signed ? (
        <form action={action} className="space-y-3 rounded-lg border p-4">
          <input type="hidden" name="id" value={row.id} />
          <p className="text-sm text-charcoal-ink/70">Signing records, under your own name, that you reviewed the limits above.</p>
          <label className="flex items-start gap-2 text-sm">
            <Input type="checkbox" name="reviewed" className="mt-1 h-5 w-5" />
            <span>I have reviewed these limits.</span>
          </label>
          {state?.error ? <p role="alert" className="text-sm text-red-700">{state.error}</p> : null}
          {state?.success ? <p role="status" className="text-sm text-green-800">Signed.</p> : null}
          <Button type="submit" className={TOUCH} disabled={pending}>Sign the limits</Button>
        </form>
      ) : null}
    </div>
  );
}
