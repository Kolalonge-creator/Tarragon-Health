"use client";

import { useState } from "react";
import { useMedications, useTodaysDoseLogs, useLogDose, todayIsoDate } from "@/lib/queries/medications";
import { buildTodaysDoseChecklist, type DoseStatus } from "@/lib/medication-schedule/checklist";
import { MISSED_REASONS } from "@/lib/validation/medication-logs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { SEMANTIC_ICON } from "@/lib/icons";

const STATUS_BADGE: Record<DoseStatus, { variant: BadgeProps["variant"]; label: string }> = {
  pending: { variant: "grey", label: "Pending" },
  taken: { variant: "green", label: "Taken" },
  missed: { variant: "red", label: "Missed" },
  skipped: { variant: "amber", label: "Skipped" },
};

type MissedReason = (typeof MISSED_REASONS)[number];

const MISSED_REASON_LABEL: Record<MissedReason, string> = {
  forgot: "I forgot",
  device_unavailable: "Don't have it with me",
  doesnt_understand: "Not sure how/why to take it",
  doesnt_want_to: "Chose not to take it",
  feels_well: "Feeling fine, didn't think I needed it",
  technical_problem: "Something else went wrong",
};

export function TodaysDoses({ patientId }: { patientId: string }) {
  const { data: medications, isLoading: medsLoading } = useMedications(patientId);
  const { data: logs, isLoading: logsLoading } = useTodaysDoseLogs(patientId);
  const logDose = useLogDose();
  // Key: `${medicationId}-${time}` of the row currently asking for a missed-reason.
  const [reasonPromptFor, setReasonPromptFor] = useState<string | null>(null);

  const isLoading = medsLoading || logsLoading;
  const checklist =
    medications && logs ? buildTodaysDoseChecklist(medications, logs) : [];

  function log(
    medicationId: string,
    time: string,
    organisationId: string,
    status: "taken" | "missed",
    missedReason?: MissedReason
  ) {
    logDose.mutate({
      medication_id: medicationId,
      status,
      missed_reason: missedReason,
      scheduled_time: time,
      scheduled_for_date: todayIsoDate(),
      patientId,
      organisationId,
    });
    setReasonPromptFor(null);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SEMANTIC_ICON.medication className="h-5 w-5 text-deep-forest" strokeWidth={2} />
          Today&apos;s doses
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
        {!isLoading && checklist.length === 0 && (
          <p className="text-sm text-charcoal-ink/60">No scheduled doses today.</p>
        )}
        {checklist.length > 0 && (
          <ul className="divide-y divide-charcoal-ink/10">
            {checklist.map((item) => {
              const medication = medications?.find((m) => m.id === item.medicationId);
              const badge = STATUS_BADGE[item.status];
              const rowKey = `${item.medicationId}-${item.time}`;
              const askingReason = reasonPromptFor === rowKey;
              return (
                <li key={rowKey} className="py-3">
                  <div className="flex items-center justify-between gap-4">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-charcoal-ink">
                          {item.time}
                        </span>
                        <Badge variant={badge.variant}>{badge.label}</Badge>
                      </div>
                      <p className="text-xs text-charcoal-ink/60">{item.drugName}</p>
                    </div>
                    {medication && (
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={logDose.isPending}
                          onClick={() =>
                            log(item.medicationId, item.time, medication.organisation_id, "taken")
                          }
                        >
                          Taken
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={logDose.isPending}
                          onClick={() => setReasonPromptFor(askingReason ? null : rowKey)}
                        >
                          Missed
                        </Button>
                      </div>
                    )}
                  </div>
                  {askingReason && medication && (
                    <div className="mt-2 rounded-lg border border-charcoal-ink/10 bg-charcoal-ink/[0.02] p-3">
                      <p className="mb-2 text-xs font-medium text-charcoal-ink/70">
                        What happened? (helps us support you better)
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {MISSED_REASONS.map((reason) => (
                          <Button
                            key={reason}
                            size="sm"
                            variant="outline"
                            disabled={logDose.isPending}
                            onClick={() =>
                              log(
                                item.medicationId,
                                item.time,
                                medication.organisation_id,
                                "missed",
                                reason
                              )
                            }
                          >
                            {MISSED_REASON_LABEL[reason]}
                          </Button>
                        ))}
                      </div>
                    </div>
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
