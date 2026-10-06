// S18: event bus handlers for lead clinician assignment and for a clinician leaving duty (spec 7.1 tail, 7.5).
//
// Thin on purpose: the database functions decide everything (who may lead, the ranking, the reassignment, the
// rota strip). These handlers only refuse what a retry cannot fix and call the service-role functions. Both are
// safe to run twice: assignment is idempotent per patient and the removal handler acts on the clinician's live
// state, so a late or repeated event changes nothing.

import { PermanentHandlerError, type BusEvent, type Handler, type HandlerContext } from "../event-bus/dispatch.ts";

export const LEAD_CLINICIAN_EVENT_HANDLER_KEY = "lead.clinician_event";
export const LEAD_ORDER_PAID_HANDLER_KEY = "lead.assign_on_order_paid";

export interface LeadPorts {
  /** Calls public.lead_on_clinician_event(staff, event type). Moves leads, work, hours and rota when the clinician is no longer fit. */
  onClinicianEvent(clinicalStaffId: string, eventType: string): Promise<void>;
  /** Calls public.assign_lead_for_event(patient, order). Idempotent: a patient who already has a valid lead keeps them. */
  assignForOrder(patientId: string, orderId: string | null): Promise<void>;
}

export function makeClinicianEventHandler(ports: LeadPorts): Handler {
  return async (event: BusEvent, _ctx: HandlerContext): Promise<void> => {
    const id = event.payload["clinical_staff_id"];
    if (typeof id !== "string" || id.length === 0) {
      throw new PermanentHandlerError(`${event.eventType} payload has no clinical_staff_id`);
    }
    await ports.onClinicianEvent(id, event.eventType);
  };
}

// Only a paid care pack gets a lead (spec 7.5). order.paid (S25) will carry care_pack = true for one; until a producer
// exists nothing reaches this handler, and an order that is not a care pack is ignored rather than guessed at.
export function makeOrderPaidLeadHandler(ports: LeadPorts): Handler {
  return async (event: BusEvent, _ctx: HandlerContext): Promise<void> => {
    if (event.payload["care_pack"] !== true) return;
    if (!event.patientId) throw new PermanentHandlerError("order.paid for a care pack has no patient");
    const order = event.payload["order_id"];
    await ports.assignForOrder(event.patientId, typeof order === "string" && order.length > 0 ? order : null);
  };
}
