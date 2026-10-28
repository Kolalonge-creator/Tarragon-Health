"use client";

import { useActionState } from "react";
import { signLowCarbProtocolConfig } from "./actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type LowCarbProtocolConfigRow = { id: string; version: number; is_active: boolean; approved_at: string | null; created_at: string; config: unknown };

type Match = { name_patterns: string[]; icd10_prefixes: string[] };
type Cfg = {
  eligibility?: {
    min_age_years?: number;
    postnatal_months?: number;
    require_confirmed_type_2?: boolean;
    severe_hypo_below_mmol?: number;
    hypo_lookback_days?: number;
    triage_lookback_hours?: number;
    condition_exclusions?: Record<string, Match>;
    medicine_groups?: Record<string, { name_patterns: string[]; handling: string }>;
    diabetes_markers?: { name_patterns: string[]; indication_patterns: string[] };
  };
  check_ins?: Record<string, { per_week: number; max_gap_days: number }>;
  safety?: { pause_glucose_below_mmol?: number; pause_ketones_at_or_above_mmol?: number; stop_after_pauses_in_30_days?: number; stop_if_checkins_missed_days?: number };
  medicine_review?: { window_days?: number; min_readings?: number; avg_glucose_below_mmol?: number; any_glucose_below_mmol?: number; standing_review_days?: number };
};

const EXCLUSION_LABEL: Record<string, string> = {
  type_1_diabetes: "Type 1 diabetes",
  kidney_disease: "Kidney disease",
  pancreatitis: "Pancreatitis",
  liver_disease: "Liver disease",
  ketoacidosis_history: "A history of ketoacidosis",
};
const GROUP_LABEL: Record<string, string> = {
  insulin: "Insulin",
  sulfonylurea: "Sulfonylureas",
  meglitinide: "Meglitinides",
  sglt2_inhibitor: "SGLT2 inhibitors",
  metformin: "Metformin",
  dpp4_inhibitor: "DPP-4 inhibitors",
  glitazone: "Glitazones",
  glp1_agonist: "GLP-1 medicines",
  alpha_glucosidase_inhibitor: "Acarbose",
};
const HANDLING_WORDS: Record<string, string> = { exclude: "not offered", supervision: "a doctor must accept supervision first", allow: "recognised, no extra step" };
const METRIC_LABEL: Record<string, string> = { glucose: "Sugar", ketones: "Ketones", weight: "Weight" };
const TOUCH = "min-h-11";

export function LowCarbProtocolConfigView({ row, canSign }: { row: LowCarbProtocolConfigRow | null; canSign: boolean }) {
  const [state, action, pending] = useActionState(signLowCarbProtocolConfig, undefined);
  const signed = row?.approved_at != null;
  const cfg = (row?.config ?? {}) as Cfg;
  const el = cfg.eligibility ?? {};
  const sf = cfg.safety ?? {};
  const mr = cfg.medicine_review ?? {};

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Badge variant={signed ? "green" : "amber"}>{signed ? `Signed ${new Date(row!.approved_at!).toLocaleDateString("en-NG")}` : "Not signed"}</Badge>
        <p className="text-sm text-charcoal-ink/70">
          Every number below is a placeholder written for you to change. Signing the rules does not switch the programme on: it also needs a signed diabetes
          step table, a recorded doctor and dietitian rota, and a decision on the cost of ketone testing. Nothing is marketed.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Who is not offered the programme</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <ul className="list-disc space-y-1 pl-5">
            <li>Under {el.min_age_years ?? "?"} years old, or no date of birth on file.</li>
            <li>Type 2 diabetes {el.require_confirmed_type_2 ? "must be confirmed by a clinician" : "may be patient-reported"}; any other type is excluded.</li>
            <li>Pregnant, or within {el.postnatal_months ?? "?"} months of a birth.</li>
            <li>A positive eating-disorder screen.</li>
            {Object.keys(el.condition_exclusions ?? {}).map((k) => (
              <li key={k}>{EXCLUSION_LABEL[k] ?? k}.</li>
            ))}
            <li>
              A sugar reading below {el.severe_hypo_below_mmol ?? "?"} mmol/L in the last {el.hypo_lookback_days ?? "?"} days, or a recent hospital admission, unless the offering doctor rules it out.
            </li>
            <li>A red or amber safety result in the last {el.triage_lookback_hours ?? "?"} hours: not offered for now.</li>
          </ul>
          <p className="font-medium">Medicines</p>
          <ul className="list-disc space-y-1 pl-5">
            {Object.entries(el.medicine_groups ?? {}).map(([k, g]) => (
              <li key={k}>
                {GROUP_LABEL[k] ?? k}: {HANDLING_WORDS[g.handling] ?? g.handling} (matches {g.name_patterns.join(", ")})
              </li>
            ))}
          </ul>
          <p>
            Any other medicine that looks diabetes-related (its name contains {(el.diabetes_markers?.name_patterns ?? []).join(", ")}, or its recorded reason contains {(el.diabetes_markers?.indication_patterns ?? []).join(", ")})
            and is on none of the lists above, or a medicine with no usable name, needs a doctor to accept supervision. It is never treated as &quot;no medicine of concern&quot;.
          </p>
          <p className="text-charcoal-ink/70">
            These name lists are a starting point written without a pharmacist. Spelling slips of one letter (two for long names), capitals, strengths and combination products are matched.
            A pharmacist and you must confirm every name before signing. Add any Nigerian brand that is missing.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Check-ins, pauses and stops</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <ul className="list-disc space-y-1 pl-5">
            {Object.entries(cfg.check_ins ?? {}).map(([k, c]) => (
              <li key={k}>
                {METRIC_LABEL[k] ?? k}: {c.per_week} a week, and never more than {c.max_gap_days} days without one.
              </li>
            ))}
            <li>Pauses the programme: a sugar reading below {sf.pause_glucose_below_mmol ?? "?"} mmol/L, a ketone reading of {sf.pause_ketones_at_or_above_mmol ?? "?"} mmol/L or more, or any red or amber safety result. Only a clinician resumes it, after the screen is re-run.</li>
            <li>Stops the programme: {sf.stop_after_pauses_in_30_days ?? "?"} pauses in 30 days, or {sf.stop_if_checkins_missed_days ?? "?"} days without a check-in. A stop always opens a medicine review.</li>
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">When a doctor must review the medicines</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <ul className="list-disc space-y-1 pl-5">
            <li>
              Average sugar below {mr.avg_glucose_below_mmol ?? "?"} mmol/L over {mr.window_days ?? "?"} days, with at least {mr.min_readings ?? "?"} readings.
            </li>
            <li>Any sugar reading below {mr.any_glucose_below_mmol ?? "?"} mmol/L.</li>
            <li>Every {mr.standing_review_days ?? "?"} days while the programme runs.</li>
            <li>Whenever the programme pauses or stops.</li>
          </ul>
          <p className="text-charcoal-ink/70">
            The platform raises the review task and, where the diabetes step table says so, an unsigned draft. It never changes a medicine, a dose or a time: a prescriber signs and the patient confirms.
          </p>
        </CardContent>
      </Card>

      {canSign && row && !signed ? (
        <form action={action} className="space-y-3 rounded-lg border p-4">
          <input type="hidden" name="id" value={row.id} />
          <p className="text-sm text-charcoal-ink/70">Signing records, under your own name, that you reviewed every number above.</p>
          <label className="flex items-start gap-2 text-sm">
            <Input type="checkbox" name="reviewed" className="mt-1 h-5 w-5" />
            <span>I have reviewed the low-carbohydrate programme rules.</span>
          </label>
          {state?.error ? <p role="alert" className="text-sm text-red-700">{state.error}</p> : null}
          {state?.success ? <p role="status" className="text-sm text-green-800">Signed.</p> : null}
          <Button type="submit" className={TOUCH} disabled={pending}>Sign the programme rules</Button>
        </form>
      ) : null}
    </div>
  );
}
