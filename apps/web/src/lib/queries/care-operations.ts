import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { getProposedConfig, type ConfigValue } from "@tarragon/shared";
import { createClient } from "@/lib/supabase/client";

/** Read from the same config entry the inbox badge uses, so the dashboard and the inbox agree on what "past target" means. */
const REPLY_TARGET = getProposedConfig<ConfigValue>("care_messages.reply_target").value as unknown as {
  hours: number;
  lookbackDays: number;
};

const count = z.coerce.number().int().nonnegative();

export const careOperationsSummarySchema = z.object({
  messages: z.object({
    new_today: count,
    support_waiting: count,
    clinical_waiting: count,
    needs_doctor: count,
    past_target: count,
    older_unanswered: count,
    unowned_waiting: count,
  }),
  alerts: z.object({
    emergency_open: count,
    urgent_open: count,
    unread_message_alerts_open: count,
  }),
  monthly_meetings: z.object({
    available: count,
    booked: count,
    done: count,
  }),
  workload: z.array(
    z.object({
      staff_id: z.string(),
      name: z.string(),
      role: z.string(),
      is_doctor: z.boolean(),
      waiting: count,
      past_target: count,
      needs_doctor: count,
    })
  ),
  target_hours: count,
  lookback_days: count,
});

export type CareOperationsSummary = z.infer<typeof careOperationsSummarySchema>;

/** Parse the RPC's jsonb. Malformed output is an error, never a half-filled dashboard of confident zeros. */
export function parseCareOperationsSummary(raw: unknown): CareOperationsSummary {
  return careOperationsSummarySchema.parse(raw);
}

/** MSG-5: the care operations summary for the caller's organisation (public.care_operations_summary). Errors throw, so a failed read
 * shows as "could not load" and never as an empty queue. */
export function useCareOperationsSummary() {
  return useQuery({
    queryKey: ["care-operations-summary", REPLY_TARGET.hours, REPLY_TARGET.lookbackDays],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("care_operations_summary", {
        p_target_hours: REPLY_TARGET.hours,
        p_lookback_days: REPLY_TARGET.lookbackDays,
      });
      if (error) throw error;
      return parseCareOperationsSummary(data);
    },
    refetchInterval: 60_000,
  });
}
