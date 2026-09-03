"use client";

import { useSleepSummary, type SleepSummary } from "@/lib/queries/wearable-sleep";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SEMANTIC_ICON } from "@/lib/icons";

function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${hours}h ${rest}m`;
}

const CONSISTENCY_LABEL: Record<SleepSummary["consistency"], string> = {
  consistent: "Fairly consistent night to night",
  somewhat_variable: "Somewhat variable night to night",
  irregular: "Irregular: duration swings a lot night to night",
  unknown: "Not enough nights yet to tell",
};

const TREND_LABEL: Record<SleepSummary["trend"], string> = {
  up: "Trending longer over the last few nights",
  down: "Trending shorter over the last few nights",
  flat: "Holding steady over the last few nights",
  unknown: "Not enough nights yet for a trend",
};

/**
 * 53.8 "Sleep tracking": duration, consistency, trend, sourced from whatever
 * a connected wearable has synced (wearable_readings.sleep_minutes — see
 * lib/queries/wearable-sleep.ts). Renders nothing when nothing has synced
 * yet, same as WearableConnectSection's neighbours on this page — an empty
 * card with a "no data" placeholder would just be noise above the actual
 * Connect card that explains why.
 *
 * The estimate disclaimer is fixed, not conditional: every sleep source this
 * platform ingests today is a consumer wearable's own sleep-stage algorithm
 * (Oura/WHOOP/Fitbit/Garmin/Apple Health/Health Connect), not a clinically
 * validated polysomnography device, so 53.8's "treat as an estimate unless
 * from a validated medical device" always applies here — there is no
 * validated-device branch to add yet.
 */
export function SleepSummaryCard({ patientId }: { patientId: string }) {
  const { data, isLoading } = useSleepSummary(patientId);

  if (isLoading || !data || data.nightsInWindow === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SEMANTIC_ICON.sleep className="h-5 w-5 text-deep-forest dark:text-brand-green-bright" strokeWidth={2} />
          Sleep
        </CardTitle>
        <CardDescription>
          Estimate from your connected wearable, not a clinically validated sleep study.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="font-heading text-2xl font-semibold text-charcoal-ink dark:text-night-ink">
          {data.lastNightMinutes !== null ? formatDuration(data.lastNightMinutes) : "—"}
          <span className="ml-2 text-sm font-normal text-charcoal-ink/60 dark:text-night-ink/60">last night</span>
        </p>
        {data.averageMinutes !== null && (
          <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">
            {formatDuration(data.averageMinutes)} average over the last {data.nightsInWindow}{" "}
            {data.nightsInWindow === 1 ? "night" : "nights"}
          </p>
        )}
        <p className="text-xs text-charcoal-ink/50 dark:text-night-ink/55">{CONSISTENCY_LABEL[data.consistency]}</p>
        <p className="text-xs text-charcoal-ink/50 dark:text-night-ink/55">{TREND_LABEL[data.trend]}</p>
      </CardContent>
    </Card>
  );
}
