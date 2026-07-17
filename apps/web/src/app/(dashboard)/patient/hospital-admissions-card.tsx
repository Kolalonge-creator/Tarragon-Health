"use client";

import { useActionState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { logHospitalAdmission, updateHospitalAdmission } from "./actions";
import {
  usePatientAdmissions,
  hospitalAdmissionsKey,
  type HospitalAdmission,
} from "@/lib/queries/hospital-admissions";
import { patientTimelineKey } from "@/lib/queries/hospital-admissions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SEMANTIC_ICON } from "@/lib/icons";

function durationLabel(admission: HospitalAdmission): string {
  const start = new Date(admission.admitted_on);
  const end = admission.discharged_on ? new Date(admission.discharged_on) : new Date();
  const days = Math.max(0, Math.round((end.getTime() - start.getTime()) / 86_400_000));
  const unit = days === 1 ? "day" : "days";
  return admission.discharged_on ? `${days} ${unit}` : `${days} ${unit} so far`;
}

function AdmissionRow({
  admission,
  patientId,
}: {
  admission: HospitalAdmission;
  patientId: string;
}) {
  const queryClient = useQueryClient();
  const [state, formAction, pending] = useActionState(updateHospitalAdmission, undefined);

  useEffect(() => {
    if (state?.success) {
      queryClient.invalidateQueries({ queryKey: hospitalAdmissionsKey(patientId) });
      queryClient.invalidateQueries({ queryKey: patientTimelineKey(patientId) });
    }
  }, [state?.success, queryClient, patientId]);

  return (
    <li className="space-y-2 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-charcoal-ink">
          {admission.facility_name ?? "Hospital admission"}
          <Badge variant={admission.is_current ? "amber" : "grey"} className="ml-2">
            {admission.is_current ? "Currently admitted" : "Discharged"}
          </Badge>
        </p>
        <span className="text-xs text-charcoal-ink/60">{durationLabel(admission)}</span>
      </div>
      <p className="text-xs text-charcoal-ink/70">
        Admitted {new Date(admission.admitted_on).toLocaleDateString()}
        {admission.discharged_on
          ? ` · discharged ${new Date(admission.discharged_on).toLocaleDateString()}`
          : ""}
      </p>
      {admission.self_reported_diagnosis && (
        <p className="text-xs text-charcoal-ink/70">
          Reason (self-reported): {admission.self_reported_diagnosis}
        </p>
      )}

      {admission.is_current && (
        <form action={formAction} className="flex flex-wrap items-end gap-2 pt-1">
          <input type="hidden" name="id" value={admission.id} />
          <input
            type="hidden"
            name="self_reported_diagnosis"
            value={admission.self_reported_diagnosis ?? ""}
          />
          <div className="space-y-1">
            <Label htmlFor={`discharged_on_${admission.id}`} className="text-xs">
              Discharge date
            </Label>
            <Input
              id={`discharged_on_${admission.id}`}
              name="discharged_on"
              type="date"
              min={admission.admitted_on}
              required
              className="h-9"
            />
          </div>
          <Button type="submit" size="sm" variant="outline" disabled={pending}>
            {pending ? "Saving…" : "Mark discharged"}
          </Button>
        </form>
      )}
      {state?.error && <p className="text-xs text-red-600">{state.error}</p>}
    </li>
  );
}

export function HospitalAdmissionsCard({ patientId }: { patientId: string }) {
  const [state, formAction, pending] = useActionState(logHospitalAdmission, undefined);
  const queryClient = useQueryClient();
  const { data, isLoading, isError } = usePatientAdmissions(patientId);

  useEffect(() => {
    if (state?.success) {
      queryClient.invalidateQueries({ queryKey: hospitalAdmissionsKey(patientId) });
      queryClient.invalidateQueries({ queryKey: patientTimelineKey(patientId) });
    }
  }, [state?.success, queryClient, patientId]);

  const today = new Date().toISOString().slice(0, 10);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SEMANTIC_ICON.clinicianFollowUp className="h-5 w-5 text-deep-forest" strokeWidth={2} />
          Hospital admissions
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <p className="text-sm text-charcoal-ink/70">
          Let your care team know if you&apos;ve been admitted to hospital. What you enter here is
          self-reported — your care team reviews it and updates your care plan if needed.
        </p>

        <form action={formAction} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="admitted_on">Admission date</Label>
              <Input id="admitted_on" name="admitted_on" type="date" max={today} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="discharged_on">Discharge date (optional)</Label>
              <Input id="discharged_on" name="discharged_on" type="date" max={today} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="facility_name">Hospital (optional)</Label>
            <Input id="facility_name" name="facility_name" type="text" maxLength={200} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="self_reported_diagnosis">
              What were you admitted for? (optional)
            </Label>
            <Input
              id="self_reported_diagnosis"
              name="self_reported_diagnosis"
              type="text"
              maxLength={500}
            />
            <p className="text-xs text-charcoal-ink/60">
              In your own words — this is recorded as self-reported, not a diagnosis.
            </p>
          </div>

          {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
          {state?.success && (
            <p className="text-sm text-brand-green">
              Saved. Your care team has been notified to review your plan.
            </p>
          )}

          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Log admission"}
          </Button>
        </form>

        <div className="border-t border-charcoal-ink/10 pt-4">
          {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
          {isError && (
            <p className="text-sm text-red-600">Could not load your admissions.</p>
          )}
          {data && data.length === 0 && (
            <p className="text-sm text-charcoal-ink/60">No admissions recorded.</p>
          )}
          {data && data.length > 0 && (
            <ul className="divide-y divide-charcoal-ink/10">
              {data.map((admission) => (
                <AdmissionRow key={admission.id} admission={admission} patientId={patientId} />
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
