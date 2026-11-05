import type { LabOrderStatus } from "@tarragon/shared";

/**
 * Request to report (migration 20261105164553_lab_order_report_link): a returned report's intake row
 * (clinical_documents.lab_order_id) names the test request it answers. These helpers turn that link into
 * what a patient or clinician sees on the request. The database decides when a request is "resulted";
 * nothing here closes one.
 */

/** A clinical_documents row linked to a request, as read through the caller's own RLS. */
export type LinkedReport = {
  id: string;
  labOrderId: string;
  status: string;
  createdAt: string;
};

export type OrderReportState = "result_back" | "report_added" | "waiting" | "closed";

/** Request statuses where a report is still expected. */
export const REPORT_EXPECTED_STATUSES: readonly LabOrderStatus[] = [
  "payment_confirmed",
  "ordered",
  "sample_collected",
  "processing",
];

/**
 * What the request shows about its report:
 *  - result_back: the request is resulted (a linked report was filed, or S27 released its result);
 *  - report_added: at least one report is linked but the request is not closed yet;
 *  - waiting: a report is still expected and none is linked;
 *  - closed: nothing to say (cancelled, unpaid, or a rejected sample).
 */
export function orderReportState(orderStatus: LabOrderStatus, reports: readonly LinkedReport[]): OrderReportState {
  if (orderStatus === "resulted") return "result_back";
  if (!REPORT_EXPECTED_STATUSES.includes(orderStatus)) return "closed";
  return reports.length > 0 ? "report_added" : "waiting";
}

/** Reports grouped by the request they answer, newest first within each request. */
export function groupReportsByOrder(reports: readonly LinkedReport[]): Map<string, LinkedReport[]> {
  const byOrder = new Map<string, LinkedReport[]>();
  for (const report of reports) {
    const list = byOrder.get(report.labOrderId) ?? [];
    list.push(report);
    byOrder.set(report.labOrderId, list);
  }
  for (const list of byOrder.values()) {
    list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  return byOrder;
}

/** Plain-English line for each state. Patient-facing: no "your doctor", no em dashes. */
export const ORDER_REPORT_LABEL: Record<Exclude<OrderReportState, "closed">, string> = {
  result_back: "Result back",
  report_added: "Report added, waiting to be checked",
  waiting: "Waiting for your result",
};

/** Turns a refusal from public.link_clinical_document_to_lab_order into a sentence a person can act on. */
export function linkErrorMessage(error: { code?: string; message?: string } | null | undefined): string {
  const message = error?.message ?? "";
  if (message.includes("lab_order_link_order_not_open")) {
    return "That test request is cancelled or not paid, so a report cannot be filed against it.";
  }
  if (message.includes("lab_order_link_not_this_patient")) {
    return "That test request belongs to someone else.";
  }
  if (error?.code === "42501") return "You cannot change this report.";
  if (error?.code === "28000") return "Sign in again to continue.";
  return "Could not save that. Try again.";
}
