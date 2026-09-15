"use client";

import { useActionState } from "react";
import { referPatientToSpecialist, type ReferPatientActionState } from "./mental-health-referral-actions";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Refer to psychiatry/psychology (Module 46 §46.8/§46.9) — a clinical
 * decision, gated to clinical-tier staff (see isClinicalTier at the call
 * site), matching how action_consultation_follow_up already gates referral
 * creation. Self-arranged only: Tarragon issues the referral, the patient
 * books their own appointment — see the referral-letter flow.
 */
export function ReferToSpecialistForm({ patientId }: { patientId: string }) {
  const [state, formAction, pending] = useActionState<ReferPatientActionState, FormData>(
    referPatientToSpecialist.bind(null, patientId),
    undefined,
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Refer to psychiatry / psychology</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-4 text-sm text-charcoal-ink/70">
          Issues a referral letter the patient can take to a specialist of their choosing
          (self-arranged: Tarragon does not book or match a provider on their behalf).
        </p>
        <form action={formAction} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="specialist_type">Specialist type</Label>
            <Select id="specialist_type" name="specialist_type" required defaultValue="psychiatry">
              <option value="psychiatry">Psychiatry</option>
              <option value="psychology">Psychology</option>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="reason">Reason for referral</Label>
            <Textarea id="reason" name="reason" required maxLength={500} rows={3} />
          </div>

          {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
          {state?.success && <p className="text-sm text-brand-green">Referral created.</p>}

          <Button type="submit" disabled={pending}>
            {pending ? "Creating…" : "Create referral"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
