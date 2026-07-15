"use client";

import { useCarePlans } from "@/lib/queries/care-plans";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SEMANTIC_ICON } from "@/lib/icons";

function humanize(value: string) {
  return value
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function CarePlanDisplay({ patientId }: { patientId: string }) {
  const { data, isLoading, isError } = useCarePlans(patientId);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SEMANTIC_ICON.carePlan className="h-5 w-5 text-deep-forest" strokeWidth={2} />
          Care plan
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
        {isError && (
          <p className="text-sm text-red-600">Could not load your care plan.</p>
        )}
        {data && data.length === 0 && (
          <p className="text-sm text-charcoal-ink/60">
            No care plan yet — your doctor will assign one after reviewing your health data.
          </p>
        )}
        {data && data.length > 0 && (
          <ul className="divide-y divide-charcoal-ink/10">
            {data.map((plan) => {
              const targetRanges = (plan.target_ranges ?? {}) as Record<string, unknown>;
              const targetRangeEntries = Object.entries(targetRanges);

              return (
                <li key={plan.id} className="space-y-1 py-3">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-charcoal-ink">
                      {humanize(plan.condition)}
                    </p>
                    <Badge variant="green">Active</Badge>
                  </div>
                  <p className="text-xs text-charcoal-ink/60">
                    {plan.assigned_clinician?.full_name
                      ? `Managed by ${plan.assigned_clinician.full_name}`
                      : "Not yet assigned to a doctor"}
                  </p>
                  {targetRangeEntries.length > 0 && (
                    <p className="text-xs text-charcoal-ink/60">
                      {targetRangeEntries
                        .map(([key, value]) => `${humanize(key)}: ${value}`)
                        .join(" — ")}
                    </p>
                  )}
                  {plan.notes && (
                    <p className="text-xs text-charcoal-ink/60">{plan.notes}</p>
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
