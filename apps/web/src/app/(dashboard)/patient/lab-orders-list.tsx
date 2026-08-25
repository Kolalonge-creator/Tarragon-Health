"use client";

import { usePatientLabOrders } from "@/lib/queries/lab-orders";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { koboToNaira, type LabOrderStatus } from "@tarragon/shared";
import { PatientResultUpload } from "@/components/patient-result-upload";
import { PayForLabOrderButton } from "@/components/pay-for-lab-order-button";
import { RedeemVoucherButton } from "@/components/redeem-voucher-button";
import { HomeCollectionAvailability } from "@/components/home-collection-availability";
import { ChooseLabFacility } from "./choose-lab-facility";
import { RequestPartnerLabVisit } from "@/app/(dashboard)/patient/request-partner-lab-visit";
import type { PatientLocation } from "./facility-selector";

/** Restored 2026-08-25: partner-fulfilled is the labels a patient sees for a
 * new order (Synlab). self_arranged labels are kept for any order booked
 * before then that's still open — the enum/labels stay dormant, not deleted. */
const LAB_ORDER_STATUS_BADGE: Record<LabOrderStatus, { variant: BadgeProps["variant"]; label: string }> = {
  pending_payment: { variant: "amber", label: "Awaiting payment" },
  payment_confirmed: { variant: "blue", label: "Booking confirmed" },
  ordered: { variant: "blue", label: "In progress" },
  sample_collected: { variant: "blue", label: "Sample collected" },
  processing: { variant: "blue", label: "In progress" },
  resulted: { variant: "green", label: "Results ready" },
  cancelled: { variant: "grey", label: "Cancelled" },
};

/** Self-arranged-only labels, used instead of the map above for any
 * still-open order booked before the 2026-08-25 partner-lab restore. */
const SELF_ARRANGED_STATUS_LABEL: Partial<Record<LabOrderStatus, string>> = {
  payment_confirmed: "Ready to take to a lab",
  ordered: "Ready to take to a lab",
};

const SELF_ARRANGED_AWAITING_RESULT: LabOrderStatus[] = ["payment_confirmed", "ordered", "processing"];

export function LabOrdersList({
  patientId,
  patientLocation,
}: {
  patientId: string;
  patientLocation?: PatientLocation | null;
}) {
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
            const isSelfArranged = order.fulfilment === "self_arranged";
            const badge = LAB_ORDER_STATUS_BADGE[order.status];
            const label = (isSelfArranged && SELF_ARRANGED_STATUS_LABEL[order.status]) || badge.label;

            return (
              <li key={order.id} className="space-y-2 py-3">
                <div className="flex items-center gap-2">
                  <Badge variant={badge.variant}>{label}</Badge>
                  <span className="text-xs text-charcoal-ink/60">{order.order_number}</span>
                </div>
                <p className="text-sm font-medium text-charcoal-ink">
                  {order.panel_bundle?.name ?? "Lab test"}
                  {order.facility ? (
                    <span className="text-charcoal-ink/60"> · {order.facility.name}</span>
                  ) : (
                    order.provider && <span className="text-charcoal-ink/60"> · {order.provider.name}</span>
                  )}
                </p>
                {!isSelfArranged && (
                  <p className="text-xs text-charcoal-ink/60">₦{koboToNaira(order.total_kobo).toLocaleString()}</p>
                )}

                {isSelfArranged ? (
                  // Dormant path: kept only for an order booked before the
                  // 2026-08-25 partner-lab restore. Nothing in the app
                  // creates a new self-arranged lab order any more.
                  SELF_ARRANGED_AWAITING_RESULT.includes(order.status) && (
                    <>
                      <a
                        href={`/api/patient/lab-order/${order.id}/request`}
                        className="inline-block text-xs font-medium text-brand-green hover:underline"
                      >
                        Download the request to take with you
                      </a>
                      <PatientResultUpload labOrderId={order.id} />
                      {order.status === "ordered" && (
                        <RequestPartnerLabVisit patientId={patientId} orderId={order.id} />
                      )}
                    </>
                  )
                ) : (
                  <>
                    {order.status === "pending_payment" &&
                      (order.facility_id ? (
                        <>
                          <PayForLabOrderButton orderId={order.id} amountKobo={order.total_kobo} />
                          <RedeemVoucherButton
                            orderType="lab"
                            orderId={order.id}
                            patientId={patientId}
                            panelBundleId={order.panel_bundle_id}
                            payableKobo={order.payable_kobo ?? order.total_kobo}
                          />
                        </>
                      ) : (
                        <ChooseLabFacility orderId={order.id} patientId={patientId} patientLocation={patientLocation} />
                      ))}
                    {(order.status === "payment_confirmed" || order.status === "ordered") && (
                      <>
                        <HomeCollectionAvailability
                          region={order.provider?.regions?.[0] ?? null}
                          homeVisitProviderName={order.home_visit_provider?.name ?? null}
                          homeVisitScheduledAt={order.home_visit_scheduled_at}
                        />
                        <PatientResultUpload labOrderId={order.id} />
                      </>
                    )}
                  </>
                )}
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
