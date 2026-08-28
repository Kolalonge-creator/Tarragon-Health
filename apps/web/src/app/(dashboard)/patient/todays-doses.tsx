"use client";

import { useState } from "react";
import { useMedications, useTodaysDoseLogs, useLogDose, todayIsoDate } from "@/lib/queries/medications";
import { buildTodaysDoseChecklist, type DoseStatus } from "@/lib/medication-schedule/checklist";
import type {
  MedicationAccessBarrierReason,
  MedicationLogStatus,
} from "@/lib/validation/medication-logs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { SEMANTIC_ICON } from "@/lib/icons";

const STATUS_BADGE: Record<DoseStatus, { variant: BadgeProps["variant"]; label: string }> = {
  pending: { variant: "grey", label: "Pending" },
  taken: { variant: "green", label: "Taken" },
  missed: { variant: "red", label: "Missed" },
  skipped: { variant: "amber", label: "Skipped" },
  unable_to_obtain: { variant: "red", label: "Couldn't get it" },
  vomited: { variant: "amber", label: "Vomited/other" },
  side_effect: { variant: "amber", label: "Side effect" },
  other: { variant: "grey", label: "Other" },
};

// 13.5's extra adherence signals beyond taken/missed/skipped, offered from a
// compact secondary control so the two primary buttons stay uncluttered.
const MORE_OPTIONS: { value: Extract<MedicationLogStatus, "unable_to_obtain" | "vomited" | "side_effect" | "other">; label: string }[] = [
  { value: "unable_to_obtain", label: "Couldn't get it" },
  { value: "vomited", label: "Vomited / other circumstance" },
  { value: "side_effect", label: "Felt a side effect" },
  { value: "other", label: "Other reason" },
];

const BARRIER_REASON_OPTIONS: { value: MedicationAccessBarrierReason; label: string }[] = [
  { value: "cost", label: "Cost" },
  { value: "stockout", label: "Not available where I looked" },
  { value: "distance", label: "Too far to get to" },
  { value: "no_transport", label: "No transport" },
  { value: "other", label: "Other" },
];

export function TodaysDoses({ patientId }: { patientId: string }) {
  const { data: medications, isLoading: medsLoading } = useMedications(patientId);
  const { data: logs, isLoading: logsLoading } = useTodaysDoseLogs(patientId);
  const logDose = useLogDose();
  const [openMoreKey, setOpenMoreKey] = useState<string | null>(null);
  const [pendingStatus, setPendingStatus] = useState<
    (typeof MORE_OPTIONS)[number]["value"] | ""
  >("");
  const [barrierReason, setBarrierReason] = useState<MedicationAccessBarrierReason | "">("");

  const isLoading = medsLoading || logsLoading;
  const checklist =
    medications && logs ? buildTodaysDoseChecklist(medications, logs) : [];

  function closeMore() {
    setOpenMoreKey(null);
    setPendingStatus("");
    setBarrierReason("");
  }

  function log(
    medicationId: string,
    time: string,
    organisationId: string,
    status: "taken" | "missed"
  ) {
    logDose.mutate({
      medication_id: medicationId,
      status,
      scheduled_time: time,
      scheduled_for_date: todayIsoDate(),
      patientId,
      organisationId,
    });
  }

  function logMore(medicationId: string, time: string, organisationId: string) {
    if (!pendingStatus) return;
    logDose.mutate(
      {
        medication_id: medicationId,
        status: pendingStatus,
        access_barrier_reason:
          pendingStatus === "unable_to_obtain" && barrierReason ? barrierReason : undefined,
        scheduled_time: time,
        scheduled_for_date: todayIsoDate(),
        patientId,
        organisationId,
      },
      { onSuccess: closeMore }
    );
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
              const itemKey = `${item.medicationId}-${item.time}`;
              const moreOpen = openMoreKey === itemKey;
              return (
                <li key={itemKey} className="space-y-2 py-3">
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
                          onClick={() =>
                            log(item.medicationId, item.time, medication.organisation_id, "missed")
                          }
                        >
                          Missed
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-charcoal-ink/60"
                          onClick={() => (moreOpen ? closeMore() : setOpenMoreKey(itemKey))}
                        >
                          More
                        </Button>
                      </div>
                    )}
                  </div>
                  {moreOpen && medication && (
                    <div className="flex flex-wrap items-end gap-2 rounded-md bg-charcoal-ink/5 p-2">
                      <div className="min-w-40 flex-1 space-y-1">
                        <Select
                          value={pendingStatus}
                          onChange={(event) =>
                            setPendingStatus(
                              event.target.value as (typeof MORE_OPTIONS)[number]["value"] | ""
                            )
                          }
                          className="h-8 text-xs"
                        >
                          <option value="" disabled>
                            What happened?
                          </option>
                          {MORE_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </Select>
                      </div>
                      {pendingStatus === "unable_to_obtain" && (
                        <div className="min-w-40 flex-1 space-y-1">
                          <Select
                            value={barrierReason}
                            onChange={(event) =>
                              setBarrierReason(event.target.value as MedicationAccessBarrierReason)
                            }
                            className="h-8 text-xs"
                          >
                            <option value="" disabled>
                              Why?
                            </option>
                            {BARRIER_REASON_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </Select>
                        </div>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!pendingStatus || logDose.isPending}
                        onClick={() =>
                          logMore(item.medicationId, item.time, medication.organisation_id)
                        }
                      >
                        Log
                      </Button>
                      <Button size="sm" variant="ghost" onClick={closeMore}>
                        Cancel
                      </Button>
                      {pendingStatus === "side_effect" && (
                        <p className="basis-full text-xs text-charcoal-ink/50">
                          For details your care team can act on, use the side-effect report
                          below.
                        </p>
                      )}
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
