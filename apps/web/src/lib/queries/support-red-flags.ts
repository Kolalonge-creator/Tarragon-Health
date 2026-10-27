import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";

type LooseSelect = { from(t: string): { select(c: string): PromiseLike<{ data: { ticket_id: string }[] | null; error: unknown }> } };

/**
 * S80d: ids of tickets (or replies on them) that matched the red-flag scan, so the queue can mark them. The table is new and not in the generated
 * types yet, hence the structural cast. A failed read throws (shown as an error), never as "no red flags".
 */
export function useRedFlaggedTicketIds() {
  return useQuery({
    queryKey: ["support-tickets", "red-flagged"] as const,
    queryFn: async () => {
      const { data, error } = await (createClient() as unknown as LooseSelect).from("support_ticket_red_flags").select("ticket_id");
      if (error || !data) throw new Error("could not read red flags");
      return new Set(data.map((r) => r.ticket_id));
    },
    refetchInterval: 60_000,
  });
}
