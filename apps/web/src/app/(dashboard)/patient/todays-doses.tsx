"use client";

import { useState } from "react";
import { useMedications, useTodaysDoseLogs, useLogDose, todayIsoDate } from "@/lib/queries/medications";
import { buildTodaysDoseChecklist, type DoseStatus } from "@/lib/medication-schedule/checklist";
import type { MissedDoseReason } from "@/lib/validation/medication-logs";
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

/** Pathway §65.9 — a one-tap barrier so the care team can run a targeted
 * intervention instead of a generic "you missed your medication" nudge. */
const MISSED_REASON_OPTIONS: { value: MissedDoseReason; label: string }[] = [
  { value: "cost", label: "Cost" },
  { value: "side_effects", label: "Side effects" },
  { value: "forgetfulness", label: "Forgot" },
  { value: "availability", label: "Couldn't get it" },
  { value: "understanding", label: "Not sure how" },
  { value: "other", label: "Other" },
];

export function TodaysDoses({ patientId }: { patientId: string }) {
  const { data: medications, isLoading: medsLoading } = useMedications(patientId);
  const { data: logs, isLoading: logsLoading } = useTodaysDoseLogs(patientId);
  const logDose = useLogDose();
  const [pickingReasonFor, setPickingReasonFor] = useState<string | null>(null);

  const isLoading = medsLoading || logsLoading;
  const checklist =
    medications && logs ? buildTodaysDoseChecklist(medications, logs) : [];

  function log(
    medicationId: string,
    time: string,
    organisationId: string,
    status: "taken" | "missed",
    missedReason?: MissedDoseReason
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
    setPickingReasonFor(null);
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
              const pickingReason = pickingReasonFor === rowKey;
              return (
                <li key={rowKey} className="flex flex-col gap-2 py-3">
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
                          onClick={() => setPickingReasonFor(pickingReason ? null : rowKey)}
                        >
                          Missed
                        </Button>
                      </div>
                    )}
                  </div>
                  {pickingReason && medication && (
                    <div className="flex flex-wrap items-center gap-1.5 rounded-lg bg-charcoal-ink/[0.03] p-2.5">
                      <span className="w-full text-xs text-charcoal-ink/60">
                        What got in the way? (Optional — helps your care team help you.)
                      </span>
                      {MISSED_REASON_OPTIONS.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          disabled={logDose.isPending}
                          onClick={() =>
                            log(
                              item.medicationId,
                              item.time,
                              medication.organisation_id,
                              "missed",
                              option.value
                            )
                          }
                          className="rounded-full border border-charcoal-ink/15 bg-white px-3 py-1 text-xs font-medium text-charcoal-ink hover:bg-charcoal-ink/5"
                        >
                          {option.label}
                        </button>
                      ))}
                      <button
                        type="button"
                        disabled={logDose.isPending}
                        onClick={() =>
                          log(item.medicationId, item.time, medication.organisation_id, "missed")
                        }
                        className="rounded-full px-3 py-1 text-xs font-medium text-charcoal-ink/50 hover:text-charcoal-ink/70"
                      >
                        Skip
                      </button>
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
