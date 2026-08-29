"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useMonitoringEpisodes,
  monitoringEpisodesKey,
  type MonitoringEpisodeWithSchedule,
  type MonitoringScheduleItemWithAdherence,
} from "@/lib/queries/monitoring-episodes";
import {
  startMonitoringEpisode,
  completeMonitoringEpisode,
  cancelMonitoringEpisode,
} from "./monitoring-episode-actions";
import { isClinicalReviewRecommended } from "@/lib/monitoring/adherence";
import {
  MONITORING_PROGRAMME_TEMPLATES,
  MONITORABLE_VITAL_TYPE_LABEL,
  findMonitoringProgrammeTemplate,
  type MonitorableVitalType,
} from "@/lib/monitoring/templates";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

function ScheduleItemSummary({ item }: { item: MonitoringScheduleItemWithAdherence }) {
  const label = MONITORABLE_VITAL_TYPE_LABEL[item.vital_type as MonitorableVitalType] ?? item.vital_type;
  const reviewRecommended = isClinicalReviewRecommended({
    trend: "stable",
    consecutiveMisses: item.consecutive_misses,
    escalationMissedThreshold: item.escalation_missed_threshold,
    adherencePct: item.adherence?.adherence_pct ?? null,
  });

  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-2">
      <div>
        <p className="text-sm font-medium text-charcoal-ink">{label}</p>
        <p className="text-xs text-charcoal-ink/60">
          {item.times_per_day}x every {item.frequency_days === 1 ? "day" : `${item.frequency_days} days`}
          {item.adherence?.adherence_pct != null && ` · Adherence ${item.adherence.adherence_pct}%`}
          {item.last_reading_at &&
            ` · Last reading ${new Date(item.last_reading_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`}
        </p>
      </div>
      {reviewRecommended && <Badge variant="amber">Clinical review: Recommended</Badge>}
    </li>
  );
}

function EpisodeCard({ episode, patientId }: { episode: MonitoringEpisodeWithSchedule; patientId: string }) {
  const queryClient = useQueryClient();
  const [completeState, completeAction, completePending] = useActionState(completeMonitoringEpisode, undefined);
  const [cancelState, cancelAction, cancelPending] = useActionState(cancelMonitoringEpisode, undefined);

  useEffect(() => {
    if (completeState?.success || cancelState?.success) {
      queryClient.invalidateQueries({ queryKey: monitoringEpisodesKey(patientId, false) });
      queryClient.invalidateQueries({ queryKey: monitoringEpisodesKey(patientId, true) });
    }
  }, [completeState?.success, cancelState?.success, queryClient, patientId]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
        <CardTitle className="text-base">{episode.purpose}</CardTitle>
        <Badge
          variant={episode.status === "active" ? "green" : episode.status === "completed" ? "blue" : "grey"}
        >
          {episode.status}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-charcoal-ink/60">
          Started {new Date(episode.started_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
          {episode.ends_at &&
            ` · Ends ${new Date(episode.ends_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`}
          {episode.review_date &&
            ` · Review ${new Date(episode.review_date).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`}
        </p>
        <ul className="divide-y divide-charcoal-ink/10">
          {episode.scheduleItems.map((item) => (
            <ScheduleItemSummary key={item.id} item={item} />
          ))}
        </ul>
        {episode.status === "active" && (
          <div className="flex gap-2">
            <form action={completeAction}>
              <input type="hidden" name="episode_id" value={episode.id} />
              <input type="hidden" name="patient_id" value={patientId} />
              <Button type="submit" size="sm" variant="outline" disabled={completePending}>
                Mark completed
              </Button>
            </form>
            <form action={cancelAction}>
              <input type="hidden" name="episode_id" value={episode.id} />
              <input type="hidden" name="patient_id" value={patientId} />
              <Button type="submit" size="sm" variant="outline" disabled={cancelPending}>
                Cancel
              </Button>
            </form>
          </div>
        )}
        {(completeState?.error || cancelState?.error) && (
          <p className="text-xs text-red-600">{completeState?.error || cancelState?.error}</p>
        )}
      </CardContent>
    </Card>
  );
}

function StartEpisodeForm({ patientId }: { patientId: string }) {
  const [templateKey, setTemplateKey] = useState<string>(MONITORING_PROGRAMME_TEMPLATES[0].key);
  const [state, formAction, pending] = useActionState(startMonitoringEpisode, undefined);
  const queryClient = useQueryClient();

  const template = findMonitoringProgrammeTemplate(templateKey);

  const scheduleItemsJson = useMemo(() => {
    if (!template) return "[]";
    return JSON.stringify(
      template.scheduleItems.map((item) => ({
        vital_type: item.vitalType,
        times_per_day: item.timesPerDay,
        frequency_days: item.frequencyDays,
        escalation_missed_threshold: item.escalationMissedThreshold,
        acceptable_range: item.acceptableRange,
      }))
    );
  }, [template]);

  useEffect(() => {
    if (state?.success) {
      queryClient.invalidateQueries({ queryKey: monitoringEpisodesKey(patientId, false) });
      queryClient.invalidateQueries({ queryKey: monitoringEpisodesKey(patientId, true) });
    }
  }, [state?.success, queryClient, patientId]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Start a monitoring episode</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="space-y-4">
          <input type="hidden" name="patient_id" value={patientId} />
          <input type="hidden" name="schedule_items_json" value={scheduleItemsJson} />

          <div className="space-y-1.5">
            <Label htmlFor="template">Programme</Label>
            <Select
              id="template"
              value={templateKey}
              onChange={(e) => setTemplateKey(e.target.value)}
            >
              {MONITORING_PROGRAMME_TEMPLATES.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.label}
                </option>
              ))}
            </Select>
            <p className="text-xs text-charcoal-ink/60">
              Sets the measurements, frequency, and escalation criteria for this episode — adjust the
              purpose, duration, and review date below.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="purpose">Purpose</Label>
            <Input
              id="purpose"
              name="purpose"
              key={`purpose-${templateKey}`}
              defaultValue={template?.purpose ?? ""}
              maxLength={200}
              required
            />
          </div>

          {template && (
            <input type="hidden" name="condition" value={template.condition ?? ""} />
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="duration_days">Duration (days, blank = ongoing)</Label>
              <Input
                id="duration_days"
                name="duration_days"
                type="number"
                min={1}
                max={365}
                key={`duration-${templateKey}`}
                defaultValue={template?.durationDays ?? ""}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="review_date">Review date (optional)</Label>
              <Input id="review_date" name="review_date" type="date" />
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm text-charcoal-ink">
            <input
              type="checkbox"
              name="tracks_symptoms"
              value="true"
              key={`symptoms-${templateKey}`}
              defaultChecked={template?.trackSymptoms ?? false}
              className="h-4 w-4"
            />
            Also nudge the patient to log how they&apos;re feeling
          </label>

          <ul className="rounded-lg border border-charcoal-ink/10 bg-charcoal-ink/[0.02] p-3 text-xs text-charcoal-ink/70">
            {(template?.scheduleItems ?? []).map((item) => (
              <li key={item.vitalType}>
                {MONITORABLE_VITAL_TYPE_LABEL[item.vitalType]} — {item.timesPerDay}x every{" "}
                {item.frequencyDays === 1 ? "day" : `${item.frequencyDays} days`}, escalate after{" "}
                {item.escalationMissedThreshold} missed reading{item.escalationMissedThreshold === 1 ? "" : "s"}
              </li>
            ))}
          </ul>

          {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
          {state?.success && <p className="text-sm text-brand-green">Monitoring episode started.</p>}

          <Button type="submit" disabled={pending}>
            {pending ? "Starting…" : "Start episode"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

export function MonitoringEpisodesSection({
  patientId,
  canStartEpisode,
}: {
  patientId: string;
  canStartEpisode: boolean;
}) {
  const { data: episodes, isLoading } = useMonitoringEpisodes(patientId);
  const activeEpisodes = (episodes ?? []).filter((e) => e.status === "active");
  const pastEpisodes = (episodes ?? []).filter((e) => e.status !== "active");

  return (
    <div className="space-y-4">
      {!isLoading && activeEpisodes.map((episode) => (
        <EpisodeCard key={episode.id} episode={episode} patientId={patientId} />
      ))}
      {!isLoading && pastEpisodes.length > 0 && (
        <details className="text-sm text-charcoal-ink/70">
          <summary className="cursor-pointer font-medium">
            Past monitoring episodes ({pastEpisodes.length})
          </summary>
          <div className="mt-3 space-y-3">
            {pastEpisodes.map((episode) => (
              <EpisodeCard key={episode.id} episode={episode} patientId={patientId} />
            ))}
          </div>
        </details>
      )}
      {canStartEpisode && <StartEpisodeForm patientId={patientId} />}
    </div>
  );
}
