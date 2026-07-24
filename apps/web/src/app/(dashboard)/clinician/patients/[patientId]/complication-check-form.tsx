"use client";

import { useActionState } from "react";
import { recordComplicationCheck } from "./foot-assessment-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function ComplicationCheckForm({ patientId }: { patientId: string }) {
  const [state, action, pending] = useActionState(recordComplicationCheck, undefined);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Eye / kidney surveillance (§18.2–18.3)</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={action} className="space-y-4">
          <input type="hidden" name="patient_id" value={patientId} />
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="check_type">Check</Label>
              <Select id="check_type" name="check_type" required defaultValue="">
                <option value="" disabled>
                  Select
                </option>
                <option value="retinal">Dilated retinal / eye screening</option>
                <option value="renal">Renal (eGFR + urine ACR)</option>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="interval_months">Next due in (months)</Label>
              <Input id="interval_months" name="interval_months" type="number" min="1" max="24" defaultValue={12} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="outcome">Result / outcome</Label>
            <Input id="outcome" name="outcome" type="text" maxLength={500} placeholder="e.g. no retinopathy; eGFR 78, ACR normal" />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="abnormal" value="true" />
            Result abnormal (also raise through the usual result pathway)
          </label>
          {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
          {state?.success && <p className="text-sm text-brand-green">Recorded. Next check date set.</p>}
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Record check"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
