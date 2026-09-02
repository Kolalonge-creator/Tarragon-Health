"use client";

import { usePatientLabOrders } from "@/lib/queries/lab-orders";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import type { LabOrderStatus } from "@tarragon/shared";
import { PatientResultUpload } from "@/components/patient-result-upload";
import { EcgReportUpload } from "@/components/ecg-report-upload";
import { RequestPartnerLabVisit } from "@/app/(dashboard)/patient/request-partner-lab-visit";
import { PayForLabOrderButton } from "@/components/pay-for-lab-order-button";

/** Self-arranged: the states that matter to a patient are "we've written it,
 * go when you can" and "the result is in". Payment states are retained in the
 * map because the enum still carries them for the dormant partner path. */
const LAB_ORDER_STATUS_BADGE: Record<LabOrderStatus, { variant: BadgeProps["variant"]; label: string }> = {
  pending_payment: { variant: "amber", label: "Awaiting payment" },
  payment_confirmed: { variant: "blue", label: "Ready to take to a lab" },
  ordered: { variant: "blue", label: "Ready to take to a lab" },
  sample_collected: { variant: "blue", label: "Sample collected" },
  processing: { variant: "blue", label: "In progress" },
  resulted: { variant: "green", label: "Results ready" },
  cancelled: { variant: "grey", label: "Cancelled" },
  sample_rejected: { variant: "red", label: "Sample rejected" },
};

/** Still open: the patient has a request and we're waiting on their result. */
const AWAITING_RESULT: LabOrderStatus[] = ["payment_confirmed", "ordered", "processing"];

export function LabOrdersList({ patientId }: { patientId: string }) {
  const { data: orders, isLoading, isError } = usePatientLabOrders(patientId);

  if (isLoading || isError || !orders || orders.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your test requests</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-charcoal-ink/10">
          {orders.map((order) => {
            const badge = LAB_ORDER_STATUS_BADGE[order.status];
            const awaiting = AWAITING_RESULT.includes(order.status);
            // An ECG is its own physical printout — even in a bundle that
            // also includes blood tests, it doesn't arrive on the same PDF,
            // so it gets its own uploader alongside the generic one rather
            // than instead of it.
            const includesEcg = order.panel_bundle?.test_codes?.includes("ecg_resting") ?? false;
            return (
              <li key={order.id} className="space-y-2 py-3">
                <div className="flex items-center gap-2">
                  <Badge variant={badge.variant}>{badge.label}</Badge>
                  {order.urgency === "urgent" && <Badge variant="red">Urgent</Badge>}
                  <span className="text-xs text-charcoal-ink/60">{order.order_number}</span>
                </div>
                <p className="text-sm font-medium text-charcoal-ink">
                  {order.panel_bundle?.name ?? "Lab test"}
                </p>
                {/* Null-gated: only a clinician-generated order ever sets
                    ordered_by, so this line is absent for a self-service
                    due-screening order rather than showing "Ordered by"
                    with nothing after it. */}
                {order.ordered_by_staff && (
                  <p className="text-xs text-charcoal-ink/60">
                    Ordered by Dr. {order.ordered_by_staff.full_name}
                  </p>
                )}
                {order.clinical_indication && (
                  <p className="text-xs text-charcoal-ink/60">Reason: {order.clinical_indication}</p>
                )}
                {order.panel_bundle?.preparation_instructions && (
                  <p className="rounded-lg border border-blue-200 bg-blue-50 p-2 text-xs text-blue-900">
                    {order.panel_bundle.preparation_instructions}
                  </p>
                )}
                {order.status === "pending_payment" && (
                  <PayForLabOrderButton orderId={order.id} amountKobo={order.total_kobo} />
                )}
                {awaiting && (
                  <>
                    <a
                      href={`/api/patient/lab-order/${order.id}/request`}
                      className="inline-block text-xs font-medium text-brand-green hover:underline"
                    >
                      Download the request to take with you
                    </a>
                    <PatientResultUpload
                      labOrderId={order.id}
                      label={includesEcg ? "Upload your blood/lab results" : "Upload your result"}
                    />
                    {includesEcg && (
                      <EcgReportUpload labOrderId={order.id} label="Upload your 12-lead ECG" />
                    )}
                    {/* Optional upgrade, not a required step — the download
                        link above already works with zero partners on
                        file. See request-partner-lab-visit.tsx. */}
                    {order.fulfilment === "self_arranged" && order.status === "ordered" && (
                      <RequestPartnerLabVisit patientId={patientId} orderId={order.id} />
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
