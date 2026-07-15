"use client";

import { usePatientLabOrders } from "@/lib/queries/lab-orders";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { koboToNaira, type LabOrderStatus } from "@tarragon/shared";
import { PayForLabOrderButton } from "@/components/pay-for-lab-order-button";

const LAB_ORDER_STATUS_BADGE: Record<LabOrderStatus, { variant: BadgeProps["variant"]; label: string }> = {
  pending_payment: { variant: "amber", label: "Awaiting payment" },
  payment_confirmed: { variant: "blue", label: "Booking confirmed" },
  ordered: { variant: "blue", label: "In progress" },
  sample_collected: { variant: "blue", label: "Sample collected" },
  processing: { variant: "blue", label: "In progress" },
  resulted: { variant: "green", label: "Results ready" },
  cancelled: { variant: "grey", label: "Cancelled" },
};

export function LabOrdersList({ patientId }: { patientId: string }) {
  const { data: orders, isLoading, isError } = usePatientLabOrders(patientId);

  if (isLoading || isError || !orders || orders.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your lab orders</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-charcoal-ink/10">
          {orders.map((order) => {
            const badge = LAB_ORDER_STATUS_BADGE[order.status];
            return (
              <li key={order.id} className="space-y-1 py-3">
                <div className="flex items-center gap-2">
                  <Badge variant={badge.variant}>{badge.label}</Badge>
                  <span className="text-xs text-charcoal-ink/60">{order.order_number}</span>
                </div>
                <p className="text-sm font-medium text-charcoal-ink">
                  {order.panel_bundle?.name ?? "Lab test"}
                  {order.provider && <span className="text-charcoal-ink/60"> · {order.provider.name}</span>}
                </p>
                <p className="text-xs text-charcoal-ink/60">₦{koboToNaira(order.total_kobo).toLocaleString()}</p>
                {order.status === "pending_payment" && (
                  <PayForLabOrderButton orderId={order.id} amountKobo={order.total_kobo} />
                )}
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
