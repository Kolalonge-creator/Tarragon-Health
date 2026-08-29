import type { BadgeProps } from "@/components/ui/badge";

/** pharmacy_order_status is wider than the pharmacist needs to distinguish
 * (payment sub-states aren't theirs to act on) — this buckets the real enum
 * down to the three states the design shows, without renaming or touching
 * the enum itself. */
export const STATUS_META: Record<string, { label: string; badge: BadgeProps["variant"] }> = {
  pending_payment: { label: "Awaiting", badge: "amber" },
  payment_confirmed: { label: "Awaiting", badge: "amber" },
  requested: { label: "Awaiting", badge: "amber" },
  confirmed: { label: "In progress", badge: "blue" },
  unavailable: { label: "Unavailable", badge: "amber" },
  dispensed: { label: "Dispensed", badge: "green" },
  out_for_delivery: { label: "Dispensed", badge: "green" },
  delivery_failed: { label: "Delivery failed", badge: "red" },
  delivered: { label: "Dispensed", badge: "green" },
  cancelled: { label: "Cancelled", badge: "grey" },
};

const COMPLETE_STATUSES = new Set(["dispensed", "out_for_delivery", "delivery_failed", "delivered", "cancelled"]);
const AWAITING_STATUSES = new Set(["pending_payment", "payment_confirmed", "requested"]);

export function isOpenStatus(status: string): boolean {
  return !COMPLETE_STATUSES.has(status);
}

export function isAwaitingStatus(status: string): boolean {
  return AWAITING_STATUSES.has(status);
}

export function statusMeta(status: string) {
  return STATUS_META[status] ?? { label: status, badge: "grey" as const };
}
