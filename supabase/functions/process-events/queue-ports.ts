// S16: the database side of the task handler, over the service-role client.
import type { QueuePorts } from "../_shared/queue/triage-task-handler.ts";
import type { RpcClient } from "./triage-ports.ts";

export function queuePorts(client: RpcClient): QueuePorts {
  return {
    async createFromTriage(triageEventId) {
      const { data, error } = await client.rpc("create_tasks_from_triage_event", { p_triage_event: triageEventId });
      if (error) throw new Error(`create_tasks_from_triage_event: ${error.message}`);
      return typeof data === "number" ? data : 0;
    },
  };
}
