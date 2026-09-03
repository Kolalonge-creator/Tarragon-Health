import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ReviewedResultLine } from "@/components/reviewed-result-line";
import { OrderImagingForm } from "./order-imaging-form";
import type { Database } from "@tarragon/shared";

type ImagingOrderStatus = Database["public"]["Enums"]["imaging_order_status"];

const STATUS_BADGE: Record<ImagingOrderStatus, { label: string; variant: "grey" | "blue" | "amber" | "green" | "red" }> = {
  ordered: { label: "Ordered", variant: "grey" },
  booked: { label: "Booked", variant: "blue" },
  attended: { label: "Attended", variant: "blue" },
  performed: { label: "Performed", variant: "amber" },
  reported: { label: "Reported", variant: "amber" },
  result_returned: { label: "Result returned", variant: "amber" },
  reviewed: { label: "Reviewed", variant: "green" },
  cancelled: { label: "Cancelled", variant: "grey" },
};

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/**
 * Clinician view of a patient's imaging orders and filed reports (spec §59,
 * the imaging & diagnostic procedure platform). Order creation is DB-gated
 * (private.has_imaging_ordering_authority: Tier 1-5 or Clinical Director,
 * never a Care Coordinator) — see order-imaging-form.tsx. `canOrder` (pass
 * isClinicalTier(callerStaff) from the page) hides the order form for a
 * Care Coordinator viewer; the list itself stays visible to any org staff,
 * same as the rest of this page's read-only sections.
 */
export async function ImagingOrdersSection({
  patientId,
  canOrder,
}: {
  patientId: string;
  canOrder: boolean;
}) {
  const supabase = await createClient();

  const { data: orders } = await supabase
    .from("imaging_orders")
    .select("id, indication, urgency, status, created_at")
    .eq("patient_id", patientId)
    .order("created_at", { ascending: false });

  const { data: reports } = await supabase
    .from("imaging_reports")
    .select("id, imaging_order_id, modality, body_region, impression, is_abnormal, urgency, reviewed_by, reviewed_at, created_at")
    .eq("patient_id", patientId)
    .order("created_at", { ascending: false });

  const reportsByOrder = new Map<string, NonNullable<typeof reports>>();
  for (const report of reports ?? []) {
    const existing = reportsByOrder.get(report.imaging_order_id) ?? [];
    existing.push(report);
    reportsByOrder.set(report.imaging_order_id, existing);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Imaging & diagnostic procedures</CardTitle>
        <CardDescription>
          X-ray, ultrasound, CT, MRI, mammography, echocardiography and other diagnostic imaging —
          the same safety loop as laboratory results.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {canOrder && <OrderImagingForm patientId={patientId} />}

        {!orders || orders.length === 0 ? (
          <p className="text-sm text-charcoal-ink/60">No imaging ordered yet.</p>
        ) : (
          <ul className="divide-y divide-charcoal-ink/10">
            {orders.map((order) => {
              const orderReports = reportsByOrder.get(order.id) ?? [];
              const status = STATUS_BADGE[order.status];
              return (
                <li key={order.id} className="space-y-2 py-4 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium text-charcoal-ink">{order.indication}</p>
                    <div className="flex items-center gap-1.5">
                      {order.urgency !== "routine" && (
                        <Badge variant={order.urgency === "emergency" ? "red" : "amber"}>
                          {order.urgency}
                        </Badge>
                      )}
                      <Badge variant={status.variant}>{status.label}</Badge>
                    </div>
                  </div>
                  <p className="text-xs text-charcoal-ink/60">Ordered {formatDate(order.created_at)}</p>

                  {orderReports.map((report) => (
                    <div key={report.id} className="rounded border border-charcoal-ink/10 p-2 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-medium text-charcoal-ink">
                          {report.modality} — {report.body_region}
                        </p>
                        {report.is_abnormal && (
                          <Badge variant={report.urgency === "critical" ? "red" : "amber"}>
                            Abnormal — {report.urgency}
                          </Badge>
                        )}
                      </div>
                      <p className="mt-1 text-charcoal-ink/70">{report.impression}</p>
                      {report.reviewed_at && (
                        <div className="mt-1">
                          <ReviewedResultLine reviewedBy={report.reviewed_by} reviewedAt={report.reviewed_at} />
                        </div>
                      )}
                    </div>
                  ))}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
