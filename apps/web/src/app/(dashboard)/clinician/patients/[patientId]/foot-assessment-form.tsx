"use client";

import { useActionState } from "react";
import { recordFootAssessment } from "./foot-assessment-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function FootAssessmentForm({ patientId }: { patientId: string }) {
  const [state, action, pending] = useActionState(recordFootAssessment, undefined);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Diabetic foot assessment (§18.1)</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={action} className="space-y-4">
          <input type="hidden" name="patient_id" value={patientId} />
          <div className="space-y-1.5">
            <Label htmlFor="risk_class">Foot-risk classification</Label>
            <Select id="risk_class" name="risk_class" required defaultValue="">
              <option value="" disabled>
                Classify risk
              </option>
              <option value="low">Low risk</option>
              <option value="increased">Increased risk</option>
              <option value="high">High risk</option>
              <option value="active">Active problem</option>
            </Select>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="sensation_left">Sensation — left (10g monofilament)</Label>
              <Select id="sensation_left" name="sensation_left" defaultValue="">
                <option value="">Not tested</option>
                <option value="normal">Normal</option>
                <option value="reduced">Reduced</option>
                <option value="absent">Absent</option>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sensation_right">Sensation — right</Label>
              <Select id="sensation_right" name="sensation_right" defaultValue="">
                <option value="">Not tested</option>
                <option value="normal">Normal</option>
                <option value="reduced">Reduced</option>
                <option value="absent">Absent</option>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pulses">Foot pulses</Label>
            <Select id="pulses" name="pulses" defaultValue="unknown">
              <option value="yes">Present</option>
              <option value="no">Absent / reduced</option>
              <option value="unknown">Not assessed</option>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="findings">Findings (skin, nails, deformity, ulcers)</Label>
            <Input id="findings" name="findings" type="text" maxLength={1000} />
          </div>
          {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
          {state?.success && (
            <p className="text-sm text-brand-green">Foot assessment recorded. Next check date set.</p>
          )}
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Record foot assessment"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
