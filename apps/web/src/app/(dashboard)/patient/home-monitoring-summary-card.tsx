"use client";

import { useActionState, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useActiveMonitoringEpisodes,
  monitoringEpisodesKey,
  type MonitoringScheduleItemWithAdherence,
} from "@/lib/queries/monitoring-episodes";
import { useVitalsTrend, type VitalsTrendType } from "@/lib/queries/vitals";
import { logMonitoringMissedReason } from "./monitoring-actions";
import { readingDueStatus, monitoringInterpretationCopy, trendDirection } from "@/lib/monitoring/adherence";
import { MONITORABLE_VITAL_TYPE_LABEL, higherIsConcernForVitalType, type MonitorableVitalType } from "@/lib/monitoring/templates";
import { MONITORING_MISSED_REASONS } from "@/lib/validation/monitoring-episodes";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";

/** Only these schedule vital types have a real trend series to read today
 * (useVitalsTrend/VitalsTrendChart don't cover spo2/temperature yet) —
 * everything else quietly skips the interpretation line rather than
 * guessing at a trend with no data behind it. */
const TREND_VALUE_FIELD: Partial<Record<MonitorableVitalType, { trendType: VitalsTrendType; field: string }>> = {
  blood_pressure: { trendType: "blood_pressure", field: "systolic" },
  glucose: { trendType: "glucose", field: "glucose_mmol_l" },
  weight: { trendType: "weight", field: "weight_kg" },
  pulse: { trendType: "pulse", field: "pulse_bpm" },
};

const REASON_LABEL: Record<(typeof MONITORING_MISSED_REASONS)[number], string> = {
  forgot: "I forgot",
  travelling: "I was travelling",
  device_problem: "Problem with my device",
  unwell: "I was feeling unwell",
  no_supplies: "Ran out of supplies",
  other: "Other",
};

function formatReviewDate(value: string | null): string | null {
  if (!value) return null;
  return new Date(value).toLocaleDateString(undefined, { day: "numeric", month: "long" });
}

function MissedReasonPrompt({ scheduleItemId, patientId }: { scheduleItemId: string; patientId: string }) {
  const [state, formAction, pending] = useActionState(logMonitoringMissedReason, undefined);
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (state?.success) {
      queryClient.invalidateQueries({ queryKey: monitoringEpisodesKey(patientId, true) });
    }
  }, [state?.success, queryClient, patientId]);

  // The success message below already short-circuits regardless of `open`,
  // so there's no need to reset it here too.
  if (state?.success) {
    return <p className="text-xs text-brand-green">Thanks — that helps your care team follow up.</p>;
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs font-medium text-charcoal-ink/60 underline hover:text-charcoal-ink"
      >
        Why did you miss this?
      </button>
    );
  }

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="schedule_item_id" value={scheduleItemId} />
      <Select name="reason" defaultValue="forgot" className="h-8 w-44 text-xs" required>
        {MONITORING_MISSED_REASONS.map((reason) => (
          <option key={reason} value={reason}>
            {REASON_LABEL[reason]}
          </option>
        ))}
      </Select>
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Saving…" : "Send"}
      </Button>
      {state?.error && <p className="w-full text-xs text-red-600">{state.error}</p>}
    </form>
  );
}

function ScheduleItemRow({
  item,
  patientId,
}: {
  item: MonitoringScheduleItemWithAdherence;
  patientId: string;
}) {
  const status = readingDueStatus(item.last_reading_at, item.frequency_days);
  const label = MONITORABLE_VITAL_TYPE_LABEL[item.vital_type as MonitorableVitalType] ?? item.vital_type;

  return (
    <li className="space-y-1 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-charcoal-ink">{label}</span>
        <Badge variant={status.done ? "green" : "amber"}>
          {status.done ? `${status.label} ✓` : status.label}
        </Badge>
      </div>
      {item.adherence?.adherence_pct != null && (
        <p className="text-xs text-charcoal-ink/50">
          {item.adherence.received_readings} of {item.adherence.expected_readings} readings so far (
          {item.adherence.adherence_pct}%)
        </p>
      )}
      {item.consecutive_misses >= 2 && (
        <MissedReasonPrompt scheduleItemId={item.id} patientId={patientId} />
      )}
    </li>
  );
}

/**
 * Spec §51.13's non-clinical interpretation line for one schedule item —
 * "Your recent readings have been higher than your usual range..." — driven
 * by the same trend series the trend chart above already plots, split into
 * an earlier/later half so a handful of noisy readings doesn't read as a
 * trend (see trendDirection's deadband).
 */
function ScheduleItemTrendNote({
  patientId,
  vitalType,
  trendType,
  field,
}: {
  patientId: string;
  vitalType: MonitorableVitalType;
  trendType: VitalsTrendType;
  field: string;
}) {
  const { data } = useVitalsTrend(patientId, trendType);
  if (!data) return null;

  const values = data
    .map((row) => (row as unknown as Record<string, number | null>)[field])
    .filter((v): v is number => typeof v === "number");

  const direction = trendDirection(values);
  if (direction === "unknown") return null;

  return (
    <p className="text-xs text-charcoal-ink/60">
      {monitoringInterpretationCopy(direction, higherIsConcernForVitalType(vitalType))}
    </p>
  );
}

/**
 * Patient-facing home monitoring summary (spec §51.2) — today's due/done
 * items across every active monitoring episode, adherence so far, and the
 * next review date. Renders nothing when the patient has no active episode,
 * same pattern as DiabetesDailyLog on this page.
 */
export function HomeMonitoringSummaryCard({ patientId }: { patientId: string }) {
  const { data: episodes, isLoading } = useActiveMonitoringEpisodes(patientId);

  if (isLoading || !episodes || episodes.length === 0) return null;

  return (
    <div className="space-y-4">
      {episodes.map((episode) => {
        const reviewDate = formatReviewDate(episode.review_date);
        return (
          <Card key={episode.id}>
            <CardHeader>
              <CardTitle>Home monitoring — {episode.purpose}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <ul className="divide-y divide-charcoal-ink/10">
                {episode.scheduleItems.map((item) => (
                  <ScheduleItemRow key={item.id} item={item} patientId={patientId} />
                ))}
              </ul>
              {episode.scheduleItems.map((item) => {
                const config = TREND_VALUE_FIELD[item.vital_type as MonitorableVitalType];
                if (!config) return null;
                return (
                  <ScheduleItemTrendNote
                    key={item.id}
                    patientId={patientId}
                    vitalType={item.vital_type as MonitorableVitalType}
                    trendType={config.trendType}
                    field={config.field}
                  />
                );
              })}
              {reviewDate && (
                <p className="text-xs text-charcoal-ink/60">Next review: {reviewDate}</p>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
