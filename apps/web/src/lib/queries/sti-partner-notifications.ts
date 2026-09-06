import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";

export type StiPartnerNotification = Tables<"sti_partner_notifications">;

export const partnerNotificationsKey = (stiCaseEpisodeId: string) => [
  "sti-partner-notifications",
  stiCaseEpisodeId,
];

/**
 * Partner-notification records for one STI case episode, newest first (spec
 * §47.6). Confidential-by-construction (patient-self or org staff only, see
 * migration 20260829090200) — never surfaced to a sponsor/supporter.
 */
export function usePartnerNotifications(stiCaseEpisodeId: string) {
  return useQuery({
    queryKey: partnerNotificationsKey(stiCaseEpisodeId),
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("sti_partner_notifications")
        .select("*")
        .eq("sti_case_episode_id", stiCaseEpisodeId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as StiPartnerNotification[];
    },
    enabled: !!stiCaseEpisodeId,
  });
}
