import type { LabOrderStatus } from "@tarragon/shared";

/**
 * "Your test requests" grouped by where each one stands (patient dashboard 2.0, spec 8.1, gap P12).
 *
 * The groups are ordered by what the patient has to do: a rejected sample first (they must go again), then payment, then the
 * requests waiting on a result, then results that are back, then cancelled. The map is a Record over the status enum, so a
 * new status does not compile until it has a group: a request can never fall out of the list.
 */
export type LabOrderGroupId = "new_sample" | "to_pay" | "waiting" | "back" | "cancelled";

export const LAB_ORDER_GROUPS: readonly { id: LabOrderGroupId; title: string }[] = [
  { id: "new_sample", title: "A new sample is needed" },
  { id: "to_pay", title: "Waiting for payment" },
  { id: "waiting", title: "Waiting for your result" },
  { id: "back", title: "Results back" },
  { id: "cancelled", title: "Cancelled" },
];

export const LAB_ORDER_GROUP_OF: Record<LabOrderStatus, LabOrderGroupId> = {
  sample_rejected: "new_sample",
  pending_payment: "to_pay",
  payment_confirmed: "waiting",
  ordered: "waiting",
  sample_collected: "waiting",
  processing: "waiting",
  resulted: "back",
  cancelled: "cancelled",
};

/** Non-empty groups in display order; within a group the input order (newest first) is kept. */
export function groupLabOrders<T extends { status: LabOrderStatus }>(
  orders: readonly T[],
): { id: LabOrderGroupId; title: string; orders: T[] }[] {
  return LAB_ORDER_GROUPS.map((group) => ({
    ...group,
    orders: orders.filter((order) => LAB_ORDER_GROUP_OF[order.status] === group.id),
  })).filter((group) => group.orders.length > 0);
}
