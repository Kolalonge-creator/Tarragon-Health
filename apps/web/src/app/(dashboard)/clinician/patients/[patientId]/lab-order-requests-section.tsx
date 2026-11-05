"use client";

import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LoadErrorCard } from "@/components/ui/load-error-card";
import { formatPatientDate } from "@/lib/format-date";
import { useLabOrderReports, usePatientLabOrders } from "@/lib/queries/lab-orders";
import {
  groupReportsByOrder,
  needsConfirmation,
  orderReportState,
  type OrderReportState,
} from "@/lib/lab-orders/report-link";

const STATE_BADGE: Record<OrderReportState, { variant: BadgeProps["variant"]; label: string }> = {
  result_back: { variant: "green", label: "Result back" },
  report_added: { variant: "amber", label: "Report linked, not yet filed" },
  waiting: { variant: "blue", label: "Waiting for result" },
  closed: { variant: "grey", label: "Closed" },
};

/**
 * Request to report, clinician view: every test request for this patient with whether its result is back. A request turns
 * "Result back" when a linked report is filed (or S27 releases its result); "Report suggested" means a report is tied to it only by
 * the patient or the matcher, so a clinician must confirm the link before filing can close the request. The link itself is set or corrected on each document in Result documents below.
 */
export function LabOrderRequestsSection({ patientId }: { patientId: string }) {
  const { data: orders, isLoading, isError } = usePatientLabOrders(patientId);
  const { data: reports } = useLabOrderReports(patientId);

  if (isError) return <LoadErrorCard title="Test requests" what="this patient's test requests" />;
  if (isLoading || !orders || orders.length === 0) return null;

  const reportsByOrder = groupReportsByOrder(reports ?? []);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Test requests</CardTitle>
        <CardDescription>Each request and whether its report has come back.</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-charcoal-ink/10">
          {orders.slice(0, 20).map((order) => {
            const linked = reportsByOrder.get(order.id) ?? [];
            const state = orderReportState(order.status, linked);
            const badge =
              order.status === "cancelled"
                ? { variant: "grey" as const, label: "Cancelled" }
                : state === "report_added" && needsConfirmation(linked)
                  ? { variant: "amber" as const, label: "Report suggested, confirm the link" }
                  : STATE_BADGE[state];
            return (
              <li key={order.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                <Badge variant={badge.variant}>{badge.label}</Badge>
                <span className="font-medium text-charcoal-ink">
                  {order.panel_bundle?.name ?? (order.panel_code ? "Annual health check bundle" : "Lab test")}
                </span>
                <span className="text-xs text-charcoal-ink/60">
                  {order.order_number} · requested {formatPatientDate(order.ordered_at)}
                  {order.resulted_at ? ` · resulted ${formatPatientDate(order.resulted_at)}` : ""}
                </span>
                {linked.length > 0 && (
                  <a href="#result-documents" className="text-xs font-medium text-brand-green hover:underline">
                    {linked.length > 1 ? `${linked.length} linked reports` : "Linked report"} →
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
