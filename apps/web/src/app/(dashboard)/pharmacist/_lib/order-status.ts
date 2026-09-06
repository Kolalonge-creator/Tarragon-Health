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
  dispensed: { label: "Dispensed", badge: "green" },
  out_for_delivery: { label: "Dispensed", badge: "green" },
  delivered: { label: "Dispensed", badge: "green" },
  cancelled: { label: "Cancelled", badge: "grey" },
};

const COMPLETE_STATUSES = new Set(["dispensed", "out_for_delivery", "delivered", "cancelled"]);
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

/**
 * Pharmacy Engine spec §12.5 — a paid order the pharmacist has not yet
 * accepted or declined. 'requested' is included for completeness (no write
 * path sets it today, per docs/PHARMACY_ENGINE_SPEC.md's own audit) so the
 * accept/decline controls would still work if that ever changes.
 */
export function needsPharmacistResponse(status: string): boolean {
  return status === "payment_confirmed" || status === "requested";
}
