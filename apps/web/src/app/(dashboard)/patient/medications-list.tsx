"use client";

import { useMedications } from "@/lib/queries/medications";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export function MedicationsList({ patientId }: { patientId: string }) {
  const { data, isLoading, isError } = useMedications(patientId);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Medications</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
        {isError && (
          <p className="text-sm text-red-600">Could not load medications.</p>
        )}
        {data && data.length === 0 && (
          <p className="text-sm text-charcoal-ink/60">No active medications.</p>
        )}
        {data && data.length > 0 && (
          <ul className="divide-y divide-charcoal-ink/10">
            {data.map((medication) => (
              <li key={medication.id} className="space-y-1 py-3">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-charcoal-ink">
                    {medication.drug_name}
                  </p>
                  <Badge variant={medication.source === "clinician" ? "blue" : "grey"}>
                    {medication.source === "clinician" ? "Prescribed" : "Self-added"}
                  </Badge>
                </div>
                <p className="text-xs text-charcoal-ink/60">
                  {[medication.dose, medication.frequency].filter(Boolean).join(" — ") ||
                    "No dose/frequency set"}
                </p>
                {medication.refill_date && (
                  <p className="text-xs text-charcoal-ink/60">
                    Refill by {new Date(medication.refill_date).toLocaleDateString()}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
