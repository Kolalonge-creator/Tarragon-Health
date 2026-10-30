"use client";

import { ScreeningDisclaimer } from "@/components/screening-disclaimer";
import { useState } from "react";
import { useScreeningSchedules, useMyScreeningRequests, screeningRequestPhase } from "@/lib/queries/screening";
import { PatientResultUpload } from "@/components/patient-result-upload";
import { todayIsoDate } from "@/lib/queries/medications";
import { useLabCatalogue, useCreateLabOrder, findSingleTestBundle } from "@/lib/queries/lab-orders";
import { ConfirmScreeningDoneForm } from "./confirm-screening-done-form";
import { DeclineScreeningForm } from "./decline-screening-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SEMANTIC_ICON } from "@/lib/icons";

import { formatPatientDate } from "@/lib/format-date";
const STATUS_BADGE: Record<string, { variant: BadgeProps["variant"]; label: string }> = {
  pending: { variant: "amber", label: "Pending" },
  booked: { variant: "blue", label: "Booked" },
  completed: { variant: "green", label: "Completed" },
  overdue: { variant: "red", label: "Overdue" },
  declined: { variant: "grey", label: "Declined" },
};

export function PreventiveScreeningCalendar({
  patientId,
  organisationId,
  bookingEnabled,
}: {
  patientId: string;
  organisationId: string | null;
  /** 'lab_coordination' feature — issuing a test request for a due screening is
   * the same lab action the catalogue always was, so it's gated the same way. */
  bookingEnabled: boolean;
}) {
  const { data, isLoading, isError } = useScreeningSchedules(patientId);
  const { data: requests } = useMyScreeningRequests(patientId);
  const requestBySchedule = new Map((requests ?? []).map((r) => [r.schedule_id, r]));
  const { data: bundles } = useLabCatalogue();
  const createOrder = useCreateLabOrder();
  const [printError, setPrintError] = useState<string | null>(null);
  const today = todayIsoDate();

  const canBook = bookingEnabled && !!organisationId;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SEMANTIC_ICON.preventive className="h-5 w-5 text-deep-forest dark:text-brand-green-bright" strokeWidth={2} aria-hidden />
          Preventive screening calendar
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading && <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">Loading…</p>}
        {isError && (
          <p className="text-sm text-red-600 dark:text-red-300">We could not load your screening calendar. Please try again shortly.</p>
        )}
        {data && data.length === 0 && (
          <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">
            No screenings scheduled yet. Complete your health profile (the two-minute risk
            assessment on this page). Your personal calendar is then created from your age,
            sex and history, and your care team can add to it.
          </p>
        )}
        {data && data.length > 0 && (
          <ul className="divide-y divide-charcoal-ink/10 dark:divide-night-ink/15">
            {data.map((schedule) => {
              const isOverdue =
                schedule.due_date < today &&
                (schedule.status === "pending" || schedule.status === "booked");
              const badge = STATUS_BADGE[isOverdue ? "overdue" : schedule.status] ??
                STATUS_BADGE.pending;
              const isDue =
                schedule.due_date <= today &&
                (schedule.status === "pending" || schedule.status === "overdue");
              const bundle =
                schedule.screen_type?.code && bundles
                  ? findSingleTestBundle(bundles, schedule.screen_type.code)
                  : null;
              const canDecline =
                schedule.status === "pending" ||
                schedule.status === "booked" ||
                schedule.status === "overdue";

              const request = requestBySchedule.get(schedule.id);
              const phase = screeningRequestPhase(request);

              return (
                <li key={schedule.id} className="space-y-2 py-3">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-charcoal-ink dark:text-night-ink">
                      {schedule.screen_type?.name ?? "Screening"}
                    </p>
                    <Badge variant={badge.variant}>{badge.label}</Badge>
                    {schedule.is_recall && <Badge variant="amber">Repeat requested</Badge>}
                  </div>
                  <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
                    Due {formatPatientDate(schedule.due_date)}
                  </p>
                  {schedule.is_recall && schedule.recall_reason && (
                    <p className="text-xs text-charcoal-ink/70 dark:text-night-ink/70">
                      Your care team asked you to repeat this: {schedule.recall_reason}
                    </p>
                  )}
                  {schedule.status === "declined" && schedule.declined_reason && (
                    <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
                      You declined this: {schedule.declined_reason}
                    </p>
                  )}
                  {request && phase === "awaiting_result" && (
                    <div className="space-y-2" data-testid="screening-request-ready">
                      <p className="text-xs font-medium text-charcoal-ink dark:text-night-ink">Your test request is ready.</p>
                      <a
                        href={`/api/patient/lab-order/${request.lab_order_id}/request`}
                        className="inline-block text-xs font-medium text-brand-green dark:text-brand-green-bright hover:underline"
                      >
                        Download the request (PDF)
                      </a>
                      <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
                        Take it to any laboratory you like and pay them directly, then upload your result here.
                      </p>
                      <PatientResultUpload labOrderId={request.lab_order_id} label="Upload your result" />
                    </div>
                  )}
                  {request && phase === "result_received" && (
                    <p className="text-xs text-charcoal-ink/70 dark:text-night-ink/70" data-testid="screening-result-received">
                      Result received. Your care team will review it. It is your own upload, not yet checked by a doctor.
                    </p>
                  )}
                  {request && phase === "reviewed" && (
                    <p className="text-xs text-charcoal-ink/70 dark:text-night-ink/70" data-testid="screening-result-reviewed">
                      Your care team has reviewed your result.
                    </p>
                  )}
                  {isDue && canBook && bundle && !request && (
                    <div className="space-y-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={createOrder.isPending}
                        onClick={() => {
                          setPrintError(null);
                          createOrder.mutate(
                            {
                              organisationId: organisationId!,
                              patientId,
                              panelBundleId: bundle.id,
                              screeningScheduleId: schedule.id,
                            },
                            {
                              onSuccess: (order) => {
                                if (!order?.id) return;
                                const win = window.open(`/api/patient/lab-order/${order.id}/request`, "_blank");
                                if (!win) {
                                  setPrintError(
                                    "Your request is ready below under “Your test requests” — your browser blocked the automatic print, so use the download link there instead."
                                  );
                                }
                              },
                            }
                          );
                        }}
                      >
                        {createOrder.isPending ? "Getting your form ready…" : "Get & print this test"}
                      </Button>
                      <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
                        We will open a printable request that lists exactly which tests are needed. Take it
                        to any laboratory you like and pay them directly, then upload the result here
                        for your care team to read.
                      </p>
                      {createOrder.isError && (
                        <p className="text-xs text-red-600 dark:text-red-300">
                          We could not set that up just now. Please try again.
                        </p>
                      )}
                      {printError && <p className="text-xs text-amber-700 dark:text-amber-300">{printError}</p>}
                    </div>
                  )}
                  <div className="flex flex-wrap items-start gap-2">
                    <ConfirmScreeningDoneForm
                      patientId={patientId}
                      scheduleId={schedule.id}
                      screenTypeId={schedule.screen_type_id}
                      screenTypeName={schedule.screen_type?.name ?? "screening"}
                      alreadyCompleted={schedule.status === "completed"}
                    />
                    {canDecline && (
                      <DeclineScreeningForm patientId={patientId} scheduleId={schedule.id} />
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <ScreeningDisclaimer className="mt-3" />
      </CardContent>
    </Card>
  );
}
