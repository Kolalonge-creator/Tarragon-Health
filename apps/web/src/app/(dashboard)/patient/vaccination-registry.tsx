"use client";

import { useMemo } from "react";
import { useVaccinationCatalog, useVaccinationRecords } from "@/lib/queries/vaccination";
import { computeVaccinationStatuses, type VaccinationStatus } from "@/lib/rules/vaccination-status";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { SEMANTIC_ICON } from "@/lib/icons";

const STATUS_BADGE: Record<VaccinationStatus, { variant: BadgeProps["variant"]; label: string }> = {
  overdue: { variant: "red", label: "Overdue" },
  due: { variant: "amber", label: "Due" },
  up_to_date: { variant: "green", label: "Up to date" },
  not_yet_due: { variant: "grey", label: "Not yet due" },
  not_applicable: { variant: "grey", label: "Not applicable" },
};

export function VaccinationRegistry({
  patientId,
  ageYears,
}: {
  patientId: string;
  ageYears: number | null;
}) {
  const catalog = useVaccinationCatalog();
  const records = useVaccinationRecords(patientId);

  const statuses = useMemo(() => {
    if (!catalog.data || !records.data) return [];
    return computeVaccinationStatuses(catalog.data, records.data, { ageYears });
  }, [catalog.data, records.data, ageYears]);

  const isLoading = catalog.isLoading || records.isLoading;
  const isError = catalog.isError || records.isError;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SEMANTIC_ICON.preventive className="h-5 w-5 text-deep-forest" strokeWidth={2} />
          Vaccination registry
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
        {isError && (
          <p className="text-sm text-red-600">Could not load your vaccination registry.</p>
        )}
        {!isLoading && !isError && statuses.length === 0 && (
          <p className="text-sm text-charcoal-ink/60">No vaccinations in the catalogue yet.</p>
        )}
        {statuses.length > 0 && (
          <ul className="divide-y divide-charcoal-ink/10">
            {statuses.map((entry) => {
              const badge = STATUS_BADGE[entry.status];
              return (
                <li key={entry.catalogId} className="space-y-1 py-3">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-charcoal-ink">{entry.name}</p>
                    <Badge variant={badge.variant}>{badge.label}</Badge>
                  </div>
                  <p className="text-xs text-charcoal-ink/60">
                    {entry.lastDoseDate
                      ? `Last dose ${new Date(entry.lastDoseDate).toLocaleDateString()} (dose ${entry.dosesGiven})`
                      : "No doses recorded yet"}
                    {entry.nextDueDate &&
                      ` — next due ${new Date(entry.nextDueDate).toLocaleDateString()}`}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
