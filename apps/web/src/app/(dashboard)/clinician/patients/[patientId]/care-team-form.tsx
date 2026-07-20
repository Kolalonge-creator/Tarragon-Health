"use client";

import { useState } from "react";
import { useOrgClinicians, useAssignCareTeam } from "@/lib/queries/clinical-staff";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";

export function CareTeamForm({
  patientId,
  organisationId,
}: {
  patientId: string;
  organisationId: string;
}) {
  const { data: clinicians, isLoading } = useOrgClinicians();
  const assignCareTeam = useAssignCareTeam();
  const [clinicianProfileId, setClinicianProfileId] = useState("");

  const assignable = (clinicians ?? []).filter((c) => c.profile_id !== null);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Care team</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading && <p className="text-sm text-charcoal-ink/60">Loading doctors…</p>}
        {!isLoading && assignable.length === 0 && (
          <p className="text-sm text-charcoal-ink/60">
            No active doctors on file for this organisation yet — add one to clinical_staff
            first.
          </p>
        )}
        {assignable.length > 0 && (
          <div className="space-y-2">
            <Label htmlFor="clinician">Assign doctor</Label>
            <Select
              id="clinician"
              value={clinicianProfileId}
              onChange={(e) => setClinicianProfileId(e.target.value)}
            >
              <option value="">Select a doctor</option>
              {assignable.map((c) => (
                <option key={c.id} value={c.profile_id!}>
                  {c.full_name}
                  {c.staff_number ? ` (${c.staff_number})` : ""}
                  {c.credential_type && c.credential_number
                    ? ` — ${c.credential_type} ${c.credential_number}`
                    : ""}
                </option>
              ))}
            </Select>
          </div>
        )}
        {assignCareTeam.isError && (
          <p className="text-sm text-red-600">Could not save. Try again.</p>
        )}
        {assignCareTeam.isSuccess && (
          <p className="text-sm text-brand-green">Care team assigned.</p>
        )}
        <Button
          disabled={!clinicianProfileId || assignCareTeam.isPending}
          onClick={() =>
            assignCareTeam.mutate({ patientId, organisationId, clinicianProfileId })
          }
        >
          {assignCareTeam.isPending ? "Saving…" : "Assign"}
        </Button>
      </CardContent>
    </Card>
  );
}
