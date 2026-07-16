"use client";

import { usePatientLabMonitoring } from "@/lib/queries/lab-monitoring";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export function LabMonitoringCard({ patientId }: { patientId: string }) {
  const { data, isLoading, isError } = usePatientLabMonitoring(patientId);

  // Nothing to show until a monitored medication is prescribed — keep the
  // dashboard quiet rather than render an empty card.
  if (!isLoading && !isError && (!data || data.length === 0)) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Lab monitoring</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
        {isError && (
          <p className="text-sm text-red-600">Could not load lab monitoring.</p>
        )}
        {data && data.length > 0 && (
          <ul className="divide-y divide-charcoal-ink/10">
            {data.map((item) => {
              const overdue =
                item.due_date != null &&
                new Date(item.due_date) < new Date(new Date().toDateString());
              return (
                <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <div className="min-w-0">
                    <p className="text-sm text-charcoal-ink">{item.monitoring_label}</p>
                    <p className="text-xs text-charcoal-ink/60">
                      {item.medication?.drug_name
                        ? `For ${item.medication.drug_name}`
                        : item.drug_class}
                    </p>
                  </div>
                  {item.due_date ? (
                    <Badge variant={overdue ? "red" : "amber"}>
                      {overdue ? "Overdue" : "Due"} {new Date(item.due_date).toLocaleDateString()}
                    </Badge>
                  ) : (
                    <Badge variant="grey">As clinically indicated</Badge>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
