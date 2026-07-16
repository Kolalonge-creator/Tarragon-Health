"use client";

import { useState } from "react";
import { useScreeningSchedules } from "@/lib/queries/screening";
import { todayIsoDate } from "@/lib/queries/medications";
import { useLabCatalogue, useCreateLabOrder, findSingleTestBundle } from "@/lib/queries/lab-orders";
import type { FacilityWithServices } from "@/lib/queries/facilities";
import { FacilitySelector, type PatientLocation } from "./facility-selector";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  patientLocation,
}: {
  patientId: string;
  organisationId: string | null;
  /** 'lab_coordination' feature — booking a due screening is a lab-booking
   * action same as the catalogue always was, so it's gated the same way. */
  bookingEnabled: boolean;
  /** Pre-fills the "choose a lab near me" picker; null if the patient hasn't saved one. */
  patientLocation?: PatientLocation | null;
}) {
  const { data, isLoading, isError } = useScreeningSchedules(patientId);
  const { data: bundles } = useLabCatalogue();
  const createOrder = useCreateLabOrder();
  const today = todayIsoDate();
  const [bookingScheduleId, setBookingScheduleId] = useState<string | null>(null);
  const [selectedFacility, setSelectedFacility] = useState<FacilityWithServices | null>(null);

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
                        <div className="space-y-3 rounded-md border border-charcoal-ink/10 p-3">
                          <p className="text-xs font-medium text-charcoal-ink">
                            Choose a lab near you
                          </p>
                          <FacilitySelector
                            type="lab"
                            patientLocation={patientLocation}
                            selectedFacilityId={selectedFacility?.id ?? null}
                            onSelect={setSelectedFacility}
                            idPrefix={`lab-${schedule.id}`}
                            emptyText="No labs listed for that location yet — try a nearby city, or message your care team to arrange it."
                          />
                          {selectedFacility && !selectedFacility.lab_provider_id && (
                            <p className="text-xs text-amber-700">
                              This location can&apos;t take an online booking yet — pick another lab, or
                              message your care team.
                            </p>
                          )}
                          <div className="flex flex-wrap items-center gap-2">
                            <Button
                              size="sm"
                              disabled={
                                !selectedFacility?.lab_provider_id || createOrder.isPending
                              }
                              onClick={() =>
                                createOrder.mutate(
                                  {
                                    organisationId: organisationId!,
                                    patientId,
                                    panelBundleId: bundle.id,
                                    providerId: selectedFacility!.lab_provider_id!,
                                    facilityId: selectedFacility!.id,
                                    totalKobo: bundle.price_kobo,
                                    screeningScheduleId: schedule.id,
                                  },
                                  {
                                    onSuccess: () => {
                                      setBookingScheduleId(null);
                                      setSelectedFacility(null);
                                    },
                                  }
                                )
                              }
                            >
                              {createOrder.isPending
                                ? "Booking…"
                                : `Confirm booking — ₦${koboToNaira(bundle.price_kobo).toLocaleString()}`}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                setBookingScheduleId(null);
                                setSelectedFacility(null);
                              }}
                            >
                              Cancel
                            </Button>
                            {createOrder.isError && (
                              <p className="w-full text-xs text-red-600">
                                Could not book. Try again.
                              </p>
                            )}
                          </div>
                        </div>
                      ) : (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setBookingScheduleId(schedule.id);
                            setSelectedFacility(null);
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
