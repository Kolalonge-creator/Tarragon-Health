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
  delayed: { variant: "amber", label: "Delayed" },
  not_available: { variant: "amber", label: "Not available" },
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

/**
 * Medication safety pathway 64.8: a dose response is one of four states —
 * Taken / Skipped / Delayed / Not available. Missed stays available
 * alongside them (it predates this change and evaluate_adherence_escalation
 * already keys its primary missed-dose count off it) rather than being
 * replaced by this list. Choosing "Missed" doesn't log immediately — it
 * opens the missed-reason picker below, same as before pathway 64.8.
 */
const LOG_ACTIONS: { status: "taken" | "missed" | "skipped" | "delayed" | "not_available"; label: string }[] = [
  { status: "taken", label: "Taken" },
  { status: "skipped", label: "Skipped" },
  { status: "delayed", label: "Delayed" },
  { status: "not_available", label: "Not available" },
  { status: "missed", label: "Missed" },
];

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
    status: "taken" | "missed" | "skipped" | "delayed" | "not_available",
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
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-soft-sage/60">
              <SEMANTIC_ICON.medication className="h-5 w-5 text-deep-forest/60" strokeWidth={2} />
            </span>
            <p className="text-sm text-charcoal-ink/60">No scheduled doses today.</p>
            <p className="text-xs text-charcoal-ink/45">
              Doses appear here once a medicine has a schedule.
            </p>
          </div>
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
                      <div className="flex flex-wrap gap-2">
                        {LOG_ACTIONS.map((action) => (
                          <Button
                            key={action.status}
                            size="sm"
                            variant="outline"
                            disabled={logDose.isPending}
                            onClick={() =>
                              action.status === "missed"
                                ? setReasonPromptFor(askingReason ? null : rowKey)
                                : log(item.medicationId, item.time, medication.organisation_id, action.status)
                            }
                          >
                            {action.label}
                          </Button>
                        ))}
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
