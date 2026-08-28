"use client";

import { useState } from "react";
import { usePatientDiagnosticRequests, useSetDiagnosticBookingPreference } from "@/lib/queries/diagnostic-requests";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { DiagnosticReportUpload } from "@/components/diagnostic-report-upload";
import type { Database } from "@tarragon/shared";

type RequestStatus = Database["public"]["Enums"]["diagnostic_request_status"];
type TimeOfDay = Database["public"]["Enums"]["lab_order_time_of_day"];

const STATUS_BADGE: Record<RequestStatus, { variant: BadgeProps["variant"]; label: string }> = {
  requested: { variant: "amber", label: "Awaiting your booking" },
  booked: { variant: "blue", label: "Booked" },
  attended: { variant: "blue", label: "Attended" },
  reported: { variant: "blue", label: "Report received" },
  reviewed: { variant: "green", label: "Reviewed by your care team" },
  actioned: { variant: "green", label: "Actioned" },
  cancelled: { variant: "grey", label: "Cancelled" },
};

const TIME_OF_DAY_OPTIONS: { value: TimeOfDay; label: string }[] = [
  { value: "morning", label: "Morning" },
  { value: "afternoon", label: "Afternoon" },
  { value: "evening", label: "Evening" },
];

/** Still open: a request the patient can act on (book a visit, or upload a
 * result once attended). */
const BOOKABLE: RequestStatus[] = ["requested", "booked"];
const UPLOADABLE: RequestStatus[] = ["requested", "booked", "attended"];

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function BookDiagnosticVisit({ requestId, patientId }: { requestId: string; patientId: string }) {
  const [expanded, setExpanded] = useState(false);
  const [facilityName, setFacilityName] = useState("");
  const [scheduledDate, setScheduledDate] = useState(todayIsoDate());
  const [timeOfDay, setTimeOfDay] = useState<TimeOfDay>("morning");
  const bookingPreference = useSetDiagnosticBookingPreference(patientId);

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="text-xs font-medium text-deep-forest hover:underline"
      >
        Book your facility, date & time
      </button>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border border-charcoal-ink/10 bg-warm-ivory/50 p-3">
      <div className="space-y-1.5">
        <Label htmlFor={`facility-${requestId}`}>Facility</Label>
        <Input
          id={`facility-${requestId}`}
          value={facilityName}
          onChange={(e) => setFacilityName(e.target.value)}
          placeholder="Any imaging centre near you"
        />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`visit-date-${requestId}`}>Preferred date</Label>
          <input
            id={`visit-date-${requestId}`}
            type="date"
            min={todayIsoDate()}
            value={scheduledDate}
            onChange={(e) => setScheduledDate(e.target.value)}
            className="flex h-10 w-full rounded-md border border-charcoal-ink/20 bg-white px-3 py-2 text-sm text-charcoal-ink"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`visit-time-${requestId}`}>Preferred time</Label>
          <Select id={`visit-time-${requestId}`} value={timeOfDay} onChange={(e) => setTimeOfDay(e.target.value as TimeOfDay)}>
            {TIME_OF_DAY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </div>
      </div>
      {bookingPreference.isError && (
        <p className="text-xs text-red-600">Could not set that up just now. Please try again.</p>
      )}
      {bookingPreference.isSuccess ? (
        <p className="text-xs text-brand-green">
          Booking preference saved — the facility will confirm your {timeOfDay} visit on{" "}
          {new Date(scheduledDate).toLocaleDateString()}.
        </p>
      ) : (
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            disabled={!facilityName.trim() || bookingPreference.isPending}
            onClick={() =>
              bookingPreference.mutate({
                requestId,
                facilityNameFreetext: facilityName.trim(),
                scheduledDate,
                preferredTimeOfDay: timeOfDay,
              })
            }
          >
            {bookingPreference.isPending ? "Saving…" : "Save booking"}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setExpanded(false)}>
            Never mind
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * Patient's list of diagnostic requests (X-ray/ultrasound/CT/MRI/ECG/echo/
 * mammography/other) their care team has ordered — 15.3 booking, 15.4
 * preparation instructions, and the upload door once they've been. Mirrors
 * LabOrdersList's shape; there is no self-order button anywhere here
 * because a diagnostic request is always clinician-created (see
 * RequestDiagnosticServiceForm's own header comment).
 */
export function DiagnosticRequestsList({ patientId }: { patientId: string }) {
  const { data: requests, isLoading, isError } = usePatientDiagnosticRequests(patientId);

  if (isLoading || isError || !requests || requests.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your diagnostic requests</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-charcoal-ink/10">
          {requests.map((request) => {
            const badge = STATUS_BADGE[request.status];
            return (
              <li key={request.id} className="space-y-2 py-3">
                <div className="flex items-center gap-2">
                  <Badge variant={badge.variant}>{badge.label}</Badge>
                </div>
                <p className="text-sm font-medium text-charcoal-ink">{request.service_name}</p>
                {request.facility_name_freetext && (
                  <p className="text-xs text-charcoal-ink/60">
                    {request.facility_name_freetext}
                    {request.scheduled_date
                      ? ` · ${new Date(request.scheduled_date).toLocaleDateString()}`
                      : ""}
                    {request.preferred_time_of_day ? ` (${request.preferred_time_of_day})` : ""}
                  </p>
                )}
                {BOOKABLE.includes(request.status) && !request.facility_name_freetext && (
                  <BookDiagnosticVisit requestId={request.id} patientId={patientId} />
                )}
                {UPLOADABLE.includes(request.status) && (
                  <DiagnosticReportUpload requestId={request.id} label="Upload your result" />
                )}
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
