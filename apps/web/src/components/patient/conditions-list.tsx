"use client";

import { useState } from "react";
import { useConditions, usePendingConditionRequests, useWithdrawConditionRequest } from "@/lib/queries/conditions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { ResultExplainer } from "@/components/result-explainer";
import { EmptyHint } from "@/components/ui/empty-hint";
import type { Enums } from "@tarragon/shared";

import { formatPatientDate } from "@/lib/format-date";
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
 * AllergiesList there is no add/edit affordance on this card.
 *
 * S05b-f: when she has asked for a condition she entered herself to be
 * removed or corrected, the request waits for her care team and the
 * condition stays exactly as it was. The row says so in one plain line and
 * offers "Withdraw request". Only she sees her own request (a caregiver's
 * read returns none, so the line does not show for a caregiver).
 *
 * Self-hides once loaded with nothing on file, UNLESS the caller passes
 * `emptyHint`. Health summary introduces this with its own "Conditions"
 * heading, so hiding left the heading standing over nothing; a caller that
 * has already labelled the section passes the line to show instead. Nothing
 * renders while the query is still in flight either way, so the hint appears
 * only once "nothing on file" is actually known.
 */
export function ConditionsList({ patientId, emptyHint }: { patientId: string; emptyHint?: string }) {
  const { data, isLoading } = useConditions(patientId);
  const { data: pendingRequests } = usePendingConditionRequests(patientId);
  const withdrawRequest = useWithdrawConditionRequest();
  const [withdrawError, setWithdrawError] = useState<string | null>(null);
  const [withdrawingId, setWithdrawingId] = useState<string | null>(null);

  if (isLoading) return null;
  if (!data || data.length === 0) return emptyHint ? <EmptyHint>{emptyHint}</EmptyHint> : null;

  const pendingIdByCondition = new Map(
    (pendingRequests ?? []).flatMap((request) => (request.condition_id ? [[request.condition_id, request.id] as const] : [])),
  );

  async function handleWithdraw(requestId: string) {
    setWithdrawError(null);
    setWithdrawingId(requestId);
    try {
      await withdrawRequest.mutateAsync({ patientId, requestId });
    } catch (err) {
      setWithdrawError(err instanceof Error ? err.message : "We could not take that request back. Please try again.");
    } finally {
      setWithdrawingId(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Conditions</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {data.map((condition) => {
          const pendingRequestId = pendingIdByCondition.get(condition.id);
          return (
          <div
            key={condition.id}
            className="space-y-1 border-b border-charcoal-ink/10 dark:border-night-ink/15 pb-3 last:border-0 last:pb-0"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium text-charcoal-ink dark:text-night-ink">{condition.condition_name}</p>
              <Badge variant={STATUS_BADGE_VARIANT[condition.status]}>
                {STATUS_LABEL[condition.status]}
              </Badge>
            </div>
            {(condition.severity || condition.date_identified) && (
              <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
                {condition.severity && `${SEVERITY_LABEL[condition.severity]} severity`}
                {condition.severity && condition.date_identified && " · "}
                {condition.date_identified &&
                  `Identified ${formatPatientDate(condition.date_identified)}`}
              </p>
            )}
            {pendingRequestId && (
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-xs font-medium text-charcoal-ink/80 dark:text-night-ink/80">
                  Change requested, waiting for your care team
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={withdrawingId === pendingRequestId}
                  onClick={() => handleWithdraw(pendingRequestId)}
                >
                  Withdraw request
                </Button>
              </div>
            )}
            <ResultExplainer
              kind="condition"
              subjectKey={condition.id}
              label={condition.condition_name}
            />
          </div>
          );
        })}
        {withdrawError && (
          <p role="alert" className="text-sm text-destructive">
            {withdrawError}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
