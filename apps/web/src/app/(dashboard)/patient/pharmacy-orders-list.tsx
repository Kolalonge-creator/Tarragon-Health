"use client";

import { usePatientPharmacyOrders, type PharmacyOrderItem } from "@/lib/queries/pharmacy-orders";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { koboToNaira, type PharmacyOrderStatus } from "@tarragon/shared";
import { PayForPharmacyOrderButton } from "@/components/pay-for-pharmacy-order-button";

const PHARMACY_ORDER_STATUS_BADGE: Record<PharmacyOrderStatus, { variant: BadgeProps["variant"]; label: string }> = {
  pending_payment: { variant: "amber", label: "Awaiting payment" },
  payment_confirmed: { variant: "blue", label: "Booking confirmed" },
  requested: { variant: "blue", label: "In progress" },
  confirmed: { variant: "blue", label: "In progress" },
  dispensed: { variant: "blue", label: "Dispensed" },
  out_for_delivery: { variant: "blue", label: "Out for delivery" },
  delivered: { variant: "green", label: "Delivered" },
  cancelled: { variant: "grey", label: "Cancelled" },
};

function itemsSummary(items: PharmacyOrderItem[]): string {
  return items.map((item) => `${item.drug_name} × ${item.quantity}`).join(", ");
}

export function PharmacyOrdersList({ patientId }: { patientId: string }) {
  const { data: orders, isLoading, isError } = usePatientPharmacyOrders(patientId);

  if (isLoading || isError || !orders || orders.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your pharmacy orders</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-charcoal-ink/10">
          {orders.map((order) => {
            const badge = PHARMACY_ORDER_STATUS_BADGE[order.status];
            const items = order.items as unknown as PharmacyOrderItem[];
            return (
              <li key={order.id} className="space-y-1 py-3">
                <div className="flex items-center gap-2">
                  <Badge variant={badge.variant}>{badge.label}</Badge>
                  {order.order_number && (
                    <span className="text-xs text-charcoal-ink/60">{order.order_number}</span>
                  )}
                </div>
                <p className="text-sm font-medium text-charcoal-ink">{itemsSummary(items)}</p>
                <p className="text-xs text-charcoal-ink/60">₦{koboToNaira(order.total_kobo).toLocaleString()}</p>
                {order.status === "pending_payment" && (
                  <PayForPharmacyOrderButton orderId={order.id} amountKobo={order.total_kobo} />
                )}
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
