"use client";

import { useState } from "react";
import { useMedications, useTodaysDoseLogs, useLogDose, todayIsoDate } from "@/lib/queries/medications";
import { buildTodaysDoseChecklist, type DoseStatus } from "@/lib/medication-schedule/checklist";
import type { MedicationLogReasonCode } from "@/lib/validation/medication-logs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { SEMANTIC_ICON } from "@/lib/icons";

const STATUS_BADGE: Record<DoseStatus, { variant: BadgeProps["variant"]; label: string }> = {
  pending: { variant: "grey", label: "Pending" },
  taken: { variant: "green", label: "Taken" },
  missed: { variant: "red", label: "Missed" },
  skipped: { variant: "amber", label: "Skipped" },
  unconfirmed: { variant: "blue", label: "Unconfirmed" },
};

/** Non-judgmental "why" picker, shown on "Didn't take it" — a quick pick
 * beats a blank text box for getting an honest answer (self-report
 * literature: patients under-disclose intentional non-adherence when logging
 * feels like being graded). 'felt_fine' is the one deliberate-skip option, so
 * it logs status='skipped' instead of 'missed' — everything else is an
 * unintentional miss and still counts toward the coach/doctor escalation
 * ladder (private.evaluate_adherence_escalation). */
const REASON_OPTIONS: {
  code: MedicationLogReasonCode;
  label: string;
  status: "missed" | "skipped";
}[] = [
  { code: "forgot", label: "Forgot", status: "missed" },
  { code: "ran_out", label: "Ran out", status: "missed" },
  { code: "side_effects", label: "Side effects", status: "missed" },
  { code: "cost", label: "Couldn't afford it", status: "missed" },
  { code: "felt_fine", label: "Chose to skip (felt fine / doctor's OK)", status: "skipped" },
  { code: "other", label: "Other reason", status: "missed" },
];

export function TodaysDoses({ patientId }: { patientId: string }) {
  const { data: medications, isLoading: medsLoading } = useMedications(patientId);
  const { data: logs, isLoading: logsLoading } = useTodaysDoseLogs(patientId);
  const logDose = useLogDose();
  const [reasonPickerFor, setReasonPickerFor] = useState<string | null>(null);

  const isLoading = medsLoading || logsLoading;
  const checklist =
    medications && logs ? buildTodaysDoseChecklist(medications, logs) : [];

  function log(
    medicationId: string,
    time: string,
    organisationId: string,
    status: "taken" | "missed" | "skipped",
    reasonCode?: MedicationLogReasonCode
  ) {
    logDose.mutate({
      medication_id: medicationId,
      status,
      reason_code: reasonCode,
      scheduled_time: time,
      scheduled_for_date: todayIsoDate(),
      patientId,
      organisationId,
    });
    setReasonPickerFor(null);
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
              const pickerOpen = reasonPickerFor === rowKey;
              return (
                <li key={rowKey} className="space-y-2 py-3">
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
                          onClick={() => setReasonPickerFor(pickerOpen ? null : rowKey)}
                        >
                          Didn&apos;t take it
                        </Button>
                      </div>
                    )}
                  </div>
                  {pickerOpen && medication && (
                    <div className="flex flex-wrap gap-2 rounded-md border border-charcoal-ink/10 bg-warm-ivory/60 p-2">
                      <span className="w-full text-xs text-charcoal-ink/60">
                        No judgment — just helps your care team know what&apos;s going on.
                      </span>
                      {REASON_OPTIONS.map((option) => (
                        <Button
                          key={option.code}
                          size="sm"
                          variant="ghost"
                          className="h-7 rounded-full border border-charcoal-ink/15 bg-white px-3 text-xs"
                          disabled={logDose.isPending}
                          onClick={() =>
                            log(
                              item.medicationId,
                              item.time,
                              medication.organisation_id,
                              option.status,
                              option.code
                            )
                          }
                        >
                          {option.label}
                        </Button>
                      ))}
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
