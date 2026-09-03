"use client";

import { useScreeningSchedules } from "@/lib/queries/screening";
import { todayIsoDate } from "@/lib/queries/medications";
import {
  useLabCatalogue,
  useCreateLabOrder,
  useScreenTypePrices,
  bundleIsPartnerBillable,
  findSingleTestBundle,
} from "@/lib/queries/lab-orders";
import { ConfirmScreeningDoneForm } from "./confirm-screening-done-form";
import { DeclineScreeningForm } from "./decline-screening-form";
import { PartnerLabBillingOption } from "./partner-lab-billing-option";
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
  const { data: bundles } = useLabCatalogue();
  const { data: screenTypePrices } = useScreenTypePrices();
  const createOrder = useCreateLabOrder();
  const today = todayIsoDate();

  const canBook = bookingEnabled && !!organisationId;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SEMANTIC_ICON.preventive className="h-5 w-5 text-deep-forest" strokeWidth={2} />
          Preventive screening calendar
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
        {isError && (
          <p className="text-sm text-red-600">Could not load your screening calendar.</p>
        )}
        {data && data.length === 0 && (
          <p className="text-sm text-charcoal-ink/60">
            No screenings scheduled yet. Complete your health profile (the two-minute risk
            assessment on this page) and your personal calendar builds itself from your age,
            sex, and history; your care team can add to it from there.
          </p>
        )}
        {data && data.length > 0 && (
          <ul className="divide-y divide-charcoal-ink/10">
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

              return (
                <li key={schedule.id} className="space-y-2 py-3">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-charcoal-ink">
                      {schedule.screen_type?.name ?? "Screening"}
                    </p>
                    <Badge variant={badge.variant}>{badge.label}</Badge>
                    {schedule.is_recall && <Badge variant="amber">Repeat requested</Badge>}
                  </div>
                  <p className="text-xs text-charcoal-ink/60">
                    Due {formatPatientDate(schedule.due_date)}
                  </p>
                  {schedule.is_recall && schedule.recall_reason && (
                    <p className="text-xs text-charcoal-ink/70">
                      Your care team asked you to repeat this: {schedule.recall_reason}
                    </p>
                  )}
                  {schedule.status === "declined" && schedule.declined_reason && (
                    <p className="text-xs text-charcoal-ink/60">
                      You declined this: {schedule.declined_reason}
                    </p>
                  )}
                  {isDue && canBook && bundle && (
                    <div className="space-y-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={createOrder.isPending}
                        onClick={() =>
                          createOrder.mutate({
                            organisationId: organisationId!,
                            patientId,
                            panelBundleId: bundle.id,
                            screeningScheduleId: schedule.id,
                          })
                        }
                      >
                        {createOrder.isPending ? "Getting it ready…" : "Get this test"}
                      </Button>
                      <p className="text-xs text-charcoal-ink/60">
                        We&apos;ll write you a request to take to any lab you like. You pay the lab
                        directly, then upload the result here for your care team to read.
                      </p>
                      {createOrder.isError && (
                        <p className="text-xs text-red-600">
                          Could not set that up just now. Please try again.
                        </p>
                      )}
                      {bundleIsPartnerBillable(bundle, screenTypePrices) && (
                        <PartnerLabBillingOption
                          patientId={patientId}
                          organisationId={organisationId!}
                          panelBundleId={bundle.id}
                          screeningScheduleId={schedule.id}
                          bundleName={bundle.name}
                          priceKobo={bundle.price_kobo}
                        />
                      )}
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
      </CardContent>
    </Card>
  );
}
