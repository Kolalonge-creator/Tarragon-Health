// S58: the database side of the points handler, over the service-role client.
import type { PointsPorts } from "../_shared/rewards/points-handler.ts";
import type { RpcClient } from "./triage-ports.ts";

export function pointsPorts(client: RpcClient): PointsPorts {
  return {
    async award(eventId) {
      const { data, error } = await client.rpc("points_award", { p_event_id: eventId });
      if (error) throw new Error(`points_award: ${error.message}`);
      return typeof data === "number" ? data : 0;
    },
  };
}
