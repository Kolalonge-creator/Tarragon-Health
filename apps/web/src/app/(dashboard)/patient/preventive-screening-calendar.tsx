"use client";

import { useState } from "react";
import { useScreeningSchedules } from "@/lib/queries/screening";
import { todayIsoDate } from "@/lib/queries/medications";
import { useLabCatalogue, useLabProviders, useCreateLabOrder, findSingleTestBundle } from "@/lib/queries/lab-orders";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { SEMANTIC_ICON } from "@/lib/icons";
import { koboToNaira } from "@tarragon/shared";

const STATUS_BADGE: Record<string, { variant: BadgeProps["variant"]; label: string }> = {
  pending: { variant: "amber", label: "Pending" },
  booked: { variant: "blue", label: "Booked" },
  completed: { variant: "green", label: "Completed" },
  overdue: { variant: "red", label: "Overdue" },
};

export function PreventiveScreeningCalendar({
  patientId,
  organisationId,
  bookingEnabled,
}: {
  patientId: string;
  organisationId: string | null;
  /** 'lab_coordination' feature — booking a due screening is a lab-booking
   * action same as the catalogue always was, so it's gated the same way. */
  bookingEnabled: boolean;
}) {
  const { data, isLoading, isError } = useScreeningSchedules(patientId);
  const { data: bundles } = useLabCatalogue();
  const { data: providers } = useLabProviders();
  const createOrder = useCreateLabOrder();
  const today = todayIsoDate();
  const [bookingScheduleId, setBookingScheduleId] = useState<string | null>(null);
  const [providerId, setProviderId] = useState("");

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
            No screenings scheduled yet. Your care team will schedule preventive screenings
            based on your age, sex, and risk profile.
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

              return (
                <li key={schedule.id} className="space-y-2 py-3">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-charcoal-ink">
                      {schedule.screen_type?.name ?? "Screening"}
                    </p>
                    <Badge variant={badge.variant}>{badge.label}</Badge>
                  </div>
                  <p className="text-xs text-charcoal-ink/60">
                    Due {new Date(schedule.due_date).toLocaleDateString()}
                  </p>
                  {isDue && canBook && bundle && (
                    <>
                      {bookingScheduleId === schedule.id ? (
                        <div className="flex flex-wrap items-end gap-2">
                          <div className="space-y-1">
                            <Label htmlFor={`provider-${schedule.id}`}>Lab provider</Label>
                            <Select
                              id={`provider-${schedule.id}`}
                              value={providerId}
                              onChange={(e) => setProviderId(e.target.value)}
                            >
                              <option value="">Select a provider</option>
                              {(providers ?? []).map((p) => (
                                <option key={p.id} value={p.id}>
                                  {p.name} — {p.regions.join(", ")}
                                  {p.home_collection ? " (home collection)" : ""}
                                </option>
                              ))}
                            </Select>
                          </div>
                          <Button
                            size="sm"
                            disabled={!providerId || createOrder.isPending}
                            onClick={() =>
                              createOrder.mutate(
                                {
                                  organisationId: organisationId!,
                                  patientId,
                                  panelBundleId: bundle.id,
                                  providerId,
                                  totalKobo: bundle.price_kobo,
                                  screeningScheduleId: schedule.id,
                                },
                                {
                                  onSuccess: () => {
                                    setBookingScheduleId(null);
                                    setProviderId("");
                                  },
                                }
                              )
                            }
                          >
                            {createOrder.isPending ? "Booking…" : "Confirm booking"}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setBookingScheduleId(null)}
                          >
                            Cancel
                          </Button>
                          {createOrder.isError && (
                            <p className="w-full text-xs text-red-600">
                              Could not book. Try again.
                            </p>
                          )}
                        </div>
                      ) : (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setBookingScheduleId(schedule.id);
                            setProviderId("");
                          }}
                        >
                          Book now — ₦{koboToNaira(bundle.price_kobo).toLocaleString()}
                        </Button>
                      )}
                    </>
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
