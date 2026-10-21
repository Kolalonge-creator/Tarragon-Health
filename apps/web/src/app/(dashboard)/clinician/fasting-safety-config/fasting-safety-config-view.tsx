"use client";

import { useActionState } from "react";
import { signFastingSafetyConfig } from "./actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type FastingSafetyConfigRow = { id: string; version: number; is_active: boolean; approved_at: string | null; created_at: string; config: unknown };

type Match = { name_patterns: string[]; icd10_prefixes: string[] };
type Cfg = {
  safety?: {
    lookback?: { red_hours?: number; amber_hours?: number };
    min_age_years?: number;
    outcomes?: Record<string, string>;
    matches?: Record<string, Match>;
    medicine_classes?: Record<string, { name_patterns: string[] }>;
  };
  calendar?: Record<string, { year: number; start: string; end: string }[]>;
};

const OUTCOME_LABEL: Record<string, string> = { not_advised: "Not advised (a hard stop)", needs_clinician_plan: "Needs a clinician plan first" };
const RULE_LABEL: Record<string, string> = {
  pregnancy: "Pregnant, or in the year after birth",
  under_age: "Under the minimum age (or date of birth unknown)",
  type1_diabetes: "Type 1 diabetes",
  kidney_disease: "Kidney disease",
  eating_disorder: "A positive eating-disorder screen, or a recorded eating disorder",
  recent_red_event: "A red triage result recently (cannot be softened)",
  recent_amber_event: "An amber triage result recently",
  insulin: "Takes insulin",
  sulfonylurea: "Takes a sulfonylurea (for example gliclazide or glimepiride)",
  diabetes_medicines_unconfirmed: "Has diabetes but no medicine is recorded",
};
const TOUCH = "min-h-11";

/**
 * Every rule the fasting gate applies, in plain words, next to the Sign control. The Chief Medical Officer confirms the outcomes, the medicine names
 * and the condition matches. The patient never sees which rule applied: pregnancy, age, a screen or a condition all give the same "unavailable" answer.
 */
export function FastingSafetyConfigView({ row, canSign }: { row: FastingSafetyConfigRow | null; canSign: boolean }) {
  const [state, action, pending] = useActionState(signFastingSafetyConfig, undefined);
  const signed = row?.approved_at != null;
  const cfg = (row?.config ?? {}) as Cfg;
  const lb = cfg.safety?.lookback ?? {};
  const outcomes = Object.entries(cfg.safety?.outcomes ?? {});
  const matches = Object.entries(cfg.safety?.matches ?? {});
  const classes = Object.entries(cfg.safety?.medicine_classes ?? {});
  const cal = Object.entries(cfg.calendar ?? {});

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Badge variant={signed ? "green" : "amber"}>{signed ? `Signed ${new Date(row!.approved_at!).toLocaleDateString("en-NG")}` : "Not signed"}</Badge>
        <p className="text-sm text-charcoal-ink/70">
          {signed
            ? "These rules apply. The fasting screen still stays hidden until the fasting_safety go-live switch is turned on."
            : "Until this is signed no patient is told anything about fasting except that they should talk to their care team. This is a safety answer for Ramadan and Lent only; there are no fasting timers or programmes."}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">What happens for each situation</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto text-sm">
          <table className="w-full min-w-[28rem] text-left">
            <thead>
              <tr className="border-b">
                <th className="py-2 pr-3 font-medium">Situation</th>
                <th className="py-2 font-medium">Outcome</th>
              </tr>
            </thead>
            <tbody>
              {outcomes.map(([k, o]) => (
                <tr key={k} className="border-b last:border-0">
                  <td className="py-2 pr-3">{RULE_LABEL[k] ?? k}</td>
                  <td className="py-2">{OUTCOME_LABEL[o] ?? o}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-charcoal-ink/70">
            <li>A red result counts for {lb.red_hours ?? "?"} hours and an amber one for {lb.amber_hours ?? "?"} hours. They also pause a plan already under way.</li>
            <li>Minimum age: {cfg.safety?.min_age_years ?? "?"}. An unknown date of birth is treated as under age.</li>
            <li>Insulin and sulfonylurea users can start only once a clinician-signed, patient-confirmed medicine timing plan covers the whole fast. The plan is an ordinary signed medicine change (S24). The platform never proposes a timing itself.</li>
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Medicines and conditions the rules look for</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {classes.map(([k, v]) => (
            <p key={k}>
              <strong className="capitalize">{k}</strong>: {v.name_patterns.join(", ")}
            </p>
          ))}
          {matches.map(([k, v]) => (
            <p key={k}>
              <strong>{k.replace(/_/g, " ")}</strong>: names containing {v.name_patterns.join(", ")}; ICD-10 starting {v.icd10_prefixes.join(", ")}
            </p>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Expected dates</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          {cal.map(([fast, windows]) => (
            <p key={fast}>
              <strong className="capitalize">{fast}</strong>: {windows.map((w) => `${w.year}: ${w.start} to ${w.end}`).join("; ")}
            </p>
          ))}
          <p className="mt-2 text-charcoal-ink/70">These are hints only and never a gate. A year not listed shows &quot;unknown until you confirm where you live&quot;.</p>
        </CardContent>
      </Card>

      {canSign && row && !signed ? (
        <form action={action} className="space-y-3 rounded-lg border p-4">
          <input type="hidden" name="id" value={row.id} />
          <p className="text-sm text-charcoal-ink/70">Signing records, under your own name, that you reviewed the rules above.</p>
          <label className="flex items-start gap-2 text-sm">
            <Input type="checkbox" name="reviewed" className="mt-1 h-5 w-5" />
            <span>I have reviewed the fasting safety rules.</span>
          </label>
          {state?.error ? <p role="alert" className="text-sm text-red-700">{state.error}</p> : null}
          {state?.success ? <p role="status" className="text-sm text-green-800">Signed.</p> : null}
          <Button type="submit" className={TOUCH} disabled={pending}>Sign the fasting safety rules</Button>
        </form>
      ) : null}
    </div>
  );
}
