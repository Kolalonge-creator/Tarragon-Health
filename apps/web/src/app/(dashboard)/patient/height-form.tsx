"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Ruler } from "lucide-react";
import { updatePatientHeight } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Sets the patient's height on file — the value BMI is calculated from
 * (vitals trend, Health Score, Health Passport). If a risk-assessment answer
 * later disagrees with whatever is saved here, the vitals page will prompt
 * the patient to pick which one is right.
 */
export function HeightForm({ initial }: { initial: { height_cm: number | null } }) {
  const [state, formAction, pending] = useActionState(updatePatientHeight, undefined);
  const router = useRouter();

  useEffect(() => {
    if (state?.success) router.refresh();
  }, [state?.success, router]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Ruler className="h-5 w-5 text-deep-forest" strokeWidth={2} />
          Height
        </CardTitle>
        <CardDescription>
          Used to calculate your BMI alongside your logged weight.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="space-y-3">
          <div className="max-w-xs space-y-1.5">
            <Label htmlFor="height-cm">Height (cm)</Label>
            <Input
              id="height-cm"
              name="height_cm"
              type="number"
              inputMode="decimal"
              min={100}
              max={230}
              step="0.1"
              placeholder="e.g. 170"
              defaultValue={initial.height_cm ?? ""}
            />
          </div>
          {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
          {state?.success && <p className="text-sm text-brand-green">Height saved.</p>}
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save height"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
