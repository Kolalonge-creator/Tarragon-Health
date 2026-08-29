"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Database } from "@tarragon/shared";

export type MonitoringEpisode = Database["public"]["Tables"]["monitoring_episodes"]["Row"];
export type MonitoringScheduleItem = Database["public"]["Tables"]["monitoring_schedule_items"]["Row"];
export type MonitoringAdherenceRow = Database["public"]["Views"]["monitoring_schedule_adherence"]["Row"];

export type MonitoringScheduleItemWithAdherence = MonitoringScheduleItem & {
  adherence: MonitoringAdherenceRow | null;
};

export type MonitoringEpisodeWithSchedule = MonitoringEpisode & {
  scheduleItems: MonitoringScheduleItemWithAdherence[];
};

export function monitoringEpisodesKey(patientId: string, activeOnly: boolean) {
  return ["monitoring-episodes", patientId, activeOnly] as const;
}

/**
 * One episode -> its schedule items -> each item's adherence row, fetched as
 * three flat queries and joined client-side (rather than a single nested
 * PostgREST select) so this doesn't depend on Supabase codegen's reverse-
 * relationship metadata for the brand-new monitoring_* tables/view.
 */
export function useMonitoringEpisodes(patientId: string, options?: { activeOnly?: boolean }) {
  const supabase = createClient();
  const activeOnly = options?.activeOnly ?? false;

  return useQuery({
    queryKey: monitoringEpisodesKey(patientId, activeOnly),
    queryFn: async (): Promise<MonitoringEpisodeWithSchedule[]> => {
      let query = supabase
        .from("monitoring_episodes")
        .select("*")
        .eq("patient_id", patientId)
        .order("started_at", { ascending: false });
      if (activeOnly) query = query.eq("status", "active");

      const { data: episodes, error } = await query;
      if (error) throw error;
      if (!episodes || episodes.length === 0) return [];

      const episodeIds = episodes.map((episode) => episode.id);

      const { data: items, error: itemsError } = await supabase
        .from("monitoring_schedule_items")
        .select("*")
        .in("episode_id", episodeIds);
      if (itemsError) throw itemsError;

      const { data: adherenceRows } = await supabase
        .from("monitoring_schedule_adherence")
        .select("*")
        .in("episode_id", episodeIds);

      const adherenceByItemId = new Map(
        (adherenceRows ?? [])
          .filter((row): row is MonitoringAdherenceRow & { schedule_item_id: string } => row.schedule_item_id != null)
          .map((row) => [row.schedule_item_id, row])
      );

      return episodes.map((episode) => ({
        ...episode,
        scheduleItems: (items ?? [])
          .filter((item) => item.episode_id === episode.id)
          .map((item) => ({ ...item, adherence: adherenceByItemId.get(item.id) ?? null })),
      }));
    },
  });
}

export function useActiveMonitoringEpisodes(patientId: string) {
  return useMonitoringEpisodes(patientId, { activeOnly: true });
}
