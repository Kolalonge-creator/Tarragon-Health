import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { ReviewedResultLine } from "@/components/reviewed-result-line";
import { loadDiagnosticRequests, loadDiagnosticReports } from "@/lib/diagnostic-services/documents";
import { ReviewDiagnosticReportForm, MarkDiagnosticReportActionCompleted } from "./review-diagnostic-report-form";
import type { Database } from "@tarragon/shared";

type RequestStatus = Database["public"]["Enums"]["diagnostic_request_status"];

const STATUS_BADGE: Record<RequestStatus, { variant: BadgeProps["variant"]; label: string }> = {
  requested: { variant: "amber", label: "Awaiting booking" },
  booked: { variant: "blue", label: "Booked" },
  attended: { variant: "blue", label: "Attended" },
  reported: { variant: "blue", label: "Report received" },
  reviewed: { variant: "green", label: "Reviewed" },
  actioned: { variant: "green", label: "Actioned" },
  cancelled: { variant: "grey", label: "Cancelled" },
};

const SOURCE_LABEL: Record<string, string> = {
  patient: "Patient uploaded",
  lab_liaison: "Lab liaison",
  clinician: "Clinician",
  admin: "Admin",
};

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/**
 * Clinician view of a patient's diagnostic requests (imaging/ECG/echo/etc.)
 * and their uploaded reports — the module 15 "Request -> Booking ->
 * Attendance -> Imaging -> Report -> Clinical review -> Action" workflow
 * end to end. Mirrors EcgReportDocumentsSection/ResultDocumentsSection's
 * shape: a request-creation form lives alongside this
 * (RequestDiagnosticServiceForm), each report carries its own
 * review-and-file panel inline.
 */
export async function DiagnosticRequestsSection({ patientId }: { patientId: string }) {
  const supabase = await createClient();
  const [requests, reports] = await Promise.all([
    loadDiagnosticRequests(supabase, patientId),
    loadDiagnosticReports(supabase, patientId),
  ]);

  const reportsByRequest = new Map<string, typeof reports>();
  for (const report of reports) {
    const list = reportsByRequest.get(report.diagnosticRequestId) ?? [];
    list.push(report);
    reportsByRequest.set(report.diagnosticRequestId, list);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Diagnostic requests</CardTitle>
        <CardDescription>
          X-ray, ultrasound, CT, MRI, ECG, echocardiography, mammography, and other diagnostic
          services requested for this patient.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {requests.length === 0 ? (
          <p className="text-sm text-charcoal-ink/60">No diagnostic requests yet.</p>
        ) : (
          <ul className="divide-y divide-charcoal-ink/10">
            {requests.map((request) => {
              const badge = STATUS_BADGE[request.status];
              const requestReports = reportsByRequest.get(request.id) ?? [];
              return (
                <li key={request.id} className="space-y-3 py-4 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium text-charcoal-ink">{request.serviceName}</p>
                    <div className="flex items-center gap-2">
                      {request.urgency !== "routine" && (
                        <Badge variant={request.urgency === "emergency" ? "red" : "amber"}>
                          {request.urgency}
                        </Badge>
                      )}
                      <Badge variant={badge.variant}>{badge.label}</Badge>
                    </div>
                  </div>
                  <p className="text-xs text-charcoal-ink/60">
                    {formatDate(request.createdAt)} · Indication: {request.indication}
                  </p>
                  {request.clinicalQuestion && (
                    <p className="text-xs text-charcoal-ink/60">
                      Clinical question: {request.clinicalQuestion}
                    </p>
                  )}
                  {(request.facilityNameFreetext || request.scheduledDate) && (
                    <p className="text-xs text-charcoal-ink/60">
                      {request.facilityNameFreetext ?? "Facility TBC"}
                      {request.scheduledDate ? ` · ${formatDate(request.scheduledDate)}` : ""}
                      {request.preferredTimeOfDay ? ` (${request.preferredTimeOfDay})` : ""}
                    </p>
                  )}

                  {requestReports.length === 0 ? (
                    <p className="text-xs text-charcoal-ink/50">No report uploaded yet.</p>
                  ) : (
                    <ul className="space-y-3 border-t border-charcoal-ink/5 pt-3">
                      {requestReports.map((report) => (
                        <li key={report.id} className="space-y-2">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="text-xs font-medium text-charcoal-ink">
                              {report.originalFilename ?? "Report"}
                            </p>
                            <Badge variant={report.reviewedAt ? "green" : "amber"}>
                              {report.reviewedAt ? "Reviewed" : "Awaiting review"}
                            </Badge>
                          </div>
                          <p className="text-xs text-charcoal-ink/60">
                            {SOURCE_LABEL[report.source] ?? report.source} · {formatDate(report.createdAt)}
                            {report.note ? ` · ${report.note}` : ""}
                          </p>
                          {report.signedUrl && (
                            <a
                              href={report.signedUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="text-xs font-medium text-brand-green hover:underline"
                            >
                              View report
                            </a>
                          )}
                          {report.reviewedAt ? (
                            <div className="space-y-1">
                              <ReviewedResultLine reviewedBy={report.reviewedBy} reviewedAt={report.reviewedAt} />
                              {report.isAbnormal && (
                                <Badge variant={report.abnormalSeverity === "critical" ? "red" : "amber"}>
                                  {report.abnormalSeverity === "critical" ? "Critical finding" : "Abnormal finding"}
                                </Badge>
                              )}
                              {report.impression && (
                                <p className="text-xs text-charcoal-ink/70">Impression: {report.impression}</p>
                              )}
                              {report.acknowledgementStatus === "action_required" && (
                                <MarkDiagnosticReportActionCompleted reportId={report.id} />
                              )}
                            </div>
                          ) : (
                            <ReviewDiagnosticReportForm reportId={report.id} />
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
