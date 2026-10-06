// S16: the database side of the task handler, over the service-role client.
import type { QueuePorts } from "../_shared/queue/triage-task-handler.ts";
import type { LeadPorts } from "../_shared/queue/lead-handlers.ts";
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

// S18: the database side of the lead handlers, over the service-role client.
export function leadPorts(client: RpcClient): LeadPorts {
  return {
    async onClinicianEvent(clinicalStaffId, eventType) {
      const { error } = await client.rpc("lead_on_clinician_event", { p_staff: clinicalStaffId, p_event: eventType });
      if (error) throw new Error(`lead_on_clinician_event: ${error.message}`);
    },
    async assignForOrder(patientId, orderId) {
      const { error } = await client.rpc("assign_lead_for_event", { p_patient: patientId, p_order: orderId });
      if (error) throw new Error(`assign_lead_for_event: ${error.message}`);
    },
  };
}
