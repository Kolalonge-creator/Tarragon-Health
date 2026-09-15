import { z } from "zod";

/**
 * A clinician ordering an imaging investigation for a patient (spec §59.4:
 * "Clinician selects... indication, urgency, relevant clinical information,
 * contraindication information where required"). patient_id/organisation_id
 * are resolved server-side from the target patient's own record, never
 * trusted from this input, and ordering_clinician_id is resolved from the
 * caller's own active clinical_staff record — see createImagingOrder in
 * lib/imaging-orders/actions.ts. The DB itself is the real authority gate
 * (private.has_imaging_ordering_authority): this schema only shapes the
 * input, it does not decide who may order.
 */
export const createImagingOrderSchema = z.object({
  patient_id: z.string().uuid(),
  study_id: z.string().uuid(),
  urgency: z.enum(["routine", "urgent", "emergency"]).default("routine"),
  indication: z.string().trim().min(1, "An indication is required").max(2000),
  clinical_information: z.string().trim().max(4000).optional(),
  contraindication_information: z.string().trim().max(2000).optional(),
});
export type CreateImagingOrderInput = z.infer<typeof createImagingOrderSchema>;

/** Staff cancelling an order — a reason is required (mirrors the DB's own
 * imaging_orders_cancellation_requires_reason CHECK). */
export const cancelImagingOrderSchema = z.object({
  order_id: z.string().uuid(),
  reason: z.string().trim().min(1, "A cancellation reason is required").max(1000),
});
export type CancelImagingOrderInput = z.infer<typeof cancelImagingOrderSchema>;

/** Staff progressing an order through the workflow (§59.7) — the DB's own
 * imaging_orders_stamp_lifecycle trigger stamps the matching timestamp and
 * refuses a transition out of a cancelled/reviewed order; this schema only
 * restricts which statuses a plain "advance" action may set (cancellation
 * goes through cancelImagingOrderSchema instead, since it requires a reason). */
export const advanceImagingOrderStatusSchema = z.object({
  order_id: z.string().uuid(),
  status: z.enum([
    "booked",
    "attended",
    "performed",
    "result_returned",
    "reviewed",
  ]),
});
export type AdvanceImagingOrderStatusInput = z.infer<typeof advanceImagingOrderStatusSchema>;
