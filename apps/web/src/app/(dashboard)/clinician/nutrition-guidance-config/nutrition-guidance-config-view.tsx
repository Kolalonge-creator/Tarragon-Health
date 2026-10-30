"use client";

import { useActionState } from "react";
import { signNutritionGuidanceConfig } from "./actions";
import { REASON_KIND_LABEL, type FoodSwap, type EatingPlan } from "@tarragon/shared";
import { parseEatingGuidance } from "@tarragon/shared";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type NutritionGuidanceConfigRow = { id: string; version: number; is_active: boolean; approved_at: string | null; created_at: string; config: unknown };

const TOUCH = "min-h-11";

/** Reads the stored config through the same parser the patient screens use, by wrapping it in the shape the gate returns. */
function read(config: unknown): { swaps: FoodSwap[]; plans: EatingPlan[]; placeholders: Record<string, string[]> } | null {
  if (!config || typeof config !== "object") return null;
  const c = config as { swaps?: unknown; plans?: Record<string, Record<string, unknown>> };
  if (!c.plans || typeof c.plans !== "object") return null;
  const wrapped = {
    state: "ok",
    config_version: 0,
    swaps: c.swaps,
    plans: Object.entries(c.plans).map(([code, p]) => ({ code, ...p })),
  };
  const parsed = parseEatingGuidance(wrapped);
  if (parsed.state !== "ok") return null;
  const placeholders: Record<string, string[]> = {};
  for (const [code, p] of Object.entries(c.plans)) placeholders[code] = Array.isArray(p.placeholders) ? (p.placeholders as string[]) : [];
  return { swaps: parsed.swaps, plans: parsed.plans, placeholders };
}

/**
 * Shows the whole swap table and every plan in the words a patient would read, next to the Sign control. Kidney and pregnancy carry no numbers by
 * construction; the one number elsewhere is listed under "numbers for you to confirm". Who sees what is fixed in the database and is not signed here.
 */
export function NutritionGuidanceConfigView({ row, canSign }: { row: NutritionGuidanceConfigRow | null; canSign: boolean }) {
  const [state, action, pending] = useActionState(signNutritionGuidanceConfig, undefined);
  const signed = row?.approved_at != null;
  const cfg = read(row?.config);
  const rawPlans = (row?.config as { plans?: Record<string, { numbers?: Record<string, number> }> } | null)?.plans ?? {};

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Badge variant={signed ? "green" : "amber"}>{signed ? `Signed ${new Date(row!.approved_at!).toLocaleDateString("en-NG")}` : "Not signed"}</Badge>
        <p className="text-sm text-charcoal-ink/70">
          {signed
            ? "Patients each plan applies to see it. The older built-in swap hints are no longer used."
            : "Until this is signed no patient sees an eating plan or a signed swap (the older built-in swap hints keep working meanwhile)."}
        </p>
      </div>

      {!cfg ? (
        <p role="alert" className="text-sm text-red-700">This version could not be read as a valid configuration, so it cannot be signed.</p>
      ) : (
        <>
          {cfg.plans.map((p) => (
            <Card key={p.code}>
              <CardHeader>
                <CardTitle className="text-base">{p.title}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p>{p.intro}</p>
                <ul className="list-disc space-y-1 pl-5">
                  {p.tips.map((t) => (
                    <li key={t.heading}>
                      <strong>{t.heading}.</strong> {t.body}
                    </li>
                  ))}
                </ul>
                <p className="text-charcoal-ink/70">Prompt to the patient: {p.careTeamPrompt}</p>
                {rawPlans[p.code]?.numbers ? (
                  <p>
                    <strong>Numbers for you to confirm:</strong>{" "}
                    {Object.entries(rawPlans[p.code]!.numbers!).map(([k, v]) => `${k.replace(/_/g, " ")} = ${v}`).join(", ")} (a placeholder until you confirm it).
                  </p>
                ) : p.code === "kidney" || p.code === "pregnancy" ? (
                  <p className="text-charcoal-ink/70">No protein, potassium, phosphorus or calorie numbers: the database refuses them on this plan.</p>
                ) : null}
              </CardContent>
            </Card>
          ))}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Food swaps ({cfg.swaps.length})</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <ul className="space-y-2">
                {cfg.swaps.map((s) => (
                  <li key={s.code}>
                    <strong>{s.fromFoodCode.replace(/_/g, " ")}</strong> to <strong>{s.toFoodCodes.map((c) => c.replace(/_/g, " ")).join(" or ")}</strong> ({REASON_KIND_LABEL[s.reasonKind]}; for {s.audience.join(", ")}). {s.reason}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Who sees what (fixed in the database, not part of this signature)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              <ul className="list-disc space-y-1 pl-5">
                <li>The weight plan, the swaps and the condition plans are withheld exactly as daily targets are: pregnancy, the postnatal year, a clinician hold, a positive eating-disorder screen, under 18.</li>
                <li>The pregnancy plan is shown only to the patient herself, never to a patient under a clinician hold or with a positive eating-disorder screen.</li>
                <li>A withheld person sees nothing at all and is given no reason.</li>
              </ul>
            </CardContent>
          </Card>
        </>
      )}

      {canSign && row && cfg && !signed ? (
        <form action={action} className="space-y-3 rounded-lg border p-4">
          <input type="hidden" name="id" value={row.id} />
          <p className="text-sm text-charcoal-ink/70">Signing records, under your own name, that you reviewed the plans and swaps above.</p>
          <label className="flex items-start gap-2 text-sm">
            <Input type="checkbox" name="reviewed" className="mt-1 h-5 w-5" />
            <span>I have reviewed every swap and every plan above.</span>
          </label>
          {state?.error ? <p role="alert" className="text-sm text-red-700">{state.error}</p> : null}
          {state?.success ? <p role="status" className="text-sm text-green-800">Signed.</p> : null}
          <Button type="submit" className={TOUCH} disabled={pending}>Sign the plans and swaps</Button>
        </form>
      ) : null}
    </div>
  );
}
