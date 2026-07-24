"use client";

import { useState } from "react";
import {
  usePatientPharmacyOrders,
  useOrderDispenses,
  useRecordDispense,
  type PharmacyOrderItem,
  type PharmacyOrderWithLogistics,
} from "@/lib/queries/pharmacy-orders";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { koboToNaira, type PharmacyOrderStatus } from "@tarragon/shared";
import { PayForPharmacyOrderButton } from "@/components/pay-for-pharmacy-order-button";
import { PayWithWalletButton } from "@/components/pay-with-wallet-button";
import { DeliveryAvailability } from "@/components/delivery-availability";
import { DeliveryAddressForm } from "@/components/delivery-address-form";

type DeliveryAddress = { street: string; area: string; state: string; phone: string };

/** Patient records what they collected against an order (self-service, works
 * even when the pharmacy doesn't log in). Existing dispense records shown too. */
function OrderDispenses({
  order,
  patientId,
}: {
  order: PharmacyOrderWithLogistics;
  patientId: string;
}) {
  const { data: dispenses } = useOrderDispenses(order.id);
  const record = useRecordDispense();
  const [open, setOpen] = useState(false);
  const [drugName, setDrugName] = useState("");
  const [quantity, setQuantity] = useState("");
  const [dispensedOn, setDispensedOn] = useState(
    new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Lagos" }),
  );

  return (
    <div className="pt-1">
      {dispenses && dispenses.length > 0 && (
        <ul className="mb-1 space-y-0.5">
          {dispenses.map((d) => (
            <li key={d.id} className="text-xs text-charcoal-ink/60">
              Collected: {d.drug_name}
              {d.quantity ? ` × ${d.quantity}` : ""} · {new Date(d.dispensed_on).toLocaleDateString()}
            </li>
          ))}
        </ul>
      )}
      {!open ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs text-charcoal-ink/70"
          onClick={() => setOpen(true)}
        >
          Record what you collected
        </Button>
      ) : (
        <div className="flex flex-wrap items-end gap-2 rounded-md bg-charcoal-ink/5 p-2">
          <div className="min-w-40 flex-1 space-y-1">
            <Label htmlFor={`dispense_drug_${order.id}`} className="text-xs">
              Medication
            </Label>
            <Input
              id={`dispense_drug_${order.id}`}
              value={drugName}
              onChange={(e) => setDrugName(e.target.value)}
              className="h-8 text-xs"
            />
          </div>
          <div className="w-20 space-y-1">
            <Label htmlFor={`dispense_qty_${order.id}`} className="text-xs">
              Quantity
            </Label>
            <Input
              id={`dispense_qty_${order.id}`}
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              className="h-8 text-xs"
            />
          </div>
          <div className="w-36 space-y-1">
            <Label htmlFor={`dispense_date_${order.id}`} className="text-xs">
              Date
            </Label>
            <Input
              id={`dispense_date_${order.id}`}
              type="date"
              value={dispensedOn}
              onChange={(e) => setDispensedOn(e.target.value)}
              className="h-8 text-xs"
            />
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={record.isPending || !drugName.trim()}
            onClick={() =>
              record.mutate(
                {
                  order,
                  drugName: drugName.trim(),
                  quantity: quantity.trim() || null,
                  dispensedOn,
                  source: "patient",
                  recordedBy: patientId,
                },
                {
                  onSuccess: () => {
                    setOpen(false);
                    setDrugName("");
                    setQuantity("");
                  },
                },
              )
            }
          >
            {record.isPending ? "Saving…" : "Save"}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          {record.isError && (
            <p className="basis-full text-xs text-red-600">Could not save. Try again.</p>
          )}
        </div>
      )}
    </div>
  );
}

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
                  <>
                    <PayForPharmacyOrderButton orderId={order.id} amountKobo={order.total_kobo} />
                    <PayWithWalletButton
                      orderType="pharmacy"
                      orderId={order.id}
                      amountKobo={order.total_kobo}
                      patientId={patientId}
                    />
                  </>
                )}
                {order.status === "payment_confirmed" && !order.delivery_address && (
                  <DeliveryAddressForm orderId={order.id} />
                )}
                {(order.delivery_address ||
                  order.status === "confirmed" ||
                  order.status === "dispensed" ||
                  order.status === "out_for_delivery" ||
                  order.status === "delivered") && (
                  <DeliveryAvailability
                    region={(order.delivery_address as unknown as DeliveryAddress | null)?.state ?? null}
                    logisticsPartnerName={order.logistics_partner?.name ?? null}
                    estimatedDeliveryAt={order.estimated_delivery_at}
                    courierReference={order.courier_reference}
                    deliveryConfirmedAt={order.delivery_confirmed_at}
                  />
                )}
                {order.status !== "pending_payment" && order.status !== "cancelled" && (
                  <OrderDispenses order={order} patientId={patientId} />
                )}
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
