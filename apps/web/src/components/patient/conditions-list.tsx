"use client";

import { useConditions } from "@/lib/queries/conditions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { ResultExplainer } from "@/components/result-explainer";
import type { Enums } from "@tarragon/shared";

const STATUS_BADGE_VARIANT: Record<
  Enums<"condition_clinical_status">,
  NonNullable<BadgeProps["variant"]>
> = {
  suspected: "amber",
  under_investigation: "amber",
  active: "red",
  uncontrolled: "red",
  controlled: "green",
  resolved: "grey",
  historical: "grey",
};

const STATUS_LABEL: Record<Enums<"condition_clinical_status">, string> = {
  suspected: "Suspected",
  under_investigation: "Under investigation",
  active: "Active",
  uncontrolled: "Uncontrolled",
  controlled: "Controlled",
  resolved: "Resolved",
  historical: "Historical",
};

const SEVERITY_LABEL: Record<Enums<"clinical_severity">, string> = {
  mild: "Mild",
  moderate: "Moderate",
  severe: "Severe",
};

/**
 * Patient's problem list (spec §76.3) -- the first place `patient_conditions`
 * is ever shown to a patient. Read-only here: only org clinical staff can
 * add or change a condition (see patient_conditions RLS), so unlike
 * AllergiesList there is no add/edit affordance on this card. Self-hides
 * entirely once loaded with nothing on file -- a summary page composing many
 * sections shouldn't carry an empty-state card for every one of them.
 */
export function ConditionsList({ patientId }: { patientId: string }) {
  const { data, isLoading } = useConditions(patientId);

  if (isLoading) return null;
  if (!data || data.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Conditions</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {data.map((condition) => (
          <div
            key={condition.id}
            className="space-y-1 border-b border-charcoal-ink/10 pb-3 last:border-0 last:pb-0"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium text-charcoal-ink">{condition.condition_name}</p>
              <Badge variant={STATUS_BADGE_VARIANT[condition.status]}>
                {STATUS_LABEL[condition.status]}
              </Badge>
            </div>
            {(condition.severity || condition.date_identified) && (
              <p className="text-xs text-charcoal-ink/60">
                {condition.severity && `${SEVERITY_LABEL[condition.severity]} severity`}
                {condition.severity && condition.date_identified && " · "}
                {condition.date_identified &&
                  `Identified ${new Date(condition.date_identified).toLocaleDateString()}`}
              </p>
            )}
            <ResultExplainer
              kind="condition"
              subjectKey={condition.id}
              label={condition.condition_name}
            />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
