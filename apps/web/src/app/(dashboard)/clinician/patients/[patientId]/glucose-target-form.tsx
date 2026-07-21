"use client";

import { useActionState, useState } from "react";
import { setGlucoseTarget } from "./foot-assessment-actions";
import { CATEGORY_DEFAULTS, GLYCAEMIC_CATEGORIES } from "@/lib/validation/glucose-target";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function GlucoseTargetForm({ patientId }: { patientId: string }) {
  const [state, action, pending] = useActionState(setGlucoseTarget, undefined);
  const [category, setCategory] = useState<(typeof GLYCAEMIC_CATEGORIES)[number]>("standard");
  const d = CATEGORY_DEFAULTS[category];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Individualised glucose target (§9)</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={action} className="space-y-4">
          <input type="hidden" name="patient_id" value={patientId} />
          <div className="space-y-1.5">
            <Label htmlFor="category">Target category</Label>
            <Select
              id="category"
              name="category"
              value={category}
              onChange={(e) => setCategory(e.target.value as typeof category)}
            >
              {GLYCAEMIC_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_DEFAULTS[c].label}
                </option>
              ))}
            </Select>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="hba1c_target_percent">HbA1c target (%)</Label>
              <Input
                id="hba1c_target_percent"
                name="hba1c_target_percent"
                type="number"
                step="0.1"
                defaultValue={d.hba1c}
                key={`hba1c-${category}`}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="upper_target">Upper glucose target (mmol/L)</Label>
              <Input
                id="upper_target"
                name="upper_target"
                type="number"
                step="0.5"
                defaultValue={d.upper}
                key={`upper-${category}`}
              />
              <p className="text-xs text-charcoal-ink/60">
                Relaxing this only softens the routine &quot;persistent high&quot; review flag —
                hypo and emergency alerts are never relaxed.
              </p>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="note">Note (optional)</Label>
            <Input id="note" name="note" type="text" maxLength={500} />
          </div>
          {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
          {state?.success && <p className="text-sm text-brand-green">Target saved.</p>}
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save target"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
