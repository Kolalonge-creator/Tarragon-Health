"use client";

import { useActionState, useState } from "react";
import { logInsulin, logFootSelfCheck, logSickDay } from "./actions";
import { FOOT_FINDINGS } from "@/lib/validation/diabetes-logs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const INSULIN_OPTIONS = [
  { value: "soluble", label: "Soluble / regular (short-acting)" },
  { value: "nph", label: "NPH / isophane (intermediate)" },
  { value: "premixed", label: "Premixed 30/70" },
  { value: "analogue_rapid", label: "Rapid-acting analogue" },
  { value: "analogue_long", label: "Long-acting analogue" },
] as const;

const FINDING_LABEL: Record<(typeof FOOT_FINDINGS)[number], string> = {
  cut: "Cut / wound",
  blister: "Blister",
  redness: "Redness",
  swelling: "Swelling",
  colour_change: "Colour change",
  pain: "Pain",
};

function Feedback({ state }: { state: { error?: string; success?: boolean } | undefined }) {
  if (state?.error) return <p className="text-sm text-red-600">{state.error}</p>;
  if (state?.success) return <p className="text-sm text-brand-green">Saved. Thank you for logging this.</p>;
  return null;
}

/**
 * The three structured self-monitoring surfaces the diabetes pathway logs
 * beyond glucose/ketones (§10.1): insulin doses, the daily foot self-check
 * (a flagged problem alerts your care team, §18.1), and the sick-day log
 * (which reminds you never to stop insulin, §17.4).
 */
export function DiabetesSelfMonitoring() {
  const [insulinState, insulinAction, insulinPending] = useActionState(logInsulin, undefined);
  const [footState, footAction, footPending] = useActionState(logFootSelfCheck, undefined);
  const [sickState, sickAction, sickPending] = useActionState(logSickDay, undefined);
  const [footProblem, setFootProblem] = useState(false);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Diabetes daily log</CardTitle>
      </CardHeader>
      <CardContent className="space-y-8">
        {/* Insulin */}
        <form action={insulinAction} className="space-y-3">
          <p className="text-sm font-medium text-deep-forest">Insulin dose</p>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="insulin_type">Type</Label>
              <Select id="insulin_type" name="insulin_type" required defaultValue="">
                <option value="" disabled>
                  Select insulin
                </option>
                {INSULIN_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="units">Units</Label>
              <Input id="units" name="units" type="number" step="0.5" min="0" required />
            </div>
          </div>
          <Feedback state={insulinState} />
          <Button type="submit" disabled={insulinPending}>
            {insulinPending ? "Saving…" : "Log insulin"}
          </Button>
        </form>

        {/* Foot self-check */}
        <form action={footAction} className="space-y-3 border-t border-charcoal-ink/10 pt-6">
          <p className="text-sm font-medium text-deep-forest">Daily foot check</p>
          <p className="text-xs text-charcoal-ink/60">
            Look at both feet (a mirror or family member helps). Tick anything new.
          </p>
          <input type="hidden" name="any_problem" value={footProblem ? "true" : "false"} />
          <div className="grid grid-cols-2 gap-2">
            {FOOT_FINDINGS.map((f) => (
              <label key={f} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name="findings"
                  value={f}
                  onChange={(e) => {
                    if (e.target.checked) setFootProblem(true);
                  }}
                />
                {FINDING_LABEL[f]}
              </label>
            ))}
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={footProblem}
              onChange={(e) => setFootProblem(e.target.checked)}
            />
            My feet don&apos;t look normal today
          </label>
          <Feedback state={footState} />
          <Button type="submit" disabled={footPending} variant={footProblem ? "default" : "outline"}>
            {footPending ? "Saving…" : footProblem ? "Report foot problem" : "Feet look fine today"}
          </Button>
        </form>

        {/* Sick-day */}
        <form action={sickAction} className="space-y-3 border-t border-charcoal-ink/10 pt-6">
          <p className="text-sm font-medium text-deep-forest">Sick-day log</p>
          <p className="text-xs text-charcoal-ink/60">
            If you&apos;re unwell, keep taking your insulin — never stop it — test more often, and
            keep fluids going.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="illness">What&apos;s wrong?</Label>
              <Input id="illness" name="illness" type="text" maxLength={300} placeholder="e.g. fever, vomiting" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="appetite">Appetite</Label>
              <Select id="appetite" name="appetite" defaultValue="normal">
                <option value="normal">Normal</option>
                <option value="reduced">Reduced</option>
                <option value="none">Not eating</option>
              </Select>
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="vomiting" value="true" />
            I&apos;ve been vomiting
          </label>
          <Feedback state={sickState} />
          <Button type="submit" disabled={sickPending}>
            {sickPending ? "Saving…" : "Log sick day"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
